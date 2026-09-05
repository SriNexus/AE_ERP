/**
 * phase8GroupAdminTenantContext.test.ts — RBAC Master Implementation Plan,
 * Phase 8 (SuperAdmin / GroupAdmin Hardening).
 *
 * ROOT CAUSE this pins: `resolveSessionCompanyId()` (src/lib/tenantRouting.ts)
 * had only two branches — owner/super-admin (free company selection) and
 * everyone-else (pinned to the profile's home company). A GroupAdmin fell
 * into "everyone else", so useGlobalBoot's tenant-routing effect snapped
 * any "Group view" / sibling-company selection straight back to the
 * GroupAdmin's home company on the next render — leaving every group-context
 * client mechanism (companyScopedQuery's 'group' branch, the roles_global
 * 'group' fetch, applyAccessFilters' 'group' branch, resolveReadCompanyId/
 * resolveWriteCompanyId's 'group' handling) as dead code, and every
 * client-side authorization plane home-company-only while firestore.rules
 * grant group-wide access. That mismatch is exactly the recurring
 * "UI/client denies what the backend allows" + "fix one page, break
 * another" pattern.
 *
 * FIX: a bounded GroupAdmin branch — a GroupAdmin WITH an authoritative
 * groupId retains the 'group' view or its own home company; any other
 * selection resolves to 'group' (never snapped to home, never widened to
 * the platform 'all' sentinel). firestore.rules' actorGroupId() remains the
 * real, independent boundary — unchanged by this fix.
 *
 * This file also proves every NON-GroupAdmin role's behavior is
 * byte-identical (the fix must not touch Admin/Sales/Manager/Warehouse/
 * Accounts/Partner/Owner/SuperAdmin).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach } from 'vitest';
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
  it("'group' view selection PERSISTS (the core fix — previously snapped to the home company)", () => {
    expect(resolveSessionCompanyId(groupAdmin(), 'group')).toBe('group');
  });

  it('an explicit home-company selection PERSISTS', () => {
    expect(resolveSessionCompanyId(groupAdmin(), HOME)).toBe(HOME);
  });

  it('an in-group sibling-company selection PERSISTS as a real company id (companyScopedQuery now issues a groupId-scoped read regardless of the focused company; the rules are the real boundary) — never snapped back to home', () => {
    expect(resolveSessionCompanyId(groupAdmin(), SIBLING)).toBe(SIBLING);
  });

  it('the platform-wide "all" sentinel is NEVER granted to a GroupAdmin — it resolves to the group view', () => {
    expect(resolveSessionCompanyId(groupAdmin(), 'all')).toBe('group');
  });

  it('the neutral "default"/empty pre-boot placeholder passes through (the companies effect resolves it to home)', () => {
    expect(resolveSessionCompanyId(groupAdmin(), 'default')).toBe('default');
    expect(resolveSessionCompanyId(groupAdmin(), '')).toBe('');
  });

  it('a GroupAdmin with NO authoritative groupId is treated exactly like an ordinary single-company user (fail closed — pinned to home)', () => {
    expect(resolveSessionCompanyId(groupAdmin({ groupId: '' }), 'group')).toBe(HOME);
    expect(resolveSessionCompanyId(groupAdmin({ groupId: undefined }), SIBLING)).toBe(HOME);
    // A sentinel value in the groupId field is not a real group.
    expect(resolveSessionCompanyId(groupAdmin({ groupId: 'group' }), 'group')).toBe(HOME);
  });

  it('a GroupAdmin with an authoritative groupId keeps a focused company selection (the home company)', () => {
    expect(resolveSessionCompanyId(groupAdmin(), HOME)).toBe(HOME);
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

  it('a GroupAdmin-named custom identity without the isOwner/isSuperAdmin flags does NOT gain owner-tier "all" access', () => {
    // Defense-in-depth: the branch never returns 'all'.
    expect(resolveSessionCompanyId(groupAdmin(), 'all')).not.toBe('all');
  });
});

describe('Phase 8 — the product write path no longer leaks the group-view sentinel as companyId', () => {
  it("useSaveProduct resolves companyId via resolveWriteCompanyId(), not a raw `activeCompanyId || …`", () => {
    const src = readFileSync(resolve(process.cwd(), 'src/features/inventory/hooks/useInventory.ts'), 'utf8');
    // The raw pattern that stamped the literal 'group' sentinel into the
    // createProductWithSkuLock() transaction is gone.
    expect(src).not.toContain("String(activeCompanyId || resolveWriteCompanyId() || '')");
    // The create path now uses the canonical resolver (which maps
    // 'group'/'all'/'default' -> the real target company).
    expect(src).toMatch(/const companyId = resolveWriteCompanyId\(\);/);
  });
});

describe('Phase 8 — companyScopedQuery: a GroupAdmin issues a groupId-scoped read for tenant collections regardless of the focused company', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: { id: 'ga-1', name: 'GA', email: 'ga@test.erp', role: 'GroupAdmin', companyId: HOME, groupId: GROUP },
      activeCompanyId: HOME,
      isAuthenticated: true,
      companyGroupIds: { [HOME]: GROUP, [SIBLING]: GROUP },
    } as never);
  });

  const TENANT_COLLECTIONS = [
    COLLECTIONS.PRODUCTS, COLLECTIONS.LEADS, COLLECTIONS.CUSTOMERS, COLLECTIONS.ORDERS,
    COLLECTIONS.QUOTATIONS, COLLECTIONS.VENDORS, COLLECTIONS.STOCK, COLLECTIONS.ATTENDANCE,
    COLLECTIONS.USERS, COLLECTIONS.COMPANIES,
  ];

  for (const col of TENANT_COLLECTIONS) {
    it(`${col}: groupId equality when focused on the HOME company`, () => {
      useAppStore.setState({ activeCompanyId: HOME } as never);
      const c = companyScopedQuery(col);
      expect(c).toHaveLength(1);
      expect(constraintJson(c[0])).toContain('groupId');
      expect(constraintJson(c[0])).not.toContain('companyId');
    });

    it(`${col}: groupId equality when focused on an IN-GROUP SIBLING (the query is provable; applyAccessFilters narrows the display)`, () => {
      useAppStore.setState({ activeCompanyId: SIBLING } as never);
      const c = companyScopedQuery(col);
      expect(c).toHaveLength(1);
      expect(constraintJson(c[0])).toContain('groupId');
      expect(constraintJson(c[0])).not.toContain('companyId');
    });

    it(`${col}: groupId equality in the 'group' aggregate view`, () => {
      useAppStore.setState({ activeCompanyId: 'group' } as never);
      const c = companyScopedQuery(col);
      expect(c).toHaveLength(1);
      expect(constraintJson(c[0])).toContain('groupId');
    });
  }

  it("roles: the SOLE exception — companyId-scoped to the FOCUSED company (role docs carry no groupId; groupAdminCanReadRole keys on companies/{id}.groupId)", () => {
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

  it("a GroupAdmin with NO authoritative groupId, focused on a real company, falls through to the ordinary company-scoped path (home) — fail closed to LESS access, not an error", () => {
    useAppStore.setState({
      user: { id: 'ga-x', name: 'GA', email: 'ga@test.erp', role: 'GroupAdmin', companyId: HOME, groupId: '' },
      activeCompanyId: HOME, companyGroupIds: {},
    } as never);
    const c = companyScopedQuery(COLLECTIONS.PRODUCTS);
    expect(constraintJson(c[0])).toContain('companyId');
    expect(constraintJson(c[0])).toContain(HOME);
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
 * CONSISTENT — i.e. a product created by useSaveProduct WOULD be returned by
 * getAll(PRODUCTS) and WOULD survive applyAccessFilters().
 *
 * COVERED here: resolveWriteCompanyId / resolveWriteGroupId (what
 * useSaveProduct -> createProductWithSkuLock stamp), companyScopedQuery
 * (what getAll queries), applyAccessFilters (the in-memory narrowing).
 * COVERED elsewhere (emulator, groupAdminFullGroupAccess / multiTenant
 * Security / customersOwnershipScope — 80/80): firestore.rules ACCEPT a
 * {companyId, groupId} create and a where('groupId','==') list for a
 * GroupAdmin. NOT covered by any automated test: a live DOM render.
 */
