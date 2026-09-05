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
import { resolveSessionCompanyId } from '../tenantRouting';

const HOME = 'CO-HOME';
const SIBLING = 'CO-SIBLING';
const GROUP = 'GRP-1';

const groupAdmin = (over: Record<string, unknown> = {}) => ({
  companyId: HOME, role: 'GroupAdmin', groupId: GROUP, isOwner: false, isSuperAdmin: false, ...over,
});

describe('Phase 8 — resolveSessionCompanyId: GroupAdmin group-context is no longer snapped back to home', () => {
  it("'group' view selection PERSISTS (the core fix — previously snapped to the home company)", () => {
    expect(resolveSessionCompanyId(groupAdmin(), 'group')).toBe('group');
  });

  it('an explicit home-company selection PERSISTS', () => {
    expect(resolveSessionCompanyId(groupAdmin(), HOME)).toBe(HOME);
  });

  it('a sibling-company selection resolves to the group view — never snapped back to home, never widened to "all"', () => {
    expect(resolveSessionCompanyId(groupAdmin(), SIBLING)).toBe('group');
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
