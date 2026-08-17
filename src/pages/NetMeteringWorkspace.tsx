/**
 * NetMeteringWorkspace — Phase 7E Government Integration
 *
 * Full-page workspace for a single Net Metering Application.
 * Tabs (universal only):
 *   Overview | Tasks | Notes | Activity | Documents | History | Linked Records | Permissions | Disposable
 */

import { useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Zap,
  ArrowLeft,
} from 'lucide-react';
import { getOne, getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import { NET_METERING_TABS } from '../features/net-metering/utils/workspaceConfig';
import NetMeteringOverview from '../features/net-metering/components/NetMeteringOverview';
import type { NetMeteringApplication } from '../lib/netMeteringWorkflow';

// ── Main Component ─────────────────────────────────────────

export default function NetMeteringWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const recordQuery = useQuery({
    queryKey: [...qkeys.netMetering, id],
    queryFn: () => getOne(COLLECTIONS.NET_METERING_APPLICATIONS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const projectsQuery = useQuery({
    queryKey: qkeys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const commissioningQuery = useQuery({
    queryKey: qkeys.commissioningRecordsAll,
    queryFn: () => getAll(COLLECTIONS.COMMISSIONING_RECORDS),
    staleTime: 60_000,
  });

  const subsidyQuery = useQuery({
    queryKey: qkeys.subsidyAll,
    queryFn: () => getAll(COLLECTIONS.SUBSIDY_APPLICATIONS),
    staleTime: 60_000,
  });

  const record = recordQuery.data as NetMeteringApplication | null;
  const projects = (projectsQuery.data as any[]) || [];
  const commissioningRecords = (commissioningQuery.data as any[]) || [];
  const subsidyApps = (subsidyQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canView = perms.canView('net_metering');
  const canCreate = perms.canCreate('net_metering');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('net-metering', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const project = useMemo(() => {
    if (!record?.projectId) return null;
    return projects.find((p: any) => p.id === record.projectId || p.projectId === record.projectId) || null;
  }, [record, projects]);

  const projectCommissioningRecords = useMemo(() => {
    if (!record?.projectId) return [];
    return commissioningRecords.filter((cr: any) => cr.projectId === record.projectId);
  }, [record, commissioningRecords]);

  const projectSubsidyApps = useMemo(() => {
    if (!record?.projectId) return [];
    return subsidyApps.filter((sa: any) => sa.projectId === record.projectId);
  }, [record, subsidyApps]);

  const caseId = project?.caseId ? String(project.caseId) : record ? String((record as any).caseId || '') : null;

  const onCaseClick = useCallback(() => {
    if (caseId) navigate(`/cases/${encodeURIComponent(caseId)}`);
  }, [caseId, navigate]);

  // ── Module tab content (empty) ───────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = {};

  // ── Overview section ─────────────────────────────────────
  const overview = (
    <NetMeteringOverview
      record={record}
      project={project}
      commissioningRecords={projectCommissioningRecords}
      subsidyApps={projectSubsidyApps}
    />
  );

  // ── Loading state ────────────────────────────────────────
  if (recordQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Net Metering Application..." icon={<Zap className="h-5 w-5" />} />
        <div className="flex-1 p-6 space-y-4">
          <div className="h-8 w-64 bg-[var(--color-bg-sunken)] rounded-md animate-pulse" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => (
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
        <Zap className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Net Metering Application not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {recordQuery.isError ? 'Failed to load net metering application.' : 'This application does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/net-metering')}>
          Back to Net Metering
        </Button>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={`Net Metering — ${record.applicationNumber || record.id}`}
        icon={<Zap className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/net-metering')}>Net Metering</Button>}
      />

      <WorkspaceShell
        header={{
          name: `NM ${record.applicationNumber || record.id}`,
          status: record.status,
          entityId: id || '',
          caseId: caseId ?? undefined,
          onCaseClick,
          createdAt: record.createdAt,
          assignedTo: record.discomName ? { name: record.discomName } : undefined,
        }}
        tabs={{
          tabs: NET_METERING_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'net_metering',
            companyId: activeCompanyId || '',
            record: (record || {}) as unknown as Record<string, unknown>,
            permissions: { canView, canCreate, canEdit: false, canDelete: false },
            caseId: caseId ?? undefined,
          },
          overview,
          moduleTabContent,
        }}
      />
    </div>
  );
}
