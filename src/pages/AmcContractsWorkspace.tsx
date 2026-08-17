/**
 * AmcContractsWorkspace.tsx — AMC Contract Detail Workspace
 *
 * Phase 8A — 9 universal tabs, no quick actions, no module-specific tabs.
 * Status workflow: Draft → Active → Expired / Cancelled
 */

import { useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';

import { useAppStore } from '../store/useAppStore';
import { usePermissions } from '../lib/permissions';
import { queryKeys } from '../lib/queryKeys';
import { COLLECTIONS } from '../lib/firebase';
import { getAll } from '../lib/firestore';
import { useTransitionAmcContract } from '../features/amc/hooks/useAmcContracts';
import { AMC_TABS } from '../features/amc/utils/workspaceConfig';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import type { AmcContractRecord, AmcStatus } from '../lib/amcWorkflow';
import AmcOverview from '../features/amc/components/AmcOverview';

// ── Main Component ─────────────────────────────────────────

export default function AmcContractsWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const transitionMut = useTransitionAmcContract();

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('amc_contract', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Data ─────────────────────────────────────────────────
  const { data: contracts = [], isLoading } = useQuery({
    queryKey: qkeys.amcContractsAll,
    queryFn: () => getAll<AmcContractRecord>(COLLECTIONS.AMC_CONTRACTS),
    staleTime: 30_000,
  });

  const record = useMemo(() =>
    (contracts as AmcContractRecord[]).find((c) => c.id === id),
    [contracts, id],
  );

  const canEdit = perms.canEdit('projects');
  const canView = perms.canView('projects');
  const canCreate = perms.canCreate('projects');

  // ── Navigation helper ────────────────────────────────────
  const onNavigate = useCallback((path: string) => navigate(path), [navigate]);

  // ── Status transition handler ────────────────────────────
  function handleTransition(nextStatus: AmcStatus) {
    if (!record) return;
    let note: string | undefined;
    if (nextStatus === 'Cancelled') {
      const reason = prompt('Enter cancellation reason:');
      if (reason === null) return;
      note = reason || 'Cancelled by user';
    }
    if (nextStatus === 'Active') {
      toast.success('Activating contract...');
    }
    transitionMut.mutate({ contractId: record.id, nextStatus, note });
  }

  const onCaseClick = useCallback(() => {
    // AMC contracts don't have caseId navigation
  }, []);

  // ── Module tab content ───────────────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = {};

  // ── Loading state ────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Loading AMC Contract..." icon={<CalendarCheck className="h-5 w-5" />} />
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
  if (!record) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <CalendarCheck className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">AMC Contract Not Found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          This contract does not exist or has been deleted.
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/amc-contracts')}>
          Back to AMC Contracts
        </Button>
      </div>
    );
  }

  // ── Overview content ─────────────────────────────────────
  const overview = (
    <AmcOverview
      record={record}
      onNavigate={onNavigate}
    />
  );

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={record.contractNumber}
        icon={<CalendarCheck className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate('/amc-contracts')}>
            Contracts
          </Button>
        }
      />

      <WorkspaceShell
        header={{
          name: record.contractNumber,
          status: record.status,
          entityId: id || '',
          caseId: undefined,
          onCaseClick,
          createdAt: record.createdAt,
          assignedTo: record.assignedToName ? { name: record.assignedToName } : undefined,
        }}
        tabs={{
          tabs: AMC_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'amc_contract',
            companyId: activeCompanyId || '',
            record: (record || {}) as unknown as Record<string, unknown>,
            permissions: { canView, canCreate, canEdit, canDelete: false },
            caseId: undefined,
          },
          overview,
          moduleTabContent,
        }}
      />
    </div>
  );
}