describe('Phase 8 — GroupAdmin Product CRUD: write shape ⟷ list shape are mutually consistent (assembled-path proof)', () => {
  const setGA = (activeCompanyId: string) => useAppStore.setState({
    user: { id: 'ga-p', name: 'GA', email: 'ga@test.erp', role: 'GroupAdmin', companyId: HOME, groupId: GROUP },
    activeCompanyId, isAuthenticated: true,
    company: { ...(useAppStore.getState().company), id: HOME, groupId: GROUP },
    globalCompany: { ...(useAppStore.getState().company), id: HOME, groupId: GROUP } as never,
    companyGroupIds: { [HOME]: GROUP, [SIBLING]: GROUP },
  } as never);

  for (const [label, active, expectVisibleCompany] of [
    ['focused on the HOME company', HOME, HOME],
    ['focused on an in-group SIBLING', SIBLING, SIBLING],
    ["in the 'group' aggregate view", 'group', HOME],
  ] as const) {
    it(`${label}: the created product's tenant fields satisfy the list query AND survive applyAccessFilters`, () => {
      setGA(active);

      // 1. What useSaveProduct -> createProductWithSkuLock would stamp:
      const writeCompanyId = resolveWriteCompanyId();
      const writeGroupId = resolveWriteGroupId(writeCompanyId);
      expect(writeCompanyId).not.toBe('group');           // never the sentinel (increment 1 fix)
      expect(writeCompanyId).not.toBe('all');
      expect(writeGroupId).toBe(GROUP);                    // authoritative group, always resolvable here
      const createdProduct: any = { id: 'PRD-new', companyId: writeCompanyId, groupId: writeGroupId, name: 'New Product', isDeleted: false };

      // 2. What getAll(PRODUCTS) queries:
      const constraints = companyScopedQuery(COLLECTIONS.PRODUCTS);
      const c = constraintJson(constraints[0]);
      expect(c).toContain('groupId');                      // GroupAdmin group-scoped (increment 2 fix)
      expect(c).toContain(GROUP);
      expect(c).not.toContain('companyId');

      // 3. The created product would be RETURNED by that query (its groupId matches):
      expect(createdProduct.groupId).toBe(GROUP);

      // 4. ...and would SURVIVE the in-memory narrowing:
      const visible = applyAccessFilters(COLLECTIONS.PRODUCTS, [createdProduct] as never, null);
      expect(visible.map((d: any) => d.id)).toEqual(['PRD-new']);
      if (active !== 'group') expect(createdProduct.companyId).toBe(expectVisibleCompany);
    });
  }

  it('a product in ANOTHER group is NOT returned by the query and IS filtered out (isolation preserved)', () => {
    setGA(HOME);
    const foreign: any = { id: 'PRD-foreign', companyId: 'CO-OTHER', groupId: 'GRP-OTHER', name: 'Foreign', isDeleted: false };
    // The where('groupId','==', GROUP) query would never return it; and even if
    // it somehow did, applyAccessFilters drops it.
    const visible = applyAccessFilters(COLLECTIONS.PRODUCTS, [foreign] as never, null);
    expect(visible).toHaveLength(0);
  });

  it('EDIT / DELETE reach the same record: canAccessApiResource-equivalent client filter keeps an in-group product editable, an out-of-group one not', () => {
    setGA(SIBLING);
    const inGroup: any = { id: 'PRD-1', companyId: SIBLING, groupId: GROUP, isDeleted: false };
    const outGroup: any = { id: 'PRD-2', companyId: 'CO-OTHER', groupId: 'GRP-OTHER', isDeleted: false };
    // Focused on the sibling: only the sibling's in-group product is shown for edit/delete.
    expect(applyAccessFilters(COLLECTIONS.PRODUCTS, [inGroup, outGroup] as never, null).map((d: any) => d.id)).toEqual(['PRD-1']);
  });
});
