import {
  collection, doc, getDocs, getDoc, addDoc, setDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit,
  startAfter, QueryConstraint, Timestamp, serverTimestamp, onSnapshot,
  DocumentData, writeBatch as firebaseWriteBatch,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db, COLLECTIONS, firebaseEnv } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { sanitizePayload } from './sanitizer';
import { buildProjectVisibilityQueryPlan, filterVisibleProjectRecords, isProjectScopedCollection } from './projectVisibility';
import { buildOwnershipVisibilityQueryPlan } from './ownershipVisibility';
import type { Visibility } from './permissions';
import { formatGeneralDate, formatGeneralNumber, getGeneralSettingsRuntime } from '../features/settings/generalRuntime';
import { filterManageableUsers } from './ownerAccess';
import { DEMO_COMPANY_ID } from '../config/demo';
import { isDemoCapabilityAllowed } from './demoCapabilityPolicy';
import { getCachedPartnerDocId, resolveCurrentPartnerDocId } from './partnerOwnership';

export type DocWithId<T = DocumentData> = T & { id: string };

const NOT_CONFIGURED_MSG = 'Firebase is not configured. This application requires a valid Firebase configuration. Sign in with demo@neozy.in on the deployed application, or configure VITE_FIREBASE_* environment variables for local development.';

// ═══════════════════════════════════════════════════════════
//  ENTERPRISE QUERY ENGINE — Centralized Filtering
// ═══════════════════════════════════════════════════════════

function isRealCompanyId(id: string | undefined | null): id is string {
  // 'group' is the Group-view sentinel (activeCompanyId, Master Plan §7.2) —
  // not a real company id. Omitting it here let a Group Admin's "All
  // Companies (Group view)" selection flow straight into
  // resolveWriteCompanyId(), stamping the literal string "group" as a new
  // document's companyId (e.g. Users.tsx's create-user form, which has no
  // company field of its own and falls through entirely to this resolver) —
  // the root cause of Group Admin user creation silently failing/producing
  // an unusable record.
  return !!id && id !== 'all' && id !== 'default' && id !== 'group';
}

function isRealGroupId(id: string | undefined | null): id is string {
  return !!id && id !== 'all' && id !== 'default';
}

/**
 * Resolve the write-time company for a record creation. Never returns the
 * neutral 'default' placeholder — a real company must be resolvable from the
 * active selection, the loaded company config, or the user's canonical ERP
 * profile, otherwise the caller must fail closed (see createDoc/createDocWithId).
 * This prevents the Admin companyId='default' defect class: records must not be
 * written under an invalid tenant that the rules then reject.
 */
export function resolveWriteCompanyId(): string {
  const state = useAppStore.getState();
  return isRealCompanyId(state.activeCompanyId)
    ? state.activeCompanyId
    : isRealCompanyId(state.company?.id)
      ? state.company!.id
      : isRealCompanyId(state.user?.companyId)
        ? state.user!.companyId!
        : '';
}

/**
 * PHASE 1 (Multi-Tenant) — authoritative Group resolution at write time
 * (Master Plan §3.4, implementation-critical, non-negotiable).
 *
 * Mirrors resolveWriteCompanyId() exactly: the groupId is NEVER client-
 * supplied — it is derived from the resolved write-time companyId's owning
 * Group, looked up from the ALREADY-LOADED company state (the app loads the
 * companies list at boot via useGlobalBoot; the store's companyGroupIds map
 * is populated from those documents — no new Firestore read is required).
 *
 * Resolution order:
 *  1. the explicit target companyId, when given and real (callers that
 *     resolved a payload companyId pass it so cross-company writes by
 *     owner/super-admin still stamp the TARGET company's Group)
 *  2. the standard resolveWriteCompanyId() result
 *  3. the loaded companyGroupIds map (populated at boot from the companies
 *     collection — includes the target company for multi-company-capable
 *     identities)
 *  4. the active company config object's own groupId (covers demo mode and
 *     the pre-boot window where the map is not yet populated)
 *  5. '' — fail closed: never persist a placeholder Group, exactly like the
 *     companyId fail-closed convention. A missing groupId is inert until
 *     Phase 2 begins enforcing it; the Phase 1 backfill catches up history.
 */
export function resolveWriteGroupId(companyId?: string): string {
  const state = useAppStore.getState();
  const targetCompanyId = isRealCompanyId(companyId) ? companyId : resolveWriteCompanyId();
  if (!isRealCompanyId(targetCompanyId)) return '';

  const fromMap = state.companyGroupIds?.[targetCompanyId];
  if (isRealGroupId(fromMap)) return fromMap;

  const config = state.company?.id === targetCompanyId
    ? state.company
    : state.globalCompany?.id === targetCompanyId
      ? state.globalCompany
      : null;
  const fromConfig = config?.groupId;
  if (isRealGroupId(fromConfig)) return fromConfig;

  return '';
}

/**
 * Resolves the write-time company's own `companyCode` — the existing,
 * data-driven template/theme selector documents already key off
 * (src/templates/documents/PI/index.ts, src/templates/documents/shared/theme.ts:
 * `company.companyCode === 'CGPL' | 'STS'`). Generated-document `templateUsed`
 * fields must be stamped from THIS, never a literal company-name string —
 * every company's own companyCode, whatever it is, resolves correctly here;
 * an unrecognized code (e.g. a company that isn't CGPL/STS) simply falls
 * through those templates' own default branch, exactly as intended.
 * Mirrors resolveWriteGroupId()'s lookup order (explicit target id, else the
 * standard resolveWriteCompanyId() result), reading the already-loaded
 * `company`/`globalCompany` config objects — no extra Firestore read.
 */
export function resolveWriteCompanyCode(companyId?: string): string {
  const state = useAppStore.getState();
  const targetCompanyId = isRealCompanyId(companyId) ? companyId : resolveWriteCompanyId();
  if (!isRealCompanyId(targetCompanyId)) return '';

  const config = state.company?.id === targetCompanyId
    ? state.company
    : state.globalCompany?.id === targetCompanyId
      ? state.globalCompany
      : null;
  return typeof config?.companyCode === 'string' ? config.companyCode.trim() : '';
}

/**
 * PHASE 1 (Multi-Tenant) — collections EXCLUDED from the write-helper
 * `groupId` auto-stamping (Master Plan §3.2's explicit exclusion list):
 *   - `companies`      — it IS the thing groupId is looked up from; its own
 *     groupId is assigned by the Phase 1 backfill (and later the Super Admin
 *     Groups UI), never derived from itself.
 *   - `roles`          — per §5.6, role documents are Company-scoped, NOT
 *     Group-scoped; they carry companyId only.
 *   - `users`          — own groupId semantics per §3.2 (GroupAdmin's group at
 *     creation; derived+optional for other roles) — handled in the users
 *     write path, not the generic helper.
 *   - `user_auth_maps` — mirrors users.groupId (authIdentity write path).
 *   - `groups` / `group_members` / `platform_settings` / `demo_operations` /
 *     `backup_metadata` — platform-level collections, no tenant scoping.
 */
