/**
 * PartnerLeads — Partner Portal Lead Workspace
 *
 * Full production workspace for partners to view, search, filter, and manage
 * their own leads. Partners only see leads attributed to them via partnerId.
 *
 * Reuses: DataTable, FilterBar, Pagination, EmptyState, partnerCreateLead
 * No duplicated lead system — existing COLLECTIONS.LEADS is the source.
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useParams } from 'react-router-dom';
import {
  Target,
  Plus,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { PageShell } from '../../components/shared/PageShell';
import { EmptyState } from '../../components/shared/EmptyState';
import { FilterBar } from '../../components/ui/FilterBar';
import { Pagination } from '../../components/ui/Pagination';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../../components/ui/Table';
import { Button } from '../../components/ui/Button';
import { statusBadge } from '../../components/ui/Badge';
import { getAll } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { queryKeys } from '../../lib/queryKeys';
import { useAppStore } from '../../store/useAppStore';
import { usePartnerSelf } from '../../features/channel-partner/hooks/usePartnerSelf';
import { filterPartnerOwnedLeads } from '../../lib/partnerOwnership';
import type { ChannelPartner } from '../../features/channel-partner/types';
import {
  COMMISSION_STATUS_STYLES,
  COMMISSION_STATUS_LABELS,
  INSTALLATION_STATUS_STYLES,
  INSTALLATION_STATUS_LABELS,
  INSTALLATION_STATUSES,
  COMMISSION_STATUSES,
} from '../../features/channel-partner/types/leadIntegration';
import { PartnerCreateLeadModal } from '../../components/partner/PartnerCreateLeadModal';
import { PartnerLeadDetailDrawer } from '../../components/partner/PartnerLeadDetailDrawer';

const PER_PAGE = 10;
const ALL = 'All';

const PARTNER_DATE_RANGE_OPTIONS = [
  { label: 'All Time',   value: 'all' },
  { label: 'Today',      value: 'today' },
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Last 30 Days', value: '30d' },
  { label: 'Custom Range', value: 'custom' },
];

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatDate(value: any): string {
  if (!value) return '—';
  const date = toDateValue(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB');
}

function CommStatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-[var(--color-text-disabled)] text-xs">—</span>;
  const style = COMMISSION_STATUS_STYLES[status] || 'bg-gray-100 dark:bg-gray-800 text-gray-500';
  const label = COMMISSION_STATUS_LABELS[status as keyof typeof COMMISSION_STATUS_LABELS] || status.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

function InstStatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-[var(--color-text-disabled)] text-xs">—</span>;
  const style = INSTALLATION_STATUS_STYLES[status] || 'bg-gray-100 dark:bg-gray-800 text-gray-500';
  const label = INSTALLATION_STATUS_LABELS[status as keyof typeof INSTALLATION_STATUS_LABELS] || status.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

export default function PartnerLeads() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();

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

  // Partner-only filtered leads — canonical ownership contract (Phase 4)
  const partnerLeads = useMemo(
    () => filterPartnerOwnedLeads(allLeads, partner?.id),
    [allLeads, partner?.id],
  );

  // ── View state from URL params ────────────────────────
  const { id: pathLeadId } = useParams<{ id: string }>();
  const openParam = searchParams.get('view') || pathLeadId || '';
  const createParam = searchParams.get('create') || '';

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || ALL);
  const [sourceF, setSourceF] = useState(() => searchParams.get('source') || ALL);
  const [instStatusF, setInstStatusF] = useState(() => searchParams.get('inst') || ALL);
  const [commStatusF, setCommStatusF] = useState(() => searchParams.get('comm') || ALL);
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [sortKey, setSortKey] = useState('createdAt');
  const [sortDesc, setSortDesc] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [viewLead, setViewLead] = useState<any>(null);

  // Open create modal from URL param
  useEffect(() => {
    if (createParam === '1') setShowCreate(true);
  }, [createParam]);

  // Open lead detail from URL param
  useEffect(() => {
    if (openParam && partnerLeads.length > 0) {
      const target = partnerLeads.find((l: any) => l.id === openParam);
      if (target) setViewLead(target);
    }
  }, [openParam, partnerLeads]);

  // ── Source options (from partner leads) ────────────
  const sourceOptions = useMemo(() => {
    const sources = new Set(partnerLeads.map((l: any) => l.source).filter(Boolean));
    return [ALL, ...Array.from(sources)];
  }, [partnerLeads]);

  // ── Filtering ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...partnerLeads];

    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((l: any) =>
        [l.name, l.phone, l.email, l.city, l.state, l.source]
          .some((v: any) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (statusF !== ALL) list = list.filter((l: any) => l.status === statusF);
    if (sourceF !== ALL) list = list.filter((l: any) => l.source === sourceF);
    if (instStatusF !== ALL) list = list.filter((l: any) => (l.installationStatus || 'pending') === instStatusF);
    if (commStatusF !== ALL) list = list.filter((l: any) => (l.commissionStatus || 'not_eligible') === commStatusF);

    // Date range filter (uses createdAt)
    if (dateRange !== 'all') {
      list = list.filter((l: any) => {
        const d = toDateValue(l.createdAt);
        if (!d) return false;
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        if (dateRange === 'today') return d.getTime() === now.getTime();
        if (dateRange === '7d') return (now.getTime() - d.getTime()) <= 7 * 86400000;
        if (dateRange === '30d') return (now.getTime() - d.getTime()) <= 30 * 86400000;
        if (dateRange === 'custom' && customFrom && customTo) {
          const from = new Date(customFrom);
          const to = new Date(customTo);
          return d >= from && d <= to;
        }
        return true;
      });
    }

    list.sort((a: any, b: any) => {
      const av = String(a[sortKey] || '');
      const bv = String(b[sortKey] || '');
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDesc ? -cmp : cmp;
    });

    return list;
  }, [partnerLeads, search, statusF, sourceF, instStatusF, commStatusF, dateRange, customFrom, customTo, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Reset page when filters change
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  // ── URL sync ──────────────────────────────────────────
  function syncParams(updates: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([k, v]) => {
      if (v && v !== ALL && v !== 'all') next.set(k, v);
      else next.delete(k);
    });
    setSearchParams(next, { replace: true });
  }

  function clearAll() {
    setSearch('');
    setStatusF(ALL);
    setSourceF(ALL);
    setInstStatusF(ALL);
    setCommStatusF(ALL);
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
    setPage(1);
    setSearchParams({}, { replace: true });
  }

  function sort(k: string) {
    if (sortKey === k) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(true); }
  }

  // ── Filters summary for display ───────────────────────
  const hasActiveFilters = Boolean(
    search || statusF !== ALL || sourceF !== ALL || instStatusF !== ALL || commStatusF !== ALL
  );

  // ── Row click handler ─────────────────────────────────
  function handleRowClick(lead: any) {
    setViewLead(lead);
    syncParams({ view: lead.id });
  }

  function handleCloseDetail() {
    setViewLead(null);
    const next = new URLSearchParams(searchParams);
    next.delete('view');
    setSearchParams(next, { replace: true });
  }

  function handleCloseCreate() {
    setShowCreate(false);
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  }

  // ── Stats ─────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: partnerLeads.length,
    new: partnerLeads.filter((l: any) => l.status === 'New').length,
    active: partnerLeads.filter((l: any) => l.status !== 'Converted' && l.status !== 'Lost').length,
    converted: partnerLeads.filter((l: any) => l.status === 'Converted').length,
  }), [partnerLeads]);

  const loading = partnersLoading || leadsLoading;

  return (
    <PageShell
      title="My Leads"
      subtitle="Track and manage your solar installation leads"
      icon={<Target className="h-5 w-5" />}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
            Refresh
          </Button>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
            Create Lead
          </Button>
        </div>
      }
    >
      {/* ── KPI row ───────────────────────────────────────── */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {[
          { label: 'TOTAL', value: stats.total, color: 'border-l-[var(--color-border-strong)]' },
          { label: 'ACTIVE', value: stats.active, color: 'border-l-blue-500' },
          { label: 'NEW', value: stats.new, color: 'border-l-amber-500' },
          { label: 'CONVERTED', value: stats.converted, color: 'border-l-emerald-500' },
        ].map((k) => (
          <div
            key={k.label}
            className={`bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] border-l-4 ${k.color} px-3 py-2.5 shadow-[var(--shadow-enterprise-kpi)]`}
          >
            <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">{k.label}</p>
            <p className="text-2xl font-extrabold text-[var(--color-text)] tabular-nums leading-tight">
              {loading ? '—' : k.value}
            </p>
          </div>
        ))}
      </div>

      {/* ── FilterBar ─────────────────────────────────────── */}
      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); syncParams({ q: v, page: page > 1 ? String(page) : '' }); }}
        searchPlaceholder="Search name, phone, email, city..."
        dateRange={dateRange}
        onDateRange={(v) => { setDateRange(v); setPage(1); syncParams({ date: v, page: page > 1 ? String(page) : '' }); }}
        dateRangeOptions={PARTNER_DATE_RANGE_OPTIONS}
        customFrom={customFrom}
        customTo={customTo}
        onCustomRange={(f, t) => { setCustomFrom(f); setCustomTo(t); setPage(1); syncParams({ from: f, to: t, page: page > 1 ? String(page) : '' }); }}
        filters={[
          {
            label: 'Status',
            value: statusF,
            onChange: (v) => { setStatusF(v); setPage(1); },
            options: [ALL, 'New', 'Follow-up', 'Qualified', 'Converted', 'Lost'].map((s) => ({ label: s, value: s })),
          },
          {
            label: 'Source',
            value: sourceF,
            onChange: (v) => { setSourceF(v); setPage(1); },
            options: sourceOptions.map((s) => ({ label: s, value: s })),
          },
          {
            label: 'Installation',
            value: instStatusF,
            onChange: (v) => { setInstStatusF(v); setPage(1); },
            options: [ALL, ...INSTALLATION_STATUSES].map((s) => ({
              label: INSTALLATION_STATUS_LABELS[s as keyof typeof INSTALLATION_STATUS_LABELS] || s.replace(/_/g, ' '),
              value: s,
            })),
          },
          {
            label: 'Commission',
            value: commStatusF,
            onChange: (v) => { setCommStatusF(v); setPage(1); },
            options: [ALL, ...COMMISSION_STATUSES].map((s) => ({
              label: COMMISSION_STATUS_LABELS[s as keyof typeof COMMISSION_STATUS_LABELS] || s.replace(/_/g, ' '),
              value: s,
            })),
          },
        ]}
        count={filtered.length}
        total={partnerLeads.length}
        label="leads"
        onClearAll={clearAll}
      />

      {/* ── Data Table ────────────────────────────────────── */}
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] overflow-hidden">
        <div className="min-h-0 overflow-x-auto">
          <Table>
            <Thead>
              <Th sortable sorted={sortKey === 'name'} desc={sortDesc} onSort={() => sort('name')}>LEAD</Th>
              <Th>SOURCE</Th>
              <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')}>STATUS</Th>
              <Th className="hidden md:table-cell">INSTALLATION</Th>
              <Th className="hidden sm:table-cell">COMMISSION</Th>
              <Th sortable sorted={sortKey === 'createdAt'} desc={sortDesc} onSort={() => sort('createdAt')}>CREATED</Th>
              <Th sortable sorted={sortKey === 'updatedAt'} desc={sortDesc} onSort={() => sort('updatedAt')}>UPDATED</Th>
              <Th className="w-20">ACTIONS</Th>
            </Thead>
            <Tbody>
              {loading ? (
                <SkeletonRows cols={8} />
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    {!partner ? (
                      <EmptyState
                        icon={<Target className="h-8 w-8" />}
                        title="No Partner Profile"
                        description="Your account isn't linked to a partner profile. Contact your administrator."
                      />
                    ) : hasActiveFilters ? (
                      <EmptyState
                        icon={<Target className="h-8 w-8" />}
                        title="No matching leads"
                        description="Try adjusting your search or filters."
                      />
                    ) : (
                      <EmptyState
                        icon={<Target className="h-8 w-8" />}
                        title="No Leads Yet"
                        description="Create your first lead to start tracking installations and commissions."
                        action={
                          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
                            Create Your First Lead
                          </Button>
                        }
                      />
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map((lead: any) => (
                  <Tr
                    key={lead.id}
                    onClick={() => handleRowClick(lead)}
                    className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-enterprise-row)]"
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center text-xs font-bold shrink-0">
                          {(lead.name || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-[var(--color-text)] text-sm leading-tight">
                            {lead.name || '—'}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {lead.phone || ''}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-xs text-[var(--color-text-muted)]">{lead.source || '—'}</Td>
                    <Td>{statusBadge(lead.status || 'New')}</Td>
                    <Td className="hidden md:table-cell">
                      <InstStatusBadge status={lead.installationStatus} />
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <CommStatusBadge status={lead.commissionStatus} />
                    </Td>
                    <Td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          (() => {
                            const d = toDateValue(lead.createdAt);
                            if (!d) return 'bg-gray-300';
                            const days = Math.floor((Date.now() - d.getTime()) / 86400000);
                            if (days === 0) return 'bg-emerald-500';
                            if (days <= 7) return 'bg-blue-500';
                            if (days <= 30) return 'bg-amber-500';
                            return 'bg-red-500';
                          })()
                        }`} />
                        {formatDate(lead.createdAt)}
                      </span>
                    </Td>
                    <Td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {formatDate(lead.updatedAt || lead.createdAt)}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end opacity-75 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRowClick(lead); }}
                          className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-sm transition-all hover:-translate-y-0.5 hover:opacity-90"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      </div>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </div>

        {filtered.length > PER_PAGE && (
          <Pagination
            page={page}
            total={filtered.length}
            perPage={PER_PAGE}
            onChange={(p) => { setPage(p); syncParams({ page: p > 1 ? String(p) : '' }); }}
          />
        )}
      </div>

      {/* ── Create Lead Modal ──────────────────────────────── */}
      <PartnerCreateLeadModal
        open={showCreate}
        onClose={handleCloseCreate}
        partner={partner}
      />

      {/* ── Lead Detail Drawer ─────────────────────────────── */}
      <PartnerLeadDetailDrawer
        lead={viewLead}
        open={!!viewLead}
        onClose={handleCloseDetail}
      />
    </PageShell>
  );
}
