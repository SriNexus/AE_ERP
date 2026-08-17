/**
 * customerWorkspacePhase2.test.ts — Phase 2 Center Panel wiring + regression
 * checks.
 *
 * Source-text analysis, matching the existing convention for this file
 * cluster (see customerWorkspace.test.ts / customerWorkspaceDialogs.test.ts)
 * — there is no @testing-library/react dependency in this repository, so
 * full render testing of the embedded workflow forms isn't available.
 * Business logic that CAN be isolated as pure/async functions is unit-tested
 * directly (createLoanApplication, checkFirstTimeBilling — see their own test
 * files); what remains here is wiring facts that can't be logic-tested:
 * does the Center Panel actually reuse the extracted functions, is the old
 * reference content still present (no regression), does the standalone
 * Quotations/Orders/Projects pages still work unmodified in behavior.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const customerWorkspacePage = read('../CustomerWorkspace.tsx');
const centerPanel = read('../../features/customers/components/workspace/CustomerCenterPanel.tsx');
const centerB2CCards = read('../../features/customers/components/workspace/CustomerB2CWorkflowCards.tsx');
const quotationForm = read('../../features/customers/components/workspace/CustomerQuotationForm.tsx');
const orderForm = read('../../features/customers/components/workspace/CustomerOrderForm.tsx');
const registrationForm = read('../../features/customers/components/workspace/CustomerLoanApplicationForm.tsx');
const projectForm = read('../../features/customers/components/workspace/CustomerProjectForm.tsx');
const quotationsPage = read('../Quotations.tsx');
const ordersPage = read('../Orders.tsx');
const projectsPage = read('../Projects.tsx');
const sharedProjectForm = read('../../features/projects/components/ProjectForm.tsx');
const loanApplicationsWorkspacePage = read('../LoanApplicationsWorkspace.tsx');
const kpis = read('../../features/customers/components/workspace/CustomerWorkspaceKpis.tsx');
// Compact Workspace & Central Panel B2B Workflow mission: B2B's create
// actions (Order specifically) moved out of CustomerCenterPanel/
// the B2C workflow-cards component into the dedicated pipeline component.
const b2bPipeline = read('../../features/customers/components/workspace/CustomerB2BWorkflowPipeline.tsx');
// Phase 4 lifted the create-view state (and the first-time-billing check
// that drives it) out of CustomerCenterPanel.tsx into this hook — see
// customerWorkspacePhase4.test.ts for the full Phase 4 wiring checks.
const centerWorkflowHook = read('../../features/customers/hooks/useCustomerCenterWorkflow.ts');
// Premium UX Redesign mission: the workspace-level tab bar (and the
// Orders/Activity/Linked Records tab-content files this describe block
// used to check were wired into it) is retired — that same content now
// mounts via CustomerWorkspaceSections' accordion instead.
const sections = read('../../features/customers/components/workspace/CustomerWorkspaceSections.tsx');

describe('CustomerWorkspace — Phase 2 Center Panel wiring', () => {
  it('embeds CustomerCenterPanel inside the Overview tab, customer-locked', () => {
    expect(customerWorkspacePage).toContain('import CustomerCenterPanel');
    // Phase 4 added a `workflow` prop (see useCustomerCenterWorkflow.ts) so
    // the Right Panel's Quick Actions can drive the same create-view state —
    // `customer` is still passed directly, still locked, unchanged.
    expect(customerWorkspacePage).toMatch(/<CustomerCenterPanel\s+customer=\{customer\}\s+workflow=\{centerWorkflow\}\s*\/>/);
  });

  it('Financial Summary/Timeline & Activity/Related Records fake-data tiles are gone entirely — not moved, removed (Premium UX Redesign mission); the real Orders/Activity/Linked Records content lives in CustomerWorkspaceSections now, not a workspace-level tab', () => {
    // "Customer Information" and "Links & References" moved out in Phase 3
    // (replaced by the Left Panel's CustomerContextPanel).
    for (const marker of ['Financial Summary', 'Timeline &amp; Activity', '>Related Records<']) {
      expect(customerWorkspacePage).not.toContain(marker);
    }
    expect(customerWorkspacePage).not.toContain('CustomerOrdersTabContent');
    expect(customerWorkspacePage).not.toContain('CustomerActivityTabContent');
    expect(customerWorkspacePage).not.toContain('CustomerLinkedRecordsTabContent');
    expect(sections).toContain('CustomerOrdersTabContent');
    expect(sections).toContain('CustomerActivityTabContent');
    expect(sections).toContain('CustomerLinkedRecordsTabContent');
  });

  it('the equivalent of every existing tab is still reachable — Documents/Activity/Order History/Linked Records/Tasks all mount via CustomerWorkspaceSections, passing the same entityId/companyId/caseId/permissions shape the old tab dispatch used, with entityType still resolved internally to \'customers\'', () => {
    expect(customerWorkspacePage).toContain('<CustomerWorkspaceSections');
    expect(customerWorkspacePage).toMatch(/entityId=\{customer\.id\}/);
    expect(sections).toMatch(/entityType:\s*'customers'/);
  });
});

describe('CustomerCenterPanel — B2B/B2C routing and first-time-billing suggestion', () => {
  it('renders exactly the 4 embedded workflow forms plus the default B2C workflow cards, no navigation-only links', () => {
    for (const form of ['CustomerQuotationForm', 'CustomerOrderForm', 'CustomerLoanApplicationForm', 'CustomerProjectForm', 'CustomerB2CWorkflowCards']) {
      expect(centerPanel).toContain(`<${form}`);
    }
    expect(centerPanel).not.toMatch(/navigate\(['"`]\/(quotations|orders|loan-applications|projects)/);
  });

  it('gates every create action behind usePermissions().canCreate for the target domain module — the B2C section gates projects; quotations/orders gates live in the B2B pipeline', () => {
    // B2C Center Panel Restructure mission: the Quotation/Loan Application cards
    // were removed from the B2C "Work on This Customer" section, so their
    // permission gates left this component with them.
    expect(centerPanel).toMatch(/canCreate\(['"]projects['"]\)/);
    expect(centerPanel).not.toMatch(/canCreate\(['"]quotations['"]\)/);
    expect(centerPanel).not.toMatch(/canCreate\(['"]loan_applications['"]\)/);
    // Quotation/Order create gates moved into CustomerB2BWorkflowPipeline
    // along with the rest of the B2B create/view actions (Compact Workspace
    // & Central Panel B2B Workflow mission).
    expect(b2bPipeline).toMatch(/canCreate\(['"]quotations['"]\)/);
    expect(b2bPipeline).toMatch(/canCreate\(['"]orders['"]\)/);
  });

  it('runs the documented first-time-billing check before routing to Create Order, and offers both quotation and direct-order paths', () => {
    // Phase 4 relocated this check (and the view state it drives) into
    // useCustomerCenterWorkflow.ts — the banner UI it triggers is still
    // rendered by CustomerCenterPanel.tsx itself.
    expect(centerWorkflowHook).toContain('checkFirstTimeBilling');
    expect(centerPanel).toContain('Create Quotation');
    expect(centerPanel).toContain('Continue with Direct Order');
  });

  it('derives project-from-loan-application eligibility from Payment Received status with no existing project — not a guessed condition', () => {
    expect(centerPanel).toMatch(/latestRegistration\?\.status === ['"]Payment Received['"]\s*&&\s*!latestProject/);
  });

  it('does not use a global reducer — Phase 2 is explicitly local per-workflow state only', () => {
    expect(centerPanel).not.toMatch(/useReducer|CustomerWorkspaceEngine/);
  });
});

describe('CustomerB2CWorkflowCards — default B2C view, real Project record summary text', () => {
  it('shows the real Project entry derived from actual data, not placeholder text — Quotation/Loan Application were removed from this section (B2C Center Panel Restructure mission)', () => {
    expect(centerB2CCards).toMatch(/Create Project/);
    expect(centerB2CCards).not.toContain('Create Quotation');
    expect(centerB2CCards).not.toContain('Start Registration');
    expect(centerB2CCards).toContain('projectCapacityLabel');
  });

  it('Create Order now lives in CustomerB2BWorkflowPipeline, the B2B pipeline\'s Order stage', () => {
    expect(centerB2CCards).not.toContain('Create Order');
    expect(b2bPipeline).toContain('Create Order');
  });
});

describe('Embedded workflow forms reuse existing extracted business logic (no duplication)', () => {
  it('CustomerQuotationForm reuses createQuotation() and QuotationItemsEditor, not a reimplementation', () => {
    expect(quotationForm).toContain("from '../../../../lib/quotationWorkflow'");
    expect(quotationForm).toContain('createQuotation(');
    expect(quotationForm).toContain('<QuotationItemsEditor');
  });

  it('CustomerOrderForm reuses createOrder() and OrderItemsEditor, not a reimplementation', () => {
    expect(orderForm).toContain("from '../../../../lib/orderWorkflow'");
    expect(orderForm).toContain('createOrder(');
    expect(orderForm).toContain('<OrderItemsEditor');
  });

  it('CustomerLoanApplicationForm reuses the extracted createLoanApplication(), not LoanApplicationsWorkspace-duplicated logic', () => {
    expect(registrationForm).toContain('createLoanApplication(');
    expect(registrationForm).not.toMatch(/createDocWithId\(/);
  });

  it('CustomerProjectForm wraps the shared ProjectForm and reuses createProject()/createProjectFromLoanApplication()', () => {
    expect(projectForm).toContain('<ProjectForm');
    expect(projectForm).toContain('createProject(');
    expect(projectForm).toContain('createProjectFromLoanApplication(');
  });

  it('CustomerProjectForm locks the customer via lockedCustomerLabel — no duplicate customer selector', () => {
    expect(projectForm).toContain('lockedCustomerLabel=');
  });
});

describe('ProjectForm — lockedCustomerLabel is additive and backward-compatible', () => {
  it('is an optional prop; the standalone Projects.tsx call site does not pass it', () => {
    expect(sharedProjectForm).toContain('lockedCustomerLabel?:');
    const callSite = projectsPage.slice(projectsPage.indexOf('<ProjectForm'), projectsPage.indexOf('/>', projectsPage.indexOf('<ProjectForm')));
    expect(callSite).not.toContain('lockedCustomerLabel');
  });
});

describe('Regression — standalone pages still work after Phase 2 extractions', () => {
  it('Quotations.tsx still renders via QuotationItemsEditor (Phase 2 extraction), same page still owns the mutation', () => {
    expect(quotationsPage).toContain('<QuotationItemsEditor');
    expect(quotationsPage).toMatch(/createQuotation\(/);
  });

  it('Orders.tsx still uses OrderItemsEditor and createOrder unchanged', () => {
    expect(ordersPage).toContain('<OrderItemsEditor');
    expect(ordersPage).toMatch(/createOrder\(/);
  });

  it('LoanApplicationsWorkspace.tsx create path now calls the extracted createLoanApplication(), and does not double-fire onLoanApplicationStatusChange', () => {
    expect(loanApplicationsWorkspacePage).toContain('createLoanApplication(');
    // Only the update (editId) branch may still call onLoanApplicationStatusChange directly —
    // the create branch's call now lives inside createLoanApplication() itself.
    const calls = loanApplicationsWorkspacePage.match(/void onLoanApplicationStatusChange\(/g) || [];
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  it('CustomerWorkspaceKpis sources its data from the shared useCustomerBillingContext hook (Phase 2 dedup), not duplicate inline queries', () => {
    expect(kpis).toContain('useCustomerBillingContext(');
    expect(kpis).not.toMatch(/useQuery\(/);
  });
});
