/**
 * ProjectAmcWorkspace — the AMC / Service stage's operational workspace,
 * embedded inside "Work on This Project" (Stage 14 — AMC; the AMC detail
 * modal on the AMC Contracts list page was retired). Built the same way
 * ProjectHandoverWorkspace / ProjectSubsidyWorkspace / ProjectNetMeteringWorkspace
 * were: surfaces the EXISTING AMC system verbatim, no parallel
 * implementation.
 *
 * AMC data model (verified from the repository): records live in the
 * amc_contracts collection (lib/amcWorkflow.ts) — AmcContractRecord has
 * projectId, projectName, customerId, customerName, contractNumber,
 * startDate, endDate, visitsPerYear, contractValue, assignedTo(Name),
 * notes, status ('Draft' → 'Active' → 'Expired' or 'Cancelled'),
 * statusHistory, activatedAt/By, expiredAt, cancelledAt/By,
 * cancellationReason. The list page, the /amc-contracts/:id record
 * workspace, mobile and THIS workspace ALL read amc_contracts via the SAME
 * query key family (queryKeys.amcContracts — React Query dedupes them;
 * never a second fetch).
 *
 * Reuse discipline:
 *   - Creation uses useCreateAmcContract → createAmcContract — the SAME
 *     canonical service + hook wrapper the list page calls. It requires
 *     project/customer + start/end dates, guards the project is at/past the
 *     Handover stage (isProjectStageAtOrPast — the canonical Handover → AMC
 *     handoff), guards against a duplicate OPEN (Draft/Active) contract
 *     (expired/cancelled records may be legitimately renewed), writes the
 *     Draft record and advances the project to the AMC stage via
 *     advanceProjectStage (the canonical stage-transition service). This
 *     workspace never mutates project.currentStage directly.
 *   - Status changes use useTransitionAmcContract → transitionAmcStatus
 *     (the canonical VALID_TRANSITIONS map: Draft → Active/Cancelled,
 *     Active → Expired/Cancelled; sets activated/expired/cancelled
 *     timestamps + cancellation reason, appends statusHistory).
 *   - The workspace never performs inventory mutation and never captures
 *     B2C serial/barcode data — physical traceability remains in
 *     Dispatch → Installation → QC records; AMC is a post-handover
 *     maintenance contract.
 *   - Generic project context (Notes / Documents / Activity / Linked
 *     Records) is NOT duplicated here — the Project Workspace owns exactly
 *     one authoritative context layer below the stage cards. This card
 *     carries AMC-specific operational content only: the real contract
 *     fields, the record's own status timeline (statusHistory — genuine
 *     domain history of the contract itself), and the real `notes` field
 *     under "Contract Notes" (not a generic Notes panel).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, CalendarCheck, CheckCircle2, ShieldCheck, XCircle,
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
  type AmcContractRecord, type AmcStatus,
} from '../../../../../lib/amcWorkflow';
import {
  useCreateAmcContract, useTransitionAmcContract,
} from '../../../../amc/hooks/useAmcContracts';
import type { ProjectStageWorkspaceProps } from './types';

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Expired: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
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

/** Real AMC record view — the actual contract fields, operational status
 * actions, the record's own status timeline, and its real notes field. No
 * generic project context (that lives at the Project Workspace level). */
function AmcContractView({
  record,
  navigate,
}: {
  record: AmcContractRecord;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const perms = usePermissions();
  const transitionMutation = useTransitionAmcContract();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const canAct = perms.canEdit('projects');
  const isTerminal = record.status === 'Expired' || record.status === 'Cancelled';

  function handleTransition(next: AmcStatus) {
    if (transitionMutation.isPending) return;
    if (next === 'Cancelled') {
      if (!cancelReason.trim()) { toast.error('Cancellation reason is required'); return; }
      transitionMutation.mutate({ contractId: record.id, nextStatus: 'Cancelled', note: cancelReason.trim() });
      setCancelOpen(false);
      setCancelReason('');
      return;
    }
    transitionMutation.mutate({ contractId: record.id, nextStatus: next });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">#{record.contractNumber.slice(-8)}</span>
            <span className="font-mono text-xs font-medium text-[var(--color-text)]">{record.contractNumber}</span>
            {statusBadge(record.status)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
            <span>{record.customerName} · {record.projectName}</span>
            <span>{fmtCurrency(record.contractValue)} · {record.visitsPerYear} visits/yr</span>
            {record.assignedToName && <span>Owner: {record.assignedToName}</span>}
          </div>
        </div>
        <Button size="xs" variant="outline" icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => navigate(`/amc-contracts/${encodeURIComponent(record.id)}`)}>
          Full workspace
        </Button>
      </div>

      {/* Real contract fields */}
      <FormSection title="Contract Overview">
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
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Period</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{fmtDateSafe(record.startDate)} – {fmtDateSafe(record.endDate)}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Contract Value</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{fmtCurrency(record.contractValue)}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Visits per Year</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{record.visitsPerYear}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Assigned To</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{record.assignedToName || '—'}</p>
          </div>
        </div>
        {record.cancellationReason && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/10">
            <p className="text-[10px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">Cancelled · {fmtDateSafe(record.cancelledAt)}</p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">{record.cancellationReason}</p>
          </div>
        )}
        {record.expiredAt && (
          <div className="mt-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Expired · {fmtDateSafe(record.expiredAt)}</p>
          </div>
        )}
      </FormSection>

      {/* Operational status actions — canonical transition service */}
      {canAct && !isTerminal && (
        <FormSection title="Contract Actions">
          <div className="flex flex-wrap items-center gap-2">
            {record.status === 'Draft' && (
              <Button size="sm" onClick={() => handleTransition('Active')} loading={transitionMutation.isPending}>
                Activate Contract
              </Button>
            )}
            {record.status === 'Active' && (
              <Button size="sm" variant="outline" onClick={() => handleTransition('Expired')} loading={transitionMutation.isPending}>
                Mark Expired
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
                Cancel Contract
              </Button>
            )}
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Status changes run through the canonical AMC transition service (Draft → Active → Expired, or Cancelled).
          </p>
        </FormSection>
      )}

      {/* Terminal-state banners — the real lifecycle outcome */}
      {record.status === 'Active' && (
        <div className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/10 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Contract active — covers {record.visitsPerYear} service visit(s) per year until {fmtDateSafe(record.endDate)}.</span>
        </div>
      )}
      {record.status === 'Cancelled' && (
        <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-300">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>This contract was cancelled. A fresh AMC contract can be created for this project once the open record is resolved.</span>
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
                <div className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', entry.status === 'Active' ? 'bg-emerald-500' : entry.status === 'Cancelled' ? 'bg-red-500' : entry.status === 'Expired' ? 'bg-gray-400' : 'bg-amber-500')} />
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
        <FormSection title="Contract Notes">
          <p className="whitespace-pre-wrap text-xs text-[var(--color-text)]">{record.notes}</p>
        </FormSection>
      )}
    </div>
  );
}

