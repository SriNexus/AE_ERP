/**
 * PartnerMobileLeadsWorkspace — Mobile Partner Lead Workspace
 *
 * Partner-specific mobile workspace for viewing and managing leads.
 * Desktop remains the source architecture — shares the same hooks/data layer.
 *
 * Uses: MobileLeadCard pattern, PartnerCreateLeadModal, PartnerLeadDetailDrawer
 * Partner-only filtering via partnerId.
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Target, Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, Button, Pagination, statusBadge } from '../../ui';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePartnerSelf } from '../../../features/channel-partner/hooks/usePartnerSelf';
import { filterPartnerOwnedLeads } from '../../../lib/partnerOwnership';
import type { ChannelPartner } from '../../../features/channel-partner/types';
import { PartnerCreateLeadModal } from '../../partner/PartnerCreateLeadModal';
import { PartnerLeadDetailDrawer } from '../../partner/PartnerLeadDetailDrawer';
import { cn } from '../../../utils/cn';

const PER_PAGE = 10;

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function isOverdue(next_date: any): boolean {
  const date = toDateValue(next_date);
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function LeadSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-8 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

export function PartnerMobileLeadsWorkspace() {
  const navigate = useNavigate();
  const { id: pathLeadId } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);

  // ── Partner profile ───────────────────────────────────
  const { data: partnerSelf, isLoading: partnersLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Data ──────────────────────────────────────────────
  const { data: allLeads = [], isLoading: leadsLoading, refetch } = useQuery({
    queryKey: companyKeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerLeads = useMemo(
    () => filterPartnerOwnedLeads(allLeads, partner?.id),
    [allLeads, partner?.id],
  );

  // ── State ─────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [viewLead, setViewLead] = useState<any>(null);

  // Auto-open lead detail from path param (e.g. /partner/leads/lead123)
  useEffect(() => {
    if (pathLeadId && partnerLeads.length > 0) {
      const target = partnerLeads.find((l: any) => l.id === pathLeadId);
      if (target) setViewLead(target);
    }
  }, [pathLeadId, partnerLeads]);

  const paginated = useMemo(
    () => [...partnerLeads]
      .sort((a: any, b: any) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
      })
      .slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [partnerLeads, page],
  );

  const loading = partnersLoading || leadsLoading;

  return (
    <div className="space-y-4 pb-4 pt-2">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">My Leads</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-bold text-white shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" /> Create
          </button>
        </div>
      </div>

      {/* ── Partner status ──────────────────────────────── */}
      {!loading && !partner && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-center">
          <Target className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
          <p className="mt-2 text-sm font-semibold text-[var(--color-text)]">No Partner Profile</p>
          <p className="text-xs text-[var(--color-text-muted)]">Contact your administrator.</p>
        </div>
      )}

      {/* ── Lead Cards ───────────────────────────────────── */}
      <div className="space-y-3">
        {loading && Array.from({ length: 4 }).map((_, i) => <LeadSkeletonCard key={i} />)}

        {!loading && partner && paginated.length === 0 && (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
            <Target className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
            <p className="mt-2 text-sm font-semibold text-[var(--color-text)]">No Leads Yet</p>
            <p className="text-xs text-[var(--color-text-muted)]">Create your first lead to get started.</p>
          </div>
        )}

        {!loading && paginated.map((lead: any) => (
          <Card
            key={lead.id}
            className={cn(
              'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-all',
              'hover:shadow-[var(--shadow-enterprise-row)] active:scale-[0.99]',
              isOverdue(lead.next_date) && 'border-l-4 border-l-red-500',
            )}
          >
            <button
              type="button"
              onClick={() => setViewLead(lead)}
              className="w-full text-left"
            >
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
                  {(lead.name || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-[var(--color-text)]">
                    {lead.name || 'Untitled Lead'}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                    {[lead.city, lead.state].filter(Boolean).join(', ') || lead.phone || '—'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {statusBadge(lead.status || 'New')}
                    {lead.source && (
                      <span className="rounded-full bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
                        {lead.source}
                      </span>
                    )}
                  </div>
                  {/* Partner workflow status */}
                  {(lead.installationStatus || lead.commissionStatus) && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {lead.installationStatus && (
                        <span className="rounded-full bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                          {lead.installationStatus.replace(/_/g, ' ')}
                        </span>
                      )}
                      {lead.commissionStatus && (
                        <span className="rounded-full bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          {lead.commissionStatus.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
                    {lead.createdAt
                      ? `${Math.max(0, Math.floor((Date.now() - new Date(lead.createdAt || Date.now()).getTime()) / 86400000))}d`
                      : '—'}
                  </span>
                </div>
              </div>
            </button>
          </Card>
        ))}
      </div>

      {/* ── Pagination ──────────────────────────────────── */}
      {partnerLeads.length > PER_PAGE && (
        <Pagination
          page={page}
          total={partnerLeads.length}
          perPage={PER_PAGE}
          onChange={setPage}
        />
      )}

      {/* ── Inline Create Button (bottom) ──────────────── */}
      {partner && partnerLeads.length > 0 && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)] transition-all active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" /> Create New Lead
        </button>
      )}

      {/* ── Create Lead Modal ─────────────────────────────── */}
      <PartnerCreateLeadModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        partner={partner}
      />

      {/* ── Lead Detail Drawer ─────────────────────────────── */}
      <PartnerLeadDetailDrawer
        lead={viewLead}
        open={!!viewLead}
        onClose={() => setViewLead(null)}
      />
    </div>
  );
}

export default PartnerMobileLeadsWorkspace;
