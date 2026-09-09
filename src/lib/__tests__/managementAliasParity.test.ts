/**
 * managementAliasParity.test.ts
 *
 * RBAC Master Implementation Plan §15 BD-5 — OWNER-APPROVED 2026-09-09.
 * `Management` is an intentional alias of `Admin` for authorization. Proves
 * the three authorization planes agree:
 *   1. CLIENT   — resolveCompatibleRole + canDo (this file, runtime)
 *   2. API      — api/_lib/permissions.ts alias table (structural)
 *   3. FIRESTORE— firestore.rules isAdmin / roleStringMatches (structural)
 * …and that no UNRELATED role gains Admin, and Management is never widened
 * past Admin (not GroupAdmin/Owner/SuperAdmin).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { useAppStore } from '../../store/useAppStore';
import { canDo, resolveCompatibleRole } from '../permissions';
import { buildRoleCache, getSystemRoleSeedDocuments } from '../roleBootstrap';

function setup(role: string, isSuperAdmin = false) {
  const seeds = getSystemRoleSeedDocuments();
  useAppStore.setState({
    user: { id: 'u', name: 'U', email: 'u@x.test', role, companyId: 'company-1', isSuperAdmin },
    teamMemberIds: [],
    permissionCache: { ready: true, roles: buildRoleCache(seeds), loadedAt: new Date().toISOString(), diagnostics: [] },
  });
}

beforeEach(() => {
  useAppStore.setState({ user: null, roleData: null, teamMemberIds: [], permissionCache: { ready: false, roles: {}, diagnostics: [] } });
});

// ── 1. CLIENT plane ───────────────────────────────────────────────────
describe('BD-5 — client: Management resolves to Admin', () => {
  it('resolveCompatibleRole("Management") / ("management") → "Admin"', () => {
    expect(resolveCompatibleRole('Management')).toBe('Admin');
    expect(resolveCompatibleRole('management')).toBe('Admin');
    expect(resolveCompatibleRole('  MANAGEMENT ')).toBe('Admin');
  });

  it('a Management user gets Admin-tier grants through canDo()', () => {
    setup('Management');
    expect(canDo('view', 'users')).toBe(true);
    expect(canDo('create', 'users')).toBe(true);
    expect(canDo('view', 'roles')).toBe(true);
    expect(canDo('view', 'companies')).toBe(true);
    expect(canDo('delete', 'payments')).toBe(true);
  });

  it('control — a Sales user does NOT get those Admin grants', () => {
    setup('Sales');
    expect(canDo('view', 'users')).toBe(false);
    expect(canDo('create', 'users')).toBe(false);
    expect(canDo('view', 'roles')).toBe(false);
  });

  it('control — an Admin user gets the identical grants (parity anchor)', () => {
    setup('Admin');
    const admin = ['users:view', 'users:create', 'roles:view', 'companies:view', 'payments:delete'];
    setup('Management');
    const mgmt = admin.map((k) => { const [m, a] = k.split(':'); return canDo(a as any, m as any); });
    setup('Admin');
    const adm = admin.map((k) => { const [m, a] = k.split(':'); return canDo(a as any, m as any); });
    expect(mgmt).toEqual(adm);
  });

  it('no UNRELATED role resolves to Admin — only the known Admin-equivalent aliases', () => {
    const src = readFileSync(new URL('../permissions.ts', import.meta.url), 'utf8');
    const table = src.slice(src.indexOf('EXACT_ROLE_COMPATIBILITY'), src.indexOf('};', src.indexOf('EXACT_ROLE_COMPATIBILITY')));
    const adminKeys = [...table.matchAll(/^\s*'?([a-z0-9 ]+)'?\s*:\s*'Admin'/gim)].map((m) => m[1].trim());
    expect(adminKeys.sort()).toEqual(
      ['admin', 'demo admin', 'demo operator', 'groupadmin', 'management'].sort(),
    );
  });
});

// ── 2. API plane ──────────────────────────────────────────────────────
describe('BD-5 — API: alias table maps management → Admin', () => {
  const src = readFileSync(new URL('../../../api/_lib/permissions.ts', import.meta.url), 'utf8');
  it('api/_lib/permissions.ts EXACT_ROLE_COMPATIBILITY has management: "Admin"', () => {
    expect(src).toMatch(/management:\s*'Admin'/);
  });
  it('and does NOT map management to Director/GroupAdmin/anything else', () => {
    expect(src).not.toMatch(/management:\s*'(?!Admin')/);
  });
});

// ── 3. FIRESTORE plane ────────────────────────────────────────────────
describe('BD-5 — firestore.rules: Management resolves to Admin, never wider', () => {
  const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');

  it('isAdmin() treats Management as Admin (inlined role-in-list, budget-minimal)', () => {
    expect(rules).toMatch(/function isAdmin\(\)[\s\S]{0,160}currentUser\(\)\.role in \['Admin', 'Management'\]/);
  });

  it('roleMatches() / actorRoleMatches() resolve a Management actor to the literal "Admin" via roleStringMatches()', () => {
    expect(rules).toMatch(/function roleStringMatches\(rawRole, pattern\)\s*{\s*return rawRole == 'Management' \? \('Admin'\)\.matches\(pattern\) : rawRole\.matches\(pattern\);/);
    expect(rules).toMatch(/function roleMatches\(pattern\)[\s\S]{0,120}roleStringMatches\(currentUser\(\)\.role, pattern\)/);
    expect(rules).toMatch(/function actorRoleMatches\(pattern\)[\s\S]{0,400}roleStringMatches\(get\([\s\S]{0,200}\.role, pattern\)/);
  });

  it('the direct role sites (users / settings / biometrics / commission read) accept Management alongside Admin', () => {
    // every raw Admin role check now admits Management
    expect(rules).not.toMatch(/actor\.role == 'Admin'(?! *\|\|)/); // no bare `actor.role == 'Admin'` left un-aliased
    expect(rules).toMatch(/role in \['Admin', 'Management', 'Manager', 'Director'\]/); // commission read
    const biometricHits = [...rules.matchAll(/actor\.role in \['Admin', 'Management'\] \|\| actor\.role == 'HR'/g)];
    expect(biometricHits.length).toBe(3);
  });

  it('Management is NEVER matched against GroupAdmin / Owner / a wider set', () => {
    // roleStringMatches only ever tests the literal 'Admin' against a pattern
    // — structurally impossible to satisfy a 'GroupAdmin'-only pattern.
    expect(rules).not.toMatch(/'Management'.*matches.*GroupAdmin/);
    // the only literal Management→X mapping is → Admin
    expect(rules).not.toMatch(/rawRole == 'Management' \? \('(?!Admin')/);
    expect(rules).not.toMatch(/role in \[[^\]]*'GroupAdmin'[^\]]*'Management'/);
  });
});