const GROUP_ID_EXCLUDED_COLLECTIONS = new Set<string>([
  COLLECTIONS.COMPANIES,
  COLLECTIONS.ROLES,
  COLLECTIONS.USERS,
  COLLECTIONS.USER_AUTH_MAPS,
  COLLECTIONS.GROUPS,
  COLLECTIONS.GROUP_MEMBERS,
  COLLECTIONS.PLATFORM_SETTINGS,
  COLLECTIONS.DEMO_OPERATIONS,
  'backup_metadata',
]);

// Phase 4 (Master Plan §6): platform-level collections owned by the Super
// Admin control plane. These collections carry NO tenant scoping — their
// documents have no companyId (groups, group_members, platform_settings,
// backup_metadata) and the rules gate them to the owner/Super Admin identity
// (plus GroupAdmin own-Group reads on groups/group_members). The generic
// write helpers therefore must NOT stamp companyId onto them (the Group
// stamp is already skipped via GROUP_ID_EXCLUDED_COLLECTIONS): the Master
// Plan §3.1 schemas list no companyId on these documents, and a stray
// companyId would be a schema violation (and, worse, would let a forged
// companyId ride on a platform write). The control plane's mutations go
// through platformAdmin.ts, which uses raw Firestore writes for the
// groupId-bearing paths (group_members grant, users groupId assignment,
// company bootstrap) precisely because the generic helpers deliberately
// strip client-supplied groupId.
const PLATFORM_COLLECTIONS = new Set<string>([
  COLLECTIONS.GROUPS,
  COLLECTIONS.GROUP_MEMBERS,
  COLLECTIONS.PLATFORM_SETTINGS,
  COLLECTIONS.DEMO_OPERATIONS,
  'backup_metadata',
]);

// Phase 4 (Master Plan §6.5/§6.7): platform-wide reads by the Super Admin
// control plane. The owner/Super Admin identity may read these collections
// platform-wide at the rules layer (isOwnerIdentity()/isSuperAdmin() are
// unconditional in every relevant read rule), and the Master Plan's platform
// screens (Groups, Companies, Users, Security, Settings) all need the FULL
// dataset regardless of the actor's activeCompanyId — a company constraint
// would silently return only one tenant's rows. getAllPlatform() is the only
// client read path for them: raw getDocs with NO company/ownership
// constraint, guarded to the owner/Super Admin identity (fail closed).
const PLATFORM_READ_COLLECTIONS = new Set<string>([
  COLLECTIONS.GROUPS,
  COLLECTIONS.GROUP_MEMBERS,
  COLLECTIONS.PLATFORM_SETTINGS,
  COLLECTIONS.SECURITY_LOGS,
  COLLECTIONS.AUDIT_LOGS,
  'backup_metadata',
  COLLECTIONS.COMPANIES,
  COLLECTIONS.USERS,
]);

// Phase 3 (F-07, Master Plan §8.1/§8.3): the collections whose records are
// warehouse-scoped — the actor's own warehouseId must equal the record's
// warehouseId (rules-level sameWarehouse()) AND the client query must carry
// the warehouseId equality so the list query stays provable (the §8.3
// query-engine narrowing). §8.1 deliberately scopes this to stock / dispatch /
// goods_receipts ("the three collections where warehouse-level data actually
// differs meaningfully"); stock_ledger is included because it is the movement
// ledger of stock — it carries warehouseId and would otherwise leak every
// warehouse's stock movements through the ledger path (audit §17 row: Stock
// Ledger shares stock's residual "cross-warehouse access within company"
// risk). The warehouses collection itself stays company-readable by design
// (§8.1 note in firestore.rules: warehouse metadata is needed for selection
// across roles, and the explicit warehouses block governs it separately).
const WAREHOUSE_SCOPED_COLLECTIONS = new Set<string>([
  COLLECTIONS.STOCK,
  COLLECTIONS.STOCK_LEDGER,
  COLLECTIONS.DISPATCH,
  COLLECTIONS.GOODS_RECEIPTS,
]);

// §8.2: warehouse-restricted roles are the existing warehouse-adjacent roles
// (Warehouse / Operations). Mirrors the rules' actorIsWarehouseRestricted()
// regex exactly (roleMatches('.*Warehouse.*') / roleMatches('.*Operations.*')).
// Every other role (Admin, GroupAdmin, Director, Manager, ...) is unaffected.
export function isWarehouseRestrictedRole(role: string | undefined | null): boolean {
  return !!role && (/.*Warehouse.*/.test(role) || /.*Operations.*/.test(role));
}

/**
 * Canonical READ-time tenant id — the single source of truth for company
 * scoping in the query core (getAll/getAllDeleted/applyAccessFilters and the
 * aggregation/search engines).
 *
 * NEVER returns the neutral 'default' placeholder: activeCompanyId is
 * 'default' in the persisted store until useGlobalBoot resolves it, and
 * feeding that raw value into where('companyId','==','default') was the Admin
 * companyId='default' 403-storm root cause (dashboard aggregation queries,
 * leads/dispatch/orders reads, notification snapshots, project/ownership
 * visibility plans).
 *
 * Resolution order:
 *  1. real activeCompanyId (explicit owner/super-admin selection, or the
 *     tenant-routed id useGlobalBoot set)
 *  2. the loaded company config id (real only)
 *  3. the user's canonical ERP profile companyId (real only)
 *  4. '' — fail closed: the caller must not issue a company-scoped query.
 *
 * 'all' is preserved as-is for owner/super-admin global reads (the plan
 * builders translate it to an empty company constraint).
 *
 * Phase 2 (Master Plan §9.4): the 'group' sentinel is recognized and passed
 * through, parallel to the 'all' sentinel — when a Group Admin's active
 * context is Group-view mode, companyScopedQuery() translates it to a
 * groupId constraint (the rules' sameGroup() additive-OR makes that query
 * provable).
 */
export function resolveReadCompanyId(): string {
  const state = useAppStore.getState();
  if (state.activeCompanyId === 'all') return 'all';
  if (state.activeCompanyId === 'group') return 'group';
  return resolveWriteCompanyId();
}

