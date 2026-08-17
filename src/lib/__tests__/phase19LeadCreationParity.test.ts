/**
 * phase19LeadCreationParity.test.ts
 *
 * Desktop's Leads.tsx used to have its own hand-rolled create-lead
 * mutation, entirely separate from useSaveLead (src/features/leads/hooks/
 * useLeads.ts) — the shared hook MobileLeadWorkspace.tsx has always used.
 * The desktop-only mutation silently skipped auto-assignment
 * (getNextAssignee), master-user linking (resolveOrCreateMasterUser), and
 * caseId propagation (createCaseForLead): a desktop-created Lead with no
 * manually-picked assignee was permanently unassigned, never linked to a
 * Users record, and never entered the Case Search chain — while the exact
 * same lead, created from mobile, got all three. Fixed by routing desktop
 * through the same useSaveLead used by mobile, and by adding desktop's
 * notification behavior (LEAD_ASSIGNED/LEAD_CREATED) into useSaveLead
 * itself so neither platform loses a capability the other had.
 *
 * Fixing this also surfaced a second, independent bug in useSaveLead's own
 * auto-assign branch: getNextAssignee() returns {userId,name} (the
 * Assignee shape), not {assignedToId,assignedToName}. The pre-existing
 * code spread that raw shape directly into the create payload as
 * `{...data, ...assignment, ...}` — since `assignment` was applied AFTER
 * `data`, an auto-assigned lead's own `name` field (the customer's name)
 * was silently overwritten by the assignee's `name` field, and
 * `assignedToId` was never actually set at all (a stray `userId` field
 * was written instead). This only fired when a lead was created without
 * an explicitly-picked assignedToId — exactly what mobile's
 * MobileLeadWorkspace.tsx create-lead form allows (assignedToId defaults
 * to '').
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const leadsPageSource = readFileSync(path.join(repoRoot, 'src/pages/Leads.tsx'), 'utf8');
const useLeadsSource = readFileSync(path.join(repoRoot, 'src/features/leads/hooks/useLeads.ts'), 'utf8');
const mobileLeadWorkspaceSource = readFileSync(
  path.join(repoRoot, 'src/components/mobile/leads/MobileLeadWorkspace.tsx'),
  'utf8',
);

describe('Phase 19 — desktop/mobile Lead creation parity', () => {
  it('desktop Leads.tsx creates leads via the same shared useSaveLead mobile uses, not a separate mutation', () => {
    expect(leadsPageSource).toMatch(/import\s*\{[^}]*useSaveLead[^}]*\}\s*from\s*['"]\.\.\/features\/leads\/hooks\/useLeads['"]/);
    expect(leadsPageSource).toMatch(/const\s+save\s*=\s*useSaveLead\(/);
    // The old desktop-only mutation body (its own genId.lead()+createLeadProjection
    // call inline in a useMutation block) must be gone, not merely unused.
    expect(leadsPageSource).not.toMatch(/const\s+save\s*=\s*useMutation\(/);
  });

  it('MobileLeadWorkspace.tsx also uses useSaveLead — one real implementation, not two', () => {
    expect(mobileLeadWorkspaceSource).toMatch(/useSaveLead/);
  });

  it("useSaveLead's create branch normalizes getNextAssignee()'s {userId,name} shape to {assignedToId,assignedToName} before use", () => {
    // Must NOT spread the raw Assignee object directly as the assignment
    // (that shape has no assignedToId/assignedToName field, and its `name`
    // field would collide with the lead's own `name` when spread after
    // `...data`).
    expect(useLeadsSource).not.toMatch(/:\s*await getNextAssignee\(activeCompanyId\)\s*[,;)]/);
    // Must actively remap userId/name -> assignedToId/assignedToName.
    expect(useLeadsSource).toMatch(/getNextAssignee\(activeCompanyId\)[\s\S]{0,120}assignedToId:\s*a\.userId/);
    expect(useLeadsSource).toMatch(/assignedToName:\s*a\.name/);
  });

  it('useSaveLead sends the same LEAD_ASSIGNED/LEAD_CREATED notifications desktop previously sent standalone', () => {
    expect(useLeadsSource).toMatch(/NotificationType\.LEAD_ASSIGNED/);
    expect(useLeadsSource).toMatch(/NotificationType\.LEAD_CREATED/);
    expect(useLeadsSource).toMatch(/notifyRoleUsers\(\['Admin',\s*'Director'\]/);
  });

  it('useSaveLead still performs master-user linking and caseId propagation on create (unregressed by this fix)', () => {
    expect(useLeadsSource).toMatch(/resolveOrCreateMasterUser/);
    expect(useLeadsSource).toMatch(/createCaseForLead/);
  });
});
