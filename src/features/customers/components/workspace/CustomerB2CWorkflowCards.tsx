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
import { Plus, ArrowRight } from 'lucide-react';
import { statusBadge } from '../../../../components/ui/Badge';
import projectIllustration from '../../../../assets/customer-workspace/project.png';
import { fmtDate } from '../../../../lib/firestore';
import { projectCapacityLabel } from '../../../projects/utils/projectDisplay';
import type { CustomerCenterWorkflow } from '../../hooks/useCustomerCenterWorkflow';

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

interface CardAction {
  label: string;
  onClick: () => void;
  /** Always rendered — only its active/muted look ever changes, so the
   * card's header skeleton never shifts. */
  active: boolean;
}

/** Identical anatomy/classes to CustomerB2BWorkflowPipeline's own
 * CreateActionButton — deliberately duplicated rather than imported: this
 * codebase's established precedent for "same visual/component system across
 * two workspaces/panels" is matching class strings at each call site, not a
 * shared cross-cutting import — keeps B2B's pipeline free of B2C-only
 * concerns while guaranteeing pixel-identical buttons. */
function CreateActionButton({ action }: { action: CardAction }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={!action.active}
      title={action.active ? undefined : 'Already created for this customer'}
      className={[
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-semibold transition-colors active:scale-[0.98] disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1',
        action.active
          ? 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-muted)]'
          : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] text-[var(--color-text-disabled)]',
      ].join(' ')}
    >
      <Plus className="h-3.5 w-3.5" />
      {action.label}
    </button>
  );
}

/** The single B2C one-time record card — same anatomy as B2B's StageCard
 * (illustration rail → header [title/badge left, Create button right] →
 * body) minus the connector-rail "blocked" tone. `state` is only ever
 * 'actionable' or 'done' — never 'blocked'. "Work on This Customer" always
 * renders for B2C (CustomerWorkspace.tsx), so 'done' is the live state once
 * a Project exists (clickable summary row into the Project Workspace), and
 * 'actionable' the state before one does — both real and data-driven. */
function RecordCard({ illustration, title, state, badge, summary, action, onOpenRecord }: {
  illustration: string;
  title: string;
  state: 'actionable' | 'done';
  badge: React.ReactNode;
  summary: React.ReactNode;
  action: CardAction;
  onOpenRecord?: () => void;
}) {
  return (
    <div className="flex gap-3.5">
      <div className="flex shrink-0 flex-col items-center">
        <span className={['mt-8 h-2.5 w-2.5 shrink-0 rounded-full', state === 'done' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-primary)]'].join(' ')} />
      </div>

      <div className={[
        'mb-2.5 flex min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--color-border)] border-l-[3px] bg-[var(--color-surface)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-1 hover:ring-[var(--color-border-strong)] focus-within:ring-1 focus-within:ring-[var(--color-primary-muted)]',
        state === 'done' ? 'border-l-[var(--color-success)]' : 'border-l-[var(--color-primary)]',
      ].join(' ')}>
        <div className="w-[13%] min-w-[52px] max-w-[76px] shrink-0 self-stretch p-0.5">
          <div className="flex h-full w-full items-center justify-center">
            <img src={illustration} alt="" aria-hidden="true" className="h-full w-full object-contain" />
          </div>
        </div>

        <div className="min-w-0 flex-1 p-4">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h4 className="text-[13px] font-bold text-[var(--color-text)]">{title}</h4>
              {badge}
            </div>
            <CreateActionButton action={action} />
          </div>

          <div className="mt-3">
            {state === 'actionable' ? (
              <p className="text-xs text-[var(--color-text-secondary)] leading-snug">{summary}</p>
            ) : (
              <button
                type="button"
                onClick={onOpenRecord}
                disabled={!onOpenRecord}
                className="group -mx-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-bg-sunken)] disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-secondary)]">{summary}</span>
                {onOpenRecord && (
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-primary-text)]" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CustomerB2CWorkflowCards({
  workflow, project, canCreateProjects, canCreateProjectFromLoanApplication,
}: Props) {
  const navigate = useNavigate();
  const hasProject = !!project;

  return (
    <div>
      <RecordCard
        illustration={projectIllustration}
        title="Project"
        state={hasProject ? 'done' : 'actionable'}
        badge={project ? statusBadge(project.currentStage || 'New') : statusBadge('Not Started')}
        summary={project
          ? <>{project.projectId || project.id} · {projectCapacityLabel(project.capacityKw)} · {fmtDate(project.updatedAt)}</>
          : canCreateProjectFromLoanApplication
            ? 'Loan Application approved — a project can now be created.'
            : 'Start a project directly for this customer.'}
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
