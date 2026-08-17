/**
 * ProjectNetMeteringWorkspace — the Net Metering stage's operational
 * workspace, embedded inside "Work on This Project" (Stage 11 — Net Metering;
 * the net metering detail modal on the Net Metering list page was retired).
 * Built the same way ProjectCommissioningWorkspace / ProjectQCWorkspace were:
 * surfaces the EXISTING Net Metering system verbatim, no parallel
 * implementation.
 *
 * Net Metering data model (verified from the repository): applications live
 * in the net_metering_applications collection (lib/netMeteringWorkflow.ts) —
 * NetMeteringApplication has projectId, discomName, applicationNumber,
 * status ('Submitted' → 'UnderReview' → 'Approved' → 'MeterInstalled' or
 * 'Rejected'), submittedDate, approvedDate, meterInstalledDate,
 * expectedMeterInstallationDate, rejectionReason, notes, statusHistory. The
 * list page, mobile workspace and this workspace ALL read the
 * net_metering_applications collection (queryKeys.netMeteringAll — React
 * Query dedupes them; never a second fetch).
 *
 * Reuse discipline:
 *   - Creation uses useCreateNetMetering → createNetMeteringApplication —
 *     the SAME canonical service + hook wrapper the list page and mobile
 *     workspace call. It validates the project is at/past the Net Metering
 *     stage (isProjectStageAtOrPast), requires DISCOM + application number,
 *     writes the Submitted application, logs activity and notifies.
 *   - Status changes use useTransitionNetMetering → transitionNetMeteringStatus
 *     (the canonical transition service with its VALID_TRANSITIONS map). The
 *     MeterInstalled transition advances the project to the Subsidy stage via
 *     buildProjectStageAdvancePatch (forward-only, idempotent) — the ONLY
 *     path that moves the lifecycle forward from this stage. This workspace
 *     never mutates project.currentStage directly.
 *   - Inventory: Net Metering performs NO stock mutation — it is a DISCOM
 *     compliance track that read-references the commissioned system; nothing
 *     is duplicated.
 *   - B2C serial/barcode: read-oriented — the serial/barcode traceability
 *     established in Dispatch → Installation → QC is preserved in those
 *     stages' records; this workspace does not fabricate or re-capture
 *     tracking data.
 *   - Generic project context (Notes / Documents / Activity / Linked Records)
 *     is NOT duplicated here — the Project Workspace owns exactly one
 *     authoritative context layer below the stage cards. This card carries
 *     Net Metering-specific operational content only: the real application
 *     fields, the application's own status timeline (statusHistory — a
 *     genuine domain event list), and the real `notes` domain field shown
 *     under "Application Notes" (not a generic Notes panel).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Building2, Calendar, CheckCircle2, XCircle, Zap,
} from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { FormSection, Input } from '../../../../../components/ui/Input';
import { getAll, fmtDate } from '../../../../../lib/firestore';
import { COLLECTIONS } from '../../../../../lib/firebase';
import { queryKeys } from '../../../../../lib/queryKeys';
import { useAppStore } from '../../../../../store/useAppStore';
import { usePermissions } from '../../../../../lib/permissions';
import { cn } from '../../../../../utils/cn';
import {
  type NetMeteringApplication, type NetMeteringStatus,
} from '../../../../../lib/netMeteringWorkflow';
import {
  useCreateNetMetering, useTransitionNetMetering,
} from '../../../../net-metering/hooks/useNetMetering';
import type { ProjectStageWorkspaceProps } from './types';

const STATUS_COLORS: Record<string, string> = {
  Submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  UnderReview: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  MeterInstalled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const VALID_NEXT: Record<NetMeteringStatus, NetMeteringStatus[]> = {
  Submitted: ['UnderReview', 'Rejected'],
  UnderReview: ['Approved', 'Rejected'],
  Approved: ['MeterInstalled', 'Rejected'],
  MeterInstalled: [],
  Rejected: [],
};

function statusLabel(status: string): string {
  return status === 'UnderReview' ? 'Under Review' : status;
}

function statusBadge(status: string) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      STATUS_COLORS[status] || 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
    )}>
      {statusLabel(status)}
    </span>
  );
}

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return fmtDate(value.toDate());
  if (typeof value === 'object' && value && 'seconds' in value) return fmtDate(new Date(Number((value as { seconds: number }).seconds) * 1000));
  return fmtDate(String(value));
}

/** Real Net Metering application view — the DISCOM application's actual
 * fields, its own status timeline (statusHistory), and the operational
 * status actions. No generic project context (that lives at the Project
 * Workspace level). */