/**
 * Builds architecture-level constraints for every query.
 * Handles Multi-Company isolation, Soft Deletes, and Role-Based scopes.
 *
 * Fail-closed tenant guard (Admin companyId='default' 403-storm root cause):
 * for an authenticated NON-owner/non-super-admin identity whose effective
 * company resolves to the neutral 'default' placeholder, the ERP profile has
 * no real company — issuing the query would only produce a storm of
 * Firestore permission-denied errors. Throw instead so the UI surfaces a
 * clear tenant-context error. The owner/super-admin identity may legitimately
 * sit in the neutral pre-boot state ('default' is resolved by useGlobalBoot
 * from the companies list), so it returns no constraint during that window.
 *
 * Identity-not-ready guard (Admin /users runtime-storm root cause): callers
 * must gate protected queries on identity/permission readiness (see
 * usePermissions().ready) before firing them at all. This function is the
 * last line of defense for any caller that isn't yet gated — previously an
 * unresolved `user` (still null, e.g. mid-boot) fell through the `!companyId`
 * branch and returned an EMPTY constraint array, which sent a completely
 * unscoped list query to Firestore. Firestore cannot prove such a query safe
 * against a rule that depends on resource.data (sameCompany), so it denies it
 * outright — a raw, unfriendly permission-denied that is indistinguishable
 * from a real defect. Fail closed with the same clear error instead.
 */
export function companyScopedQuery(colName: string): QueryConstraint[] {
  const { activeCompanyId, user } = useAppStore.getState();

  // Phase 2 (Master Plan §9.4): Group-view mode — the active context is the
  // GroupAdmin's authoritative Group. The groupId comes from the booted
  // identity (user.groupId — the GroupAdmin's group, §3.2); the rules'
  // groupAdminCanRead()/sameGroup() branches make `where('groupId','==',...)`
  // provable for a Group Admin (including on `companies`, whose docs carry
  // groupId per §3.2), and groupId itself is write-helper-stamped, never
  // client-controlled. Only a GroupAdmin identity may resolve this branch
  // (the boot flow never sets 'group' for other roles). Placed BEFORE the
  // companies/roles special-casing so Group-view lists never fall through to
  // a companyId constraint.
  if (activeCompanyId === 'group') {
    const groupId = user?.groupId;
    if (!groupId) {
      throw new Error(
        'Group context is not resolved: the Group Admin identity has no authoritative groupId. ' +
        'Contact an administrator to repair the user profile.'
      );
    }
    return [where('groupId', '==', groupId)];
  }

  // F-01 (Phase 0): `companies` was previously returned with NO constraint by
  // design ("global, unscoped" collection), but firestore.rules now scopes its
  // read to the actor's own company (Super Admin/owner remain platform-wide).
  // Leaving the client query unscoped would reproduce the documented "Failed to
  // load data" regression class: Firestore cannot prove an unscoped list query
  // safe against a per-document rule and denies the whole list. Scoping the
  // query to the actor's own company keeps list queries provable for ordinary
  // users; owner/super-admin keep the unscoped read they are exempted for at
  // the rules layer.
  //
  // F-03 closure (Phase 1, Master Plan §5.6): `roles` is now Company-scoped —
  // role documents are per-company keyed (`${companyId}_${roleName}` for system
  // templates, ROL-* ids for custom roles) and carry the owning companyId, so a
  // company-scoped read resolves the current user's role against THEIR company's
  // role documents. Owner/super-admin keep the unscoped platform-wide read (the
  // same exemption as the Phase 0 F-01 companies fix; the rules' sameCompany()
  // grants them the same bypass).
  if (colName === COLLECTIONS.COMPANIES || colName === COLLECTIONS.ROLES) {
    if (user?.isOwner || user?.isSuperAdmin) return [];
    const companyId = isRealCompanyId(activeCompanyId) ? activeCompanyId : user?.companyId;
    if (!companyId || companyId === 'default') {
      if (user?.isOwner || user?.isSuperAdmin) return [];
      throw new Error(
        'Tenant context is not resolved: the authenticated ERP identity has no valid companyId. ' +
        'Contact an administrator to repair the user profile.'
      );
    }
    return [where('companyId', '==', companyId)];
  }

  if (!user) {
    throw new Error(
      'Identity context is not resolved yet: the ERP identity has not finished loading. ' +
      'This query must wait for authentication to complete.'
    );
  }

  const companyId = isRealCompanyId(activeCompanyId)
    ? activeCompanyId
    : user.companyId;

  if (!companyId || companyId === 'default') {
    if (user.isOwner || user.isSuperAdmin) return [];
    throw new Error(
      'Tenant context is not resolved: the authenticated ERP identity has no valid companyId. ' +
      'Contact an administrator to repair the user profile.'
    );
  }
  const constraints: QueryConstraint[] = [where('companyId', '==', companyId)];

  // Phase 3 (F-07, Master Plan §8.3): warehouse-scoped query narrowing — for
  // the warehouse-scoped collections (stock / stock_ledger / dispatch /
  // goods_receipts), a warehouse-restricted role (Warehouse / Operations,
  // matching the rules' actorIsWarehouseRestricted()) MUST carry the
  // warehouseId equality in the query itself. This keeps the list query
  // provable against the rules' sameWarehouse() gate (Firestore cannot prove
  // an unscoped query against a per-document rule and denies the whole list —
  // the same F-01 class this function already solves for companyId) and makes
  // the restriction structural, not a client-side filter. Fail closed: a
  // warehouse-restricted actor with no authoritative warehouseId cannot
  // construct a safe query at all (they may only ever see own-warehouse
  // records). Owner / Super Admin bypass (rules-level exemption) — but the
  // warehouseId is taken from the authoritative identity, never from the
  // client.
  if (WAREHOUSE_SCOPED_COLLECTIONS.has(colName) && isWarehouseRestrictedRole(user.role)) {
    const warehouseId = user.warehouseId;
    if (!warehouseId) {
      throw new Error(
        'Warehouse context is not resolved: the authenticated identity has no authoritative warehouseId. ' +
        'Contact an administrator to assign the user to a warehouse.'
      );
    }
    constraints.push(where('warehouseId', '==', warehouseId));
  }
  return constraints;
}

const COLLECTION_PERMISSION_MODULE: Record<string, string> = {
  [COLLECTIONS.USERS]: 'users',
  [COLLECTIONS.COMPANIES]: 'companies',
  [COLLECTIONS.LEADS]: 'leads',
  [COLLECTIONS.CUSTOMERS]: 'customers',
  [COLLECTIONS.PROJECTS]: 'projects',
  [COLLECTIONS.SURVEYS]: 'surveys',
  [COLLECTIONS.ENGINEERING_DESIGNS]: 'engineering',
  [COLLECTIONS.PRODUCTS]: 'products',
  [COLLECTIONS.PRODUCT_CATEGORIES]: 'categories',
  [COLLECTIONS.WAREHOUSES]: 'warehouses',
  [COLLECTIONS.STOCK]: 'stock',
  [COLLECTIONS.STOCK_LEDGER]: 'stock',
  [COLLECTIONS.ORDERS]: 'orders',
  [COLLECTIONS.PROFORMA_INVOICES]: 'invoices',
  [COLLECTIONS.TAX_INVOICES]: 'tax_invoices',
  [COLLECTIONS.QUOTATIONS]: 'quotations',
  [COLLECTIONS.DISPATCH]: 'dispatch',
  [COLLECTIONS.PAYMENTS]: 'payments',
  [COLLECTIONS.LOAN_APPLICATIONS]: 'loan_applications',
  [COLLECTIONS.EMPLOYEES]: 'employees',
  [COLLECTIONS.ATTENDANCE]: 'attendance',
  [COLLECTIONS.PAYROLL]: 'payroll',
  [COLLECTIONS.ROLES]: 'roles',
  // Channel Partner records are owned by the linked user (channel_partners.userId)
  // rather than createdBy — Phase 1 identity: partner self-read must resolve
  // through the canonical userId link (CP spec §7/§9.1), so visibility for this
  // collection follows the 'partners' module permission.
  [COLLECTIONS.CHANNEL_PARTNERS]: 'partners',
  // Phase 6 (Channel Partner — Vendor Lock / Registration): the module key is
  // 'scheme_registration' (no trailing s) — maps the collection so
  // resolveVisibility() honors the seeded role visibility (Partner self /
  // Manager team / Management all) instead of falling back to 'self'.
  [COLLECTIONS.SCHEME_REGISTRATIONS]: 'scheme_registration',
};

