/**
 * QCWorkspace — Phase 7C Quality Gate
 *
 * Full-page workspace for a single QC Check record.
 * Tabs (universal only):
 *   Overview | Tasks | Notes | Activity | Documents | History | Linked Records | Permissions | Disposable
 */

import { useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardCheck,
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
import { QC_TABS } from '../features/qc/utils/workspaceConfig';
import QCOverview from '../features/qc/components/QCOverview';
import type { QCRecord } from '../lib/qcWorkflow';
import { normalizeQCRecord } from '../lib/qcWorkflow';

// ── Main Component ─────────────────────────────────────────

export default function QCWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const qcQuery = useQuery({
    queryKey: [...qkeys.qcChecks, id],
    queryFn: () => getOne(COLLECTIONS.QC_CHECKS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const projectsQuery = useQuery({
    queryKey: qkeys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const installationsQuery = useQuery({
    queryKey: qkeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 60_000,
  });

  const qcRecord = qcQuery.data ? normalizeQCRecord(qcQuery.data as any) : null;
  const projects = (projectsQuery.data as any[]) || [];
  const installations = (installationsQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canEdit = perms.canEdit('qc') || perms.can('qc', 'approve');
  const canCreate = perms.canCreate('qc');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('qc', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const qc = qcRecord;
  const status = String(qc?.status || 'pending');
  const qcId = String(qc?.id || '—');
  const caseId = qc ? String((qc as any).caseId || '') : null;
  const project = useMemo(() => {
    if (!qc?.projectId) return null;
    return projects.find((p: any) => p.id === qc.projectId) || null;
  }, [qc, projects]);
  const installation = useMemo(() => {
    if (!qc?.installationId) return null;
    return installations.find((i: any) => i.id === qc.installationId) || null;
  }, [qc, installations]);

  const onCaseClick = useCallback(() => {
    if (caseId) navigate(`/cases/${encodeURIComponent(caseId)}`);
  }, [caseId, navigate]);

  // ── Module tab content (empty — no module-specific tabs) ─
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = {};

  // ── Overview section ──────────────────────────────────────
  const overview = (
    <QCOverview
      qc={qc}
      project={project}
      installation={installation}
    />
  );

  // ── Loading state ────────────────────────────────────────
  if (qcQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading QC Check..." icon={<ClipboardCheck className="h-5 w-5" />} />
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
  if (!qc || qcQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <ClipboardCheck className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">QC Check not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {qcQuery.isError ? 'Failed to load QC check details.' : 'This QC check does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/qc')}>
          Back to QC
        </Button>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={`QC Check ${qcId}`}
        icon={<ClipboardCheck className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/qc')}>QC Checks</Button>}
      />

      <WorkspaceShell
        header={{
          name: `QC Check ${qcId}`,
          status,
          entityId: id || '',
          caseId: caseId ?? undefined,
          onCaseClick,
          createdAt: qc.createdAt ? String(qc.createdAt) : undefined,
          assignedTo: qc.inspectorName ? { name: qc.inspectorName } : undefined,
        }}
        tabs={{
          tabs: QC_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'qc',
            companyId: activeCompanyId || '',
            record: (qc || {}) as unknown as Record<string, unknown>,
            permissions: { canView: true, canCreate, canEdit, canDelete: false },
            caseId: caseId ?? undefined,
          },
          overview,
          moduleTabContent,
        }}
      />
    </div>
  );
}
