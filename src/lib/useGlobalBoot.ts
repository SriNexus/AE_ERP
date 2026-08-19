/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { onAuthStateChanged } from 'firebase/auth';
import { createDocWithId, getAll, resolveWriteCompanyId, updateDocById } from './firestore';
import { COLLECTIONS, auth, firebaseEnv } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { resolveSessionCompanyId } from './tenantRouting';
import { loadCurrentUserProfile, syncCurrentUserProfile } from './userProfile';
import { registerServiceWorker, getFcmToken, persistDeviceToken, deactivateDeviceTokens } from './fcmTokenManager';
import { isOfficialDemoCompany } from '../config/demo';
import { DEMO_COMPANY } from '../config/demoCompany';
import {
  buildRoleCache,
  getCompanyRoleSeedDocuments,
  getMissingSystemRoleSeeds,
  getSystemRoleSeedDocuments,
  normalizeRoleName,
  roleDocumentId,
} from './roleBootstrap';

type RawRoleDocument = {
  id?: unknown;
  name?: unknown;
  schemaVersion?: unknown;
  permissions?: unknown;
};

function validateRoleDocument(role: RawRoleDocument) {
  const diagnostics: string[] = [];
  const name = typeof role.name === 'string' ? role.name.trim() : '';
  const schemaVersion = role.schemaVersion ?? 1;
  if (!name) diagnostics.push('missing-name');
  if (schemaVersion !== 1) diagnostics.push(`unsupported-schema-version:${String(role.schemaVersion)}`);
  if (!role.permissions || typeof role.permissions !== 'object') diagnostics.push('missing-permissions');
  return { valid: diagnostics.length === 0, name, diagnostics };
}

/**
 * Pure decision function for the auth-session reconciliation effect below —
 * extracted so it is directly unit-testable without mounting the hook (this
 * codebase has no @testing-library/react). Returns true when the persisted
 * client "logged in" state has outlived the real Firebase Auth session and
 * must be reconciled via logout().
 */
export function shouldReconcileStaleSession(firebaseUser: unknown, isAuthenticated: boolean): boolean {
  return firebaseUser === null && isAuthenticated;
}

/**
 * Pure decision function for the role-doc self-heal effect's write gate —
 * extracted so it is directly unit-testable. Must match firestore.rules'
 * `roles/{roleId}` create/update requirement EXACTLY: only a Super Admin or
 * the app owner may create/modify a system-protected (isSystem:true) role
 * document (`isAdmin() && (roleNotSystemProtected(...) || isSuperAdmin())`).
 * A plain role:'Admin' user does NOT qualify — the rule intentionally
 * protects the shared system role templates from a single company Admin.
 * Using anything broader here (e.g. role==='Admin') lets a legitimate,
 * correctly-scoped Admin trigger a write the rules will deny, which — since
 * this function gates the ONLY Firestore writes in useGlobalBoot's
 * role-resolution effect — silently prevented the effect from ever reaching
 * setPermissionCache({ready:true,...}) once the previous bug fired: every
 * canDo() check then fails closed, so the user sees a successful login
 * followed by no pages/data rendering anywhere. See the effect's own comment
 * for the full live-verified root-cause chain (2026-08-17).
 */
export function canSelfHealSystemRoles(user: { isSuperAdmin?: boolean; isOwner?: boolean } | null | undefined): boolean {
  return user?.isSuperAdmin === true || user?.isOwner === true;
}