// ── Convert Firestore doc snapshot → plain JS object ─────────
export function fromDoc<T = DocumentData>(snap: { id: string; data: () => DocumentData }): DocWithId<T> {
  const data = snap.data();
  const cleaned: DocumentData = {};
  for (const key in data) {
    const val = data[key];
    cleaned[key] = val instanceof Timestamp ? val.toDate().toISOString() : val;
  }
  
  // Safe Fallback for Legacy Documents (Migration Safety)
  if (cleaned.isDeleted === undefined) cleaned.isDeleted = false;
  if (!cleaned.companyId) cleaned.companyId = 'default';

  return { ...cleaned, id: snap.id } as DocWithId<T>;
}

// Collections whose access is already gated by something other than
// self/team/all record ownership (shared config, or a parent-entity's own
// gating for Documents) — applyAccessFilters() short-circuits these to
// 'all' per-doc below regardless of role, so query-level scoping in getAll()
// must never narrow them either (see isOwnershipScopedCollection()).
const OWNERSHIP_EXEMPT_COLLECTIONS = new Set<string>([
  COLLECTIONS.COMPANIES, COLLECTIONS.ROLES, COLLECTIONS.SETTINGS, COLLECTIONS.DOCUMENTS,
]);

/** Single source of truth for a collection's resolved self/team/all visibility, reused by both the query-planning layer (getAll) and the in-memory defense-in-depth filter (applyAccessFilters). */
export function resolveVisibility(col: string): Visibility {
  if (OWNERSHIP_EXEMPT_COLLECTIONS.has(col)) return 'all';
  const { user, roleData } = useAppStore.getState();
  // Phase 2 (Master Plan §5.2): GroupAdmin is a SCOPE extension with Admin
  // grants — record-level visibility is 'all' exactly like Admin (the rules
  // restrict WHICH companies they can reach via sameGroup; within the Group
  // they are Admin-equivalent, incl. per-Company Admin role customizations).
  if (user?.role === 'Admin' || user?.role === 'GroupAdmin') return 'all';
  if (roleData && roleData.permissions) {
    const moduleKey = COLLECTION_PERMISSION_MODULE[col] || col;
    const modulePermissions = roleData.permissions[moduleKey] || roleData.permissions[col];
    return modulePermissions?.visibility || 'self';
  }
  return 'self';
}

// Collections eligible for query-level self/team scoping in getAll() — every
// non-project-scoped collection except the ownership-exempt ones above and
// Users (Users' own visibility filtering must never narrow the raw fetch:
// useGlobalBoot's team-hierarchy resolution reads every company User's
// managerId to compute teamMemberIds in the first place, so scoping that
// same read by teamMemberIds would be circular).
export function isOwnershipScopedCollection(col: string): boolean {
  return !isProjectScopedCollection(col) && col !== COLLECTIONS.USERS && !OWNERSHIP_EXEMPT_COLLECTIONS.has(col);
}

export function applyAccessFilters<T = DocumentData>(
  col: string,
  docs: DocWithId<T>[],
  /** Phase 3: the authenticated partner's channel_partners DOC id (null for
   *  non-partner users). Falls back to the session cache so synchronous call
   *  sites (listenCollection) still match partnerId-keyed records once the
   *  cache is warm. */
  partnerDocId: string | null = getCachedPartnerDocId(),
): DocWithId<T>[] {
  if (col === COLLECTIONS.USERS) docs = filterManageableUsers(docs);
  const state = useAppStore.getState();
  const { user, roleData, teamMemberIds, activeCompanyId } = state;
  const globalCols = [COLLECTIONS.COMPANIES, COLLECTIONS.ROLES];

  const visibility = resolveVisibility(col);

  // Canonical read tenant — never the neutral 'default' placeholder (which
  // would filter every real-company record out AND, in getAll, be sent to
  // Firestore as where('companyId','==','default') — the Admin 403 storm).
  const effectiveCompanyId = resolveReadCompanyId();

  // Phase 2 (§9.4): in Group-view mode ('group' sentinel) the in-memory
  // defense-in-depth filter keys off the denormalized groupId (matching the
  // query-level where('groupId','==',...) constraint) instead of companyId —
  // a Group Admin's list spans every Company in their Group.
  const effectiveGroupId = effectiveCompanyId === 'group' ? state.user?.groupId : '';

  const companyFiltered = docs.filter((docData: any) => {
    if (docData.isDeleted === true) return false;
    if (!globalCols.includes(col as any) && effectiveCompanyId && effectiveCompanyId !== 'all') {
      if (effectiveCompanyId === 'group') {
        if (!effectiveGroupId || docData.groupId !== effectiveGroupId) return false;
      } else if (docData.companyId !== effectiveCompanyId) {
        return false;
      }
    }

    // Phase 3 (F-07, Master Plan §8.3): in-memory defense-in-depth for the
    // warehouse-scoped collections — a warehouse-restricted role (Warehouse /
    // Operations) may only ever hold records of their OWN warehouse. This
    // mirrors the query-level where('warehouseId','==',...) narrowing in
    // companyScopedQuery() and the rules' sameWarehouse() gate; like the
    // companyId filter above, it is belt-and-braces behind the real security
    // boundary (Firestore rules), never the boundary itself.
    if (WAREHOUSE_SCOPED_COLLECTIONS.has(col) && isWarehouseRestrictedRole(user?.role)) {
      if (!user?.warehouseId || docData.warehouseId !== user.warehouseId) return false;
    }

    // Settings documents are already scoped by deterministic document ID and
    // Firestore rules; they do not carry the entity ownership fields below.
    if (col === COLLECTIONS.SETTINGS) return true;

    // Shared case Documents (Lead/Customer/Project Documents sections) have
    // no per-document "owner" concept and are not their own permission
    // module — access is already correctly gated by whichever parent entity
    // (Project/Customer/Lead) the user opened to reach this section in the
    // first place. Falling through to the default self/team ownership
    // check below would hide teammates' uploads from each other, breaking
    // the "one shared document set per case" requirement.
    if (col === COLLECTIONS.DOCUMENTS) return true;

    // globalCols (companies/roles) are shared config, not per-user-owned
    // records — they never carry assignedToId/createdBy. Without this,
    // fetching roles for a non-Admin user whose own roleData hasn't been
    // resolved yet (still null on this very first roles fetch — the
    // permission system's own bootstrap) falls through to 'self' visibility,
    // which then rejects every role document (including the user's own) for
    // having no owner field, permanently emptying the permission cache and
    // leaving that user unable to pass any RoleRoute check — confirmed via
    // runtime testing (Phase 5.2 Permission Audit), reproducible for ANY
    // non-'Admin'-named role's first-ever session.
    if (globalCols.includes(col as any)) return true;

    // VL-9/VL-10 fix: project-scoped collections (surveys, subsidy,
    // scheme_registrations, ...) defer the ENTIRE ownership decision to the
    // project-visibility engine (filterVisibleProjectRecords below) — the
    // engine reads the projects.visibility kind + the per-collection
    // assignment fields (incl. scheme_registrations managerId/userId). The
    // generic self/team pre-filter below reads the MODULE-level visibility,
    // which for a Manager role without an explicit scheme_registration.visibility
    // resolves to 'self' and would silently drop every team registration
    // BEFORE the project engine ever sees it. Skipping it here only defers to
    // the authoritative engine; company scoping above is unaffected.
    if (isProjectScopedCollection(col)) return true;

    if (visibility === 'all') return true;

    const allowedIds = new Set<string>();
    if (user?.id) allowedIds.add(user.id);
    if (partnerDocId) allowedIds.add(partnerDocId);
    if (visibility === 'team') {
      teamMemberIds.forEach((id) => { if (id) allowedIds.add(id); });
    }

    // Phase 1 identity: Channel Partner records are owned by the LINKED USER
    // (channel_partners.userId — the canonical partner↔user relationship), not
    // by the admin who created the record. Self/team scoping for this
    // collection must key off `userId` (mirrors the Firestore rule
    // `isPartner() && resource.data.userId == currentUserId()`).
    // Phase 3: for all other collections the ownership candidate set also
    // includes `partnerId` (the partner DOC id) so agent-owned records stay
    // visible to their partner regardless of who converted/created them.
    const candidateIds: unknown[] = col === COLLECTIONS.CHANNEL_PARTNERS
      ? [docData.userId, docData.assignedToId, docData.createdBy]
      : [docData.assignedToId, docData.createdBy, docData.partnerId];

    return candidateIds.some((candidate) => candidate && allowedIds.has(String(candidate)));
  });

  if (isProjectScopedCollection(col)) {
    return filterVisibleProjectRecords(
      companyFiltered as any[],
      user?.id,
      user?.role,
      roleData,
      teamMemberIds,
      partnerDocId,
      col, // VL-9/VL-10: per-collection extra assignment fields (e.g. scheme_registrations managerId/userId)
    ) as DocWithId<T>[];
  }

  return companyFiltered;
}

