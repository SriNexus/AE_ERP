/**
 * CommissioningWorkspace — Phase 7D System Energization
 *
 * Full-page workspace for a single Commissioning Record.
 * Tabs (universal only):
 *   Overview | Tasks | Notes | Activity | Documents | History | Linked Records | Permissions | Disposable
 *
 * Commissioning records are IMMUTABLE — created as a single sign-off action.
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
import { COMMISSIONING_TABS } from '../features/commissioning/utils/workspaceConfig';
import CommissioningOverview from '../features/commissioning/components/CommissioningOverview';
import type { CommissioningRecord } from '../lib/commissioningWorkflow';

// ── Main Component ─────────────────────────────────────────

export default function CommissioningWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const recordQuery = useQuery({
    queryKey: [...qkeys.commissioningRecords, id],
    queryFn: () => getOne(COLLECTIONS.COMMISSIONING_RECORDS, id || ''),
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

  const commissioningRecord = recordQuery.data as CommissioningRecord | null;
  const projects = (projectsQuery.data as any[]) || [];
  const netMetering = (netMeteringQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canView = perms.canView('commissioning');
  const canCreate = perms.canCreate('commissioning');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('commissioning', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const record = commissioningRecord;
  const isCompleted = Boolean(record?.isCompleted);
  const recordId = String(record?.id || '—');

  const project = useMemo(() => {
    if (!record?.projectId) return null;
    return projects.find((p: any) => p.id === record.projectId || p.projectId === record.projectId) || null;
  }, [record, projects]);

  const netMeteringRecords = useMemo(() => {
    if (!record?.projectId) return [];
    return netMetering.filter((nm: any) => nm.projectId === record.projectId);
  }, [record, netMetering]);

  const caseId = project?.caseId ? String(project.caseId) : record ? String((record as any).caseId || '') : null;

  const onCaseClick = useCallback(() => {
    if (caseId) navigate(`/cases/${encodeURIComponent(caseId)}`);
  }, [caseId, navigate]);

  // ── Module tab content (empty) ───────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = {};

  // ── Overview section ─────────────────────────────────────
  const overview = (
    <CommissioningOverview
      record={record}
      project={project}
      netMeteringRecords={netMeteringRecords}
    />
  );

  // ── Loading state ────────────────────────────────────────
  if (recordQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Commissioning Record..." icon={<Zap className="h-5 w-5" />} />
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
        <h2 className="mt-4 text-lg font-semibold">Commissioning Record not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {recordQuery.isError ? 'Failed to load commissioning record.' : 'This record does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/commissioning')}>
          Back to Commissioning
        </Button>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={`Commissioning ${recordId}`}
        icon={<Zap className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/commissioning')}>Commissioning</Button>}
      />

      <WorkspaceShell
        header={{
          name: `Commissioning ${recordId}`,
          status: isCompleted ? 'Completed' : 'Pending',
          entityId: id || '',
          caseId: caseId ?? undefined,
          onCaseClick,
          createdAt: record.createdAt,
          assignedTo: record.commissionedByName ? { name: record.commissionedByName } : undefined,
        }}
        tabs={{
          tabs: COMMISSIONING_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'commissioning',
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
