import { describe, expect, it } from 'vitest';
import { buildOwnershipVisibilityQueryPlan } from '../ownershipVisibility';

describe('ownershipVisibility — query-level self/team scoping for non-project collections (Phase 13)', () => {
  it('returns a single company-scoped query with no id constraint for "all" visibility', () => {
    const plan = buildOwnershipVisibilityQueryPlan('COMP-1', 'USR-1', 'all', []);
    expect(plan.mode).toBe('all');
    expect(plan.queries).toHaveLength(1);
  });

  // Vendor Lock GAP-04 remediation (independent audit, 2026-08-14): these
  // two tests were stale, not the implementation — OWNERSHIP_FIELDS gained
  // a third field, 'partnerId', per the Channel Partner spec §8.3
  // IMPLEMENTATION DECISION ("add 'partnerId' to OWNERSHIP_FIELDS... so a
  // Partner-role user's projects/leads/customers resolve to 'self'
  // regardless of who converted them"). The hardcoded field-count
  // expectations here were never updated when that (correct, intentional)
  // change landed.
  it('builds one query per ownership field ("assignedToId", "createdBy", "partnerId") for "self" visibility', () => {
    const plan = buildOwnershipVisibilityQueryPlan('COMP-1', 'USR-1', 'self', []);
    expect(plan.mode).toBe('owned');
    expect(plan.queries).toHaveLength(3);
  });

  it('includes teamMemberIds in the id set for "team" visibility, deduplicated with self', () => {
    const plan = buildOwnershipVisibilityQueryPlan('COMP-1', 'USR-1', 'team', ['USR-1', 'USR-2', 'USR-3']);
    expect(plan.mode).toBe('owned');
    // 3 ownership fields x 1 id-chunk (3 unique ids fits in one 'in' chunk)
    expect(plan.queries).toHaveLength(3);
  });

  it('falls back to "all" (no scoping) when userId is missing, even for self/team visibility', () => {
    const plan = buildOwnershipVisibilityQueryPlan('COMP-1', null, 'team', ['USR-2']);
    expect(plan.mode).toBe('all');
  });

  it('chunks id sets larger than Firestore\'s 30-value "in" limit', () => {
    const bigTeam = Array.from({ length: 40 }, (_, i) => `USR-${i}`);
    const plan = buildOwnershipVisibilityQueryPlan('COMP-1', 'USR-0', 'team', bigTeam);
    // 41 total ids -> 2 chunks (30 + 11) per field x 3 fields = 6 queries
    expect(plan.queries).toHaveLength(6);
  });

  it('omits the company constraint when companyId is "all"', () => {
    const plan = buildOwnershipVisibilityQueryPlan('all', 'USR-1', 'self', []);
    expect(plan.mode).toBe('owned');
    // Each query should only carry the ownership constraint, not a companyId constraint
    plan.queries.forEach((constraints) => expect(constraints).toHaveLength(1));
  });
});