export function useGlobalBoot() {
  const queryClient = useQueryClient();
  const bootstrapState = useRef<{ userId: string | null; seedAttempted: boolean }>({ userId: null, seedAttempted: false });
  const { setGlobalCompany, setCompany, activeCompanyId, setActiveCompanyId, user, roleData, setRoleData, setTeamMemberIds, setPermissionCache, setCompanyGroupIds } = useAppStore();

  // Auth-session reconciliation (root cause: "Missing or insufficient
  // permissions" on every Firestore call while the UI still renders as
  // logged in). `isAuthenticated`/`user` are persisted to localStorage
  // (useAppStore's `neozy-v1` persist key) so a page reload restores the
  // "logged in" UI state instantly, before Firebase Auth's own (separate,
  // IndexedDB-backed) session has had a chance to resolve — and nothing
  // anywhere else in the app subscribes to the real Firebase Auth session
  // to catch the case where it DISAGREES (token revoked/expired past
  // refresh, browser storage cleared, or — the exact trigger here — the
  // configured Firebase project changed underneath a still-persisted
  // session, e.g. switching VITE_FIREBASE_PROJECT_ID between environments).
  // ProtectedRoute only ever reads the persisted `isAuthenticated` flag, so
  // in that mismatch the app renders fully "logged in" and issues every
  // Firestore query as normal — Firestore's rules see request.auth == null
  // and every `signedIn()` check denies, surfacing as a blanket
  // FirebaseError: Missing or insufficient permissions on virtually every
  // read/write, not any one specific module.
  //
  // onAuthStateChanged's first callback is the authoritative signal that
  // Firebase Auth has finished restoring (or failed to restore) a session;
  // reconciling here — and on every subsequent change (expiry, revocation,
  // sign-out in another tab) — keeps the persisted client state from ever
  // outliving the real session. Reuses the store's own logout() so demo
  // sessions are cleaned up identically (clearDemoSession, query cache
  // reset, company context reset) — no separate demo-mode branch needed.
  useEffect(() => {
    if (!firebaseEnv.isConfigured) return;
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (shouldReconcileStaleSession(firebaseUser, useAppStore.getState().isAuthenticated)) {
        useAppStore.getState().logout();
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    // Tenant routing: bind ordinary users to their canonical ERP company.
    // The neutral 'default' placeholder is deliberately NOT bound here — it
    // means "no company resolved yet", and the companies effect below is the
    // authority that resolves it to the default company once the list loads.
    // Forcing 'default' from this effect would fight that resolution and
    // create an infinite setActiveCompanyId loop ("Maximum update depth
    // exceeded" — useAppStore.ts:90 / useGlobalBoot.ts:42).
    const resolvedCompanyId = resolveSessionCompanyId(user, activeCompanyId);
    if (resolvedCompanyId === 'default') return;
    if (resolvedCompanyId !== activeCompanyId) setActiveCompanyId(resolvedCompanyId);
  }, [user?.id, user?.companyId, user?.isOwner, user?.isSuperAdmin, activeCompanyId, setActiveCompanyId]);

  const { data: companies } = useQuery({ queryKey:['companies_global'], queryFn:()=>getAll(COLLECTIONS.COMPANIES,[]), staleTime:1000*60*30, enabled:!!user&&!isOfficialDemoCompany(user?.companyId) });
  // Phase 1 (Multi-Tenant): populate the companyId -> groupId lookup from the
  // companies list ALREADY loaded above — no new Firestore read. resolveWriteGroupId()
  // (src/lib/firestore.ts §3.4) stamps authoritative groupId on writes from this
  // map, so the client can never supply a groupId of its own.
  useEffect(() => {
    if (!companies || companies.length === 0) return;
    const map: Record<string, string> = {};
    for (const co of companies as any[]) {
      if (co?.id && typeof co.groupId === 'string' && co.groupId) map[co.id] = co.groupId;
    }
    if (Object.keys(map).length > 0) setCompanyGroupIds(map);
  }, [companies, setCompanyGroupIds]);
  // Demo user: apply the permanent Demo Company config and skip Firestore companies
  const isDemo = isOfficialDemoCompany(user?.companyId);

  // Root cause (live-verified, 2026-08-19): `user` is persisted to
  // localStorage (useAppStore's `neozy-v1` persist key) so a page reload/
  // resumed session restores the "logged in" identity instantly from cache —
  // but nothing anywhere else in the boot flow ever re-fetches that identity
  // against the live users/{id} Firestore doc. Any server-side profile change
  // made while a browser session stays open (a role promotion, a Group/
  // company reassignment, a new groupId backfilled onto the profile) is
  // therefore invisible to that already-open tab until the user manually
  // logs out and back in. Concretely: promoting admin@neozy.in from 'Admin'
  // to 'GroupAdmin' and stamping groupId='group-csgpl' on their Firestore
  // profile did not update their already-persisted session, which still
  // carried the pre-promotion object with role updated (from an intervening
  // partial state update elsewhere) but no groupId at all — Users.tsx's
  // useGroupCompanies(currentUser?.groupId) then never fires
  // (enabled: !!groupId), groupCompanies stays permanently empty, the
  // Company field never renders (neither auto-assigned nor as a picker), and
  // submit always hits the "Select a Company" guard with nothing to select.
  //
  // Fix: once per resumed/booted session (ref-guarded per user.id, so this
  // never refetches on every render or every page navigation), re-read the
  // actor's own canonical profile and reconcile the persisted identity via
  // the existing syncCurrentUserProfile() — the same normalizeUserProfile()/
  // profileToAppUser() mapping the real login flow already uses, so every
  // field (not just groupId) self-heals to match Firestore. Best-effort and
  // non-blocking: the Owner's synthetic identity has no users/{id} doc by
  // design (skipped), a demo session has its own fixed identity (skipped),
  // and any read failure is swallowed — a stale-but-valid cached identity is
  // still usable, so this must never block boot or log the user out.
  const profileSyncRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id || user.isOwner || isDemo) return;
    if (profileSyncRef.current === user.id) return;
    profileSyncRef.current = user.id;
    let cancelled = false;
    (async () => {
      try {
        const profile = await loadCurrentUserProfile(user.id);
        if (!cancelled) syncCurrentUserProfile(profile);
      } catch {
        // Best-effort self-heal — see comment above.
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.isOwner, isDemo]);

  useEffect(() => {
    // Demo mode: always use the permanent Demo Company configuration
    if (isDemo) {
      // The DEMO_COMPANY config has all required CompanyConfig fields;
      // logo/iconLogo are omitted here because the Login page and Sidebar
      // use DEMO_LOGO_URLS (static PNG imports) instead.
      setGlobalCompany({ ...DEMO_COMPANY });
      setCompany({ ...DEMO_COMPANY });
      document.title = 'Neozy Demo';
      return;
    }

    // Production mode: load company from Firestore
    if (!companies || companies.length === 0) return;
    const defaultCo = companies.find((c: any) => c.isDefault) || companies[0];
    if (defaultCo) {
      const currentGlobal = useAppStore.getState().globalCompany;
      if (currentGlobal?.id !== defaultCo.id) {
        setGlobalCompany(defaultCo as any);
      }
      document.title = `${defaultCo.shortName || defaultCo.name}`;
    }
    // 'default' is a neutral placeholder (post-logout), not a real company id.
    // Ordinary users: resolve it to the default company so company-scoped
    // queries (Home, etc.) use a real id instead of 'default' (which matches
    // no documents). Owner/Super-Admin: resolve it to the existing 'all'
    // sentinel instead — they are the Platform-context identity and must not
    // be silently pinned to whichever company happens to be default just
    // because they logged in (that previously showed that company's data,
    // dashboard and logo as if it were the Owner's own company). 'all' is
    // already a fully-supported neutral value everywhere company-scoped
    // reads/writes resolve it (companyScopedQuery, resolveWriteCompanyId
    // falls back to `company` state below, which still resolves to a real
    // company for any write-fallback need).
    const isOwnerOrSuperAdmin = !!(user?.isOwner || user?.isSuperAdmin);
    if (activeCompanyId === 'default' && defaultCo) {
      setActiveCompanyId(isOwnerOrSuperAdmin ? 'all' : defaultCo.id);
    }
    // Demo-data isolation (root cause): for owner/super-admin sessions the
    // active company is their explicit selection, and a stale
    // 'company-demo-neozy' id left over from a previous demo session (before
    // logout reset it) must not keep pointing production Admin/Super-Admin
    // sessions at the demo dataset. Fall back to the default company for any
    // unresolvable selection.
    // Ordinary users are ALREADY bound to their canonical company by the
    // tenant-routing effect above; overriding that here would fight it and
    // cause an infinite setActiveCompanyId loop ("Maximum update depth
    // exceeded"). The isolation fallback therefore applies to selections only.
    let targetId = activeCompanyId === 'default' ? (isOwnerOrSuperAdmin ? 'all' : defaultCo?.id) : activeCompanyId;
    if (targetId && targetId !== 'all' && defaultCo && isOwnerOrSuperAdmin && !companies.some((c: any) => c.id === targetId)) {
      targetId = defaultCo.id;
      if (activeCompanyId !== targetId) setActiveCompanyId(defaultCo.id);
    }
    if (targetId && targetId !== 'all') {
      const co = companies.find((c: any) => c.id === targetId);
      if (co) {
        const currentCompany = useAppStore.getState().company;
        if (currentCompany?.id !== co.id) {
          setCompany(co as any);
        }
      }
    } else if (defaultCo) {
      const currentCompany = useAppStore.getState().company;
      if (currentCompany?.id !== defaultCo.id) {
        setCompany(defaultCo as any);
      }
    }
  }, [companies, activeCompanyId, isDemo]);

  // Phase 1 (F-03 closure, Master Plan §5.6): the roles query is now
  // Company-scoped via companyScopedQuery() — every role doc carries the
  // companyId of the company it belongs to (per-company keying
  // `${companyId}_${roleName}` for system templates), so the permission
  // bootstrap resolves the current user's role against THEIR company's role
  // documents. Owner/super-admin keep the unscoped platform-wide read (the
  // same exemption as the Phase 0 F-01 companies fix).
  const { data: roles, isError: rolesQueryFailed, error: rolesQueryError } = useQuery({ queryKey:['roles_global'], queryFn:()=>getAll(COLLECTIONS.ROLES), staleTime:1000*60*30, enabled:!!user });
  // Blank-screen safety net: without this, a permanently failing (not merely
  // slow) roles_global query left `roles` undefined forever, the bootstrap
  // effect below's `if (!user || !roles) return;` guard never let `run()`
  // execute, and setPermissionCache({ready:true,...}) was NEVER called — with
  // no error, no timeout, no visible state. RoleRoute (permissionCache.ready)
  // and Sidebar's nav filter (usePermissions().ready) both gate on that same
  // flag, so the user saw a completely blank main panel AND an empty sidebar,
  // indefinitely, with nothing in the UI to explain why. On a genuine query
  // error (not the normal in-flight pending state), this bounds the wait:
  // permissionCache still becomes ready (fail-closed, matching the rest of
  // this codebase's philosophy — an empty role map, not a fabricated one),
  // and RoleRoute can detect the 'roles-query-failed' diagnostic to show a
  // recoverable message instead of an unexplained blank page.
  useEffect(() => {
    if (!user || !rolesQueryFailed) return;
    if (useAppStore.getState().permissionCache.ready) return;
    setPermissionCache({
      ready: true,
      roles: {},
      loadedAt: new Date().toISOString(),
      diagnostics: [`roles-query-failed:${rolesQueryError instanceof Error ? rolesQueryError.message : String(rolesQueryError)}`],
    });
  }, [user?.id, rolesQueryFailed, rolesQueryError, setPermissionCache]);
  // Phase 13: team-hierarchy resolution must be data-driven (any role whose
  // FirestoreRoleDocument sets visibility:'team' on any module), not limited
  // to the two hardcoded legacy role-name strings — a custom/data-driven
  // role can carry 'team' visibility without being named 'Manager'/'TL'.
  // The legacy name check is kept as an OR, never narrowed, so it only ever
  // adds cases where teamMemberIds gets resolved, never removes one.
  const roleHasTeamVisibility = !!roleData?.permissions && Object.values(roleData.permissions as Record<string, { visibility?: string }>).some((modulePermissions) => modulePermissions?.visibility === 'team');
  const isManager = user?.role==='Manager'||user?.role==='TL'||roleHasTeamVisibility;
  const { data: users } = useQuery({ queryKey:['users_hierarchy'], queryFn:()=>getAll(COLLECTIONS.USERS,[]), staleTime:1000*60*30, enabled:!!user&&isManager });
  useEffect(() => {
    if (!user || !users) return;
    setTeamMemberIds(users.filter((u:any)=>u.managerId===user.id).map((u:any)=>u.id));
  }, [user?.id, users, setTeamMemberIds]);

  useEffect(() => {
    if (!user || !roles) return;
    if (bootstrapState.current.userId !== user.id) {
      bootstrapState.current = { userId: user.id, seedAttempted: false };
    }

    const diagnostics: string[] = [];
    let cancelled = false;

    const run = async () => {
      let currentRoles = roles as RawRoleDocument[];
      const missingSystemRoles = getMissingSystemRoleSeeds(currentRoles);
      const seedByRole = new Map(getSystemRoleSeedDocuments().map((seed) => [normalizeRoleName(seed.name), seed] as const));

      // Root cause (live-verified, 2026-08-17): system role docs (Admin,
      // Director, Manager, ...) are seeded with isSystem:true, and
      // firestore.rules' `roles/{roleId}` create/update rules require
      // isAdmin() AND (roleNotSystemProtected(...) || isSuperAdmin()) — i.e.
      // ONLY a Super Admin (or the app owner) may create/modify a
      // system-protected role document; a plain role:'Admin' user is
      // correctly denied by design (protects the shared system role
      // templates from a single compromised/over-trusted company Admin).
      // This self-heal block previously gated on ANY role:'Admin' user
      // (isAdminUser), so a plain Admin whose live role doc was missing a
      // newly-added module (e.g. `payouts`/`scheme_registration`, added by
      // later phases after their role doc was seeded) would trigger an
      // updateDocById() the rules reject — an UNCAUGHT rejection inside this
      // async function (no try/catch), which aborted `run()` before
      // setRoleData()/setPermissionCache({ready:true,...}) ever executed.
      // Net effect: permissionCache.ready stayed false forever for that
      // session, so every canDo() check failed closed — the user saw a
      // successful login with NO pages/data rendering, and the console
      // showed exactly "Uncaught (in promise) FirebaseError: Missing or
      // insufficient permissions" at this effect's location.
      //
      // Fix, in two parts:
      // 1. Gate the self-heal WRITE attempts on genuine Super
      //    Admin/Owner status (matching what the rules actually require),
      //    not merely role==='Admin' — a plain Admin simply skips self-heal
      //    (canDo() already degrades gracefully per-module when a role's
      //    permissions map is missing a key — see permissions.ts) instead of
      //    attempting a write the rules will deny.
      // 2. try/catch the writes regardless, so ANY future denial (a
      //    plain Admin, a network error, a rules change) can never again
      //    prevent roleData/permissionCache from being set from whatever
      //    role data IS currently available — self-heal is best-effort and
      //    must never block the boot-critical path.
      const canSelfHeal = canSelfHealSystemRoles(user);

      if (missingSystemRoles.length > 0 && canSelfHeal && !bootstrapState.current.seedAttempted) {
        bootstrapState.current.seedAttempted = true;
        try {
          // Phase 1 (F-03 closure): seeds are written as per-company role
          // documents — id `${companyId}_${roleName}`, companyId stamped — so
          // the company-scoped roles read resolves them (the old name-keyed
          // shared-template write would be invisible to the scoped query). The
          // seed target is the resolved write-time company: the company the
          // current session's permission bootstrap is scoped to. Fail closed
          // (skip) when no real company resolves — an owner/super-admin in
          // the neutral pre-boot window must not write a malformed role doc.
          const seedCompanyId = resolveWriteCompanyId();
          if (!seedCompanyId) {
            diagnostics.push('role-seed-skipped:no-company');
          } else {
            const companySeeds = missingSystemRoles.map((role) => ({
              ...role,
              id: roleDocumentId(seedCompanyId, String(role.name || role.id)),
              companyId: seedCompanyId,
            }));
            await Promise.all(
              companySeeds.map((role) => createDocWithId(COLLECTIONS.ROLES, String(role.id), role as any))
            );
            currentRoles = [...currentRoles, ...companySeeds];
          }

          queryClient.setQueryData(['roles_global'], currentRoles);
          queryClient.setQueryData(['roles'], currentRoles);
        } catch (error) {
          diagnostics.push(`role-seed-failed:${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const migratedRoles: RawRoleDocument[] = [];
      if (canSelfHeal) {
        for (const role of currentRoles) {
          const key = normalizeRoleName(role.name);
          const seed = seedByRole.get(key);
          if (!seed || !role.id) continue;

          const currentPermissions = role.permissions && typeof role.permissions === 'object' ? role.permissions as Record<string, Record<string, unknown>> : {};
          const nextPermissions: Record<string, Record<string, unknown>> = { ...currentPermissions };
          let changed = false;

          for (const [moduleName, seedModulePermissions] of Object.entries(seed.permissions)) {
            const modulePermissions = currentPermissions[moduleName] && typeof currentPermissions[moduleName] === 'object'
              ? currentPermissions[moduleName]
              : undefined;
            const mergedModulePermissions = {
              ...(seedModulePermissions as Record<string, unknown>),
              ...(modulePermissions || {}),
            };

            const missingPermission = Object.keys(seedModulePermissions).some((permissionKey) => {
              return (modulePermissions as Record<string, unknown> | undefined)?.[permissionKey] === undefined;
            }) || !modulePermissions;

            if (missingPermission) {
              changed = true;
            }

            nextPermissions[moduleName] = mergedModulePermissions;
          }

          if (!changed) continue;

          migratedRoles.push({
            ...role,
            id: String(role.id),
            name: String(role.name || seed.name),
            schemaVersion: 1,
            permissions: nextPermissions,
          });
        }

        if (migratedRoles.length > 0) {
          try {
            await Promise.all(
              migratedRoles.map((role) => updateDocById(COLLECTIONS.ROLES, String(role.id), role as any))
            );
            currentRoles = currentRoles.map((role) => {
              const migrated = migratedRoles.find((next) => String(next.id) === String(role.id));
              return migrated || role;
            });
            queryClient.setQueryData(['roles_global'], currentRoles);
            queryClient.setQueryData(['roles'], currentRoles);
          } catch (error) {
            diagnostics.push(`role-migration-failed:${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      const roleMap = buildRoleCache(currentRoles);
      for (const role of currentRoles) {
        const result = validateRoleDocument(role);
        if (!result.valid) {
          diagnostics.push(`role:${result.name || String(role.id || 'unknown')}:${result.diagnostics.join(',')}`);
        }
      }

      if (cancelled) return;

      const currentRole = currentRoles.find((role) => normalizeRoleName(role.name) === normalizeRoleName(user.role));
      setRoleData(currentRole || null);

      setPermissionCache({
        ready: true,
        roles: roleMap,
        loadedAt: new Date().toISOString(),
        diagnostics,
      });
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, user?.isSuperAdmin, roles, queryClient, setPermissionCache, setRoleData]);

  // Phase 9B: Passive FCM device token registration
  // Only attempts to register if notification permission is already granted.
  // Does NOT request permission — that requires user action.
  useEffect(() => {
    if (!user?.id) return;
    if (isDemo) return; // Skip for demo users
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (window.Notification.permission !== 'granted') return;

    let cancelled = false;

    const setupFcm = async () => {
      try {
        const sw = await registerServiceWorker();
        if (!sw || cancelled) return;
        const token = await getFcmToken();
        if (token && !cancelled) {
          await persistDeviceToken(token);
        }
      } catch {
        // FCM setup is best-effort — failures are non-critical
      }
    };

    void setupFcm();

    return () => {
      cancelled = true;
    };
  }, [user?.id, isDemo]);

  // Phase 9B: Deactivate device tokens on logout
  // Uses a ref to track previous user state to avoid premature cleanup on initial mount
  // when user is null before auth resolves.
  const logoutCleanupRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const prevUserId = logoutCleanupRef.current;
    logoutCleanupRef.current = user?.id || null;

    // Only deactivate when transitioning from logged-in to logged-out
    // (prevUserId is undefined on initial mount — skip that case)
    if (prevUserId && !user?.id) {
      void deactivateDeviceTokens();
    }
  }, [user?.id]);
}
