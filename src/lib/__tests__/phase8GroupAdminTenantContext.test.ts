/**
 * phase8GroupAdminTenantContext.test.ts — RBAC Master Implementation Plan,
 * Phase 8 (SuperAdmin / GroupAdmin Hardening).
 *
 * ROOT CAUSE this pins: the client authorization planes each independently
 * confined a GroupAdmin to their home company while firestore.rules grant
 * group-wide access — the recurring "UI/client denies what the backend
 * allows" + "fix one page, break another" pattern. Two distinct defects:
 *
 *  1. `resolveSessionCompanyId()` (src/lib/tenantRouting.ts) had only two
 *     branches — owner/super-admin (free selection) and everyone-else
 *     (pinned to home) — so useGlobalBoot's tenant-routing effect snapped a
 *     GroupAdmin's "Group view" / sibling selection straight back to home.
 *
 *  2. `companyScopedQuery()` (src/lib/firestore.ts), after the first Phase 8
 *     pass, issued a `where('groupId','==')` read for a GroupAdmin in EVERY
 *     context including their own home company. That made the core session
 *     depend on the identity's groupId AND on every legacy document carrying
 *     a groupId — and a fresh session, landing on an arbitrary in-group
 *     SIBLING (companies[0] of a now-groupId-scoped list), wrote new records
 *     under that sibling's companyId with no resolvable groupId, which the
 *     rules' groupAdminCanCreate / canCreateCompanyScoped then rejected.
 *     THIS is why "GroupAdmin cannot create a Product" survived the first
 *     passes.
 *
 * FIX (this increment): the split is by ADMINISTRATIVE SCOPE, not business
 * permission —
 *   - a GroupAdmin focused on their HOME company reads/writes with a plain
 *     `where('companyId','==', home)` — pre-Phase-8 behaviour, always
 *     provable via canReadCompanyScoped / the Phase-7 catch-all, ZERO
 *     dependency on the identity groupId or on document groupId. Their core
 *     session (list + create + edit on their own company, legacy records
 *     included) works unconditionally.
 *   - a GroupAdmin focused on an in-group SIBLING, or the 'group' aggregate
 *     view, reads with `where('groupId','==', actorGroupId)` (the only shape
 *     firestore.rules' groupAdminCanRead can prove there).
 *   - `companies` is ALWAYS group-scoped for a GroupAdmin (so the switcher
 *     lists the whole group); `roles` is NEVER group-scoped (companyId of
 *     the focused company — groupAdminCanReadRole keys on
 *     companies/{id}.groupId).
 *   - a fresh ('' / 'default') session lands on the HOME company, never an
 *     arbitrary sibling.
 *   - a GroupAdmin whose group cannot be resolved degrades to home-company
 *     companyId scope (fail closed to LESS access) — never a hard error
 *     except in the explicit 'group' view.
 *
 * firestore.rules' actorGroupId() remains the real, independent boundary —
 * unchanged by this fix. This file also proves every NON-GroupAdmin role's
 * behaviour is byte-identical.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveSessionCompanyId } from '../tenantRouting';
import { companyScopedQuery, applyAccessFilters, resolveWriteCompanyId, resolveWriteGroupId } from '../firestore';
import { COLLECTIONS } from '../firebase';
import { useAppStore } from '../../store/useAppStore';

const HOME = 'CO-HOME';
const SIBLING = 'CO-SIBLING';
const GROUP = 'GRP-1';

const groupAdmin = (over: Record<string, unknown> = {}) => ({
  companyId: HOME, role: 'GroupAdmin', groupId: GROUP, isOwner: false, isSuperAdmin: false, ...over,
});

function constraintJson(c: unknown) {
  return JSON.stringify(c);
}

describe('Phase 8 — resolveSessionCompanyId: GroupAdmin group-context is no longer snapped back to home', () => {
  it("'group' view selection PERSISTS (previously snapped to the home company)", () => {
    expect(resolveSessionCompanyId(groupAdmin(), 'group')).toBe('group');
  });

  it('an explicit home-company selection PERSISTS', () => {
    expect(resolveSessionCompanyId(groupAdmin(), HOME)).toBe(HOME);
  });

  it('an in-group sibling-company selection PERSISTS as a real company id — never snapped back to home', () => {
    expect(resolveSessionCompanyId(groupAdmin(), SIBLING)).toBe(SIBLING);
  });

  it('the platform-wide "all" sentinel is NEVER granted to a GroupAdmin — it resolves to the group view', () => {
    expect(resolveSessionCompanyId(groupAdmin(), 'all')).toBe('group');
  });

  it('the neutral "default"/empty pre-boot placeholder resolves to the HOME company (not an arbitrary sibling)', () => {
    expect(resolveSessionCompanyId(groupAdmin(), 'default')).toBe(HOME);
    expect(resolveSessionCompanyId(groupAdmin(), '')).toBe(HOME);
  });

  it('a GroupAdmin with NO authoritative groupId is treated exactly like an ordinary single-company user (fail closed — pinned to home)', () => {
    expect(resolveSessionCompanyId(groupAdmin({ groupId: '' }), 'group')).toBe(HOME);
    expect(resolveSessionCompanyId(groupAdmin({ groupId: undefined }), SIBLING)).toBe(HOME);
    expect(resolveSessionCompanyId(groupAdmin({ groupId: 'group' }), 'group')).toBe(HOME);
  });

  it('role matching is case-insensitive and trims (mirrors resolveCompatibleRole / firestore.ts)', () => {
    expect(resolveSessionCompanyId(groupAdmin({ role: ' groupadmin ' }), 'group')).toBe('group');
    expect(resolveSessionCompanyId(groupAdmin({ role: 'GROUPADMIN' }), 'group')).toBe('group');
  });
});

describe('Phase 8 — resolveSessionCompanyId: NON-GroupAdmin roles are byte-for-byte unchanged', () => {
  for (const role of ['Admin', 'Sales', 'Manager', 'TL', 'Warehouse', 'Accounts', 'Partner', 'Director', 'HR', 'Operations', 'Surveyor']) {
    it(`${role} stays pinned to its canonical home company for ANY selection`, () => {
      const identity = { companyId: HOME, role, groupId: GROUP, isOwner: false, isSuperAdmin: false };
      expect(resolveSessionCompanyId(identity, 'group')).toBe(HOME);
      expect(resolveSessionCompanyId(identity, SIBLING)).toBe(HOME);
      expect(resolveSessionCompanyId(identity, 'all')).toBe(HOME);
      expect(resolveSessionCompanyId(identity, HOME)).toBe(HOME);
      expect(resolveSessionCompanyId(identity, 'default')).toBe(HOME);
    });
  }

  it('Owner retains an arbitrary company selection (unchanged)', () => {
    expect(resolveSessionCompanyId({ companyId: HOME, isOwner: true }, 'anything')).toBe('anything');
    expect(resolveSessionCompanyId({ companyId: HOME, isOwner: true }, 'all')).toBe('all');
  });

  it('SuperAdmin retains an arbitrary company selection (unchanged)', () => {
    expect(resolveSessionCompanyId({ companyId: HOME, isSuperAdmin: true }, 'anything')).toBe('anything');
  });

  it('an identity with no companyId passes the selection through (unchanged)', () => {
    expect(resolveSessionCompanyId({ companyId: '', role: 'Sales' }, 'fallback-co')).toBe('fallback-co');
  });

  it('a GroupAdmin-named identity without the isOwner/isSuperAdmin flags does NOT gain owner-tier "all" access', () => {
    expect(resolveSessionCompanyId(groupAdmin(), 'all')).not.toBe('all');
  });
});

describe('Phase 8 — the product write path no longer leaks the group-view sentinel as companyId', () => {
  it("useSaveProduct resolves companyId via resolveWriteCompanyId(), not a raw `activeCompanyId || …`", () => {
    const src = readFileSync(resolve(process.cwd(), 'src/features/inventory/hooks/useInventory.ts'), 'utf8');
    expect(src).not.toContain("String(activeCompanyId || resolveWriteCompanyId() || '')");
    expect(src).toMatch(/const companyId = resolveWriteCompanyId\(\);/);
  });
});

describe('Phase 8 — companyScopedQuery: the home / sibling / group split (administrative scope)', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: { id: 'ga-1', name: 'GA', email: 'ga@test.erp', role: 'GroupAdmin', companyId: HOME, groupId: GROUP },
      activeCompanyId: HOME,
      isAuthenticated: true,
      companyGroupIds: { [HOME]: GROUP, [SIBLING]: GROUP },
    } as never);
  });

  // Every ordinary tenant collection (NOT companies, NOT roles).
  const TENANT_COLLECTIONS = [
    COLLECTIONS.PRODUCTS, COLLECTIONS.LEADS, COLLECTIONS.CUSTOMERS, COLLECTIONS.ORDERS,
    COLLECTIONS.QUOTATIONS, COLLECTIONS.VENDORS, COLLECTIONS.STOCK, COLLECTIONS.ATTENDANCE,
    COLLECTIONS.USERS,
  ];

  for (const col of TENANT_COLLECTIONS) {
    it(`${col}: focused on the HOME company -> plain companyId scope (pre-Phase-8, always provable, zero groupId dependency)`, () => {
      useAppStore.setState({ activeCompanyId: HOME } as never);
      const c = companyScopedQuery(col);
      expect(c).toHaveLength(1);
      expect(constraintJson(c[0])).toContain('companyId');
      expect(constraintJson(c[0])).toContain(HOME);
      expect(constraintJson(c[0])).not.toContain('"groupId"');
    });

    it(`${col}: focused on an IN-GROUP SIBLING -> groupId scope (the only shape groupAdminCanRead can prove there)`, () => {
      useAppStore.setState({ activeCompanyId: SIBLING } as never);
      const c = companyScopedQuery(col);
      expect(c).toHaveLength(1);
      expect(constraintJson(c[0])).toContain('groupId');
      expect(constraintJson(c[0])).toContain(GROUP);
      expect(constraintJson(c[0])).not.toContain('"companyId"');
    });

    it(`${col}: the 'group' aggregate view -> groupId scope`, () => {
      useAppStore.setState({ activeCompanyId: 'group' } as never);
      const c = companyScopedQuery(col);
      expect(c).toHaveLength(1);
      expect(constraintJson(c[0])).toContain('groupId');
      expect(constraintJson(c[0])).toContain(GROUP);
    });
  }

  it('companies: ALWAYS group-scoped for a GroupAdmin (even focused on home) so the switcher lists the whole group', () => {
    useAppStore.setState({ activeCompanyId: HOME } as never);
    const c = companyScopedQuery(COLLECTIONS.COMPANIES);
    expect(c).toHaveLength(1);
    expect(constraintJson(c[0])).toContain('groupId');
    expect(constraintJson(c[0])).toContain(GROUP);
  });

  it('roles: NEVER group-scoped — companyId of the FOCUSED company (role docs carry no groupId; groupAdminCanReadRole keys on companies/{id}.groupId)', () => {
    useAppStore.setState({ activeCompanyId: SIBLING } as never);
    const c = companyScopedQuery(COLLECTIONS.ROLES);
    expect(c).toHaveLength(1);
    expect(constraintJson(c[0])).toContain('companyId');
    expect(constraintJson(c[0])).toContain(SIBLING);
    expect(constraintJson(c[0])).not.toContain('groupId');
  });

  it('roles: focused on the home company -> home-company roles', () => {
    useAppStore.setState({ activeCompanyId: HOME } as never);
    const c = companyScopedQuery(COLLECTIONS.ROLES);
    expect(constraintJson(c[0])).toContain(HOME);
  });

  it('a GroupAdmin whose group cannot be resolved, focused on their HOME company, still gets a working companyId-scoped read (the core session never breaks on incomplete linkage)', () => {
    useAppStore.setState({
      user: { id: 'ga-x', name: 'GA', email: 'ga@test.erp', role: 'GroupAdmin', companyId: HOME, groupId: '' },
      activeCompanyId: HOME, companyGroupIds: {},
    } as never);
    const c = companyScopedQuery(COLLECTIONS.PRODUCTS);
    expect(constraintJson(c[0])).toContain('companyId');
    expect(constraintJson(c[0])).toContain(HOME);
  });

  it('a GroupAdmin whose group cannot be resolved, focused on a SIBLING, degrades to companyId scope (fail closed to LESS access — the rules deny the sibling, home still works)', () => {
    useAppStore.setState({
      user: { id: 'ga-x2', name: 'GA', email: 'ga@test.erp', role: 'GroupAdmin', companyId: HOME, groupId: '' },
      activeCompanyId: SIBLING, companyGroupIds: {},
    } as never);
    const c = companyScopedQuery(COLLECTIONS.PRODUCTS);
    expect(constraintJson(c[0])).toContain('companyId');
    expect(constraintJson(c[0])).toContain(SIBLING);
  });

  it("the §3.2 fallback: a GroupAdmin with NO identity groupId but a linked home company derives the group from companyGroupIds[home]", () => {
    useAppStore.setState({
      user: { id: 'ga-z', name: 'GA', email: 'ga@test.erp', role: 'GroupAdmin', companyId: HOME, groupId: '' },
      activeCompanyId: SIBLING, companyGroupIds: { [HOME]: GROUP, [SIBLING]: GROUP },
    } as never);
    const c = companyScopedQuery(COLLECTIONS.PRODUCTS);
    expect(constraintJson(c[0])).toContain('groupId');
    expect(constraintJson(c[0])).toContain(GROUP);
  });

  it("the explicit 'group' aggregate view with NO resolvable groupId is a hard error (unchanged)", () => {
    useAppStore.setState({
      user: { id: 'ga-y', name: 'GA', email: 'ga@test.erp', role: 'GroupAdmin', companyId: HOME, groupId: '' },
      activeCompanyId: 'group', companyGroupIds: {},
    } as never);
    expect(() => companyScopedQuery(COLLECTIONS.PRODUCTS)).toThrow(/Group context is not resolved/);
  });
});

describe('Phase 8 — companyScopedQuery: NON-GroupAdmin actors are byte-for-byte unchanged', () => {
  for (const role of ['Admin', 'Sales', 'Manager', 'Warehouse', 'Accounts', 'Partner', 'Director']) {
    it(`${role} on a real company still gets a companyId-scoped read for products/leads (no groupId branch)`, () => {
      useAppStore.setState({
        user: { id: 'u-1', name: role, email: 'u@test.erp', role, companyId: HOME, groupId: GROUP },
        activeCompanyId: HOME, isAuthenticated: true, companyGroupIds: { [HOME]: GROUP },
      } as never);
      for (const col of [COLLECTIONS.PRODUCTS, COLLECTIONS.LEADS]) {
        const c = companyScopedQuery(col);
        expect(constraintJson(c[0])).toContain('companyId');
        expect(constraintJson(c[0])).not.toContain('"groupId"');
      }
    });
  }

  it('Owner / SuperAdmin get the unscoped read for roles/companies (unchanged)', () => {
    useAppStore.setState({
      user: { id: 'o-1', name: 'Owner', email: 'shreeniwas.tripathi0@gmail.com', role: 'Owner', companyId: HOME, isOwner: true, isSuperAdmin: true },
      activeCompanyId: 'all',
    } as never);
    expect(companyScopedQuery(COLLECTIONS.ROLES)).toHaveLength(0);
    expect(companyScopedQuery(COLLECTIONS.COMPANIES)).toHaveLength(0);
  });
});

/**
 * Product CRUD — deterministic assembled-path proof.
 *
 * A literal browser test (React render -> click "Add Product" -> submit ->
 * poll the list) is impractical in this repo's test architecture (no RTL +
 * emulator + app-`db`-to-emulator wiring). This is the closest deterministic
 * assembly: it drives the REAL client tenant helpers a GroupAdmin's Product
 * flow uses and proves the write shape and the read/list shape are MUTUALLY
 * CONSISTENT — a product created by useSaveProduct WOULD be returned by
 * getAll(PRODUCTS) and WOULD survive applyAccessFilters().
 *
 * COVERED here: resolveWriteCompanyId / resolveWriteGroupId (what
 * useSaveProduct -> createProductWithSkuLock stamp), companyScopedQuery
 * (what getAll queries), applyAccessFilters (the in-memory narrowing).
 * COVERED elsewhere (emulator — groupAdminFullGroupAccess / multiTenant
 * Security / customersOwnershipScope): firestore.rules ACCEPT a
 * {companyId, groupId} create and the corresponding list query for a
 * GroupAdmin. NOT covered by any automated test: a live DOM render against
 * the production project with a real GroupAdmin account whose identity
 * groupId is actually backfilled.
 */