/** Create the AMC contract — pre-scoped to this project. Calls the
 * canonical useCreateAmcContract hook (createAmcContract) exactly like the
 * list-page create modal. Mirrors their real fields: customer name,
 * start/end dates, visits per year, contract value, owner, notes. */
function AmcCreateForm({ project }: { project: any }) {
  const perms = usePermissions();
  const createMutation = useCreateAmcContract();

  const [customerName, setCustomerName] = useState((project as any).customerName || '');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [visitsPerYear, setVisitsPerYear] = useState(2);
  const [contractValue, setContractValue] = useState(0);
  const [notes, setNotes] = useState('');

  const canCreate = perms.canEdit('projects');

  function handleSubmit() {
    if (!canCreate || createMutation.isPending) return;
    if (!customerName.trim()) { toast.error('Customer name is required'); return; }
    if (!startDate) { toast.error('Start date is required'); return; }
    if (!endDate) { toast.error('End date is required'); return; }
    if (endDate <= startDate) { toast.error('End date must be after start date'); return; }
    if (contractValue <= 0) { toast.error('Contract value must be greater than 0'); return; }
    createMutation.mutate(
      {
        projectId: project.id,
        projectName: project.projectId || project.id,
        customerId: (project as any).customerId || '',
        customerName: customerName.trim(),
        startDate,
        endDate,
        visitsPerYear: Number(visitsPerYear) || 0,
        contractValue: Number(contractValue) || 0,
        notes: notes || undefined,
      },
      { onSuccess: () => { setCustomerName((project as any).customerName || ''); setStartDate(new Date().toISOString().split('T')[0]); setEndDate(''); setNotes(''); } },
    );
  }

  if (!canCreate) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
        <p className="text-xs text-[var(--color-text-muted)]">
          No AMC contract exists for this project yet. You do not have permission to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          <ShieldCheck className="h-3.5 w-3.5" /> No AMC contract yet — {project.projectId || project.id}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          Create the post-handover service contract for this project. Runs through the same create service the AMC Contracts list page uses and advances the project to the AMC stage.
        </p>
      </div>

      <FormSection title="Contract Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Customer Name *"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Customer name"
          />
          <Input
            label="Start Date *"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            label="End Date *"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <Input
            label="Visits per Year"
            type="number"
            min={0}
            value={String(visitsPerYear)}
            onChange={(e) => setVisitsPerYear(Number(e.target.value))}
          />
          <Input
            label="Contract Value *"
            type="number"
            min={0}
            value={String(contractValue)}
            onChange={(e) => setContractValue(Number(e.target.value))}
          />
        </div>
        <Input
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Additional notes about the contract"
        />
      </FormSection>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" loading={createMutation.isPending} onClick={handleSubmit}>
          Create AMC Contract
        </Button>
        <span className="text-[11px] text-[var(--color-text-muted)]">Creates a Draft contract for this project and advances the project to the AMC stage.</span>
      </div>
    </div>
  );
}

/** The real AMC state for one project — create form when no contract
 * exists yet (a Cancelled contract also re-opens the create form, since a
 * fresh contract can be filed once the open one is resolved — the canonical
 * service only guards duplicate OPEN records), contract view after. No
 * generic project context (Documents/Activity/Linked Records live at the
 * Project Workspace level). */
export default function ProjectAmcWorkspace({ project }: ProjectStageWorkspaceProps) {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  const { data: contracts = [], isLoading } = useQuery({
    queryKey: keys.amcContracts,
    queryFn: () => getAll(COLLECTIONS.AMC_CONTRACTS),
    staleTime: 15_000,
  });

  const projectRecords = useMemo(
    () => (contracts as AmcContractRecord[])
      .filter((c) => c.projectId === project.id && !c.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [contracts, project.id],
  );

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  const latest = projectRecords[0];

  return (
    <div className="space-y-3">
      {latest ? <AmcContractView record={latest} navigate={navigate} /> : null}
      {/* A Cancelled or Expired contract re-opens the create form: the
          canonical createAmcContract service guards against duplicate OPEN
          (Draft/Active) records only, so a fresh contract can be filed once
          the previous one was resolved — the service's own docs state an
          Expired or Cancelled contract "can still be legitimately renewed
          with a fresh one". */}
      {(!latest || latest.status === 'Cancelled' || latest.status === 'Expired') && <AmcCreateForm project={project} />}
    </div>
  );
}