// ── PLATFORM READ (Super Admin control plane, Master Plan §6) ───────────
// The ONLY client read path for the platform collections and platform-wide
// company/user datasets. The owner/Super Admin identity is exempt from
// company/ownership scoping at the rules layer on every collection it may
// reach here (platform collections have no companyId at all; companies/users
// read rules exempt the platform identity unconditionally), so the query
// carries NO company/ownership constraint — the in-memory defense filter
// (applyAccessFilters) must not be applied either, because it would drop
// platform documents (no companyId) and company-scope the users list.
// Fail closed: any non-owner/non-Super-Admin caller is rejected outright —
// this helper is never the security boundary (the rules are), but a stray
// caller must not silently get an unscoped read either.
export async function getAllPlatform<T = DocumentData>(
  col: string, userConstraints: QueryConstraint[] = []
): Promise<DocWithId<T>[]> {
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }
  const { user } = useAppStore.getState();
  if (!user?.isOwner && !user?.isSuperAdmin) {
    throw new Error('Platform reads require the Super Admin identity.');
  }
  const snap = await getDocs(query(collection(db, col), ...userConstraints));
  let docs = snap.docs.map((d) => fromDoc<T>(d as any));
  if (col === COLLECTIONS.USERS) docs = filterManageableUsers(docs);
  return docs;
}

// ── GET ALL (With Smart Fallback for Missing Indexes) ────────
export async function getAll<T = DocumentData>(
  col: string, userConstraints: QueryConstraint[] = []
): Promise<DocWithId<T>[]> {
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }

  const state = useAppStore.getState();
  // Canonical read tenant — never the neutral 'default' placeholder.
  const companyId = resolveReadCompanyId();
  // Phase 3: authenticated partner doc id (cached; one users-doc read per
  // session) — enables `partnerId`-keyed self/team matching below.
  const partnerDocId = await resolveCurrentPartnerDocId();

  const fetchAndFilter = async (constraints: QueryConstraint[]) => {
    const snap = await getDocs(query(collection(db, col), ...constraints, ...userConstraints));
    return applyAccessFilters(col, snap.docs.map((d) => fromDoc<T>(d as any)), partnerDocId);
  };

  if (isProjectScopedCollection(col)) {
    const visibilityPlan = buildProjectVisibilityQueryPlan(companyId, state.user?.id, state.user?.role, state.roleData, state.teamMemberIds, partnerDocId, col);
    const docsById = new Map<string, DocWithId<T>>();
    const results = await Promise.all(visibilityPlan.queries.map((constraints) => fetchAndFilter(constraints)));
    results.flat().forEach((docData) => docsById.set(docData.id, docData));
    return applyAccessFilters(col, Array.from(docsById.values()), partnerDocId);
  }

  // Non-project collections with self/team visibility (Leads, Customers,
  // Orders, Tasks, etc.) — narrow the query itself instead of fetching the
  // full company dataset and filtering client-side (Audit §22, HIGH
  // data-exposure gap; Blueprint Phase 13 target). applyAccessFilters()
  // below still re-applies the ownership check in memory as defense-in-depth.
  if (isOwnershipScopedCollection(col)) {
    const visibility = resolveVisibility(col);
    if (visibility !== 'all') {
      const plan = buildOwnershipVisibilityQueryPlan(companyId, state.user?.id, visibility, state.teamMemberIds, partnerDocId);
      if (plan.mode === 'owned') {
        const docsById = new Map<string, DocWithId<T>>();
        const results = await Promise.all(plan.queries.map((constraints) => fetchAndFilter(constraints)));
        results.flat().forEach((docData) => docsById.set(docData.id, docData));
        return applyAccessFilters(col, Array.from(docsById.values()), partnerDocId);
      }
    }
  }

  const baseConstraints = companyScopedQuery(col);
  const finalConstraints = [...baseConstraints, ...userConstraints];
  return await fetchAndFilter(finalConstraints);
}

