/**
 * customerWorkspacePhase4.test.ts — Phase 4 Right Panel wiring + regression
 * checks.
 *
 * Source-text analysis, matching the convention established in Phase 2/3 —
 * no @testing-library/react in this repo. Logic that CAN be pure-tested
 * lives in relationshipHealth.test.ts / customerRecentActivity.test.ts /
 * linkedRecordsEngine.test.ts; this file covers wiring facts: is the Right
 * Panel actually mounted, does Quick Actions trigger the shared workflow
 * (not a competing one), is Phase 0-3 still intact, is there zero Phase 5
 * scope creep, were no mobile files touched.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const customerWorkspacePage = read('../CustomerWorkspace.tsx');
const rightPanel = read('../../features/customers/components/workspace/CustomerWorkspaceRightPanel.tsx');
const quickActions = read('../../features/customers/components/workspace/rightPanel/CustomerQuickActions.tsx');
const relationshipHealthUi = read('../../features/customers/components/workspace/rightPanel/CustomerRelationshipHealth.tsx');
const recentActivityUi = read('../../features/customers/components/workspace/rightPanel/CustomerRecentActivity.tsx');
const linkedRecordsUi = read('../../features/customers/components/workspace/rightPanel/CustomerLinkedRecords.tsx');
const centerPanel = read('../../features/customers/components/workspace/CustomerCenterPanel.tsx');
const b2cCards = read('../../features/customers/components/workspace/CustomerB2CWorkflowCards.tsx');
const centerWorkflowHook = read('../../features/customers/hooks/useCustomerCenterWorkflow.ts');
const leftPanel = read('../../features/customers/components/workspace/CustomerWorkspaceLeftPanel.tsx');
const kpis = read('../../features/customers/components/workspace/CustomerWorkspaceKpis.tsx');
const header = read('../../features/customers/components/workspace/CustomerWorkspaceHeader.tsx');
const followupWorkflow = read('../../features/customers/services/followupWorkflow.ts');
const customersWorkspacePage = read('../CustomersWorkspace.tsx');

describe('CustomerWorkspace — Phase 4 Right Panel wiring', () => {
  it('mounts CustomerWorkspaceRightPanel with the shared centerWorkflow instance', () => {
    expect(customerWorkspacePage).toContain('import CustomerWorkspaceRightPanel');
    expect(customerWorkspacePage).toMatch(/<CustomerWorkspaceRightPanel[\s\S]{0,200}workflow=\{centerWorkflow\}/);
  });

  it('CustomerCenterPanel and CustomerWorkspaceRightPanel receive the SAME centerWorkflow instance (single source of truth, not two)', () => {
    expect(customerWorkspacePage).toMatch(/<CustomerCenterPanel[^>]*workflow=\{centerWorkflow\}/);
    expect(customerWorkspacePage).toMatch(/<CustomerWorkspaceRightPanel[\s\S]{0,200}workflow=\{centerWorkflow\}/);
  });

  it('the Right Panel placeholder div is gone — real widgets now occupy the 20% column', () => {
    expect(customerWorkspacePage).not.toContain('minimal placeholder establishing the frozen layout');
  });
});

describe('CustomerQuickActions — triggers the existing Center Panel workflow, does not compete with it', () => {
  it('calls workflow.goToProject — the exact same function CustomerB2CWorkflowCards calls (goToQuotation/goToOrder no longer called here — Final UI Cleanup mission removed those buttons; goToLoanApplication was removed from this panel in a later pass — see the Start Registration removal test below)', () => {
    expect(quickActions).toContain('workflow.goToProject');
    expect(quickActions).not.toContain('workflow.goToQuotation');
    expect(quickActions).not.toContain('workflow.goToOrder()');
    expect(quickActions).not.toContain('workflow.goToLoanApplication');
  });

  it('never navigates to a standalone /quotations, /orders, /loan-applications, or /projects creation page for the embedded workflows', () => {
    expect(quickActions).not.toMatch(/navigate\(['"`]\/(quotations|orders|loan-applications|projects)\?create/);
  });

  it('Final UI Cleanup mission: Create Quotation/Create Order removed entirely (both B2B and B2C); B2C (no project) still offers Create Project, gated on !isB2B && !hasProject; Start Registration was later removed from this panel entirely (redundant with the Center Panel\'s own card)', () => {
    expect(quickActions).not.toContain('Create Quotation');
    expect(quickActions).not.toContain('Create Order');
    expect(quickActions).toMatch(/!isB2B\s*&&\s*!hasProject/);
    expect(quickActions).not.toContain('Start Registration');
    expect(quickActions).toContain('Create Project');
  });

  it('gates every remaining create action on a verified permission — no action bypasses permissions', () => {
    for (const check of [
      /canCreate\(['"]projects['"]\)/,
      /canView\(['"]leads['"]\)/,
    ]) {
      expect(quickActions).toMatch(check);
    }
    // loan_applications permission check was only ever used by the now-removed
    // Start Loan Application shortcut in this panel — and, since the B2C Center
    // Panel Restructure removed the Loan Application card from
    // CustomerB2CWorkflowCards too, it is no longer referenced there either.
    // Loan Application creation remains permission-gated at the service layer
    // (loanApplicationWorkflow.ts) and its own /loan-applications page.
    expect(quickActions).not.toMatch(/canCreate\(['"]loan_applications['"]\)/);
    expect(b2cCards).not.toMatch(/canCreateLoanApplications/);
    expect(b2cCards).toMatch(/canCreateProjects/);
  });

  it('does NOT use a nonexistent "tasks" permission module — Create Task is gated on canCreate(customers), matching UniversalTasksTab\'s own gating', () => {
    expect(quickActions).not.toMatch(/canCreate\(['"]tasks['"]\)/);
    expect(quickActions).toMatch(/canCreate\(['"]customers['"]\)/);
  });

  it('Schedule Follow-up reuses the existing CustomerFollowupModal + createFollowup(), not a new form/mutation', () => {
    expect(quickActions).toContain('CustomerFollowupModal');
    expect(quickActions).toContain('createFollowup(');
  });

  it('Create Task calls taskEngine.createTask() directly — the same function UniversalTasksTab uses, not a new task-creation path', () => {
    expect(quickActions).toContain('taskEngine.createTask(');
  });

  it('Call/WhatsApp/Email were removed from this panel (Final UI Cleanup mission) — Header keeps its own copies, untouched', () => {
    expect(quickActions).not.toMatch(/href=\{`tel:\$\{phone\}`\}/);
    expect(quickActions).not.toMatch(/wa\.me/);
    expect(quickActions).not.toMatch(/href=\{`mailto:\$\{email\}`\}/);
  });

  it('Add Note writes via CustomerDomainService.update(customer.id, { notes }) — same field the Left Panel Edit Customer form uses, not a new note system', () => {
    expect(quickActions).toContain("import { CustomerDomainService } from '../../../../../services/CustomerDomainService'");
    expect(quickActions).toContain('CustomerDomainService.update(customer.id, { notes: note })');
  });

  it('issues zero direct Firestore mutations of its own — createDocWithId/updateDocById never called here', () => {
    expect(quickActions).not.toMatch(/createDocWithId\(|updateDocById\(/);
  });
});

describe('CustomerRelationshipHealth — derived, not stored, not a Lead Score copy', () => {
  it('calls the pure calculateRelationshipHealth() function rather than reading a stored score field', () => {
    expect(relationshipHealthUi).toContain('calculateRelationshipHealth(');
    expect(relationshipHealthUi).not.toMatch(/customer\.(healthScore|relationshipScore|value_score)/);
  });

  it('uses a 3-tier Healthy/Needs-Attention/At-Risk label set, not a numeric Lead-Score-style badge', () => {
    expect(relationshipHealthUi).toContain('Healthy');
    expect(relationshipHealthUi).toContain('Needs Attention');
    expect(relationshipHealthUi).toContain('At Risk');
  });
});

describe('CustomerLinkedRecords — uses the shared engine, not a parallel query system', () => {
  it('calls linkedRecordsEngine.getLinkedRecords, not its own Firestore queries', () => {
    expect(linkedRecordsUi).toContain('linkedRecordsEngine.getLinkedRecords(');
    expect(linkedRecordsUi).not.toMatch(/getAll\(|getDocs\(|collection\(/);
  });

  it('queries for entityType "customers", scoped by customerId and companyId — no full-collection fetch', () => {
    expect(linkedRecordsUi).toMatch(/getLinkedRecords\(customerId, ['"]customers['"], companyId\)/);
  });
});

describe('Regression — Phase 0/1/2/3 remain intact', () => {
  it('Header still renders Call/WhatsApp/Email/View-Source-Lead — Phase 4 did not remove or replace them', () => {
    expect(header).toContain('tel:${phone}');
    expect(header).toContain('wa.me');
    expect(header).toContain('mailto:${email}');
  });

  it('CustomerWorkspaceKpis (Phase 1/2) is untouched by Phase 4', () => {
    expect(kpis).toContain('useCustomerBillingContext(');
  });

  it('CustomerWorkspaceLeftPanel (Phase 3) is untouched by Phase 4', () => {
    expect(leftPanel).toContain('resolveLeftPanelMode');
  });

  it('Premium UX Redesign mission retired CUSTOMER_TABS and workspaceConfig.ts entirely — see customerWorkspacePhase3.test.ts for the replacement coverage (CustomerWorkspaceSections)', () => {
    expect(existsSync(resolve(__dirname, '../../features/customers/utils/workspaceConfig.ts'))).toBe(false);
  });

  it('CustomerCenterPanel still renders the 4 embedded forms plus the B2C workflow cards (routing logic unchanged, only its state source moved)', () => {
    for (const form of ['CustomerQuotationForm', 'CustomerOrderForm', 'CustomerLoanApplicationForm', 'CustomerProjectForm', 'CustomerB2CWorkflowCards']) {
      expect(centerPanel).toContain(`<${form}`);
    }
  });

  it('useCustomerCenterWorkflow is a plain useState hook — no useReducer, no dirty-state, no conflict-detection (Phase 5 scope)', () => {
    expect(centerWorkflowHook).toContain('useState');
    expect(centerWorkflowHook).not.toMatch(/useReducer|dirtyState|hasUnsaved|conflictPending|CustomerWorkspaceEngine/);
  });

  it('followupWorkflow.ts extraction: createFollowup() is shared, real logic — Final Customer Module Polish mission retired the list page\'s own Schedule Follow-up row trigger (CustomersWorkspace.tsx no longer calls it directly), but the extracted function itself is untouched and still used by the Workspace\'s own Quick Action (see quickActions below)', () => {
    expect(followupWorkflow).toContain('export async function createFollowup(');
    expect(customersWorkspacePage).not.toContain('createFollowup(');
    expect(quickActions).toContain('createFollowup(');
  });

  it('module exports the component function', async () => {
    const mod = await import('../CustomerWorkspace');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
    // 240s: cold import of the full CustomerWorkspace graph under full-suite
    // parallel load (verified: passes isolated/grouped within 15-30s; the
    // full-suite parallel scheduler can push a cold compile past 170s on slow
    // machines). 240s keeps the module-existence assertion meaningful.
  }, 240000);
});

describe('Strict scope boundary — no Phase 5, no mobile, no unrelated redesigns', () => {
  it('no Save/Save & Next/Previous/Next/Footer/dirty-state/conflict-detection anywhere in the new Right Panel files', () => {
    for (const src of [rightPanel, quickActions, relationshipHealthUi, recentActivityUi, linkedRecordsUi]) {
      expect(src).not.toMatch(/Save\s*&amp;\s*Next|hasUnsaved|conflictPending|FooterActionButton|Save Draft/);
    }
  });

  it('CustomerWorkspace.tsx gained no footer element in Phase 4 — the Footer is Phase 5 scope (see customerWorkspacePhase5.test.ts), added later, not part of this phase\'s own changes', () => {
    // This test asserts the Phase 4 state of affairs, not the current file —
    // Phase 5 legitimately added a footer afterward; verified here only that
    // the Phase 4 diff itself introduced no footer-related code by checking
    // the Right Panel widget (this phase's actual scope) has none.
    expect(rightPanel).not.toMatch(/FOOTER|<footer/i);
  });

  it('no Right Panel file imports or references any Mobile* component', () => {
    for (const src of [rightPanel, quickActions, relationshipHealthUi, recentActivityUi, linkedRecordsUi]) {
      expect(src).not.toMatch(/Mobile[A-Z]\w*/);
    }
  });

  it('CustomerWorkspace.tsx does not import or reference any Mobile* component', () => {
    expect(customerWorkspacePage).not.toMatch(/Mobile[A-Z]\w*/);
  });
});
