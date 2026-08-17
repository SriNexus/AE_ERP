/**
 * ProjectSubsidyWorkspace — the Subsidy stage's operational workspace,
 * embedded inside "Work on This Project" (Stage 12 — Subsidy; the subsidy
 * detail modal on the Subsidy list page was retired). Built the same way
 * ProjectNetMeteringWorkspace / ProjectCommissioningWorkspace were: surfaces
 * the EXISTING Subsidy system verbatim, no parallel implementation.
 *
 * Subsidy data model (verified from the repository): applications live in
 * the subsidy_applications collection (lib/subsidyWorkflow.ts) —
 * SubsidyApplication has projectId, schemeName, schemeType, applicationNumber,
 * status ('Draft' → 'Submitted' → 'UnderReview' → 'Approved' → 'Disbursed' or
 * 'Rejected'), applicationDate, submittedDate, approvedDate, rejectedDate,
 * rejectionReason, disbursedDate, totalSanctionedAmount, totalDisbursedAmount,
 * documentsSubmitted, notes, statusHistory, and the IMMUTABLE append-only
 * disbursements ledger. The list page, mobile workspace and this workspace
 * ALL read the subsidy_applications collection (queryKeys.subsidyAll — React
 * Query dedupes them; never a second fetch).
 *
 * Reuse discipline:
 *   - Creation uses useCreateSubsidy → createSubsidyApplication — the SAME
 *     canonical service + hook wrapper the list page and mobile workspace
 *     call. It validates the project is at/past the Net Metering stage
 *     (isProjectStageAtOrPast), requires scheme + application number, writes
 *     the application (Draft, or Submitted when a submitted date is given)
 *     and advances the project to the Subsidy stage via
 *     buildProjectStageAdvancePatch (forward-only, idempotent — the same
 *     canonical path Net Metering's MeterInstalled transition uses; there is
 *     exactly one transition path, never duplicated).
 *   - Status changes use useTransitionSubsidy → transitionSubsidyStatus (the
 *     canonical VALID_TRANSITIONS map; sets approved/rejected/disbursed
 *     dates, totalSanctionedAmount, rejectionReason, appends statusHistory).
 *   - Disbursements use useRecordDisbursement → recordDisbursement — the
 *     canonical append-only immutable ledger (amount > 0; requires an
 *     approved application; auto-transitions Approved → Disbursed on first
 *     disbursement). Entries can never be edited or deleted.
 *   - The Subsidy → Handover progression is NOT implemented here: handover
 *     (projectHandoverWorkflow) is gated on currentStage being at/past
 *     'Subsidy' — this workspace never mutates project.currentStage.
 *   - Inventory: Subsidy performs NO stock mutation — it is a
 *     compliance/financial government process that read-references the
 *     commissioned system; nothing is duplicated.
 *   - B2C serial/barcode: read-oriented — the serial/barcode traceability
 *     established in Dispatch → Installation → QC is preserved in those
 *     stages' records; Subsidy neither captures nor fabricates tracking data.
 *   - Generic project context (Notes / Documents / Activity / Linked Records)
 *     is NOT duplicated here — the Project Workspace owns exactly one
 *     authoritative context layer below the stage cards. This card carries
 *     Subsidy-specific operational content only: the real application
 *     fields, the append-only disbursement ledger (immutable financial
 *     domain data), the application's own status timeline (statusHistory),
 *     the real `notes` field under "Application Notes", and the real
 *     `documentsSubmitted` field under "Submitted Documents" (the documents
 *     filed with the government scheme — genuine Subsidy domain data, not
 *     the Project-level Documents panel).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Calendar, CheckCircle2, DollarSign, FileText, Landmark, XCircle,
} from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { FormSection, Input } from '../../../../../components/ui/Input';
import { getAll, fmtCurrency, fmtDateSafe } from '../../../../../lib/firestore';
import { COLLECTIONS } from '../../../../../lib/firebase';
import { queryKeys } from '../../../../../lib/queryKeys';
import { useAppStore } from '../../../../../store/useAppStore';
import { usePermissions } from '../../../../../lib/permissions';
import { cn } from '../../../../../utils/cn';
import {
  type SubsidyApplication, type SubsidyStatus,
} from '../../../../../lib/subsidyWorkflow';
import {
  useCreateSubsidy, useTransitionSubsidy, useRecordDisbursement,
} from '../../../../subsidy/hooks/useSubsidy';
import type { ProjectStageWorkspaceProps } from './types';

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  UnderReview: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Disbursed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const VALID_NEXT: Record<SubsidyStatus, SubsidyStatus[]> = {
  Draft: ['Submitted', 'Rejected'],
  Submitted: ['UnderReview', 'Rejected'],
  UnderReview: ['Approved', 'Rejected'],
  Approved: ['Disbursed', 'Rejected'],
  Disbursed: [],
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

/** Real Subsidy application view — the government application's actual
 * fields, the append-only disbursement ledger, status actions, the
 * application's own status timeline, and its real notes/documents fields.
 * No generic project context (that lives at the Project Workspace level). */
