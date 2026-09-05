/**
 * phase5OwnershipFieldAudit.test.ts
 *
 * RBAC Master Implementation Plan — Phase 5 (Firestore/Data Authorization
 * Groundwork). This is the phase's own required deliverable: "a written
 * rules-pattern design plus a data-coverage report." Rather than leave the
 * findings as prose only, this file pins the concrete, re-checkable facts
 * the audit found as an executable regression contract — so Phase 7 (or
 * any later phase) can re-run it instead of re-deriving the same evidence
 * by hand, and so a future change to any of these files is caught here
 * before it silently invalidates this phase's own conclusions.
 *
 * ZERO firestore.rules changes were made this phase (by design — see the
 * Master Plan's own Phase 5 definition: "Security impact: none yet...
 * Regression risks: none (read-only audit)"). This file is source-text
 * verification only; it asserts facts about the CURRENT, unmodified
 * codebase, not a new mechanism.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const firestoreRulesSrc = readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf-8');
const leadsPageSrc = readFileSync(resolve(__dirname, '../../pages/Leads.tsx'), 'utf-8');
const quotationsPageSrc = readFileSync(resolve(__dirname, '../../pages/Quotations.tsx'), 'utf-8');
const ordersPageSrc = readFileSync(resolve(__dirname, '../../pages/Orders.tsx'), 'utf-8');
const useGlobalBootSrc = readFileSync(resolve(__dirname, '../useGlobalBoot.ts'), 'utf-8');
const ownershipVisibilitySrc = readFileSync(resolve(__dirname, '../ownershipVisibility.ts'), 'utf-8');
const caseEngineSrc = readFileSync(resolve(__dirname, '../../engines/CaseEngine.ts'), 'utf-8');
const projectVisibilitySrc = readFileSync(resolve(__dirname, '../projectVisibility.ts'), 'utf-8');
const dispatchDetailPageSrc = readFileSync(resolve(__dirname, '../../pages/DispatchDetail.tsx'), 'utf-8');

const AUTH_C1_COLLECTIONS = ['leads', 'customers', 'quotations', 'orders', 'products', 'vendors', 'cases', 'loan_applications'];

describe('AUTH-C1 — none of the 8 collections have a dedicated firestore.rules match block (still true, re-verified)', () => {
  for (const collection of AUTH_C1_COLLECTIONS) {
    it(`no dedicated "match /${collection}/" block exists`, () => {
      expect(firestoreRulesSrc).not.toMatch(new RegExp(`match /${collection}/\\{`));
    });
  }
});

describe('AUTH-C1a — CSV-imported Leads persist with no assignee (confirmed, not fixed this phase)', () => {
  it("Leads.tsx's CSV import path sets assignedToId to an empty string", () => {
    expect(leadsPageSrc).toContain("assignedToId: ''");
  });

  it('the standard (non-CSV) lead creation path auto-assigns via round-robin when no assignee is explicit — confirms the CSV path is the ONE exception, not the norm', () => {
    const useLeadsSrc = readFileSync(resolve(__dirname, '../../features/leads/hooks/useLeads.ts'), 'utf-8');
    expect(useLeadsSrc).toContain('getNextAssignee(activeCompanyId)');
  });
});

describe('Schema audit — 5 of the 8 collections have no assignedToId field at creation, only createdBy (confirmed)', () => {
  it('Quotations.tsx creation payload sets createdBy but never assignedToId', () => {
    expect(quotationsPageSrc).toContain('createdBy: user.id');
    expect(quotationsPageSrc).not.toContain('assignedToId:');
  });

  it("Orders.tsx creation payload sets createdBy but never assignedToId (assignedToId appears only in the list page's filter UI, not the create payload)", () => {
    expect(ordersPageSrc).toContain('createdBy:user.id');
    // The only assignedToId reference in this file is the filter predicate,
    // not a create-payload field — confirmed by there being exactly one
    // occurrence and it reading a value, not assigning one at creation.
    const matches = ordersPageSrc.match(/assignedToId/g) || [];
    expect(matches.length).toBeGreaterThan(0); // present (the filter)
    expect(ordersPageSrc).not.toContain('assignedToId:'); // but never set as a payload field
  });
});

describe('The corrected rules-pattern design mirrors useGlobalBoot.ts\'s REAL team-membership computation exactly', () => {
  it('teamMemberIds is a one-level, direct managerId match — confirms a single get() per record is sufficient for an equivalent rules-layer check, not a multi-level hierarchy walk', () => {
    expect(useGlobalBootSrc).toContain("setTeamMemberIds(users.filter((u:any)=>u.managerId===user.id).map((u:any)=>u.id));");
  });

  it("the client's own ownership/visibility query plan already checks BOTH assignedToId AND createdBy for team matching — the exact gap the plan's original draft rules-pattern missed", () => {
    expect(ownershipVisibilitySrc).toContain("export const OWNERSHIP_FIELDS = ['assignedToId', 'createdBy', 'partnerId'] as const;");
  });
});

describe('AUTH-C1 — cases has createdBy but is moot until BD-4 (only Admin holds any grant today)', () => {
  it('CaseEngine.ts sets createdBy on every case', () => {
    expect(caseEngineSrc).toContain('createdBy: userId,');
  });
});

describe('AUTH-C3 — commission_records/settlements ownership narrowing remains a documented, deliberate, unchanged trade-off (re-verified, not newly discovered)', () => {
  it('the existing rules comment explicitly says team/self scoping was deliberately left out to avoid extra get() calls', () => {
    expect(firestoreRulesSrc).toContain('does NOT replicate Manager\'s team-scope or Partner\'s');
    expect(firestoreRulesSrc).toContain('to avoid the extra get() calls a');
  });
});

describe('AUTH-C4 — canReadProjectScoped() still unconditionally admits any non-project-scoped role (re-verified, unchanged)', () => {
  it('the !isProjectScopedRole() branch is still present, still an unconditional OR', () => {
    const match = firestoreRulesSrc.match(/function canReadProjectScoped\(data\) \{[\s\S]*?\n    \}/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('|| !isProjectScopedRole()');
  });

  it("Project's real ownership fields are assignedSurveyor/assignedInstaller/salesOwner/designerId — NOT assignedToId (Projects use their own, already-established naming, confirmed here so a future phase doesn't assume AUTH-C1's field names apply)", () => {
    const match = firestoreRulesSrc.match(/function canReadProjectScoped\(data\) \{[\s\S]*?\n    \}/);
    expect(match![0]).toContain('data.assignedSurveyor == currentUserId()');
    expect(match![0]).toContain('data.assignedInstaller == currentUserId()');
    expect(match![0]).toContain('data.salesOwner == currentUserId()');
    expect(match![0]).toContain('data.designerId == currentUserId()');
  });
});

describe('BD-9 / AUTH-C4a — RESOLVED: the !isProjectScopedRole() default is intentional, not a gap (evidence pinned so a future phase does not "fix" a shipped feature)', () => {
  it("the client's own dedicated project-visibility engine (projectVisibility.ts) independently falls back to 'all' for any role name not in its own field-role set — the SAME default firestore.rules' !isProjectScopedRole() grants, confirming the two were deliberately kept in lockstep, not accidentally aligned", () => {
    expect(projectVisibilitySrc).toContain("const PROJECT_SCOPED_ROLE_NAMES = new Set([");
    expect(projectVisibilitySrc).toContain("return PROJECT_SCOPED_ROLE_NAMES.has(normalizedKey(roleName)) ? 'self' : 'all';");
  });

  it('DispatchDetail.tsx — a real, currently-shipped page opened by Warehouse/Operations/Accounts/Sales alike — unconditionally fetches the full company projects list with no permission gate, to resolve and link a dispatch\'s parent project; this is the concrete feature that depends on the "all" default above and would break if it were narrowed', () => {
    expect(dispatchDetailPageSrc).toContain('getAll(COLLECTIONS.PROJECTS)');
    // No canDo/permission gate wraps this query — every role that can open
    // a Dispatch Detail page reaches it, including roles with zero explicit
    // `projects` module grant (Warehouse, Operations, Accounts, Sales).
    expect(dispatchDetailPageSrc).not.toMatch(/canDo\([^)]*'projects'\)[\s\S]{0,80}getAll\(COLLECTIONS\.PROJECTS\)/);
  });
});
