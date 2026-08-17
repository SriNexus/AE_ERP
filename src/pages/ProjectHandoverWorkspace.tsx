/**
 * ProjectHandoverWorkspace — Full-page workspace for a single Project Handover record
 *
 * Phase 7G — 9 universal tabs, no quick actions, no module-specific tabs.
 * Handover status workflow: Draft → Scheduled → Completed / Cancelled
 */

import { useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Handshake, ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';

import { getOne, getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import { HANDOVER_TABS } from '../features/handover/utils/workspaceConfig';
import type { HandoverRecord, HandoverStatus } from '../lib/projectHandoverWorkflow';
import { isValidTransition } from '../lib/projectHandoverWorkflow';
import { useTransitionHandover } from '../features/project-handover/hooks/useProjectHandover';
import HandoverOverview from '../features/handover/components/HandoverOverview';

// ── Main Component ─────────────────────────────────────────

export default function ProjectHandoverWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const recordQuery = useQuery({
    queryKey: [...qkeys.projectHandovers, id],
    queryFn: () => getOne(COLLECTIONS.PROJECT_HANDOVERS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const projectsQuery = useQuery({
    queryKey: qkeys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const subsidyQuery = useQuery({
    queryKey: qkeys.subsidyAll,
    queryFn: () => getAll(COLLECTIONS.SUBSIDY_APPLICATIONS),
    staleTime: 60_000,
  });

  const netMeteringQuery = useQuery({
    queryKey: qkeys.netMeteringAll,
    queryFn: () => getAll(COLLECTIONS.NET_METERING_APPLICATIONS),
    staleTime: 60_000,
  });

  const commissioningQuery = useQuery({
    queryKey: qkeys.commissioningRecordsAll,
    queryFn: () => getAll(COLLECTIONS.COMMISSIONING_RECORDS),
    staleTime: 60_000,
  });

  const amcQuery = useQuery({
    queryKey: qkeys.amcContractsAll,
    queryFn: () => getAll(COLLECTIONS.AMC_CONTRACTS),
    staleTime: 60_000,
  });

  const record = recordQuery.data as HandoverRecord | null;
  const projects = (projectsQuery.data as any[]) || [];
  const subsidyApps = (subsidyQuery.data as any[]) || [];
  const netMeteringApps = (netMeteringQuery.data as any[]) || [];
  const commissioningRecs = (commissioningQuery.data as any[]) || [];
  const amcContracts = (amcQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canView = perms.canView('projects') || perms.canView('subsidy');
  const canEdit = perms.canEdit('projects');
  const canCreate = perms.canCreate('projects');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('handover', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Transition mutation ──────────────────────────────────
  const transitionMut = useTransitionHandover();

  // ── Derived data ─────────────────────────────────────────
  const project = useMemo(() => {
    if (!record?.projectId) return null;
    return projects.find((p: any) => p.id === record.projectId || p.projectId === record.projectId) || null;
  }, [record, projects]);

  const projectSubsidyApps = useMemo(() => {
    if (!record?.projectId) return [];
    return subsidyApps.filter((s: any) => s.projectId === record.projectId);
  }, [record, subsidyApps]);

  const projectNetMeteringApps = useMemo(() => {
    if (!record?.projectId) return [];
    return netMeteringApps.filter((nm: any) => nm.projectId === record.projectId);
  }, [record, netMeteringApps]);

  const projectCommissioningRecs = useMemo(() => {
    if (!record?.projectId) return [];
    return commissioningRecs.filter((cr: any) => cr.projectId === record.projectId);
  }, [record, commissioningRecs]);

  const projectAmcContracts = useMemo(() => {
    if (!record?.projectId) return [];
    return amcContracts.filter((a: any) => a.projectId === record.projectId);
  }, [record, amcContracts]);

  const status = (record?.status || 'Draft') as HandoverStatus;
  const caseId = project?.caseId ? String(project.caseId) : record ? String((record as any).caseId || '') : null;

  // ── Transition handler ───────────────────────────────────
  const handleTransition = useCallback((nextStatus: HandoverStatus) => {
    if (!id || !record) return;
    if (!isValidTransition(status, nextStatus)) return;

    const payload: any = { handoverId: id, nextStatus };

    if (nextStatus === 'Scheduled') {
      const date = prompt('Enter scheduled date (YYYY-MM-DD):', record.handoverDate || new Date().toISOString().split('T')[0]);
      if (!date) return;
      payload.scheduledDate = date;
      const engineerName = prompt('Enter assigned engineer name:', record.assignedEngineerName || '');
      if (engineerName) {
        payload.assignedEngineerName = engineerName;
        payload.assignedEngineer = engineerName;
      }
    }
    if (nextStatus === 'Cancelled') {
      const reason = prompt('Enter cancellation reason:');
      if (reason === null) return;
      payload.note = reason || 'Cancelled by user';
    }

    transitionMut.mutate(payload);
  }, [id, record, status, transitionMut]);

  // ── Navigation helper ────────────────────────────────────
  const onNavigate = useCallback((path: string) => navigate(path), [navigate]);

  const onCaseClick = useCallback(() => {
    if (caseId) navigate(`/cases/${encodeURIComponent(caseId)}`);
  }, [caseId, navigate]);

  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = {};

  // ── Loading state ────────────────────────────────────────
  if (recordQuery.isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Loading Handover..." icon={<Handshake className="h-5 w-5" />} />
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
        <Handshake className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Handover not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {recordQuery.isError ? 'Failed to load handover record.' : 'This record does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/handovers')}>
          Back to Handovers
        </Button>
      </div>
    );
  }

  // ── Overview content ─────────────────────────────────────
  const overview = (
    <HandoverOverview
      record={record}
      project={project}
      projectSubsidyApps={projectSubsidyApps}
      projectNetMeteringApps={projectNetMeteringApps}
      projectCommissioningRecs={projectCommissioningRecs}
      projectAmcContracts={projectAmcContracts}
      status={status}
      onNavigate={onNavigate}
    />
  );

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={record.handoverNumber}
        icon={<Handshake className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate('/handovers')}>
            Handovers
          </Button>
        }
      />

      <WorkspaceShell
        header={{
          name: record.handoverNumber,
          status,
          entityId: id || '',
          caseId: caseId ?? undefined,
          onCaseClick,
          createdAt: record.createdAt,
          assignedTo: record.assignedEngineerName ? { name: record.assignedEngineerName } : undefined,
        }}
        tabs={{
          tabs: HANDOVER_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'handover',
            companyId: activeCompanyId || '',
            record: (record || {}) as unknown as Record<string, unknown>,
            permissions: { canView, canCreate, canEdit, canDelete: false },
            caseId: caseId ?? undefined,
          },
          overview,
          moduleTabContent,
        }}
      />
    </div>
  );
}
