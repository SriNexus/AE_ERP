/**
 * CustomerWorkspaceRightPanel — Customer Workspace Right Panel (Phase 4).
 *
 * Persistent (not tab-contextual, unlike the Left Panel) supporting control
 * surface: Relationship Health → Quick Actions → Recent Activity → Linked
 * Records, in that order (see the Phase 4 report §3 for the visual
 * hierarchy rationale — most important/actionable content first).
 *
 * Data sourcing discipline (Phase 4 report §9):
 *   - Relationship Health / Quick Actions' B2B branch: useCustomerBillingContext
 *     (Phase 2, already mounted by CustomerWorkspaceKpis/CustomerCenterPanel/
 *     CustomerWorkspaceLeftPanel on this same page — React Query dedups by key)
 *   - Linked Records: linkedRecordsEngine.getLinkedRecords() (Section 8
 *     shared engine — a genuinely new query, since no other component reuses
 *     this specific engine's output; unavoidable per the explicit
 *     instruction to use this engine rather than a customer-specific query)
 *
 * Quick Actions do not own their own workflow — they receive the same
 * `workflow` (useCustomerCenterWorkflow) instance CustomerWorkspace.tsx
 * passes to CustomerCenterPanel, so triggering "Create Quotation" here and
 * on the Center Panel's own Snapshot view are the same function call.
 *
 * Premium UX Redesign mission, second refinement pass: Recent Activity moved
 * out of this panel — it now lives as the Center Panel's Activity preview
 * (CustomerWorkspaceSections.tsx), reusing the exact same
 * rightPanel/CustomerRecentActivity.tsx component, just mounted in one place
 * instead of two. Two independent "what happened recently" widgets, one in
 * the Center and one in the Right Panel, was real duplication with no
 * distinguishing purpose — this panel now stays focused on health/actions/
 * relationships, none of which repeat what the Center already shows.
 */
import { useCustomerBillingContext } from '../../hooks/useCustomerBillingContext';
import { mostRecentByDate } from './CustomerWorkspaceKpis';
import { useCurrentUser } from '../../../../store/useAppStore';
import type { CustomerCenterWorkflow } from '../../hooks/useCustomerCenterWorkflow';
import CustomerRelationshipHealth from './rightPanel/CustomerRelationshipHealth';
import CustomerQuickActions from './rightPanel/CustomerQuickActions';
import CustomerLinkedRecords from './rightPanel/CustomerLinkedRecords';

interface Props {
  customer: any;
  workflow: CustomerCenterWorkflow;
  companyId: string;
  sourceLeadId?: string;
  onViewSourceLead?: () => void;
}

export default function CustomerWorkspaceRightPanel({ customer, workflow, companyId, sourceLeadId, onViewSourceLead }: Props) {
  const billing = useCustomerBillingContext(customer);
  const user = useCurrentUser();
  // B2C one-time-project lifecycle (B2C Project Timeline & Workspace UX
  // Specification mission): once a Project already exists, this Quick
  // Action hides. This panel's own bank loan-application creation shortcut was
  // retired entirely (it stays fully available from the Center Panel's own
  // "Work on This Customer" card) — no equivalent flag needed here anymore.
  const hasProject = !billing.isB2B ? Boolean(mostRecentByDate(billing.projects, 'updatedAt')) : false;

  return (
    <div className="flex flex-col">
      <CustomerRelationshipHealth customer={customer} isB2B={billing.isB2B} orders={billing.orders} />
      <CustomerQuickActions
        customer={customer}
        isB2B={billing.isB2B}
        hasProject={hasProject}
        companyId={companyId}
        workflow={workflow}
        sourceLeadId={sourceLeadId}
        onViewSourceLead={onViewSourceLead}
        createdById={user.id}
        createdByName={user.name}
      />
      <CustomerLinkedRecords customerId={customer.id} companyId={companyId} />
    </div>
  );
}
