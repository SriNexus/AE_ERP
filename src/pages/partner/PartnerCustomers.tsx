/**
 * PartnerCustomers — Partner Portal Customers Workspace
 *
 * Partners view, search, and manage their OWN customers (partnerId = partner
 * DOC id via the Phase 3 ownership chain Lead → Customer). Creation goes
 * through the canonical createCustomerProjection/useSaveCustomer path, which
 * auto-stamps partnerId from the authenticated partner link — the UI can
 * never supply another partner's id.
 *
 * Reuses: useCustomers, useSaveCustomer, DataTable, FilterBar, Pagination.
 * No duplicated customer system — COLLECTIONS.CUSTOMERS is the source.
 */

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { Users, Plus, RefreshCw, Eye } from 'lucide-react';
import { PageShell } from '../../components/shared/PageShell';
import { EmptyState } from '../../components/shared/EmptyState';
import { FilterBar } from '../../components/ui/FilterBar';
import { Pagination } from '../../components/ui/Pagination';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../../components/ui/Table';
import { Button } from '../../components/ui/Button';
import { useAppStore } from '../../store/useAppStore';
import { useCustomers } from '../../features/customers/hooks/useCustomers';
import { usePartnerSelf } from '../../features/channel-partner/hooks/usePartnerSelf';
import { filterPartnerOwnedCustomers } from '../../lib/partnerOwnership';
import type { ChannelPartner } from '../../features/channel-partner/types';
import { PartnerCreateCustomerModal } from '../../components/partner/PartnerCreateCustomerModal';
import { PartnerCustomerDetailDrawer } from '../../components/partner/PartnerCustomerDetailDrawer';

const PER_PAGE = 10;
const ALL = 'All';

function formatDate(value: any): string {
  if (!value) return '—';
  const date = typeof value === 'object' && typeof value.toDate === 'function'
    ? value.toDate()
    : typeof value === 'object' && value.seconds
      ? new Date(value.seconds * 1000)
      : new Date(value);
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB');
}

