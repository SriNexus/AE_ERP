/**
 * ProjectHandoverWorkspace — the Handover stage's operational workspace,
 * embedded inside "Work on This Project" (Stage 13 — Handover; the handover
 * detail modal on the Project Handover list page was retired). Built the
 * same way ProjectSubsidyWorkspace / ProjectNetMeteringWorkspace were:
 * surfaces the EXISTING Handover system verbatim, no parallel
 * implementation.
 *
 * Handover data model (verified from the repository): records live in the
 * project_handovers collection (lib/projectHandoverWorkflow.ts) —
 * HandoverRecord has projectId, projectName, customerId, customerName,
 * handoverNumber, handoverDate, scheduledDate, completedDate, completedAt/
 * completedBy, assignedEngineer(Name), notes, status
 * ('Draft' → 'Scheduled' → 'Completed' or 'Cancelled'), statusHistory,
 * cancellationReason. The list page, mobile workspace and this workspace
 * ALL read the project_handovers collection via the SAME query key
 * (queryKeys.projectHandovers — React Query dedupes them; never a second
 * fetch).
 *
 * Reuse discipline:
 *   - Creation uses useCreateHandover → createHandover — the SAME canonical
 *     service + hook wrapper the list page and mobile workspace call. It
 *     requires project/customer name + handover date, guards the project is
 *     at/past the Subsidy stage (isProjectStageAtOrPast — the canonical
 *     Subsidy → Handover handoff), guards against a duplicate open handover,
 *     writes the Draft record and advances the project to the Handover stage
 *     via advanceProjectStage (the canonical stage-transition service). This
 *     workspace never mutates project.currentStage directly.
 *   - Status changes use useTransitionHandover → transitionHandoverStatus
 *     (the canonical VALID_TRANSITIONS map: Draft → Scheduled/Cancelled,
 *     Scheduled → Completed/Cancelled; sets scheduledDate/engineer,
 *     completedAt/By, cancelledAt/By + cancellationReason, appends
 *     statusHistory).
 *   - The Handover → AMC/Service transition is NOT implemented here: AMC
 *     contract creation (amcWorkflow.createAmcContract) is gated on
 *     currentStage being at/past 'Handover' and performs the canonical
 *     advanceProjectStage('AMC') — the next instruction covers AMC.
 *   - Inventory: Handover performs NO stock mutation — it is the final
 *     customer/project delivery stage; the material was already issued at
 *     Dispatch and verified through Installation/QC.
 *   - B2C serial/barcode: read-oriented — physical traceability remains in
 *     Dispatch → Installation → QC records; Handover neither captures nor
 *     fabricates tracking data.
 *   - Generic project context (Notes / Documents / Activity / Linked Records)
 *     is NOT duplicated here — the Project Workspace owns exactly one
 *     authoritative context layer below the stage cards. This card carries
 *     Handover-specific operational content only: the real handover fields,
 *     the record's own status timeline (statusHistory — genuine domain
 *     history of the handover itself), and the real `notes` field under
 *     "Handover Notes" (not a generic Notes panel).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Building2, Calendar, CheckCircle2, Handshake, UserCheck, XCircle,
} from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { FormSection, Input } from '../../../../../components/ui/Input';
import { getAll, fmtDateSafe } from '../../../../../lib/firestore';
import { COLLECTIONS } from '../../../../../lib/firebase';
import { queryKeys } from '../../../../../lib/queryKeys';
import { useAppStore } from '../../../../../store/useAppStore';
import { usePermissions } from '../../../../../lib/permissions';
import { cn } from '../../../../../utils/cn';
import {
  type HandoverRecord, type HandoverStatus,
} from '../../../../../lib/projectHandoverWorkflow';
import {
  useCreateHandover, useTransitionHandover,
} from '../../../../project-handover/hooks/useProjectHandover';
import type { ProjectStageWorkspaceProps } from './types';

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Scheduled: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function statusBadge(status: string) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      STATUS_COLORS[status] || 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
    )}>
      {status}
    </span>
  );
}

/** Real Handover record view — the actual handover fields, operational
 * status actions, the record's own status timeline, and its real notes
 * field. No generic project context (that lives at the Project Workspace
 * level). */
