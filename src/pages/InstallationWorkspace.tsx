/**
 * InstallationWorkspace — Phase 7B Field Execution Center
 *
 * Full-page workspace for a single Installation record.
 * Installation records live in the `leads` collection filtered by `installationStatus`.
 *
 * Tabs (universal only):
 *   Overview | Tasks | Notes | Activity | Documents | History | Linked Records | Permissions | Disposable
 */

import { useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  HardHat,
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
import { INSTALLATION_TABS } from '../features/installations/utils/workspaceConfig';
import InstallationOverview from '../features/installations/components/InstallationOverview';


// ── Main Component ─────────────────────────────────────────

export default function InstallationWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const leadQuery = useQuery({
    queryKey: [...qkeys.leadsRoot, id],
    queryFn: () => getOne(COLLECTIONS.LEADS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const projectsQuery = useQuery({
    queryKey: qkeys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const partnersQuery = useQuery({
    queryKey: ['channel_partners_dropdown', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 60_000,
    enabled: Boolean(activeCompanyId),
  });

  const lead = leadQuery.data as any;
  const projects = (projectsQuery.data as any[]) || [];
  const partners = (partnersQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canEdit = perms.canEdit('installations');
  const canCreate = perms.canCreate('installations');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('installations', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const installationStatus = String(lead?.installationStatus || '');
  const caseId = lead?.caseId ? String(lead.caseId) : null;
  const linkedProject = useMemo(() => {
    if (!lead?.projectId) return null;
    return projects.find((p: any) => p.id === lead.projectId || p.projectId === lead.projectId) || null;
  }, [lead, projects]);

  const onCaseClick = useCallback(() => {
    if (caseId) navigate(`/cases/${encodeURIComponent(caseId)}`);
  }, [caseId, navigate]);

  // ── Module tab content (empty — no module-specific tabs) ─
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = useMemo(() => ({}), []);

  // ── Overview section ──────────────────────────────────────
  const overview = (
    <InstallationOverview
      installation={lead || {}}
      linkedProject={linkedProject}
      partners={partners}
      projects={projects}
    />
  );

  // ── Loading state ────────────────────────────────────────
  if (leadQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Installation..." icon={<HardHat className="h-5 w-5" />} />
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
  if (!lead || leadQuery.isError || !lead.installationStatus) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <HardHat className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Installation not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {leadQuery.isError ? 'Failed to load installation details.' : 'This installation record does not exist or has not progressed to an installation stage.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/installations')}>
          Back to Installations
        </Button>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={`${lead?.name || 'Installation'}`}
        icon={<HardHat className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/installations')}>Installations</Button>}
      />

      <WorkspaceShell
        header={{
          name: lead?.name || 'Installation',
          status: installationStatus,
          entityId: id || '',
          caseId: caseId ?? undefined,
          onCaseClick,
          createdAt: lead?.createdAt ? String(lead.createdAt) : undefined,
          assignedTo: lead?.assignedEngineerName ? { name: String(lead.assignedEngineerName) } : undefined,
        }}
        tabs={{
          tabs: INSTALLATION_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'installations',
            companyId: activeCompanyId || '',
            record: lead as Record<string, unknown>,
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