function NetMeteringApplicationView({
  app,
  navigate,
}: {
  app: NetMeteringApplication;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const perms = usePermissions();
  const transitionMutation = useTransitionNetMetering();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const nextStatuses = VALID_NEXT[app.status] || [];
  const canTransition = perms.canEdit('net_metering') && nextStatuses.length > 0;
  const isTerminal = app.status === 'MeterInstalled' || app.status === 'Rejected';

  function handleTransition(next: NetMeteringStatus) {
    if (transitionMutation.isPending) return;
    if (next === 'Rejected') {
      if (!rejectionReason.trim()) { toast.error('Rejection reason is required'); return; }
      transitionMutation.mutate({ id: app.id, status: next, options: { rejectionReason: rejectionReason.trim() } });
      setRejectOpen(false);
      setRejectionReason('');
      return;
    }
    const options = next === 'Approved'
      ? { approvedDate: new Date().toISOString() }
      : next === 'MeterInstalled'
        ? { meterInstalledDate: new Date().toISOString() }
        : {};
    transitionMutation.mutate({ id: app.id, status: next, options });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Zap className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">#{app.id.slice(-8)}</span>
            <span className="font-mono text-xs font-medium text-[var(--color-text)]">{app.applicationNumber}</span>
            {statusBadge(app.status)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{app.discomName}</span>
            <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />Submitted {fmtDateSafe(app.submittedDate)}</span>
            {app.status === 'MeterInstalled' && (
              <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" />Meter installed</span>
            )}
          </div>
        </div>
        <Button size="xs" variant="outline" icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => navigate(`/net-metering/${encodeURIComponent(app.id)}`)}>
          Full workspace
        </Button>
      </div>

      {/* Real application fields */}
      <FormSection title="Application Overview">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">DISCOM / Utility</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--color-text)]">{app.discomName}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Application No.</p>
            <p className="mt-0.5 font-mono text-xs font-medium text-[var(--color-text)]">{app.applicationNumber}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</p>
            <p className="mt-0.5">{statusBadge(app.status)}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Submitted</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{fmtDateSafe(app.submittedDate)}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Expected Meter Installation</p>
            <p className="mt-0.5 text-xs font-medium text-amber-600">
              {app.meterInstalledDate ? '—' : (fmtDateSafe(app.expectedMeterInstallationDate))}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Approved / Installed</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">
              {app.meterInstalledDate ? `Installed ${fmtDateSafe(app.meterInstalledDate)}` : (app.approvedDate ? `Approved ${fmtDateSafe(app.approvedDate)}` : '—')}
            </p>
          </div>
        </div>
        {app.rejectionReason && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/10">
            <p className="text-[10px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">Rejected · {fmtDateSafe(app.rejectedDate)}</p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">{app.rejectionReason}</p>
          </div>
        )}
      </FormSection>

      {/* Operational status actions — canonical transition service */}
      {canTransition && (
        <FormSection title="Status Actions">
          <div className="flex flex-wrap items-center gap-2">
            {nextStatuses.map((next) =>
              next === 'Rejected' ? (
                <div key={next} className="flex flex-wrap items-center gap-2">
                  {rejectOpen ? (
                    <>
                      <input
                        type="text"
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        placeholder="Rejection reason *"
                        className="h-8 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                      />
                      <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30" onClick={() => handleTransition(next)} loading={transitionMutation.isPending}>
                        Confirm Reject
                      </Button>
                      <button type="button" onClick={() => setRejectOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30" onClick={() => setRejectOpen(true)}>
                      Reject Application
                    </Button>
                  )}
                </div>
              ) : (
                <Button
                  key={next}
                  size="sm"
                  loading={transitionMutation.isPending}
                  onClick={() => handleTransition(next)}
                >
                  {next === 'MeterInstalled' ? 'Mark Meter Installed' : `Mark ${statusLabel(next)}`}
                </Button>
              ),
            )}
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Status changes run through the canonical transition service; marking the meter installed advances the project to the Subsidy stage.
          </p>
        </FormSection>
      )}

      {/* Terminal-state banners — the real lifecycle outcome */}
      {app.status === 'MeterInstalled' && (
        <div className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/10 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Net meter installed successfully — the project advanced to the Subsidy stage via the canonical lifecycle engine.</span>
        </div>
      )}
      {app.status === 'Rejected' && (
        <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-300">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>This application was rejected. A new application can be submitted for this project below.</span>
        </div>
      )}

      {/* The application's own status timeline — genuine domain history */}
      <FormSection title="Status Timeline">
        {(app.statusHistory || []).length === 0 ? (
          <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">No status changes recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {[...(app.statusHistory || [])].reverse().map((entry, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-xs">
                <div className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', entry.status === 'Rejected' ? 'bg-red-500' : entry.status === 'MeterInstalled' || entry.status === 'Approved' ? 'bg-emerald-500' : 'bg-[var(--color-primary)]')} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[var(--color-text)]">{statusLabel(entry.status)}</p>
                  {entry.note && <p className="text-[var(--color-text-muted)]">{entry.note}</p>}
                  <p className="text-[10px] text-[var(--color-text-muted)]">{fmtDateSafe(entry.changedAt)} · {entry.changedBy || 'System'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </FormSection>

      {/* Real domain notes field — not a generic Notes panel */}
      {app.notes && (
        <FormSection title="Application Notes">
          <p className="text-xs text-[var(--color-text)]">{app.notes}</p>
        </FormSection>
      )}
    </div>
  );
}

/** Create the DISCOM application — pre-scoped to this project. Calls the
 * canonical useCreateNetMetering hook (createNetMeteringApplication) exactly
 * like the list-page create modal and mobile workspace. Mirrors their real
 * fields: DISCOM name, application number, submitted date, expected meter
 * installation date, notes. */
function NetMeteringApplicationForm({ project }: { project: any }) {
  const perms = usePermissions();
  const createMutation = useCreateNetMetering();

  const [discomName, setDiscomName] = useState('');
  const [applicationNumber, setApplicationNumber] = useState('');
  const [submittedDate, setSubmittedDate] = useState('');
  const [expectedMeterInstallationDate, setExpectedMeterInstallationDate] = useState('');
  const [notes, setNotes] = useState('');

  const canCreate = perms.canCreate('net_metering');

  function handleSubmit() {
    if (!canCreate || createMutation.isPending) return;
    if (!discomName.trim()) { toast.error('Please enter DISCOM name'); return; }
    if (!applicationNumber.trim()) { toast.error('Please enter application number'); return; }
    createMutation.mutate({
      projectId: project.id,
      projectName: project.projectId || project.id,
      discomName: discomName.trim(),
      applicationNumber: applicationNumber.trim(),
      submittedDate: submittedDate || undefined,
      expectedMeterInstallationDate: expectedMeterInstallationDate || undefined,
      notes: notes || undefined,
    });
  }

  if (!canCreate) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
        <p className="text-xs text-[var(--color-text-muted)]">
          No net metering application has been filed for this project yet. You do not have permission to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          <Zap className="h-3.5 w-3.5" /> No application filed yet — {project.projectId || project.id}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          File the DISCOM net metering application for this project. Runs through the same create service the Net Metering list page uses.
        </p>
      </div>

      <FormSection title="Application Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="DISCOM / Utility *"
            value={discomName}
            onChange={(e) => setDiscomName(e.target.value)}
            placeholder="e.g. TPNODL, WESCO, CESU"
          />
          <Input
            label="Application Number *"
            value={applicationNumber}
            onChange={(e) => setApplicationNumber(e.target.value)}
            placeholder="DISCOM application reference number"
          />
          <Input
            label="Submitted Date"
            type="date"
            value={submittedDate}
            onChange={(e) => setSubmittedDate(e.target.value)}
          />
          <Input
            label="Expected Meter Installation"
            type="date"
            value={expectedMeterInstallationDate}
            onChange={(e) => setExpectedMeterInstallationDate(e.target.value)}
          />
        </div>
        <Input
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Additional notes about the application"
        />
      </FormSection>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" loading={createMutation.isPending} onClick={handleSubmit}>
          File Application
        </Button>
        <span className="text-[11px] text-[var(--color-text-muted)]">Creates a Submitted application for this project.</span>
      </div>
    </div>
  );
}

/** The real Net Metering state for one project — create form when no
 * application exists yet, application view after; a rejected application
 * re-opens the create form (a new application can be filed, per the existing
 * list-page banner). No generic project context (Documents/Activity/Linked
 * Records live at the Project Workspace level). */
export default function ProjectNetMeteringWorkspace({ project }: ProjectStageWorkspaceProps) {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  const { data: applications = [], isLoading } = useQuery({
    queryKey: keys.netMeteringAll,
    queryFn: () => getAll(COLLECTIONS.NET_METERING_APPLICATIONS),
    staleTime: 15_000,
  });

  const projectApps = useMemo(
    () => (applications as NetMeteringApplication[])
      .filter((app) => app.projectId === project.id && !app.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [applications, project.id],
  );

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  const latest = projectApps[0];

  return (
    <div className="space-y-3">
      {latest ? <NetMeteringApplicationView app={latest} navigate={navigate} /> : null}
      {/* Rejected applications can be re-filed (the existing list page says
          so) — always offer the create form when none exists OR the latest
          was rejected. */}
      {(!latest || latest.status === 'Rejected') && (
        <div className={latest ? 'rounded-lg border border-[var(--color-border-subtle)] p-3' : ''}>
          <NetMeteringApplicationForm project={project} />
        </div>
      )}
    </div>
  );
}
