/**
 * SubsidyWorkspace — Full-page workspace for a single Subsidy Application
 *
 * Phase 7F — 9 universal tabs, no quick actions, no module-specific tabs.
 * Subsidy status workflow: Draft → Submitted → UnderReview → Approved → Disbursed → Rejected
 * Includes immutable disbursement ledger (append-only entries).
 */

import { useMemo, useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Landmark, ArrowLeft, DollarSign, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { getOne, getAll, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import { SUBSIDY_TABS } from '../features/subsidy/utils/workspaceConfig';
import type { SubsidyApplication, SubsidyStatus } from '../lib/subsidyWorkflow';
import {
  useTransitionSubsidy,
  useRecordDisbursement,
} from '../features/subsidy/hooks/useSubsidy';
import SubsidyOverview from '../features/subsidy/components/SubsidyOverview';

// ── Status colors ─────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, SubsidyStatus[]> = {
  Draft: ['Submitted', 'Rejected'],
  Submitted: ['UnderReview', 'Rejected'],
  UnderReview: ['Approved', 'Rejected'],
  Approved: ['Disbursed', 'Rejected'],
  Disbursed: [],
  Rejected: [],
};

// ── Main Component ─────────────────────────────────────────

export default function SubsidyWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const recordQuery = useQuery({
    queryKey: [...qkeys.subsidy, id],
    queryFn: () => getOne(COLLECTIONS.SUBSIDY_APPLICATIONS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const projectsQuery = useQuery({
    queryKey: qkeys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const netMeteringQuery = useQuery({
    queryKey: qkeys.netMeteringAll,
    queryFn: () => getAll(COLLECTIONS.NET_METERING_APPLICATIONS),
    staleTime: 60_000,
  });

  const handoverQuery = useQuery({
    queryKey: qkeys.projectHandoversAll,
    queryFn: () => getAll(COLLECTIONS.PROJECT_HANDOVERS),
    staleTime: 60_000,
  });

  const commissioningQuery = useQuery({
    queryKey: qkeys.commissioningRecordsAll,
    queryFn: () => getAll(COLLECTIONS.COMMISSIONING_RECORDS),
    staleTime: 60_000,
  });

  const record = recordQuery.data as SubsidyApplication | null;
  const projects = (projectsQuery.data as any[]) || [];
  const netMeteringRecs = (netMeteringQuery.data as any[]) || [];
  const handoverRecs = (handoverQuery.data as any[]) || [];
  const commissioningRecs = (commissioningQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canView = perms.canView('subsidy');
  const canEdit = perms.canEdit('subsidy');
  const canCreate = perms.canCreate('subsidy');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('subsidy', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Mutations ────────────────────────────────────────────
  const transitionMutation = useTransitionSubsidy();
  const disburseMutation = useRecordDisbursement();

  // ── Disbursement form state ──────────────────────────────
  const [showDisburseForm, setShowDisburseForm] = useState(false);
  const [disburseAmount, setDisburseAmount] = useState('');
  const [disburseRef, setDisburseRef] = useState('');
  const [disburseNotes, setDisburseNotes] = useState('');

  // ── Derived data ─────────────────────────────────────────
  const project = useMemo(() => {
    if (!record?.projectId) return null;
    return projects.find((p: any) => p.id === record.projectId || p.projectId === record.projectId) || null;
  }, [record, projects]);

  const projectNetMeteringRecs = useMemo(() => {
    if (!record?.projectId) return [];
    return netMeteringRecs.filter((nm: any) => nm.projectId === record.projectId);
  }, [record, netMeteringRecs]);

  const projectHandoverRecs = useMemo(() => {
    if (!record?.projectId) return [];
    return handoverRecs.filter((h: any) => h.projectId === record.projectId);
  }, [record, handoverRecs]);

  const projectCommissioningRecs = useMemo(() => {
    if (!record?.projectId) return [];
    return commissioningRecs.filter((cr: any) => cr.projectId === record.projectId);
  }, [record, commissioningRecs]);

  const status = record?.status || 'Draft';
  const nextTransitions = VALID_TRANSITIONS[status] || [];
  const hasNextTransitions = nextTransitions.length > 0 && canEdit;
  const disbursements = record?.disbursements || [];
  const totalSanctioned = record?.totalSanctionedAmount ?? 0;
  const totalDisbursed = record?.totalDisbursedAmount ?? 0;
  const remainingAmount = Math.max(0, totalSanctioned - totalDisbursed);
  const canDisburse = canEdit && (status === 'Approved' || status === 'Disbursed') && remainingAmount > 0;
  const caseId = project?.caseId ? String(project.caseId) : record ? String((record as any).caseId || '') : null;

  // ── Transition handler ───────────────────────────────────
  const handleTransition = useCallback((newStatus: SubsidyStatus) => {
    if (!id) return;
    let options: any = {};
    if (newStatus === 'Rejected') {
      const reason = prompt('Enter rejection reason:');
      if (!reason) return;
      options = { rejectionReason: reason };
    }
    if (newStatus === 'Approved') {
      const amt = prompt('Enter sanctioned amount (optional):');
      if (amt) options = { approvedDate: new Date().toISOString(), totalSanctionedAmount: Number(amt) };
      else options = { approvedDate: new Date().toISOString() };
    }
    if (newStatus === 'Disbursed') {
      setShowDisburseForm(true);
      return;
    }
    transitionMutation.mutate({ id, status: newStatus, options });
  }, [id, transitionMutation]);

  // ── Disbursement handler ─────────────────────────────────
  const handleDisburse = useCallback(() => {
    if (!id) return;
    const amount = Number(disburseAmount);
    if (!amount || amount <= 0) return;
    if (amount > remainingAmount) return;
    disburseMutation.mutate({
      id,
      input: {
        amount,
        referenceNumber: disburseRef.trim() || undefined,
        notes: disburseNotes.trim() || undefined,
      },
    });
    setShowDisburseForm(false);
    setDisburseAmount('');
    setDisburseRef('');
    setDisburseNotes('');
  }, [id, disburseAmount, disburseRef, disburseNotes, remainingAmount, disburseMutation]);

  // ── Navigation helper for overview ───────────────────────
  const onNavigate = useCallback((path: string) => navigate(path), [navigate]);

  // ── No module-specific tab content ───────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = {};

  // ── onCaseClick ──────────────────────────────────────────
  const onCaseClick = useCallback(() => {
    if (caseId) navigate(`/cases/${encodeURIComponent(caseId)}`);
  }, [caseId, navigate]);

  // ── Loading state ────────────────────────────────────────
  if (recordQuery.isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Loading Application..." icon={<Landmark className="h-5 w-5" />} />
        <div className="flex-1 p-6 space-y-4">
          <div className="h-8 w-64 bg-[var(--color-bg-sunken)] rounded-md animate-pulse" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-20 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────
  if (!record || recordQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <Landmark className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Application not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {recordQuery.isError ? 'Failed to load subsidy application.' : 'This record does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/subsidy')}>
          Back to Subsidy
        </Button>
      </div>
    );
  }

  // ── Overview content ─────────────────────────────────────
  const overview = (
    <SubsidyOverview
      record={record}
      project={project}
      projectNetMeteringRecs={projectNetMeteringRecs}
      projectHandoverRecs={projectHandoverRecs}
      projectCommissioningRecs={projectCommissioningRecs}
      status={status}
      totalSanctioned={totalSanctioned}
      totalDisbursed={totalDisbursed}
      remainingAmount={remainingAmount}
      disbursements={disbursements}
      onNavigate={onNavigate}
    />
  );

  // ── Disbursement Form Modal ──────────────────────────────
  const disburseModal = showDisburseForm && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-[var(--color-text)]">Record Disbursement</h3>
          <button onClick={() => setShowDisburseForm(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            Sanctioned: {fmtCurrency(totalSanctioned)} · Remaining: {fmtCurrency(remainingAmount)}
          </p>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Amount *</label>
            <input
              type="number" min="0.01" max={remainingAmount} step="0.01"
              value={disburseAmount}
              onChange={(e) => setDisburseAmount(e.target.value)}
              placeholder="Disbursement amount"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Reference Number</label>
            <input
              type="text" value={disburseRef}
              onChange={(e) => setDisburseRef(e.target.value)}
              placeholder="UTR / transaction reference"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Notes</label>
            <textarea
              value={disburseNotes} onChange={(e) => setDisburseNotes(e.target.value)}
              placeholder="Optional notes about this disbursement" rows={2}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none"
            />
          </div>
        </div>
        <div className="mt-4 flex gap-2 justify-end">
          <button
            onClick={() => setShowDisburseForm(false)}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)]"
          >
            Cancel
          </button>
          <button
            onClick={handleDisburse}
            disabled={disburseMutation.isPending || !disburseAmount || Number(disburseAmount) <= 0 || Number(disburseAmount) > remainingAmount}
            className="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {disburseMutation.isPending ? 'Recording...' : 'Record Disbursement'}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={`Subsidy ${record.applicationNumber}`}
        icon={<Landmark className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate('/subsidy')}>
            Applications
          </Button>
        }
      />

      <WorkspaceShell
        header={{
          name: `Subsidy ${record.applicationNumber}`,
          status,
          entityId: id || '',
          caseId: caseId ?? undefined,
          onCaseClick,
          createdAt: record.createdAt,
          assignedTo: undefined,
        }}
        tabs={{
          tabs: SUBSIDY_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'subsidy',
            companyId: activeCompanyId || '',
            record: (record || {}) as unknown as Record<string, unknown>,
            permissions: { canView, canCreate, canEdit, canDelete: false },
            caseId: caseId ?? undefined,
          },
          overview,
          moduleTabContent,
        }}
      />

      {disburseModal}
    </div>
  );
}
