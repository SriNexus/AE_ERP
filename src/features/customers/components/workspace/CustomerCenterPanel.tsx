/**
 * CustomerCenterPanel — the Customer Workspace's Center Panel (Phase 2).
 * Replaces the WorkspaceShell Overview tab's content; every other existing
 * tab (Orders/Invoices/Activity/Notes/Documents/History/Tasks/Linked
 * Records/Permissions/Attachments) is untouched — see the Phase 2 report's
 * Tabs Transition Matrix.
 *
 * Renders exactly one view at a time. Phase 4: the "which view" state moved
 * to useCustomerCenterWorkflow (a plain lifted useState hook, not a
 * reducer/engine) so the Right Panel's Quick Actions can trigger the same
 * workflow instead of building a competing one — see the Phase 4 report §3.
 * This component is now a controlled consumer of that hook's result; its own
 * rendering logic (which form to show, the first-time-suggestion banner,
 * the eligible-loan-application computation) is otherwise unchanged from Phase 2.
 */
import { usePermissions } from '../../../../lib/permissions';
import { useCustomerBillingContext } from '../../hooks/useCustomerBillingContext';
import type { CustomerCenterWorkflow } from '../../hooks/useCustomerCenterWorkflow';
import { mostRecentByDate } from './CustomerWorkspaceKpis';
import CustomerB2CWorkflowCards from './CustomerB2CWorkflowCards';
import CustomerB2BWorkflowPipeline from './CustomerB2BWorkflowPipeline';
import CustomerQuotationForm from './CustomerQuotationForm';
import CustomerOrderForm from './CustomerOrderForm';
import CustomerLoanApplicationForm from './CustomerLoanApplicationForm';
import CustomerProjectForm from './CustomerProjectForm';

interface Props {
  customer: any;
  workflow: CustomerCenterWorkflow;
}

export default function CustomerCenterPanel({ customer, workflow }: Props) {
  const perms = usePermissions();
  const billing = useCustomerBillingContext(customer);
  const { view, firstTimeSuggestion, backToSnapshot, confirmFirstTimeQuotation, confirmDirectOrder } = workflow;

  // B2C's "Work on This Customer" section now contains ONLY the Project
  // entry — the Quotation/Loan Application cards were removed from this section
  // (their functionality lives on via /quotations and /loan-applications), so
  // the only create action left here is gated on projects.
  const canCreateProjects = perms.canCreate('projects');

  const latestProject = mostRecentByDate(billing.projects, 'updatedAt');
  const latestRegistration = mostRecentByDate(billing.registrations, 'updatedAt');
  const eligibleLoanApplication = latestRegistration?.status === 'Payment Received' && !latestProject ? latestRegistration : null;

  if (firstTimeSuggestion) {
    return (
      <div className="rounded-2xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] p-5 space-y-3">
        <p className="text-sm font-semibold text-[var(--color-text)]">
          This is the first billing transaction for {customer.company || customer.name || 'this customer'}. Would you like to create a quotation first?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={confirmFirstTimeQuotation}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--color-primary-hover)] transition-colors"
          >
            Create Quotation
          </button>
          <button
            type="button"
            onClick={confirmDirectOrder}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            Continue with Direct Order
          </button>
        </div>
      </div>
    );
  }

  if (view === 'create-quotation') {
    // Phase 8: link to the customer's existing Project when one already
    // exists — B2C's canonical flow says every Quotation should trace to a
    // Project (Blueprint §6), but Quotation/Project are deliberately
    // independent one-time cards here (see the B2C section below), so a
    // Quotation can still be created before a Project exists; this only
    // wires the link when it's already resolvable, never blocks creation.
    return <CustomerQuotationForm customer={customer} projectId={latestProject?.id} onCancel={backToSnapshot} onCreated={backToSnapshot} />;
  }
  if (view === 'create-order') {
    return <CustomerOrderForm customer={customer} onCancel={backToSnapshot} onCreated={backToSnapshot} />;
  }
  if (view === 'create-loan-application') {
    return <CustomerLoanApplicationForm customer={customer} onCancel={backToSnapshot} onCreated={backToSnapshot} />;
  }
  if (view === 'create-project') {
    return <CustomerProjectForm customer={customer} eligibleLoanApplication={eligibleLoanApplication} onCancel={backToSnapshot} onCreated={backToSnapshot} />;
  }

  // Compact Workspace & Central Panel B2B Workflow mission: B2B's default
  // view is the 5-stage Quotation → Order → Invoice → Payment → Dispatch
  // pipeline (replaces the old 2-action-card snapshot and the separate
  // standalone Invoice/Dispatch sections).
  if (billing.isB2B) {
    return <CustomerB2BWorkflowPipeline customer={customer} workflow={workflow} />;
  }

  // B2C Project Timeline & Workspace UX Specification mission: the B2C body
  // now contains ONLY the Project entry — Quotation/Loan Application were removed
  // from this section (their functionality remains via /quotations and
  // /loan-applications). "Work on This Customer" always renders for both B2B and
  // B2C (CustomerWorkspace.tsx), so this Project card is shown in its create
  // state before a Project exists and its done state (open the record) once
  // one does — keeping the required hierarchy (Work on This Customer →
  // Project Timeline → Activity → Linked Records) intact at all times.
  return (
    <CustomerB2CWorkflowCards
      workflow={workflow}
      project={latestProject}
      canCreateProjects={canCreateProjects}
      canCreateProjectFromLoanApplication={!!eligibleLoanApplication}
    />
  );
}
