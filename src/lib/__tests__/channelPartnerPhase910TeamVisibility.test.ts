/**
 * channelPartnerPhase910TeamVisibility.test — VL-9 / VL-10 (TL/Manager team
 * Registration view + Management/Director/Admin controls) verification.
 *
 * Covers the DATA-LAYER team scope (the canonical registration fields
 * managerId/userId now participate in the project-visibility matching for
 * scheme_registrations only):
 *   - Manager/TL sees own-team registrations (record.managerId == self, or
 *     record.userId ∈ teamMemberIds), never unrelated teams.
 *   - Partner self scope regression (partnerId/userId) — unchanged.
 *   - Admin / Director 'all' company scope — unchanged.
 *   - Cross-company denial via the canonical company constraint.
 *   - Query plan gains managerId/userId clauses ONLY for scheme_registrations.
 *   - applyAccessFilters (real module) end-to-end filtering.
 *   - Route / nav / mobile parity + the naming contract (user-facing label is
 *     exactly "Registration").
 *
 * Service-level RBAC (Director read-only, Manager approve, Accounts denied)
 * is asserted in channelPartnerPhase6SchemeRegistration.test.ts (same mock
 * world as the Phase 6 machine tests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// ── Mocks (the REAL firestore/projectVisibility modules are imported below;
// only the SDK `where` and the store/partner-identity modules are mocked). ──

const mockState = vi.hoisted(() => {
  const state: any = {
    user: null,
    roleData: null,
    teamMemberIds: [],
    activeCompanyId: 'comp-1',
    company: { id: 'comp-1' },
    permissionCache: { ready: false },
  };
  return {
    getState: () => state,
    setState: (patch: any) => Object.assign(state, patch),
  };
});

const mockWhere = vi.hoisted(() => vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })));

const mockPartnerIdentity = vi.hoisted(() => {
  let cachedPartnerDocId: string | null = null;
  return {
    cached: () => cachedPartnerDocId,
    setCached: (id: string | null) => { cachedPartnerDocId = id; },
    getCachedPartnerDocId: () => cachedPartnerDocId,
    resolveCurrentPartnerDocId: async () => cachedPartnerDocId,
  };
});

vi.mock('firebase/firestore', () => ({
  where: mockWhere,
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: mockState.getState, setState: mockState.setState },
}));

// The REAL firestore module (applyAccessFilters) — only its external deps are
// stubbed. COLLECTIONS keeps the canonical Phase 0 constants real.
vi.mock('../firebase', () => {
  const COLLECTIONS = new Proxy<Record<string, string>>({
    SCHEME_REGISTRATIONS: 'scheme_registrations',
    LOAN_APPLICATIONS: 'registrations',
  }, { get: (target, key: string) => target[key] ?? key.toLowerCase() });
  return { COLLECTIONS, firebaseEnv: { isConfigured: false }, db: {} };
});

vi.mock('../partnerOwnership', () => ({
  getCachedPartnerDocId: mockPartnerIdentity.getCachedPartnerDocId,
  resolveCurrentPartnerDocId: mockPartnerIdentity.resolveCurrentPartnerDocId,
}));

// ── Real modules under test ──────────────────────────────────
import { applyAccessFilters } from '../firestore';
import {
  PROJECT_ASSIGNMENT_FIELDS,
  projectAssignmentFields,
  canAccessProjectRecord,
  filterVisibleProjectRecords,
  buildProjectVisibilityQueryPlan,
} from '../projectVisibility';

const MANAGER_ROLE = {
  name: 'Manager', schemaVersion: 1 as const,
  permissions: { projects: { view: true, create: true, edit: true, visibility: 'team' as const } },
};
const PARTNER_ROLE = {
  name: 'Partner', schemaVersion: 1 as const,
  permissions: { projects: { view: true, create: true, visibility: 'self' as const } },
};
const DIRECTOR_ROLE = {
  name: 'Director', schemaVersion: 1 as const,
  permissions: { projects: { view: true } },
};

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'SREG-001', registrationId: 'SREG-001', projectId: 'PRJ-1',
    companyId: 'comp-1', partnerId: 'PART-1', managerId: 'u-manager', userId: 'u-partner',
    status: 'Submitted', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockWhere.mockClear();
  mockPartnerIdentity.setCached(null);
  mockState.setState({
    user: null, roleData: null, teamMemberIds: [],
    activeCompanyId: 'comp-1', company: { id: 'comp-1' },
  });
});

// ── Per-collection assignment fields ─────────────────────────

describe('VL-9/VL-10 — per-collection assignment fields (projectVisibility)', () => {
  it('adds managerId/userId ONLY for scheme_registrations', () => {
    const fields = projectAssignmentFields('scheme_registrations');
    expect(fields).toEqual(expect.arrayContaining(['partnerId', 'managerId', 'userId']));
    expect(fields).toEqual(expect.arrayContaining([...PROJECT_ASSIGNMENT_FIELDS]));
    // Other project-scoped collections and the default are UNCHANGED.
    expect(projectAssignmentFields('projects')).toEqual(PROJECT_ASSIGNMENT_FIELDS);
    expect(projectAssignmentFields()).toEqual(PROJECT_ASSIGNMENT_FIELDS);
    expect(projectAssignmentFields('surveys')).toEqual(PROJECT_ASSIGNMENT_FIELDS);
  });
});

// ── canAccessProjectRecord ───────────────────────────────────

describe('VL-9 — Manager/TL team visibility resolution', () => {
  const extra = projectAssignmentFields('scheme_registrations');

  it('Manager sees their team\'s registrations via record.managerId == self', () => {
    expect(canAccessProjectRecord(registration({ managerId: 'u-manager' }), 'u-manager', 'Manager', MANAGER_ROLE, [], null, extra)).toBe(true);
  });

  it('Manager sees a direct report\'s registration via userId ∈ teamMemberIds', () => {
    expect(canAccessProjectRecord(registration({ managerId: 'u-other', userId: 'u-partner' }), 'u-manager', 'Manager', MANAGER_ROLE, ['u-partner'], null, extra)).toBe(true);
  });

  it('Manager cannot see an unrelated partner\'s registration (no team overlap)', () => {
    expect(canAccessProjectRecord(registration({ managerId: 'u-other', userId: 'u-other-partner' }), 'u-manager', 'Manager', MANAGER_ROLE, ['u-partner'], null, extra)).toBe(false);
  });

  it('an unrelated manager\'s team is invisible', () => {
    expect(canAccessProjectRecord(registration({ managerId: 'u-other' }), 'u-manager', 'Manager', MANAGER_ROLE, [], null, extra)).toBe(false);
  });

  it('Manager cannot see a record whose only owner field is an unknown partnerId', () => {
    expect(canAccessProjectRecord(registration({ partnerId: 'PART-9', managerId: undefined, userId: undefined }), 'u-manager', 'Manager', MANAGER_ROLE, [], null, extra)).toBe(false);
  });

  it('Partner self scope still resolves via partnerId (regression)', () => {
    expect(canAccessProjectRecord(registration({ partnerId: 'PART-1', managerId: undefined, userId: undefined }), 'u-partner', 'Partner', PARTNER_ROLE, [], 'PART-1', extra)).toBe(true);
    // A record owned by ANOTHER partner must NOT resolve — even with a
    // manipulated partnerId, no userId/managerId overlap.
    expect(canAccessProjectRecord(registration({ partnerId: 'PART-2', managerId: undefined, userId: undefined }), 'u-partner', 'Partner', PARTNER_ROLE, [], 'PART-1', extra)).toBe(false);
  });

  it('Partner self scope also resolves via their linked userId', () => {
    expect(canAccessProjectRecord(registration({ partnerId: 'PART-1', userId: 'u-partner' }), 'u-partner', 'Partner', PARTNER_ROLE, [], null, extra)).toBe(true);
  });

  it('Admin and Director resolve to full company scope (read posture unchanged)', () => {
    expect(canAccessProjectRecord(registration({ partnerId: 'PART-9' }), 'u-admin', 'Admin', DIRECTOR_ROLE, [], null, extra)).toBe(true);
    expect(canAccessProjectRecord(registration({ partnerId: 'PART-9' }), 'u-director', 'Director', DIRECTOR_ROLE, [], null, extra)).toBe(true);
  });
});

// ── filterVisibleProjectRecords ──────────────────────────────

describe('VL-9/VL-10 — in-memory team filtering (scheme_registrations)', () => {
  const teamReg = registration({ id: 'SREG-A', managerId: 'u-manager' });
  const reportReg = registration({ id: 'SREG-B', managerId: 'u-other', userId: 'u-partner' });
  const unrelated = registration({ id: 'SREG-C', managerId: 'u-other', userId: 'u-other-partner' });
  const otherCompany = registration({ id: 'SREG-D', companyId: 'comp-2', managerId: 'u-manager' });

  it('Manager sees own-team + direct-report records only', () => {
    const visible = filterVisibleProjectRecords(
      [teamReg, reportReg, unrelated],
      'u-manager', 'Manager', MANAGER_ROLE, ['u-partner'], null, 'scheme_registrations',
    );
    const ids = visible.map((r) => r.id);
    expect(ids).toContain('SREG-A');
    expect(ids).toContain('SREG-B');
    expect(ids).not.toContain('SREG-C');
    // NOTE: company isolation is enforced upstream in applyAccessFilters (the
    // company filter) — filterVisibleProjectRecords is ownership-only.
  });

  it('other collections are unaffected (no managerId matching for projects)', () => {
    const visible = filterVisibleProjectRecords(
      [registration({ id: 'P-1', managerId: 'u-manager' })],
      'u-manager', 'Manager', MANAGER_ROLE, [], null, 'projects',
    );
    // 'projects' has no managerId in its assignment fields → not visible via managerId
    expect(visible).toHaveLength(0);
  });
});

// ── buildProjectVisibilityQueryPlan ──────────────────────────

describe('VL-9 — query plan team clauses', () => {
  it('includes managerId/userId/partnerId clauses for scheme_registrations (team)', () => {
    const plan = buildProjectVisibilityQueryPlan('comp-1', 'u-manager', 'Manager', MANAGER_ROLE, ['u-partner'], null, 'scheme_registrations');
    expect(plan.mode).toBe('assigned');
    const fields = new Set(plan.queries.flat().map((c: any) => c.field));
    expect(fields.has('managerId')).toBe(true);
    expect(fields.has('userId')).toBe(true);
    expect(fields.has('partnerId')).toBe(true);
    expect(fields.has('companyId')).toBe(true);
    // every query carries the tenant constraint
    plan.queries.forEach((q) => {
      expect(q.some((c: any) => c.field === 'companyId' && c.value === 'comp-1')).toBe(true);
    });
    // the manager's own user id is in the in-clauses
    const managerIn = plan.queries.flat().some((c: any) => c.field === 'managerId' && c.value?.includes?.('u-manager'));
    expect(managerIn).toBe(true);
  });

  it('does NOT add managerId/userId clauses for other collections', () => {
    const plan = buildProjectVisibilityQueryPlan('comp-1', 'u-manager', 'Manager', MANAGER_ROLE, ['u-partner'], null, 'projects');
    const fields = new Set(plan.queries.flat().map((c: any) => c.field));
    expect(fields.has('managerId')).toBe(false);
    expect(fields.has('userId')).toBe(false);
  });

  it('Admin/Director keep the mode=all company-scoped plan', () => {
    const plan = buildProjectVisibilityQueryPlan('comp-1', 'u-director', 'Director', DIRECTOR_ROLE, [], null, 'scheme_registrations');
    expect(plan.mode).toBe('all');
    expect(plan.queries[0]).toEqual([{ field: 'companyId', op: '==', value: 'comp-1' }]);
  });
});

// ── applyAccessFilters (REAL data-layer module) ──────────────

describe('VL-9/VL-10 — applyAccessFilters end-to-end (real module)', () => {
  const teamReg = registration({ id: 'SREG-A', managerId: 'u-manager' });
  const reportReg = registration({ id: 'SREG-B', managerId: 'u-other', userId: 'u-partner' });
  const unrelated = registration({ id: 'SREG-C', managerId: 'u-other', userId: 'u-other-partner' });
  const otherCompany = registration({ id: 'SREG-D', companyId: 'comp-2', managerId: 'u-manager' });

  it('Manager (team scope) sees team registrations only — cross-company excluded', () => {
    mockState.setState({
      user: { id: 'u-manager', role: 'Manager' },
      roleData: MANAGER_ROLE,
      teamMemberIds: ['u-partner'],
      activeCompanyId: 'comp-1',
    });
    const result = applyAccessFilters('scheme_registrations', [teamReg, reportReg, unrelated, otherCompany] as any);
    const ids = result.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['SREG-A', 'SREG-B']));
    expect(ids).not.toContain('SREG-C');
    expect(ids).not.toContain('SREG-D');
  });

  it('Partner (self scope) sees own registrations only, even with a manipulated partnerId', () => {
    mockPartnerIdentity.setCached('PART-1');
    mockState.setState({
      user: { id: 'u-partner', role: 'Partner' },
      roleData: PARTNER_ROLE,
      teamMemberIds: [],
      activeCompanyId: 'comp-1',
    });
    const result = applyAccessFilters('scheme_registrations', [
      registration({ id: 'SREG-A', partnerId: 'PART-1', managerId: undefined, userId: undefined }),
      registration({ id: 'SREG-B', partnerId: 'PART-2', managerId: undefined, userId: undefined }), // another partner's
      otherCompany,
    ] as any);
    expect(result.map((r) => r.id)).toEqual(['SREG-A']);
  });

  it('Director (read-only, company scope) sees all company records; cross-company denied', () => {
    mockState.setState({
      user: { id: 'u-director', role: 'Director' },
      roleData: DIRECTOR_ROLE,
      teamMemberIds: [],
      activeCompanyId: 'comp-1',
    });
    const result = applyAccessFilters('scheme_registrations', [teamReg, reportReg, unrelated, otherCompany] as any);
    expect(result.map((r) => r.id)).toEqual(['SREG-A', 'SREG-B', 'SREG-C']);
  });

  it('Admin sees all company records; cross-company denied', () => {
    mockState.setState({
      user: { id: 'u-admin', role: 'Admin' },
      roleData: DIRECTOR_ROLE,
      teamMemberIds: [],
      activeCompanyId: 'comp-1',
    });
    const result = applyAccessFilters('scheme_registrations', [teamReg, reportReg, unrelated, otherCompany] as any);
    expect(result.map((r) => r.id)).toEqual(['SREG-A', 'SREG-B', 'SREG-C']);
  });
});

// ── Route / nav / mobile parity + naming contract ────────────

describe('VL-9/VL-10 — surface wiring + naming contract', () => {
  it('desktop route /registration is gated by the scheme_registration module', () => {
    const src = readFileSync(new URL('../../app/router/routes.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/<Route path="\/registration" element={<RoleRoute module="scheme_registration">/);
  });

  it('navigation exposes the standalone Registration list under Channel Partners', () => {
    const src = readFileSync(new URL('../../components/layout/navigationConfig.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/path: '\/registration'/);
    expect(src).toMatch(/module: 'scheme_registration'/);
  });

  it('mobile reuses the SAME page (no separate mobile business logic)', () => {
    const src = readFileSync(new URL('../../components/mobile/routing/MobileRoutes.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/path="\/registration"/);
    expect(src).toMatch(/SchemeRegistrations/);
  });

  it('the standalone list keeps the user-facing label exactly "Registration"', () => {
    const src = readFileSync(new URL('../../pages/SchemeRegistrations.tsx', import.meta.url), 'utf8');
    expect(src).toContain('title="Registration"');
    // Never promotes "Vendor Lock" / "Scheme Registration" as the page name.
    expect(src).not.toContain('title="Vendor Lock"');
    expect(src).not.toContain('title="Scheme Registration"');
    // Uses the canonical hooks — never a second data model.
    expect(src).toMatch(/useSchemeRegistrations/);
    expect(src).toMatch(/RegistrationDetailModal/);
  });
});