export type PageCursor = QueryDocumentSnapshot<DocumentData> | null;

export async function getPage<T = DocumentData>(
  col: string,
  userConstraints: QueryConstraint[] = [],
  cursor: PageCursor = null,
  pageSize = 50
): Promise<{ data: DocWithId<T>[]; cursor: PageCursor; hasMore: boolean }> {
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }

  if (isProjectScopedCollection(col)) {
    const all = await getAll<T>(col, userConstraints);
    const data = all.slice(0, pageSize);
    return { data, cursor: null, hasMore: all.length > pageSize };
  }

  const pageConstraints = [
    ...companyScopedQuery(col),
    ...userConstraints,
    ...(cursor ? [startAfter(cursor)] : []),
    limit(pageSize),
  ];
  const partnerDocId = await resolveCurrentPartnerDocId();
  const snap = await getDocs(query(collection(db, col), ...pageConstraints));
  return {
    data: applyAccessFilters(col, snap.docs.map(d => fromDoc<T>(d as any)), partnerDocId),
    cursor: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize,
  };
}

// ── GET ONE ───────────────────────────────────────────────────
export async function getOne<T = DocumentData>(col: string, id: string): Promise<DocWithId<T> | null> {
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }

  const snap = await getDoc(doc(db, col, id));
  if (!snap.exists()) return null;
  const docData = fromDoc<T>(snap);
  if ((docData as any).isDeleted) return null; // Enforce soft-delete on single gets
  const partnerDocId = await resolveCurrentPartnerDocId();
  return applyAccessFilters(col, [docData], partnerDocId)[0] ?? null;
}

/**
 * Check if the current user is in the demo company and, if so, that the
 * 'business-crud' capability is allowed (blocks the genuinely-restricted
 * categories — company-admin, user-admin, system-counter, stock-ledger-
 * mutation, etc. — per demoCapabilityPolicy.ts's real allow-list).
 *
 * Phase 15: this function used to ALSO enforce a hard per-collection cap
 * (a fixed ceiling of 5 non-deleted documents, formerly a named constant in
 * config/demo.ts) — counting every non-deleted document in the collection
 * and throwing once the cap was reached. That directly contradicted
 * the Blueprint's own binding principle (§14: "full create/edit/soft-delete
 * capability with no artificial ceiling — seeded records plus user-created
 * records must coexist") and was, in practice, a hard block on ALL demo
 * creation: every collection the seed data touches already has more than 5
 * seeded records (Leads: 16, Customers: 11, Projects: 10, …), so this check
 * would fire on literally the first create attempt in any of them. This is
 * the exact mechanism the Blueprint's Appendix E (item 5) flagged as
 * `[UNKNOWN — REQUIRES IMPLEMENTATION-TIME VERIFICATION]` — located and
 * removed here, not merely raised to a bigger number (a bigger number is
 * still an artificial ceiling; the Blueprint requires none).
 */
async function enforceDemoRecordLimit(col: string): Promise<void> {
  const state = useAppStore.getState();
  const companyId = (state.activeCompanyId === 'all' ? state.company?.id : state.activeCompanyId) || state.user?.companyId;
  if (companyId !== DEMO_COMPANY_ID) return;
  if (!isDemoCapabilityAllowed(companyId, 'business-crud')) {
    throw new Error('This operation is not available in Demo Mode.');
  }
}

// ── CREATE (auto-id) ──────────────────────────────────────────
export async function createDoc<T extends DocumentData>(col: string, data: T): Promise<DocWithId<T>> {
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }

  await enforceDemoRecordLimit(col);

  const state = useAppStore.getState();
  // Canonical write-time tenant: an explicit invalid companyId ('default',
  // 'all', empty) is NEVER persisted — it is replaced by the resolved real
  // company (activeCompanyId -> company -> user profile). If nothing
  // resolves, the companyId field is stripped entirely (fail closed) instead
  // of stamping the neutral placeholder that Firestore rules reject.
  const explicitCompanyId = (data as any).companyId;
  const resolvedCompanyId = isRealCompanyId(explicitCompanyId)
    ? explicitCompanyId
    : resolveWriteCompanyId();
  // Phase 1 (Multi-Tenant): strip any client-supplied groupId and stamp the
  // authoritative value resolved from the target company's owning Group — the
  // identical fail-closed pattern used for companyId above (Master Plan §3.4).
  // Excluded collections (§3.2) never receive the auto-stamp. Phase 4
  // (Master Plan §6): platform collections carry NO companyId at all — the
  // resolved session company must never be stamped onto a groups /
  // group_members / platform_settings document (a stray companyId would be a
  // schema violation and a forged-companyId ride-along on a platform write).
  const { companyId: _stripped, groupId: _strippedGroupId, ...restData } = data as DocumentData;
  const isPlatform = PLATFORM_COLLECTIONS.has(col);
  const resolvedGroupId = GROUP_ID_EXCLUDED_COLLECTIONS.has(col) ? '' : resolveWriteGroupId(resolvedCompanyId);
  const payload = sanitizePayload({
    ...restData,
    ...(!isPlatform && resolvedCompanyId ? { companyId: resolvedCompanyId } : {}),
    ...(resolvedGroupId ? { groupId: resolvedGroupId } : {}),
    createdBy: state.user?.id || 'system',
    updatedBy: state.user?.id || 'system',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isDeleted: false
  });
  const ref = await addDoc(collection(db, col), payload);
  return { ...data, id: ref.id } as DocWithId<T>;
}

// ── CREATE WITH SPECIFIC ID ───────────────────────────────────
export async function createDocWithId<T extends DocumentData>(col: string, id: string, data: T): Promise<DocWithId<T>> {
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }

  await enforceDemoRecordLimit(col);

  const state = useAppStore.getState();
  // Canonical write-time tenant: same fail-closed policy as createDoc — an
  // invalid explicit companyId is replaced by the resolved real company, or
  // stripped entirely if nothing resolves (never persisted as 'default').
  const explicitCompanyId = (data as any).companyId;
  const resolvedCompanyId = isRealCompanyId(explicitCompanyId)
    ? explicitCompanyId
    : resolveWriteCompanyId();
  // Phase 1 (Multi-Tenant): strip any client-supplied groupId and stamp the
  // authoritative value (Master Plan §3.4) — see createDoc() for the rationale.
  // Excluded collections (§3.2) never receive the auto-stamp. Phase 4: same
  // companyId skip as createDoc() for the platform collections (§6).
  const { companyId: _stripped, groupId: _strippedGroupId, ...restData } = data as DocumentData;
  const isPlatform = PLATFORM_COLLECTIONS.has(col);
  const resolvedGroupId = GROUP_ID_EXCLUDED_COLLECTIONS.has(col) ? '' : resolveWriteGroupId(resolvedCompanyId);
  const payload = sanitizePayload({
    ...restData,
    ...(!isPlatform && resolvedCompanyId ? { companyId: resolvedCompanyId } : {}),
    ...(resolvedGroupId ? { groupId: resolvedGroupId } : {}),
    createdBy: state.user?.id || 'system',
    updatedBy: state.user?.id || 'system',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isDeleted: false
  });
  await setDoc(doc(db, col, id), payload, { merge: true });
  return { ...data, id } as DocWithId<T>;
}