function SubsidyApplicationView({
  app,
  navigate,
}: {
  app: SubsidyApplication;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const perms = usePermissions();
  const transitionMutation = useTransitionSubsidy();
  const disburseMutation = useRecordDisbursement();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [approveOpen, setApproveOpen] = useState(false);
  const [sanctionedAmount, setSanctionedAmount] = useState('');
  const [disburseAmount, setDisburseAmount] = useState('');
  const [disburseReference, setDisburseReference] = useState('');
  const [disburseNotes, setDisburseNotes] = useState('');

  const nextStatuses = VALID_NEXT[app.status] || [];
  const canTransition = perms.canEdit('subsidy') && nextStatuses.length > 0;
  const canDisburse = perms.canEdit('subsidy') && (app.status === 'Approved' || app.status === 'Disbursed');

  function handleTransition(next: SubsidyStatus) {
    if (transitionMutation.isPending) return;
    if (next === 'Rejected') {
      if (!rejectionReason.trim()) { toast.error('Rejection reason is required'); return; }
      transitionMutation.mutate({ id: app.id, status: next, options: { rejectionReason: rejectionReason.trim() } });
      setRejectOpen(false);
      setRejectionReason('');
      return;
    }
    if (next === 'Approved') {
      if (approveOpen) {
        const amount = Number(sanctionedAmount);
        transitionMutation.mutate({
          id: app.id,
          status: next,
          options: {
            approvedDate: new Date().toISOString(),
            ...(sanctionedAmount && !isNaN(amount) && amount > 0 ? { totalSanctionedAmount: amount } : {}),
          },
        });
        setApproveOpen(false);
        setSanctionedAmount('');
      } else {
        setApproveOpen(true);
      }
      return;
    }
    transitionMutation.mutate({ id: app.id, status: next, options: {} });
  }

  function handleDisburse() {
    if (disburseMutation.isPending) return;
    const amount = Number(disburseAmount);
    if (!amount || amount <= 0) { toast.error('Please enter a valid positive amount'); return; }
    disburseMutation.mutate(
      {
        id: app.id,
        input: {
          amount,
          referenceNumber: disburseReference || undefined,
          notes: disburseNotes || undefined,
        },
      },
      { onSuccess: () => { setDisburseAmount(''); setDisburseReference(''); setDisburseNotes(''); } },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Landmark className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">#{app.id.slice(-8)}</span>
            <span className="font-mono text-xs font-medium text-[var(--color-text)]">{app.applicationNumber}</span>
            {statusBadge(app.status)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1"><Landmark className="h-3 w-3" />{app.schemeName}{app.schemeType ? ` (${app.schemeType})` : ''}</span>
            <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />Applied {fmtDateSafe(app.applicationDate)}</span>
            {app.status === 'Disbursed' && (
              <span className="inline-flex items-center gap-1"><DollarSign className="h-3 w-3 text-emerald-600" />{fmtCurrency(app.totalDisbursedAmount || 0)} disbursed</span>
            )}
          </div>
        </div>
        <Button size="xs" variant="outline" icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => navigate(`/subsidy/${encodeURIComponent(app.id)}`)}>
          Full workspace
        </Button>
      </div>

      {/* Real application fields */}
      <FormSection title="Application Overview">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Scheme</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--color-text)]">{app.schemeName}{app.schemeType ? ` (${app.schemeType})` : ''}</p>
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
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Application / Submitted</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">
              {fmtDateSafe(app.applicationDate)}
              {app.submittedDate ? ` · Submitted ${fmtDateSafe(app.submittedDate)}` : ' · Not submitted'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Sanctioned / Disbursed</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">
              {app.totalSanctionedAmount ? `${fmtCurrency(app.totalSanctionedAmount)} sanctioned` : 'Not sanctioned'}
              {app.totalDisbursedAmount ? ` · ${fmtCurrency(app.totalDisbursedAmount)} paid` : ''}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Approved / Disbursed</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">
              {app.approvedDate ? `Approved ${fmtDateSafe(app.approvedDate)}` : '—'}
              {app.disbursedDate ? ` · Disbursed ${fmtDateSafe(app.disbursedDate)}` : ''}
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

      {/* Documents filed with the government scheme — genuine Subsidy domain data */}
      {app.documentsSubmitted && app.documentsSubmitted.length > 0 && (
        <FormSection title="Submitted Documents">
          <div className="flex flex-wrap gap-1.5">
            {app.documentsSubmitted.map((doc, i) => (
              <span key={i} className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                <FileText className="mr-1 h-2.5 w-2.5" />
                {doc}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">Documents filed with the scheme application.</p>
        </FormSection>
      )}

      {/* Operational status actions — canonical transition service */}
      {canTransition && (
        <FormSection title="Status Actions">
          <div className="flex flex-wrap items-center gap-2">
            {nextStatuses
              .filter((next) => next !== 'Disbursed') // Disbursed = Record Disbursement section below
              .map((next) =>
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
                ) : next === 'Approved' ? (
                  <div key={next} className="flex flex-wrap items-center gap-2">
                    {approveOpen ? (
                      <>
                        <input
                          type="number"
                          min="0"
                          value={sanctionedAmount}
                          onChange={(e) => setSanctionedAmount(e.target.value)}
                          placeholder="Sanctioned amount (optional)"
                          className="h-8 w-52 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                        />
                        <Button size="sm" onClick={() => handleTransition(next)} loading={transitionMutation.isPending}>
                          Confirm Approval
                        </Button>
                        <button type="button" onClick={() => setApproveOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <Button size="sm" onClick={() => setApproveOpen(true)}>
                        Approve Application
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
                    {`Mark ${statusLabel(next)}`}
                  </Button>
                ),
              )}
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Status changes run through the canonical transition service; approvals can carry the sanctioned subsidy amount.
          </p>
        </FormSection>
      )}

      {/* Record Disbursement — append-only via the canonical ledger service */}
      {canDisburse && (
        <FormSection title="Record Disbursement">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Amount *"
              type="number"
              min="0.01"
              step="0.01"
              value={disburseAmount}
              onChange={(e) => setDisburseAmount(e.target.value)}
              placeholder="Disbursement amount"
            />
            <Input
              label="Reference Number"
              value={disburseReference}
              onChange={(e) => setDisburseReference(e.target.value)}
              placeholder="Payment reference / transaction ID"
            />
            <Input
              label="Notes"
              value={disburseNotes}
              onChange={(e) => setDisburseNotes(e.target.value)}
              placeholder="Optional notes"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" loading={disburseMutation.isPending} onClick={handleDisburse}>
              Record Disbursement
            </Button>
            <span className="text-[10px] text-[var(--color-text-muted)]">Append-only — the first disbursement moves the application to Disbursed.</span>
          </div>
        </FormSection>
      )}

      {/* The immutable disbursement ledger — genuine financial domain data */}
      {app.disbursements && app.disbursements.length > 0 && (
        <FormSection title="Disbursement Ledger">
          <div className="space-y-1.5">
            {app.disbursements.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs dark:border-emerald-900/30 dark:bg-emerald-900/10">
                <DollarSign className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">{fmtCurrency(entry.amount)}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    {fmtDateSafe(entry.disbursedDate)}{entry.referenceNumber ? ` · Ref: ${entry.referenceNumber}` : ''}
                  </p>
                  {entry.notes && <p className="text-[10px] text-[var(--color-text-muted)]">{entry.notes}</p>}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] italic text-[var(--color-text-muted)]">Immutable ledger — entries cannot be modified.</p>
        </FormSection>
      )}

      {/* Terminal-state banners — the real lifecycle outcome */}
      {app.status === 'Disbursed' && (
        <div className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/10 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Subsidy disbursed: {fmtCurrency(app.totalDisbursedAmount || 0)}. The project is at the Subsidy stage — handover becomes available per the lifecycle rules.</span>
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
                <div className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', entry.status === 'Rejected' ? 'bg-red-500' : entry.status === 'Disbursed' || entry.status === 'Approved' ? 'bg-emerald-500' : 'bg-[var(--color-primary)]')} />
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

/** Create the government subsidy application — pre-scoped to this project.
 * Calls the canonical useCreateSubsidy hook (createSubsidyApplication)
 * exactly like the list-page create modal and mobile workspace. Mirrors
 * their real fields: scheme, application number, application/submitted
 * dates, sanctioned amount, notes. */
function SubsidyApplicationForm({ project }: { project: any }) {
  const perms = usePermissions();
  const createMutation = useCreateSubsidy();

  const [schemeName, setSchemeName] = useState('');
  const [schemeType, setSchemeType] = useState('');
  const [applicationNumber, setApplicationNumber] = useState('');
  const [applicationDate, setApplicationDate] = useState('');
  const [submittedDate, setSubmittedDate] = useState('');
  const [totalSanctionedAmount, setTotalSanctionedAmount] = useState('');
  const [notes, setNotes] = useState('');

  const canCreate = perms.canCreate('subsidy');

  function handleSubmit() {
    if (!canCreate || createMutation.isPending) return;
    if (!schemeName.trim()) { toast.error('Please select/enter a scheme name'); return; }
    if (!applicationNumber.trim()) { toast.error('Please enter application number'); return; }
    createMutation.mutate({
      projectId: project.id,
      projectName: project.projectId || project.id,
      schemeName: schemeName.trim(),
      schemeType: schemeType || undefined,
      applicationNumber: applicationNumber.trim(),
      applicationDate: applicationDate || undefined,
      submittedDate: submittedDate || undefined,
      totalSanctionedAmount: totalSanctionedAmount ? Number(totalSanctionedAmount) : undefined,
      notes: notes || undefined,
    });
  }

  function onSchemeChange(val: string) {
    setSchemeName(val);
    if (val === 'PM Surya Ghar') setSchemeType('Central');
    else if (val === 'State Scheme') setSchemeType('State');
  }

  if (!canCreate) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
        <p className="text-xs text-[var(--color-text-muted)]">
          No subsidy application has been filed for this project yet. You do not have permission to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          <Landmark className="h-3.5 w-3.5" /> No application filed yet — {project.projectId || project.id}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          File the government subsidy application for this project. Runs through the same create service the Subsidy list page uses and advances the project to the Subsidy stage.
        </p>
      </div>

      <FormSection title="Application Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Scheme Name *</label>
            <select
              value={schemeName === 'OTHER' ? 'OTHER' : schemeName}
              onChange={(e) => onSchemeChange(e.target.value)}
              className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              <option value="">Select scheme</option>
              <option value="PM Surya Ghar">PM Surya Ghar</option>
              <option value="State Scheme">State Scheme</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          {schemeName === 'OTHER' && (
            <Input
              label="Custom Scheme Name *"
              value={schemeName === 'OTHER' ? '' : schemeName}
              onChange={(e) => { setSchemeName(e.target.value); setSchemeType(''); }}
              placeholder="Enter scheme name"
            />
          )}
          <Input
            label="Application Number *"
            value={applicationNumber}
            onChange={(e) => setApplicationNumber(e.target.value)}
            placeholder="Scheme application reference number"
          />
          <Input
            label="Sanctioned Amount"
            type="number"
            min="0"
            value={totalSanctionedAmount}
            onChange={(e) => setTotalSanctionedAmount(e.target.value)}
            placeholder="Total approved subsidy amount"
          />
          <Input
            label="Application Date"
            type="date"
            value={applicationDate}
            onChange={(e) => setApplicationDate(e.target.value)}
          />
          <Input
            label="Submitted Date (optional)"
            type="date"
            value={submittedDate}
            onChange={(e) => setSubmittedDate(e.target.value)}
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
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {submittedDate ? 'Creates a Submitted application' : 'Creates a Draft application'} for this project.
        </span>
      </div>
    </div>
  );
}

/** The real Subsidy state for one project — create form when no application
 * exists yet, application view after; a rejected application re-opens the
 * create form (a new application can be filed, per the existing list-page
 * banner). No generic project context (Documents/Activity/Linked Records
 * live at the Project Workspace level). */
export default function ProjectSubsidyWorkspace({ project }: ProjectStageWorkspaceProps) {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  const { data: applications = [], isLoading } = useQuery({
    queryKey: keys.subsidyAll,
    queryFn: () => getAll(COLLECTIONS.SUBSIDY_APPLICATIONS),
    staleTime: 15_000,
  });

  const projectApps = useMemo(
    () => (applications as SubsidyApplication[])
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
      {latest ? <SubsidyApplicationView app={latest} navigate={navigate} /> : null}
      {/* Rejected applications can be re-filed (the existing list page says
          so) — always offer the create form when none exists OR the latest
          was rejected. */}
      {(!latest || latest.status === 'Rejected') && (
        <div className={latest ? 'rounded-lg border border-[var(--color-border-subtle)] p-3' : ''}>
          <SubsidyApplicationForm project={project} />
        </div>
      )}
    </div>
  );
}