function TypeBadge({ type }: { type?: string }) {
  const isB2B = type === 'B2B';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
      isB2B ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
    }`}>
      {type || '—'}
    </span>
  );
}

export default function PartnerCustomers() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();
  const { id: pathCustomerId } = useParams<{ id: string }>();

  // ── Partner profile ───────────────────────────────────
  const { data: partnerSelf, isLoading: partnersLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Data ──────────────────────────────────────────────
  const { data: allCustomers = [], isLoading: customersLoading, refetch, loadMore, hasMore, loadingMore } = useCustomers();

  const partnerCustomers = useMemo(
    () => filterPartnerOwnedCustomers(allCustomers, partner?.id),
    [allCustomers, partner?.id],
  );

  // ── View state from URL params ────────────────────────
  const openParam = searchParams.get('view') || pathCustomerId || '';
  const createParam = searchParams.get('create') || '';

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [typeF, setTypeF] = useState(() => searchParams.get('type') || ALL);
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [showCreate, setShowCreate] = useState(false);
  const [viewCustomer, setViewCustomer] = useState<any>(null);

  useEffect(() => {
    if (createParam === '1') setShowCreate(true);
  }, [createParam]);

  useEffect(() => {
    if (openParam && partnerCustomers.length > 0) {
      const target = partnerCustomers.find((c: any) => c.id === openParam);
      if (target) setViewCustomer(target);
    }
  }, [openParam, partnerCustomers]);

  // ── Filtering ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...partnerCustomers];
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((c: any) =>
        [c.name, c.phone, c.email, c.company, c.city, c.state]
          .some((v: any) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (typeF !== ALL) list = list.filter((c: any) => c.type === typeF);
    list.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return list;
  }, [partnerCustomers, search, typeF]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

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
    setTypeF(ALL);
    setPage(1);
    setSearchParams({}, { replace: true });
  }

  function handleRowClick(customer: any) {
    setViewCustomer(customer);
    syncParams({ view: customer.id });
  }

  function handleCloseDetail() {
    setViewCustomer(null);
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
    total: partnerCustomers.length,
    b2c: partnerCustomers.filter((c: any) => c.type === 'B2C').length,
    b2b: partnerCustomers.filter((c: any) => c.type === 'B2B').length,
    converted: partnerCustomers.filter((c: any) => c.sourceLeadId).length,
  }), [partnerCustomers]);

  const loading = partnersLoading || customersLoading;
  const hasActiveFilters = Boolean(search || typeF !== ALL);

  return (
    <PageShell
      title="My Customers"
      subtitle="Customers you have converted from your leads"
      icon={<Users className="h-5 w-5" />}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
            Refresh
          </Button>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
            Add Customer
          </Button>
        </div>
      }
    >
      {/* ── KPI row ───────────────────────────────────────── */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {[
          { label: 'TOTAL', value: stats.total, color: 'border-l-[var(--color-border-strong)]' },
          { label: 'B2C', value: stats.b2c, color: 'border-l-emerald-500' },
          { label: 'B2B', value: stats.b2b, color: 'border-l-purple-500' },
          { label: 'FROM LEADS', value: stats.converted, color: 'border-l-blue-500' },
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
        searchPlaceholder="Search name, phone, email, company, city..."
        filters={[
          {
            label: 'Type',
            value: typeF,
            onChange: (v) => { setTypeF(v); setPage(1); },
            options: [ALL, 'B2B', 'B2C'].map((s) => ({ label: s, value: s })),
          },
        ]}
        count={filtered.length}
        total={partnerCustomers.length}
        label="customers"
        onClearAll={clearAll}
      />

      {/* ── Data Table ────────────────────────────────────── */}
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] overflow-hidden">
        <div className="min-h-0 overflow-x-auto">
          <Table>
            <Thead>
              <Th>CUSTOMER</Th>
              <Th>TYPE</Th>
              <Th className="hidden md:table-cell">COMPANY</Th>
              <Th className="hidden sm:table-cell">CITY</Th>
              <Th>CREATED</Th>
              <Th className="w-20">ACTIONS</Th>
            </Thead>
            <Tbody>
              {loading ? (
                <SkeletonRows cols={6} />
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    {!partner ? (
                      <EmptyState
                        icon={<Users className="h-8 w-8" />}
                        title="No Partner Profile"
                        description="Your account isn't linked to a partner profile. Contact your administrator."
                      />
                    ) : hasActiveFilters ? (
                      <EmptyState
                        icon={<Users className="h-8 w-8" />}
                        title="No matching customers"
                        description="Try adjusting your search or filters."
                      />
                    ) : (
                      <EmptyState
                        icon={<Users className="h-8 w-8" />}
                        title="No Customers Yet"
                        description="Convert one of your leads to a customer to get started."
                      />
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map((customer: any) => (
                  <Tr
                    key={customer.id}
                    onClick={() => handleRowClick(customer)}
                    className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-enterprise-row)]"
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center text-xs font-bold shrink-0">
                          {(customer.name || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-[var(--color-text)] text-sm leading-tight">
                            {customer.name || '—'}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">{customer.phone || ''}</p>
                        </div>
                      </div>
                    </Td>
                    <Td><TypeBadge type={customer.type} /></Td>
                    <Td className="hidden md:table-cell text-xs text-[var(--color-text-muted)]">
                      {customer.company || '—'}
                    </Td>
                    <Td className="hidden sm:table-cell text-xs text-[var(--color-text-muted)]">
                      {[customer.city, customer.state].filter(Boolean).join(', ') || '—'}
                    </Td>
                    <Td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {formatDate(customer.createdAt)}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end opacity-75 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRowClick(customer); }}
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

        {hasMore && (
          <div className="p-3 text-center">
            <Button variant="outline" size="sm" onClick={() => loadMore()} loading={loadingMore}>
              Load more
            </Button>
          </div>
        )}
      </div>

      {/* ── Create Customer Modal ─────────────────────────── */}
      <PartnerCreateCustomerModal
        open={showCreate}
        onClose={handleCloseCreate}
        partner={partner}
      />

      {/* ── Customer Detail Drawer ────────────────────────── */}
      <PartnerCustomerDetailDrawer
        customer={viewCustomer}
        open={!!viewCustomer}
        onClose={handleCloseDetail}
      />
    </PageShell>
  );
}