// ── UPDATE ────────────────────────────────────────────────────
export async function updateDocById(col: string, id: string, data: Partial<DocumentData>): Promise<void> {
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }

  const state = useAppStore.getState();
  const ref = doc(db, col, id);
  const snap = await getDoc(ref);
  // Phase 1 (Multi-Tenant): on UPDATE, groupId is never client-controlled
  // either — any client-supplied value is stripped for the denormalized
  // collections and the authoritative value (derived from the document's
  // OWN companyId) is re-stamped, mirroring the create helpers (Master Plan
  // §3.4). The existing doc's companyId is authoritative: companyId is
  // immutable at the rules layer (companyIdUnchanged()), so the Group derived
  // from it can never legitimately change — a payload companyId (or a
  // resolved session company) is only a fallback for docs that do not exist
  // yet (the merge-create branch below). Excluded collections (§3.2) never
  // receive the auto-stamp.
  const { groupId: _strippedGroupId, ...restData } = data as DocumentData;
  const existingCompanyId = snap.exists() ? (snap.data() as any)?.companyId : undefined;
  const targetCompanyId = isRealCompanyId(existingCompanyId)
    ? existingCompanyId
    : isRealCompanyId((restData as any).companyId)
      ? (restData as any).companyId
      : resolveWriteCompanyId();
  const resolvedGroupId = GROUP_ID_EXCLUDED_COLLECTIONS.has(col) ? '' : resolveWriteGroupId(targetCompanyId);
  const payload = sanitizePayload({
    ...restData,
    ...(resolvedGroupId ? { groupId: resolvedGroupId } : {}),
    updatedBy: state.user?.id || 'system',
    updatedAt: serverTimestamp()
  });
  if (!snap.exists()) {
    await setDoc(ref, payload, { merge: true });
    return;
  }
  await updateDoc(ref, payload);
}

// ── ENTERPRISE SOFT DELETE ────────────────────────────────────
export async function softDelete(col: string, id: string): Promise<void> {
  if (col === COLLECTIONS.STOCK_LEDGER) {
    throw new Error('Stock ledger entries are immutable. Create a reversal entry instead.');
  }
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }
  const state = useAppStore.getState();
  await updateDocById(col, id, {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    deletedBy: state.user?.id || 'system',
  });
}

export async function restoreRecord(col: string, id: string): Promise<void> {
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }

  const state = useAppStore.getState();
  await updateDocById(col, id, {
    isDeleted: false,
    updatedBy: state.user?.id || 'system',
    restoredBy: state.user?.id || 'system',
    restoredAt: serverTimestamp(),
  });
}

/**
 * Fetches soft-deleted ("inactive") records for a collection, applying the
 * same company + self/team/all visibility scoping as getAll() (Blueprint
 * Phase 13 §13 — "show inactive" must respect the same access rules as the
 * active-record list, not bypass them).
 */
export async function getAllDeleted<T = DocumentData>(
  col: string, userConstraints: QueryConstraint[] = []
): Promise<DocWithId<T>[]> {
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }

  const state = useAppStore.getState();
  const globalCols = [COLLECTIONS.COMPANIES, COLLECTIONS.ROLES];
  // Canonical read tenant — never the neutral 'default' placeholder.
  const effectiveCompanyId = resolveReadCompanyId();
  // Phase 3: partner doc id for partnerId-keyed self/team matching.
  const partnerDocId = await resolveCurrentPartnerDocId();

  const fetchDeleted = async (constraints: QueryConstraint[]) => {
    const snap = await getDocs(query(
      collection(db, col), ...constraints, where('isDeleted', '==', true), ...userConstraints,
    ));
    let docs = snap.docs.map((d) => fromDoc<T>(d as any));
    if (col === COLLECTIONS.USERS) docs = filterManageableUsers(docs);
    return docs.filter((docData: any) => (
      globalCols.includes(col as any)
      || !effectiveCompanyId || effectiveCompanyId === 'all'
      || docData.companyId === effectiveCompanyId
    ));
  };

  const mergeById = (results: DocWithId<T>[][]) => {
    const docsById = new Map<string, DocWithId<T>>();
    results.flat().forEach((docData) => docsById.set(docData.id, docData));
    return Array.from(docsById.values());
  };

  if (isProjectScopedCollection(col)) {
    const visibilityPlan = buildProjectVisibilityQueryPlan(effectiveCompanyId, state.user?.id, state.user?.role, state.roleData, state.teamMemberIds, partnerDocId, col);
    return mergeById(await Promise.all(visibilityPlan.queries.map((constraints) => fetchDeleted(constraints))));
  }

  if (isOwnershipScopedCollection(col)) {
    const visibility = resolveVisibility(col);
    if (visibility !== 'all') {
      const plan = buildOwnershipVisibilityQueryPlan(effectiveCompanyId, state.user?.id, visibility, state.teamMemberIds, partnerDocId);
      if (plan.mode === 'owned') {
        return mergeById(await Promise.all(plan.queries.map((constraints) => fetchDeleted(constraints))));
      }
    }
  }

  return fetchDeleted(companyScopedQuery(col));
}

// Overwrite legacy delete to use Soft Delete safely
export async function deleteDocById(col: string, id: string): Promise<void> {
  return softDelete(col, id);
}

export async function hardDelete(col: string, id: string): Promise<void> {
  if (col === COLLECTIONS.STOCK_LEDGER) {
    throw new Error('Stock ledger entries are immutable. Create a reversal entry instead.');
  }
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }
  await deleteDoc(doc(db, col, id));
}

// ── BATCH WRITE ───────────────────────────────────────────────
export async function batchCreate(col: string, items: DocumentData[]): Promise<void> {
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }

  // Enforce the demo business-crud capability gate for batch creates (see enforceDemoRecordLimit()'s own doc comment — Phase 15 removed the numeric per-collection cap this used to also apply here).
  if (items.length > 0) {
    await enforceDemoRecordLimit(col);
  }

  const state = useAppStore.getState();
  const batch = writeBatch(db);
  items.forEach((item) => {
    const ref = item.id ? doc(db, col, item.id) : doc(collection(db, col));
    // Canonical write-time tenant: per-item invalid companyId is replaced by
    // the resolved real company (never 'default'); stripped if unresolvable.
    const itemCompanyId = isRealCompanyId(item.companyId)
      ? item.companyId
      : resolveWriteCompanyId();
    // Phase 1 (Multi-Tenant): strip any client-supplied groupId and stamp the
    // authoritative value resolved per-item from the item's target company
    // (Master Plan §3.4). Excluded collections (§3.2) never receive it. Phase
    // 4: same companyId skip as createDoc() for the platform collections (§6).
    const { companyId: _stripped, groupId: _strippedGroupId, ...restItem } = item;
    const isPlatform = PLATFORM_COLLECTIONS.has(col);
    const itemGroupId = GROUP_ID_EXCLUDED_COLLECTIONS.has(col) ? '' : resolveWriteGroupId(itemCompanyId);
    const payload = sanitizePayload({
      ...restItem,
      ...(!isPlatform && itemCompanyId ? { companyId: itemCompanyId } : {}),
      ...(itemGroupId ? { groupId: itemGroupId } : {}),
      createdBy: state.user?.id || 'system',
      updatedBy: state.user?.id || 'system',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isDeleted: false
    });
    batch.set(ref, payload);
  });
  await batch.commit();
}

