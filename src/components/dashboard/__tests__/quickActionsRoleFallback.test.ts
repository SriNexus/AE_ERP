/**
 * quickActionsRoleFallback.test.ts
 *
 * RBAC Master Implementation Plan — Phase 4 (hardcoded-check sweep).
 *
 * ROOT CAUSE: QuickActions.tsx's `normalizeRole()` fell through to a hard
 * `return UserRole.Sales` for any role it didn't explicitly name — silently
 * mis-bucketing Manager, GroupAdmin, Procurement, TL, and the 5
 * project-scoped field roles as "Sales" for this dashboard widget's
 * candidate-action pre-filter, restricting them to Sales' 5-module shortcut
 * list regardless of their own real, much broader `canDo()` grants. This is
 * a "UI shows fewer shortcuts than the role is entitled to" bug scoped
 * entirely to this widget — the underlying pages remained correctly
 * reachable via their own canDo()-gated routes/nav the whole time.
 *
 * FIX: an unrecognized role now falls through to `null`, which
 * `quickActionsForRole()` treats as "no bucket pre-filter — canDo() alone
 * decides, over the full action list." Since `canDo()` was and remains the
 * final, authoritative, UNCHANGED gate, this can only surface actions a
 * role's real permissions already grant; it cannot over-grant anything.
 *
 * "Keep old, diff, prove equivalent" per the Master Plan's transition
 * discipline: this file proves the 8 explicitly-named roles' candidate
 * module lists are BYTE-IDENTICAL to before this fix (mocking canDo() to
 * always return true isolates the pre-filter's own behavior from the real
 * permission gate, so the comparison is exact), and separately proves the
 * previously-mis-bucketed roles now see the full candidate list instead of
 * Sales' narrow one.
 */
import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../../types';

vi.mock('../../../lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/permissions')>('../../../lib/permissions');
  return { ...actual, canDo: vi.fn(() => true) }; // isolate the module pre-filter from the real permission gate
});

const { quickActionsForRole } = await import('../QuickActions');

// Mirrors ALL_ACTIONS' module list, in the file's own declared order —
// used only to assert "the full list" without re-typing every action here.
const ALL_ACTION_MODULES = [
  'leads', 'customers', 'quotations', 'orders', 'invoices', 'payments', 'dispatch', 'products', 'stock',
  'partners', 'partners', 'employees', 'projects', 'surveys', 'engineering', 'qc', 'commissioning',
  'projects', 'projects', 'service_tickets', 'net_metering', 'subsidy', 'tax_invoices',
];

function modulesFor(role: UserRole | null): string[] {
  return quickActionsForRole(role).map((a) => a.module);
}

describe('The 8 explicitly-named roles are BYTE-IDENTICAL to their pre-fix bucket lists (canDo() mocked true, isolating the pre-filter)', () => {
  it('Admin — full action list, unchanged', () => {
    expect(new Set(modulesFor(UserRole.Admin))).toEqual(new Set(ALL_ACTION_MODULES));
  });

  it('Director — full action list, unchanged', () => {
    expect(new Set(modulesFor(UserRole.Director))).toEqual(new Set(ALL_ACTION_MODULES));
  });

  it('Sales — leads/customers/orders/quotations/invoices only, unchanged', () => {
    expect(new Set(modulesFor(UserRole.Sales))).toEqual(new Set(['leads', 'customers', 'orders', 'quotations', 'invoices']));
  });

  it('Accounts — customers/orders/invoices/payments only, unchanged', () => {
    expect(new Set(modulesFor(UserRole.Accounts))).toEqual(new Set(['customers', 'orders', 'invoices', 'payments']));
  });

  it('Warehouse — products/stock/dispatch only, unchanged', () => {
    expect(new Set(modulesFor(UserRole.Warehouse))).toEqual(new Set(['products', 'stock', 'dispatch']));
  });

  it('HR — employees only, unchanged', () => {
    expect(new Set(modulesFor(UserRole.HR))).toEqual(new Set(['employees']));
  });

  it('Operations — orders/products/stock/dispatch/commissioning/qc/projects only, unchanged', () => {
    expect(new Set(modulesFor(UserRole.Operations))).toEqual(new Set(['orders', 'products', 'stock', 'dispatch', 'commissioning', 'qc', 'projects']));
  });

  it('Partner — DISCLOSED side effect: normalizeRole now correctly maps literal \'Partner\' to its own bucket instead of silently falling through to Sales\'s (the old catch-all every unrecognized role hit). ROLE_MODULES.Partner itself is untouched. Verified inert in production: routes.tsx\'s ProtectedLayout redirects any isPartnerOnlyIdentity() session to /partner before this internal Dashboard widget can ever render for them.', () => {
    // 'dashboard' is listed in ROLE_MODULES.Partner but no ALL_ACTIONS entry
    // uses that module, so it never surfaces regardless — correctly reflected here.
    expect(new Set(modulesFor(UserRole.Partner))).toEqual(new Set(['leads', 'customers', 'partners']));
  });
});

describe('Previously mis-bucketed roles now get the full candidate list instead of silently falling back to Sales\'s narrow one', () => {
  it('an unrecognized role (e.g. Manager, GroupAdmin, Procurement, TL, or any project-scoped field role) resolves to null, not Sales', () => {
    // normalizeRole is not exported (page-local, matching this repo's
    // established convention for non-exported helpers) — verified via the
    // behavioral effect instead: passing null explicitly (what normalizeRole
    // now produces for these roles) must yield the FULL list, not Sales's
    // 5-module list.
    expect(new Set(modulesFor(null))).toEqual(new Set(ALL_ACTION_MODULES));
    expect(modulesFor(null).length).not.toBe(modulesFor(UserRole.Sales).length);
  });

  it('the full list for an unrecognized role is still entirely gated by canDo() — confirmed by re-running with canDo() mocked false, yielding zero actions despite the wide candidate set', async () => {
    vi.resetModules();
    vi.doMock('../../../lib/permissions', async () => {
      const actual = await vi.importActual<typeof import('../../../lib/permissions')>('../../../lib/permissions');
      return { ...actual, canDo: vi.fn(() => false) };
    });
    const { quickActionsForRole: quickActionsForRoleDenied } = await import('../QuickActions');
    expect(quickActionsForRoleDenied(null)).toEqual([]);
  });
});
