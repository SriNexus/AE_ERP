/**
 * Phase 13 (Roles / Permissions / Data Visibility) regression tests.
 *
 * Covers the genuine gaps found and fixed this phase:
 *  - resolveVisibility()/isOwnershipScopedCollection() — the new single
 *    source of truth query-planning in getAll() shares with the existing
 *    in-memory applyAccessFilters() defense-in-depth check.
 *  - useGlobalBoot's team-hierarchy resolution must be data-driven (any
 *    role with visibility:'team' on any module), not limited to the two
 *    hardcoded legacy role-name strings.
 *  - restoreRecord() must stamp restoredBy/restoredAt.
 *  - Permanent (hard) delete is Super-Admin-only, both in firestore.rules
 *    and at the one real client-side hard-delete surface (Categories).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import { resolveVisibility, isOwnershipScopedCollection } from '../firestore';
import { COLLECTIONS } from '../firebase';
import { useAppStore } from '../../store/useAppStore';

describe('resolveVisibility — single source of truth for self/team/all', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: { id: 'user-1', name: 'Test User', email: 'user@test.erp', role: 'Sales', companyId: 'company-1' },
      roleData: {
        name: 'Sales', schemaVersion: 1,
        permissions: { leads: { visibility: 'team' }, customers: { visibility: 'self' }, loan_applications: { visibility: 'all' } },
      } as any,
      teamMemberIds: [],
      activeCompanyId: 'company-1',
      isAuthenticated: true,
    });
  });

  it('reads visibility from the role document per module', () => {
    expect(resolveVisibility(COLLECTIONS.LEADS)).toBe('team');
    expect(resolveVisibility(COLLECTIONS.CUSTOMERS)).toBe('self');
  });

  it('defaults to "self" for a module the role document does not mention', () => {
    expect(resolveVisibility(COLLECTIONS.ORDERS)).toBe('self');
  });

  it('maps the registrations collection to the loan_applications permission module (rename regression guard)', () => {
    // The Loan Applications domain was renamed from "Registration" to
    // "loan_applications" while its Firestore collection stayed 'registrations'.
    // COLLECTION_PERMISSION_MODULE must translate the collection to the module
    // key, otherwise resolveVisibility falls back to 'self' and hides every
    // record (including the demo tenant's) from roles whose permission entry
    // is keyed 'loan_applications'.
    expect(resolveVisibility(COLLECTIONS.LOAN_APPLICATIONS)).toBe('all');
  });

  it('always resolves "all" for Admin users, regardless of role document content', () => {
    useAppStore.setState({ user: { id: 'admin-1', name: 'Admin', email: 'a@test.erp', role: 'Admin', companyId: 'company-1' } });
    expect(resolveVisibility(COLLECTIONS.LEADS)).toBe('all');
  });

  it('always resolves "all" for ownership-exempt collections (companies/roles/settings/documents)', () => {
    expect(resolveVisibility(COLLECTIONS.COMPANIES)).toBe('all');
    expect(resolveVisibility(COLLECTIONS.ROLES)).toBe('all');
    expect(resolveVisibility(COLLECTIONS.SETTINGS)).toBe('all');
    expect(resolveVisibility(COLLECTIONS.DOCUMENTS)).toBe('all');
  });
});

describe('isOwnershipScopedCollection — which collections get query-level self/team scoping in getAll()', () => {
  it('includes ordinary business-record collections (Leads, Customers, Orders)', () => {
    expect(isOwnershipScopedCollection(COLLECTIONS.LEADS)).toBe(true);
    expect(isOwnershipScopedCollection(COLLECTIONS.CUSTOMERS)).toBe(true);
    expect(isOwnershipScopedCollection(COLLECTIONS.ORDERS)).toBe(true);
  });

  it('excludes project-scoped collections (they use the project visibility query plan instead)', () => {
    expect(isOwnershipScopedCollection(COLLECTIONS.PROJECTS)).toBe(false);
  });

  it('excludes Users — narrowing the Users fetch by teamMemberIds would be circular, since teamMemberIds is itself derived from a full Users scan', () => {
    expect(isOwnershipScopedCollection(COLLECTIONS.USERS)).toBe(false);
  });

  it('excludes companies/roles/settings/documents — already always-visible by design', () => {
    expect(isOwnershipScopedCollection(COLLECTIONS.COMPANIES)).toBe(false);
    expect(isOwnershipScopedCollection(COLLECTIONS.ROLES)).toBe(false);
    expect(isOwnershipScopedCollection(COLLECTIONS.SETTINGS)).toBe(false);
    expect(isOwnershipScopedCollection(COLLECTIONS.DOCUMENTS)).toBe(false);
  });
});

describe('useGlobalBoot — team-hierarchy resolution is data-driven, not limited to hardcoded role names (source verification)', () => {
  const source = fs.readFileSync('src/lib/useGlobalBoot.ts', 'utf-8');

  it('computes roleHasTeamVisibility from the resolved role document rather than only checking user.role literals', () => {
    expect(source).toContain("modulePermissions?.visibility === 'team'");
    expect(source).toContain('roleHasTeamVisibility');
  });

  it('keeps the legacy Manager/TL role-name check as a superset (OR), never narrowing existing behavior', () => {
    expect(source).toMatch(/isManager\s*=\s*user\?\.role===['"]Manager['"]\|\|user\?\.role===['"]TL['"]\|\|roleHasTeamVisibility/);
  });
});

describe('restoreRecord — stamps restoredBy/restoredAt (source verification)', () => {
  const source = fs.readFileSync('src/lib/firestore.ts', 'utf-8');
  const restoreFn = source.slice(source.indexOf('export async function restoreRecord'), source.indexOf('export async function getAllDeleted'));

  it('sets restoredBy and restoredAt alongside isDeleted:false', () => {
    expect(restoreFn).toContain('isDeleted: false');
    expect(restoreFn).toContain('restoredBy:');
    expect(restoreFn).toContain('restoredAt:');
  });
});

describe('Permanent delete is Super-Admin-only (Blueprint §13)', () => {
  const rules = fs.readFileSync('firestore.rules', 'utf-8');

  it('firestore.rules gates product_categories delete to isSuperAdmin(), not the universal "if false"', () => {
    const block = rules.slice(rules.indexOf('match /product_categories/'), rules.indexOf('match /product_categories/') + 400);
    expect(block).toContain('allow delete: if isSuperAdmin()');
  });

  it('every other explicitly-declared collection (and the catch-all) still denies delete outright — the Super Admin allowance is narrowly scoped, not a blanket relaxation', () => {
    const genericDenyCount = (rules.match(/allow delete: if false;/g) || []).length;
    // Sanity floor: still many collections with the universal deny (dispatch, stock,
    // notifications, tasks, projects, surveys, etc.) — this must not have dropped to ~0.
    expect(genericDenyCount).toBeGreaterThan(15);
  });

  it('CategoriesWorkspace.tsx (desktop) gates hardDelete()-calling mutations behind isSuperAdmin', () => {
    const desktop = fs.readFileSync('src/pages/CategoriesWorkspace.tsx', 'utf-8');
    expect(desktop).toContain('useSuperAdminAccess');
    expect(desktop).toContain("if (!isSuperAdmin) throw new Error('Permanent delete is restricted to the Super Admin account.');");
  });

  it('MobileCategoryWorkspace.tsx gates hardDelete()-calling mutations behind isSuperAdmin', () => {
    const mobile = fs.readFileSync('src/components/mobile/categories/MobileCategoryWorkspace.tsx', 'utf-8');
    expect(mobile).toContain('useSuperAdminAccess');
    expect(mobile).toContain('canDelete = perms.canDelete(');
    expect(mobile).toMatch(/canDelete\s*=\s*perms\.canDelete\('categories'\)\s*&&\s*isSuperAdmin/);
  });
});
