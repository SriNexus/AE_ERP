/**
 * ServiceTicketsWorkspace.tsx — Service Ticket Detail Workspace
 *
 * Phase 8B — 9 universal tabs, no quick actions, no module-specific tabs.
 * Status workflow: Open → InProgress → Resolved → Closed / Cancelled
 */

import { useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Wrench, ArrowLeft } from 'lucide-react';

import { useTransitionServiceTicket } from '../features/service-tickets/hooks/useServiceTickets';

import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { COLLECTIONS } from '../lib/firebase';
import { getAll } from '../lib/firestore';
import { SERVICE_TICKET_TABS } from '../features/service-tickets/utils/workspaceConfig';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import type { ServiceTicketRecord } from '../lib/serviceTicketWorkflow';
import ServiceOverview from '../features/service-tickets/components/ServiceOverview';

// ── Main Component ─────────────────────────────────────────

export default function ServiceTicketsWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const transitionMut = useTransitionServiceTicket();

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('service_ticket', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Data ─────────────────────────────────────────────────
  const { data: tickets = [], isLoading } = useQuery({
    queryKey: qkeys.serviceTicketsAll,
    queryFn: () => getAll<ServiceTicketRecord>(COLLECTIONS.SERVICE_TICKETS),
    staleTime: 30_000,
  });

  const record = useMemo(() =>
    (tickets as ServiceTicketRecord[]).find((t) => t.id === id),
    [tickets, id],
  );

  // ── Navigation helper ────────────────────────────────────
  const onNavigate = useCallback((path: string) => navigate(path), [navigate]);

  const onCaseClick = useCallback(() => {
    // Service tickets don't have caseId navigation
  }, []);

  // ── Module tab content ───────────────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = {};

  // ── Loading state ────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Loading Service Ticket..." icon={<Wrench className="h-5 w-5" />} />
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
        <Wrench className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Service Ticket Not Found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          This ticket does not exist or has been deleted.
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/service-tickets')}>
          Back to Service Tickets
        </Button>
      </div>
    );
  }

  // ── Overview content ─────────────────────────────────────
  const overview = (
    <ServiceOverview
      record={record}
      onNavigate={onNavigate}
    />
  );

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={record.ticketNumber}
        icon={<Wrench className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate('/service-tickets')}>
            Tickets
          </Button>
        }
      />

      <WorkspaceShell
        header={{
          name: record.ticketNumber,
          status: record.status,
          entityId: id || '',
          caseId: undefined,
          onCaseClick,
          createdAt: record.createdAt,
          assignedTo: record.assignedTechnicianName ? { name: record.assignedTechnicianName } : undefined,
        }}
        tabs={{
          tabs: SERVICE_TICKET_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'service_ticket',
            companyId: activeCompanyId || '',
            record: (record || {}) as unknown as Record<string, unknown>,
            permissions: { canView: true, canCreate: true, canEdit: true, canDelete: false },
            caseId: undefined,
          },
          overview,
          moduleTabContent,
        }}
      />
    </div>
  );
}