// ── REAL-TIME LISTENER ────────────────────────────────────────
export function listenCollection<T = DocumentData>(
  col: string,
  constraints: QueryConstraint[],
  callback: (docs: DocWithId<T>[]) => void,
  options: { limit?: number } = {}
) {
  if (!firebaseEnv.isConfigured) {
    throw new Error(NOT_CONFIGURED_MSG);
  }

  const queryConstraints = options.limit ? [...constraints, limit(options.limit)] : constraints;
  const q = queryConstraints.length ? query(collection(db, col), ...queryConstraints) : query(collection(db, col));
  return onSnapshot(q, (snap) => callback(applyAccessFilters(col, snap.docs.map((d) => fromDoc<T>(d)))));
}

export function writeBatch(database: typeof db) {
  const batch = firebaseWriteBatch(database);
  const originalSet = batch.set.bind(batch) as any;
  const originalUpdate = batch.update.bind(batch) as any;
  (batch as any).set = (documentRef: unknown, data: unknown, options?: unknown) => (
    options ? originalSet(documentRef, sanitizePayload(data), options) : originalSet(documentRef, sanitizePayload(data))
  );
  (batch as any).update = (documentRef: unknown, dataOrField: unknown, ...rest: unknown[]) => (
    rest.length
      ? originalUpdate(documentRef, dataOrField, ...rest)
      : originalUpdate(documentRef, sanitizePayload(dataOrField))
  );
  return batch;
}

// ── Re-export query helpers ───────────────────────────────────
export { collection, doc, getDocs, query, where, orderBy, limit, startAfter };

// ── ID GENERATORS ─────────────────────────────────────────────
function rnd(len = 4) {
  return Array.from({ length: len }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
}
function dp() {
  const d = new Date();
  return `${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function dpy() {
  const d = new Date();
  return `${String(d.getFullYear())}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
export const genId = {
  lead:         (prefix = 'LD')  => `${prefix}-${dp()}-${rnd()}`,
  customer:     (prefix = 'CU')  => `${prefix}-${dp()}-${rnd()}`,
  project:      (prefix = 'PRJ') => `${prefix}-${dpy()}-${rnd()}`,
  order:        (prefix = 'ORD') => `${prefix}-${dp()}-${rnd()}`,
  invoice:      (prefix = 'INV') => `${prefix}-${dp()}-${rnd()}`,
  dispatch:     (prefix = 'DSP') => `${prefix}-${dp()}-${rnd()}`,
  quotation:    (prefix = 'QT')  => `${prefix}-${dp()}-${rnd()}`,
  payment:      (prefix = 'PAY') => `${prefix}-${dp()}-${rnd()}`,
  employee:     (prefix = 'EMP') => `${prefix}-${dp()}-${rnd()}`,
  registration: (prefix = 'RG')  => `${prefix}-${dp()}-${rnd()}`,
  // Phase 6 (Channel Partner — Vendor Lock / Registration): the new
  // scheme_registrations id prefix (distinct from the loan `registrations`
  // RG- prefix; the two subsystems share nothing).
  schemeRegistration: (prefix = 'SREG') => `${prefix}-${dp()}-${rnd()}`,
  generic:      (prefix = 'ID')  => `${prefix}-${Date.now()}-${rnd()}`,
};

// ── FORMATTERS ────────────────────────────────────────────────
export function fmtDate(val?: string | Date | null): string {
  if (!val) return '—';
  try {
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return '—';
    return formatGeneralDate(d);
  } catch { return '—'; }
}

/** fmtDateSafe — like fmtDate, but tolerant of Firestore Timestamp objects
 * ({ toDate() }) and plain server-snapshot shapes ({ seconds, nanoseconds })
 * in addition to strings and Dates. Shared by the embedded stage workspaces
 * (e.g. ProjectSubsidyWorkspace) that render Firestore timestamp fields
 * directly. */
export function fmtDateSafe(val?: unknown): string {
  if (!val) return '—';
  if (val instanceof Date) return fmtDate(val);
  if (typeof val === 'object') {
    const obj = val as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') return fmtDate(obj.toDate());
    if (typeof obj.seconds === 'number') return fmtDate(new Date(obj.seconds * 1000));
  }
  return fmtDate(String(val));
}
export function fmtDateTime(val?: string | Date | null): string {
  if (!val) return '—';
  try {
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return '—';
    const settings = getGeneralSettingsRuntime();
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    return `${fmtDate(d)} ${time}`;
  } catch { return '—'; }
}
export function fmtCurrency(val?: number | null, symbol = '₹'): string {
  if (val == null) return `${symbol}0`;
  return `${symbol}${formatGeneralNumber(Number(val))}`;
}
function trimCompactDecimal(value: number, maximumFractionDigits: number, minimumFractionDigits = 0): string {
  return value.toLocaleString('en-IN', {
    minimumFractionDigits,
    maximumFractionDigits,
  });
}
export function fmtCompactCurrency(val?: number | null, symbol = '₹'): string {
  const amount = Number(val ?? 0);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);

  if (abs >= 9950000) {
    const cr = abs / 10000000;
    const rounded = Number(cr.toFixed(2));
    const minimumFractionDigits = cr < 1 && rounded === 1 ? 1 : 0;
    return `${sign}${symbol}${trimCompactDecimal(rounded, 2, minimumFractionDigits)}Cr`;
  }
  if (abs >= 100000) {
    return `${sign}${symbol}${trimCompactDecimal(abs / 100000, 2)}L`;
  }
  if (abs >= 1000) {
    return `${sign}${symbol}${trimCompactDecimal(abs / 1000, 1)}K`;
  }
  return `${sign}${symbol}${trimCompactDecimal(abs, 0)}`;
}
export function fmtNumber(val?: number | null): string {
  if (val == null) return '0';
  return Number(val).toLocaleString('en-IN');
}
export function ageDays(val?: string | null): number {
  if (!val) return 0;
  return Math.floor((Date.now() - new Date(val).getTime()) / 86400000);
}
export function toInputDate(val?: string | null): string {
  if (!val) return '';
  try {
    const d = new Date(val);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  } catch { return ''; }
}