function HandoverRecordView({
  record,
  navigate,
}: {
  record: HandoverRecord;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const perms = usePermissions();
  const transitionMutation = useTransitionHandover();

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(record.handoverDate || '');
  const [engineerName, setEngineerName] = useState(record.assignedEngineerName || '');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const canAct = perms.canEdit('projects');
  const isTerminal = record.status === 'Completed' || record.status === 'Cancelled';

  function handleTransition(next: HandoverStatus) {
    if (transitionMutation.isPending) return;
    if (next === 'Scheduled') {
      if (!scheduledDate) { toast.error('Scheduled date is required'); return; }
      transitionMutation.mutate({
        handoverId: record.id,
        nextStatus: 'Scheduled',
        scheduledDate,
        ...(engineerName.trim() ? { assignedEngineer: engineerName.trim(), assignedEngineerName: engineerName.trim() } : {}),
      });
      setScheduleOpen(false);
      return;
    }
    if (next === 'Cancelled') {
      if (!cancelReason.trim()) { toast.error('Cancellation reason is required'); return; }
      transitionMutation.mutate({ handoverId: record.id, nextStatus: 'Cancelled', note: cancelReason.trim() });
      setCancelOpen(false);
      setCancelReason('');
      return;
    }
    transitionMutation.mutate({ handoverId: record.id, nextStatus: 'Completed' });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Handshake className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">#{record.handoverNumber.slice(-8)}</span>
            <span className="font-mono text-xs font-medium text-[var(--color-text)]">{record.handoverNumber}</span>
            {statusBadge(record.status)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{record.customerName}</span>
            <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />Handover {fmtDateSafe(record.handoverDate)}</span>
            {record.assignedEngineerName && (
              <span className="inline-flex items-center gap-1"><UserCheck className="h-3 w-3" />{record.assignedEngineerName}</span>
            )}
          </div>
        </div>
        <Button size="xs" variant="outline" icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => navigate(`/handovers/${encodeURIComponent(record.id)}`)}>
          Full workspace
        </Button>
      </div>

      {/* Real handover fields */}
      <FormSection title="Handover Overview">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Customer</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--color-text)]">{record.customerName}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{record.projectName}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Handover Date</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{fmtDateSafe(record.handoverDate)}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Scheduled</p>
            <p className="mt-0.5 text-xs font-medium text-amber-600">{fmtDateSafe(record.scheduledDate)}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Engineer</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{record.assignedEngineerName || '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Completed</p>
            <p className="mt-0.5 text-xs font-medium text-emerald-600">{fmtDateSafe(record.completedDate || record.completedAt)}</p>
          </div>
        </div>
        {record.cancellationReason && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/10">
            <p className="text-[10px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">Cancelled · {fmtDateSafe(record.cancelledAt)}</p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">{record.cancellationReason}</p>
          </div>
        )}
      </FormSection>

      {/* Operational status actions — canonical transition service */}
      {canAct && !isTerminal && (
        <FormSection title="Handover Actions">
          <div className="flex flex-wrap items-center gap-2">
            {record.status === 'Draft' && (
              scheduleOpen ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    label="Scheduled Date *"
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-44"
                  />
                  <Input
                    label="Engineer Name"
                    value={engineerName}
                    onChange={(e) => setEngineerName(e.target.value)}
                    placeholder="Engineer"
                    className="w-44"
                  />
                  <Button size="sm" onClick={() => handleTransition('Scheduled')} loading={transitionMutation.isPending}>
                    Confirm Schedule
                  </Button>
                  <button type="button" onClick={() => setScheduleOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                    Cancel
                  </button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setScheduleOpen(true)}>
                  Schedule Handover
                </Button>
              )
            )}
            {record.status === 'Scheduled' && (
              <Button size="sm" onClick={() => handleTransition('Completed')} loading={transitionMutation.isPending}>
                Complete Handover
              </Button>
            )}
            {cancelOpen ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Cancellation reason *"
                  className="h-8 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
                <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30" onClick={() => handleTransition('Cancelled')} loading={transitionMutation.isPending}>
                  Confirm Cancel
                </Button>
                <button type="button" onClick={() => setCancelOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                  Cancel
                </button>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30" onClick={() => setCancelOpen(true)}>
                Cancel Handover
              </Button>
            )}
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Status changes run through the canonical handover transition service (Draft → Scheduled → Completed, or Cancelled).
          </p>
        </FormSection>
      )}

      {/* Terminal-state banners — the real lifecycle outcome */}
      {record.status === 'Completed' && (
        <div className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/10 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Handover completed — the project is at the Handover stage; an AMC contract can now be created (next lifecycle stage: AMC / Service).</span>
        </div>
      )}
      {record.status === 'Cancelled' && (
        <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-300">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>This handover was cancelled. A fresh handover can be created for this project once the open record is resolved.</span>
        </div>
      )}

      {/* The record's own status timeline — genuine domain history */}
      <FormSection title="Status Timeline">
        {(record.statusHistory || []).length === 0 ? (
          <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">No status changes recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {[...(record.statusHistory || [])].reverse().map((entry, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-xs">
                <div className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', entry.status === 'Completed' ? 'bg-emerald-500' : entry.status === 'Cancelled' ? 'bg-red-500' : entry.status === 'Scheduled' ? 'bg-amber-500' : 'bg-[var(--color-primary)]')} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[var(--color-text)]">{entry.status}</p>
                  {entry.note && <p className="text-[var(--color-text-muted)]">{entry.note}</p>}
                  <p className="text-[10px] text-[var(--color-text-muted)]">{fmtDateSafe(entry.changedAt)} · {entry.changedBy || 'System'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </FormSection>

      {/* Real domain notes field — not a generic Notes panel */}
      {record.notes && (
        <FormSection title="Handover Notes">
          <p className="whitespace-pre-wrap text-xs text-[var(--color-text)]">{record.notes}</p>
        </FormSection>
      )}
    </div>
  );
}

/** Create the handover record — pre-scoped to this project. Calls the
 * canonical useCreateHandover hook (createHandover) exactly like the
 * list-page create modal and mobile workspace. Mirrors their real fields:
 * customer name, handover date, scheduled date, engineer, notes. */
function HandoverCreateForm({ project }: { project: any }) {
  const perms = usePermissions();
  const createMutation = useCreateHandover();

  const [customerName, setCustomerName] = useState((project as any).customerName || '');
  const [handoverDate, setHandoverDate] = useState(new Date().toISOString().split('T')[0]);
  const [scheduledDate, setScheduledDate] = useState('');
  const [engineerName, setEngineerName] = useState('');
  const [notes, setNotes] = useState('');

  const canCreate = perms.canEdit('projects');

  function handleSubmit() {
    if (!canCreate || createMutation.isPending) return;
    if (!customerName.trim()) { toast.error('Customer name is required'); return; }
    if (!handoverDate) { toast.error('Handover date is required'); return; }
    createMutation.mutate(
      {
        projectId: project.id,
        projectName: project.projectId || project.id,
        customerId: (project as any).customerId || '',
        customerName: customerName.trim(),
        handoverDate,
        scheduledDate: scheduledDate || undefined,
        assignedEngineer: engineerName.trim() || undefined,
        assignedEngineerName: engineerName.trim() || undefined,
        notes: notes || undefined,
      },
      { onSuccess: () => { setCustomerName((project as any).customerName || ''); setHandoverDate(new Date().toISOString().split('T')[0]); setScheduledDate(''); setEngineerName(''); setNotes(''); } },
    );
  }

  if (!canCreate) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
        <p className="text-xs text-[var(--color-text-muted)]">
          No handover record exists for this project yet. You do not have permission to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          <Handshake className="h-3.5 w-3.5" /> No handover yet — {project.projectId || project.id}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          Create the customer handover record for this project. Runs through the same create service the Project Handover list page uses and advances the project to the Handover stage.
        </p>
      </div>

      <FormSection title="Handover Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Customer Name *"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Customer name"
          />
          <Input
            label="Handover Date *"
            type="date"
            value={handoverDate}
            onChange={(e) => setHandoverDate(e.target.value)}
          />
          <Input
            label="Scheduled Date"
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
          />
          <Input
            label="Assigned Engineer"
            value={engineerName}
            onChange={(e) => setEngineerName(e.target.value)}
            placeholder="Engineer name"
          />
        </div>
        <Input
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Additional notes about the handover"
        />
      </FormSection>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" loading={createMutation.isPending} onClick={handleSubmit}>
          Create Handover
        </Button>
        <span className="text-[11px] text-[var(--color-text-muted)]">Creates a Draft handover record for this project.</span>
      </div>
    </div>
  );
}

/** The real Handover state for one project — create form when no record
 * exists yet (a Cancelled handover also re-opens the create form, since a
 * fresh record can be created once the open one is resolved), record view
 * after. No generic project context (Documents/Activity/Linked Records live
 * at the Project Workspace level). */
export default function ProjectHandoverWorkspace({ project }: ProjectStageWorkspaceProps) {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  const { data: handovers = [], isLoading } = useQuery({
    queryKey: keys.projectHandovers,
    queryFn: () => getAll(COLLECTIONS.PROJECT_HANDOVERS),
    staleTime: 15_000,
  });

  const projectRecords = useMemo(
    () => (handovers as HandoverRecord[])
      .filter((h) => h.projectId === project.id && !h.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [handovers, project.id],
  );

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  const latest = projectRecords[0];

  return (
    <div className="space-y-3">
      {latest ? <HandoverRecordView record={latest} navigate={navigate} /> : null}
      {/* A Cancelled handover re-opens the create form: the canonical
          createHandover service guards against duplicate OPEN records only,
          so a fresh record can be filed once the previous one was resolved. */}
      {(!latest || latest.status === 'Cancelled') && <HandoverCreateForm project={project} />}
    </div>
  );
}
