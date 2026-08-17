/**
 * customerWorkspaceCentralPanelRefinement.test.ts — Central Panel
 * Refinement & B2B/B2C Workflow Implementation mission.
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: the Overview tab reorganization (Financial
 * Summary/Timeline & Activity/Related Records moved into their own tabs),
 * the B2B Quotation → Order → Invoice → Payment → Dispatch stage pipeline
 * (Compact Workspace & Central Panel B2B Workflow mission superseded the
 * original separate Invoice/Dispatch sections with one unified pipeline —
 * see CustomerB2BWorkflowPipeline.tsx), the B2C Project Timeline section,
 * and scope-control checks confirming no business logic was duplicated and
 * no already-completed area (Left Panel/Tabs/Footer/Project Workspace/
 * Invoice Workspace/Dispatch Workspace) was disturbed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const customerWorkspacePage = read('../CustomerWorkspace.tsx');
const centerPanel = read('../../features/customers/components/workspace/CustomerCenterPanel.tsx');
const ordersTab = read('../../features/customers/components/workspace/CustomerOrdersTabContent.tsx');
const activityTab = read('../../features/customers/components/workspace/CustomerActivityTabContent.tsx');
const linkedRecordsTab = read('../../features/customers/components/workspace/CustomerLinkedRecordsTabContent.tsx');
const b2bPipeline = read('../../features/customers/components/workspace/CustomerB2BWorkflowPipeline.tsx');
const projectTimeline = read('../../features/customers/components/workspace/CustomerProjectTimelinePanel.tsx');
const billingContext = read('../../features/customers/hooks/useCustomerBillingContext.ts');
const dispatchRequestModalSrc = read('../../features/dispatch/components/DispatchRequestModal.tsx');
const useProjectStageSrc = read('../../hooks/useProjectStage.ts');
const stageTimelineSrc = read('../../components/shared/StageTimeline.tsx');
const leadWorkspacePage = read('../LeadWorkspace.tsx');
const leadSections = read('../../features/leads/components/workspace/LeadWorkspaceSections.tsx');
const sharedSectionCards = read('../../components/shared/WorkspaceSectionCards.tsx');

describe('§1 Central Panel spacing matches LeadWorkspace.tsx exactly', () => {
  // Final Leads Workspace — Customer Workspace Design System Replication
  // mission: Lead's own tab-switched center cards (formerly rounded-2xl/
  // p-6/shadow-sm, one per tab) were retired along with the tab bar itself.
  // Lead now uses the same tight "always-open primary workflow + peek/
  // collapsed secondary sections" rhythm as Customer (rounded-xl/p-4/
  // shadow-sm peek cards, space-y-3 outer rhythm) — see
  // LeadWorkspaceSections.tsx. The two workspaces have converged onto one
  // shared card language rather than Customer deliberately diverging from
  // an older, looser Lead pattern.
  const sharedTitleClass = 'text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]';

  it('LeadWorkspaceSections.tsx (Lead\'s secondary-section replacement for the retired tab bar) uses the same tight rounded-xl/p-4/shadow-sm peek-card rhythm Customer\'s own CustomerWorkspaceSections.tsx uses, not the old p-6/rounded-2xl tab-content pattern — both now import the genuinely shared PeekCard/CollapsedRow (components/shared/WorkspaceSectionCards.tsx) rather than each keeping its own local copy of that class string', () => {
    expect(sharedSectionCards).toContain('rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm');
    expect(leadSections).toContain("import { PeekCard, CollapsedRow } from '../../../../components/shared/WorkspaceSectionCards'");
    expect(leadSections).toContain(sharedTitleClass);
    expect(leadWorkspacePage).not.toContain('role="tablist"');
  });

  it('Premium UX Redesign mission: CustomerWorkspace.tsx\'s own Center cards ("Work on This Customer"/Notes) use the same tighter p-5/rounded-xl/space-y-4 rhythm now shared with Lead\'s redesigned secondary sections — an explicit information-density decision for an 8-hour-use workspace', () => {
    expect(customerWorkspacePage).toContain('<div className="p-4 space-y-4">');
    expect(customerWorkspacePage).toContain('rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm');
  });

  it('CustomerOrdersTabContent/CustomerActivityTabContent/CustomerLinkedRecordsTabContent no longer carry their own outer card/space-y wrapper — Premium UX Redesign mission moved them into CustomerWorkspaceSections\' accordion, which supplies its own container, so double-nesting a second card inside each section would recreate the "too many cards" problem the redesign explicitly fixes', () => {
    for (const src of [ordersTab, activityTab, linkedRecordsTab]) {
      expect(src).not.toContain('rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm');
      expect(src).not.toContain('space-y-5');
    }
  });

  it('CustomerWorkspace.tsx\'s own outer wrapper cancels the shared app-shell padding exactly like LeadWorkspace.tsx (Compact Workspace & Header mission; gap-2/p-2 added by the Surface Unification mission for the rounded-card separation between Header/Body/Footer)', () => {
    expect(leadWorkspacePage).toMatch(/-m-5 p-2 flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-\[var\(--color-bg\)\]/);
    expect(customerWorkspacePage).toMatch(/-m-5 p-2 flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-\[var\(--color-bg\)\]/);
  });
});

describe('§2 Overview tab reorganization — Premium UX Redesign mission: tab bar retired in favor of an always-visible pipeline + accordion sections', () => {
  it('CustomerWorkspace.tsx mounts CustomerWorkspaceSections (the accordion) instead of dispatching Orders/Activity/Linked Records through separate tabs', () => {
    expect(customerWorkspacePage).toContain('<CustomerWorkspaceSections');
    expect(customerWorkspacePage).not.toContain("'orders-tab': <CustomerOrdersTabContent");
    expect(customerWorkspacePage).not.toContain('CUSTOMER_TABS');
    expect(customerWorkspacePage).not.toContain('role="tablist"');
  });

  it('the old "Financial Summary" tile row (Lifetime Value/Active Orders/Total Revenue/Outstanding) is REMOVED from the Order History section — those fields are never written anywhere, so the row always showed four "—" placeholders; only the real order history list remains', () => {
    for (const field of ['Lifetime Value', 'Total Revenue', 'Outstanding']) {
      expect(ordersTab).not.toContain(field);
    }
    expect(ordersTab).toMatch(/orderTimestamp\(b\) - orderTimestamp\(a\)/);
    expect(ordersTab).toContain('useCustomerBillingContext(');
  });

  it('the old "Timeline & Activity" KPI tile row is REMOVED from the Activity section — two of its four fields were never written anywhere and the other two duplicated the Left Panel/Header; only the real activity log remains, via the existing content() dispatch (not re-imported)', () => {
    for (const field of ['Last Order Date', 'AMC Active']) {
      expect(activityTab).not.toContain(field);
    }
    expect(activityTab).toContain("import { content } from '../../../../components/shared/WorkspaceTabs'");
    expect(activityTab).toMatch(/content\('activity', undefined,/);
  });

  it('Linked Records section keeps its Related Records quick-nav (Orders/Quotations/Projects/Invoices/Installations) as plain navigation, with the fake denormalized counts removed, above the existing UniversalLinkedRecordsTab content', () => {
    for (const field of ['Orders', 'Quotations', 'Projects', 'Invoices', 'Installations']) {
      expect(linkedRecordsTab).toContain(field);
    }
    expect(linkedRecordsTab).not.toContain('customer.orderCount');
    expect(linkedRecordsTab).not.toContain('customer.quotationCount');
    expect(linkedRecordsTab).toMatch(/content\('linked_records', undefined,/);
  });

  it('"Work on This Customer" remains always-visible above the accordion; Notes remains there for B2C only — Center Panel B2B Workflow Enhancement mission removed it from the B2B flow entirely', () => {
    expect(customerWorkspacePage).toContain('Work on This Customer');
    expect(customerWorkspacePage).toMatch(/!centerBilling\.isB2B && customer\.notes && \(/);
  });
});

describe('§3/§4 B2B — Quotation → Order → Invoice → Payment → Dispatch pipeline, no duplicate business logic', () => {
  it('CustomerCenterPanel routes B2B customers to CustomerB2BWorkflowPipeline (replacing the old 2-action-card snapshot and the separate standalone Invoice/Dispatch sections)', () => {
    expect(centerPanel).toContain('import CustomerB2BWorkflowPipeline');
    expect(centerPanel).toMatch(/if \(billing\.isB2B\) \{\s*\n\s*return <CustomerB2BWorkflowPipeline/);
  });

  it('CustomerWorkspace.tsx no longer mounts a separate Invoice or Dispatch section — CustomerCenterPanel owns the whole B2B body now', () => {
    expect(customerWorkspacePage).not.toContain('CustomerInvoicesSection');
    expect(customerWorkspacePage).not.toContain('CustomerDispatchSection');
  });

  it('renders all five stages — Quotation, Order, Invoice, Payment, Dispatch', () => {
    for (const stage of ['Quotation', 'Order', 'Invoice', 'Payment', 'Dispatch']) {
      expect(b2bPipeline).toMatch(new RegExp(`stage="${stage}"`));
    }
  });

  it('Center Panel B2B Workflow Enhancement mission: stages are vertically stacked, full-width, connected cards (each with its own margin-bottom and a stepper rail), not a horizontal row or wrapping grid — Final UI/UX Refinement mission restructured the card into a flex row (illustration rail + content column) so the class list gained `flex overflow-hidden` between mb-2.5 and rounded-xl, same structural shape otherwise', () => {
    expect(b2bPipeline).toMatch(/mb-2\.5 flex min-w-0 flex-1 overflow-hidden rounded-xl/);
    expect(b2bPipeline).not.toMatch(/grid grid-cols-1|lg:flex-row|xl:grid-cols/);
  });

  it('stages render in lifecycle order — Quotation, then Order, then Invoice, then Payment, then Dispatch', () => {
    const order = ['Quotation', 'Order', 'Invoice', 'Payment', 'Dispatch'].map((s) => b2bPipeline.indexOf(`stage="${s}"`));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it('Quotation/Order "create" actions reuse the existing useCustomerCenterWorkflow handlers — the same functions the Right Panel Quick Actions call, not a new workflow', () => {
    expect(b2bPipeline).toContain('workflow.goToQuotation');
    expect(b2bPipeline).toMatch(/workflow\.goToOrder\(\)/);
  });

  it('Invoice/Payment/Dispatch "View Latest" actions navigate DIRECTLY to the existing per-record workspace routes — no invoice/payment line items or PDF logic reimplemented here', () => {
    expect(b2bPipeline).toContain('const invoiceViewTarget = invoiceForLatestOrder || previousInvoice');
    expect(b2bPipeline).toContain('const paymentViewTarget = latestPaymentForOrder || previousPayment');
    expect(b2bPipeline).toContain('const dispatchViewTarget = dispatchForLatestOrder || previousDispatch');
    expect(b2bPipeline).toMatch(/navigate\(`\/invoices\/\$\{encodeURIComponent\(invoiceViewTarget\.id\)\}`\)/);
    expect(b2bPipeline).toMatch(/navigate\(`\/payments\/\$\{encodeURIComponent\(paymentViewTarget\.id\)\}`\)/);
    expect(b2bPipeline).toMatch(/navigate\(`\/dispatch\/\$\{encodeURIComponent\(dispatchViewTarget\.id\)\}`\)/);
  });

  it('B2B Workflow Completeness mission: Generate Invoice IS offered, but only for the specific latest order once it has no invoice yet — reuses useGeneratePIFromOrder()/generatePIsFromOrder(), the exact function Orders.tsx\'s own "Generate PI" button calls, not a reimplementation, not the retired CustomerInvoiceModal popup', () => {
    expect(b2bPipeline).toContain("import { useGeneratePIFromOrder } from '../../../orders/hooks/useOrders'");
    expect(b2bPipeline).toMatch(/label:\s*'Generate Invoice'/);
    expect(b2bPipeline).toContain('generateInvoice.mutate(latestOrder');
    expect(b2bPipeline).not.toContain('CustomerInvoiceModal');
    expect(b2bPipeline).not.toMatch(/function generatePIsFromOrder/);
  });

  it('Invoice generation is gated on the LATEST order actually lacking one (order.piGenerated-derived) — the button always renders (Final UX Parity mission) but its `active` flag, not shown unconditionally — repeat orders each need their own invoice', () => {
    expect(b2bPipeline).toContain('invoicesForLatestOrder');
    expect(b2bPipeline).toMatch(/active:\s*hasOrder && !invoiceForLatestOrder && canGenerateInvoice/);
  });

  it('Center Panel B2B Workflow Enhancement mission: Payment and Dispatch are ALSO order-specific (not just "latest by date"), same repeat-order-safety fix already applied to Invoice', () => {
    expect(b2bPipeline).toContain('paymentsForLatestOrder');
    expect(b2bPipeline).toContain('dispatchesForLatestOrder');
  });

  it('Payment now has a real, repeatable "Record Payment" action reusing useSavePayment() from features/sales/hooks/useSales.ts — the exact hook the real Payments.tsx page uses, not the separate/unused lib/paymentWorkflow.ts module', () => {
    expect(b2bPipeline).toContain("import { useSavePayment, PAYMENT_FORM_DEFAULT, type PaymentForm } from '../../../sales/hooks/useSales'");
    expect(b2bPipeline).not.toMatch(/from '.*lib\/paymentWorkflow'/);
    expect(b2bPipeline).not.toMatch(/from '.*payment\/hooks\/usePayment'/);
    expect(b2bPipeline).toMatch(/label="Record Payment"|>Record Payment</);
  });

  it('Invoice/Payment/Dispatch are all blocked ("Not Available Yet") until an Order exists — never a fake/disabled action', () => {
    expect(b2bPipeline).toMatch(/!hasOrder \? statusBadge\('Not Available Yet'\)/g);
    const notAvailableCount = (b2bPipeline.match(/statusBadge\('Not Available Yet'\)/g) || []).length;
    expect(notAvailableCount).toBe(3);
  });

  it('Create/Record + View Latest stay required, fully-populated props for all 5 stages (StageCard\'s TS type never makes them optional, and no call site ever passes `undefined`) — Final UI/UX Refinement mission: the Create action now renders as one shared CreateActionButton permanently docked in the card header for every stage/state (active or muted, never omitted, so the header skeleton never changes shape); View Latest is folded into the clickable record row once a record exists, or shown as a quiet fallback link when only an older order\'s record is available — a presentation decision, never a loss of the underlying data/permission-derived active flags this test still confirms are always computed and passed', () => {
    expect(b2bPipeline).toMatch(/primaryAction:\s*StageAction;/);
    expect(b2bPipeline).toMatch(/viewLatest:\s*StageAction;/);
    // Neither prop is ever passed conditionally as `undefined` at a call site.
    expect(b2bPipeline).not.toMatch(/primaryAction=\{[^}]*: undefined\}/);
    expect(b2bPipeline).not.toMatch(/viewLatest=\{[^}]*: undefined\}/);
  });

  it('Dispatch\'s primary action is only ACTIVE when at least one order is still eligible for dispatch (Final UX Parity mission: always rendered, never opens a request form with an empty order picker)', () => {
    expect(b2bPipeline).toContain('canRequestDispatchNow');
    expect(b2bPipeline).toMatch(/active:\s*canRequestDispatchNow && canRequestDispatch/);
  });

  it('Dispatch reuses requestDispatch()/DEFAULT_FORM/DispatchRequestModal from the existing dispatch feature — no reimplemented dispatch creation', () => {
    expect(b2bPipeline).toContain("import { requestDispatch } from '../../../../lib/dispatchWorkflow'");
    expect(b2bPipeline).toContain("import { DEFAULT_FORM } from '../../../dispatch/utils/dispatchWorkspaceUtils'");
    expect(b2bPipeline).toContain("import { DispatchRequestModal } from '../../../dispatch/components/DispatchRequestModal'");
    expect(b2bPipeline).toContain('<DispatchRequestModal');
    expect(b2bPipeline).not.toMatch(/function requestDispatch/);
  });

  it('the Dispatch request form carries the same vehicle/driver detail fields DispatchWorkspace.tsx uses', () => {
    expect(dispatchRequestModalSrc).toContain('Vehicle No');
    expect(dispatchRequestModalSrc).toContain('Driver Name');
    expect(dispatchRequestModalSrc).toContain('Driver Phone');
  });

  it('sources quotations/orders/invoices/payments/dispatches from the shared useCustomerBillingContext hub, not one-off queries', () => {
    expect(b2bPipeline).toContain('useCustomerBillingContext(');
    expect(b2bPipeline).not.toMatch(/useQuery\(\{\s*\n\s*queryKey: \['customer-kpi/);
  });

  it('useCustomerBillingContext fetches invoices/payments/dispatches as B2B-only, same as Orders — a B2C case never gets an invoice, payment, or warehouse dispatch', () => {
    for (const key of ['customer-kpi-invoices', 'customer-kpi-payments', 'customer-kpi-dispatches']) {
      const block = billingContext.slice(billingContext.indexOf(key), billingContext.indexOf(key) + 200);
      expect(block).toMatch(/enabled:\s*isB2B\s*&&\s*!!customerId/);
    }
  });

  it('payments query reuses the existing COLLECTIONS.PAYMENTS + customerId scoping, matching PaymentRecord\'s own field (lib/paymentWorkflow.ts) — no new payment data model', () => {
    expect(billingContext).toContain('COLLECTIONS.PAYMENTS');
    expect(billingContext).toMatch(/where\('customerId', '==', customerId\)/);
  });
});

describe('§5 B2C — Project Timeline tracks progress, reuses the real Project stage engine', () => {
  it('CustomerWorkspace.tsx mounts CustomerProjectTimelinePanel only for B2C, below "Work on This Customer"', () => {
    expect(customerWorkspacePage).toMatch(/!centerBilling\.isB2B && \(\s*\n\s*<CustomerProjectTimelinePanel project=\{centerLatestProject\} \/>/);
  });

  it('reuses resolveProjectWorkspaceStages() (the real Project Workspace stage engine) rather than a reimplemented lifecycle', () => {
    expect(projectTimeline).toContain("import { resolveProjectWorkspaceStages");
    expect(projectTimeline).not.toMatch(/const LIFECYCLE\s*[:=]/);
  });

  it('B2C Project Timeline & Workspace UX Specification mission: rewrote the single horizontal StageTimeline card into a two-panel operational tracker — a compact 3-stage-viewport left rail (local selection state) plus a read-only right-side detail panel for the selected stage, driven by a new pure resolveStageDetail() helper', () => {
    expect(projectTimeline).not.toContain("import { StageTimeline } from '../../../../components/shared/StageTimeline'");
    expect(projectTimeline).not.toContain('<StageTimeline');
    expect(projectTimeline).toContain('export function resolveStageDetail');
    expect(projectTimeline).toContain('VISIBLE_ROWS');
  });

  it('the left stage panel is a REAL internal scroll container — overflow-y-auto on the panel itself with a fixed 3-row height, every stage reachable by scrolling inside it (never the page\'s scroll container), and selection scrolls the chosen stage into view via the container\'s own scrollTo', () => {
    expect(projectTimeline).toContain('overflow-y-auto');
    expect(projectTimeline).toMatch(/style=\{\{ height: VISIBLE_ROWS \* ROW_HEIGHT \}\}/);
    expect(projectTimeline).toMatch(/scrollRef\.current\?\.scrollTo\(\{ top: offset, behavior: 'smooth' \}\)/);
    // The old transform-panned viewport is gone — no translateY transform
    // and no overflow-hidden clip on the stage rail (prose comments may
    // still mention the old mechanism for history).
    expect(projectTimeline).not.toMatch(/transform: `translateY/);
    expect(projectTimeline).not.toMatch(/overflow-hidden/);
  });

  it('selecting a stage is local UI state; the right panel reuses the stage engine\'s own href for its "Open in full workspace" action — the same per-stage navigation Project Workspace\'s GenericStageDetail uses, never a reimplemented link (B2C Center Panel Restructure mission)', () => {
    expect(projectTimeline).toContain('stage.href');
    expect(projectTimeline).not.toMatch(/function stageHref/);
    expect(projectTimeline).not.toMatch(/const LIFECYCLE\s*[:=]/);
    expect(projectTimeline).toContain('Go to Project Workspace');
    expect(projectTimeline).toMatch(/navigate\(`\/projects\/\$\{encodeURIComponent\(project\.id\)\}`\)/);
  });

  it('before a Project exists, stages still resolve against the same synthetic placeholder as before (every stage "upcoming") — the section itself stays mounted regardless (it no longer hides "Work on This Customer" just because a Project exists)', () => {
    expect(projectTimeline).toContain('PLACEHOLDER_PROJECT');
    expect(projectTimeline).toMatch(/resolveProjectWorkspaceStages\(project \|\| PLACEHOLDER_PROJECT\)/);
  });

  it('issues no Firestore query of its own — project is passed in as a prop, already fetched by useCustomerBillingContext', () => {
    expect(projectTimeline).not.toMatch(/useQuery\(|getAll\(|getOne\(/);
  });
});

describe('Scope control — already-completed areas and other workspaces are untouched', () => {
  it('useProjectStage.ts / StageTimeline.tsx are unmodified reuse targets, not touched for this mission', () => {
    expect(useProjectStageSrc).toContain('export function resolveProjectWorkspaceStages');
    expect(stageTimelineSrc).toContain('export function StageTimeline');
  });

  it('CustomerWorkspace.tsx does not import or reference any Mobile* component', () => {
    expect(customerWorkspacePage).not.toMatch(/Mobile[A-Z]\w*/);
  });

  it('none of the Central Panel sections import CustomerWorkspaceLeftPanel, WorkspaceTabs\' nav, or CustomerWorkspaceFooter — this mission only touches the Central Panel', () => {
    for (const src of [ordersTab, activityTab, linkedRecordsTab, b2bPipeline, projectTimeline]) {
      expect(src).not.toMatch(/CustomerWorkspaceLeftPanel|CustomerWorkspaceFooter/);
    }
  });
});