describe('Phase 8 — GroupAdmin Product CRUD: write shape ⟷ list shape are mutually consistent (assembled-path proof)', () => {
  const setGA = (activeCompanyId: string) => useAppStore.setState({
    user: { id: 'ga-p', name: 'GA', email: 'ga@test.erp', role: 'GroupAdmin', companyId: HOME, groupId: GROUP },
    activeCompanyId, isAuthenticated: true,
    company: { ...(useAppStore.getState().company), id: HOME, groupId: GROUP },
    globalCompany: { ...(useAppStore.getState().company), id: HOME, groupId: GROUP } as never,
    companyGroupIds: { [HOME]: GROUP, [SIBLING]: GROUP },
  } as never);

  for (const [label, active, expectScopeField, expectScopeValue] of [
    ['focused on the HOME company', HOME, 'companyId', HOME],
    ['focused on an in-group SIBLING', SIBLING, 'groupId', GROUP],
    ["in the 'group' aggregate view", 'group', 'groupId', GROUP],
  ] as const) {
    it(`${label}: the created product's tenant fields satisfy the list query AND survive applyAccessFilters`, () => {
      setGA(active);

      // 1. What useSaveProduct -> createProductWithSkuLock would stamp:
      const writeCompanyId = resolveWriteCompanyId();
      const writeGroupId = resolveWriteGroupId(writeCompanyId);
      expect(writeCompanyId).not.toBe('group');
      expect(writeCompanyId).not.toBe('all');
      expect(writeGroupId).toBe(GROUP);
      const createdProduct: any = { id: 'PRD-new', companyId: writeCompanyId, groupId: writeGroupId, name: 'New Product', isDeleted: false };

      // 2. What getAll(PRODUCTS) queries:
      const constraints = companyScopedQuery(COLLECTIONS.PRODUCTS);
      const c = constraintJson(constraints[0]);
      expect(c).toContain(expectScopeField);
      expect(c).toContain(expectScopeValue);

      // 3. The created product would be RETURNED by that query:
      if (expectScopeField === 'companyId') expect(createdProduct.companyId).toBe(expectScopeValue);
      else expect(createdProduct.groupId).toBe(expectScopeValue);

      // 4. ...and would SURVIVE the in-memory narrowing:
      const visible = applyAccessFilters(COLLECTIONS.PRODUCTS, [createdProduct] as never, null);
      expect(visible.map((d: any) => d.id)).toEqual(['PRD-new']);
    });
  }

  it('a product in ANOTHER group is NOT returned by the query and IS filtered out (isolation preserved)', () => {
    setGA(HOME);
    const foreign: any = { id: 'PRD-foreign', companyId: 'CO-OTHER', groupId: 'GRP-OTHER', name: 'Foreign', isDeleted: false };
    const visible = applyAccessFilters(COLLECTIONS.PRODUCTS, [foreign] as never, null);
    expect(visible).toHaveLength(0);
  });

  it('EDIT / DELETE reach the same record: an in-group product stays editable, an out-of-group one is filtered out', () => {
    setGA(SIBLING);
    const inGroup: any = { id: 'PRD-1', companyId: SIBLING, groupId: GROUP, isDeleted: false };
    const outGroup: any = { id: 'PRD-2', companyId: 'CO-OTHER', groupId: 'GRP-OTHER', isDeleted: false };
    expect(applyAccessFilters(COLLECTIONS.PRODUCTS, [inGroup, outGroup] as never, null).map((d: any) => d.id)).toEqual(['PRD-1']);
  });
});
