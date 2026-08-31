/**
 * CustomerB2CWorkflowCards — the B2C Center Panel's "Work on This Customer"
 * body (B2C Center Panel Restructure mission).
 *
 * This section now contains ONLY the Project entry — the Quotation and
 * Loan Application cards were removed from this specific section. Their ERP
 * functionality is untouched: quotations/loan applications remain fully
 * creatable/viewable through their own pages (`/quotations`, `/loan-applications`)
 * and their existing workflow services; only their representation here is
 * gone. The Project is the one-time record that matters from the customer's
 * workspace: the card is independently actionable until the Project exists
 * (create state), and once it exists it renders the record itself (done
 * state — clickable summary row into the Project Workspace). "Work on This
 * Customer" always renders for B2C (CustomerWorkspace.tsx), keeping the
 * required hierarchy — Work on This Customer → Project Timeline → Activity →
 * Linked Records — intact at all times.
 *
 * Real linkage preserved: when the customer's Loan Application reached
 * 'Payment Received' and no Project exists yet, the Project card still offers
 * the "Create Project from Loan Application" fast path
 * (`createProjectFromLoanApplication()` via CustomerProjectForm) — the exact
 * copy rule the retired snapshot used, only the label/description change,
 * never the button gating beyond the Project record itself.
 *
 * Visual consistency: the card reuses the same RecordCard anatomy as the B2B
 * pipeline's StageCard (illustration rail → header [title/badge left, Create
 * button right] → body) minus the connector-rail "blocked" tone.
 */
import { useNavigate } from 'react-router-dom';
import { statusBadge } from '../../../../components/ui/Badge';
import projectIllustration from '../../../../assets/customer-workspace/project.png';
import { fmtDate } from '../../../../lib/firestore';
import { projectCapacityLabel, projectSiteAddressSummary } from '../../../projects/utils/projectDisplay';
import type { CustomerCenterWorkflow } from '../../hooks/useCustomerCenterWorkflow';
import WorkflowCard from './WorkflowCard';

interface Props {
  workflow: CustomerCenterWorkflow;
  /** The customer's most recent Project, or null before one exists. Derived
   * once in CustomerCenterPanel via the shared mostRecentByDate — never
   * re-derived here. */
  project: any;
  canCreateProjects: boolean;
  /** True when the customer's Loan Application is 'Payment Received' and no
   * Project exists yet — drives the "Create Project from Loan Application" copy
   * (the real createProjectFromLoanApplication fast path stays in
   * CustomerProjectForm). */
  canCreateProjectFromLoanApplication: boolean;
}

export default function CustomerB2CWorkflowCards({
  workflow, project, canCreateProjects, canCreateProjectFromLoanApplication,
}: Props) {
  const navigate = useNavigate();
  const hasProject = !!project;

  return (
    <div>
      <WorkflowCard
        title="Project"
        illustration={projectIllustration}
        badge={project ? statusBadge(project.currentStage || 'New') : statusBadge('Not Started')}
        summary={project
          ? <>{project.projectId || project.id} · {projectCapacityLabel(project.capacityKw)} · {fmtDate(project.updatedAt)}</>
          : canCreateProjectFromLoanApplication
            ? 'Loan Application approved — a project can now be created.'
            : 'Start a project directly for this customer.'}
        facts={project ? [
          { label: 'Project ID', value: project.projectId || project.id },
          { label: 'Capacity', value: projectCapacityLabel(project.capacityKw) },
          { label: 'Owner', value: project.salesOwner },
          { label: 'Surveyor', value: project.assignedSurveyor },
          { label: 'Site', value: projectSiteAddressSummary(project.siteAddress) },
          { label: 'Created', value: fmtDate(project.createdAt) },
          { label: 'Updated', value: fmtDate(project.updatedAt) },
        ] : undefined}
        action={{
          label: canCreateProjectFromLoanApplication ? 'Create Project from Loan Application' : 'Create Project',
          onClick: workflow.goToProject,
          active: !project && canCreateProjects,
        }}
        onOpenRecord={project ? () => navigate(`/projects/${encodeURIComponent(project.id)}`) : undefined}
      />
    </div>
  );
}
