import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ReceiptText, RefreshCw, Plus, Download, Search } from 'lucide-react';
import {
  WorkspaceHero, PremiumKpi, Select as UiSelect,
} from '../components/ui';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { COLLECTIONS } from '../lib/firebase';
import { getAll } from '../lib/firestore';
import { isInDateRange } from '../lib/dateFilters';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { usePermissions } from '../lib/permissions';
import type { Order, Product, ProformaInvoice } from '../types';
import type { TaxInvoiceFormState, TaxInvoiceRecord } from '../features/tax-invoices/types';
import {
  buildTaxInvoiceDraftFromOrder,
  buildTaxInvoiceDraftFromProformaInvoice,
  buildTaxInvoiceFormFromRecord,
  createEmptyTaxInvoiceForm,
} from '../features/tax-invoices/utils';
import {
  TaxInvoiceDetailModal,
  TaxInvoiceEditorModal,
  TaxInvoiceWorkspacePanel,
} from '../features/tax-invoices/components/TaxInvoiceWorkspaceParts';
import {
  useCancelTaxInvoice,
  useIssueTaxInvoice,
  useSaveTaxInvoiceDraft,
  useTaxInvoices,
} from '../features/tax-invoices/hooks/useTaxInvoices';
import toast from 'react-hot-toast';

const PER_PAGE = 10;

export default function TaxInvoicesWorkspace() {
  const { company } = useAppStore();
  const perms = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get('open') || '';

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<TaxInvoiceFormState>(() => createEmptyTaxInvoiceForm(company));
  const [viewItem, setViewItem] = useState<TaxInvoiceRecord | null>(null);

  const { data: invoices = [], isLoading, refetch } = useTaxInvoices();
  const { data: orders = [] } = useQuery({
    queryKey: queryKeys.forCompany(company.id).ordersAll,
    queryFn: () => getAll<Order>(COLLECTIONS.ORDERS),
    staleTime: 60_000,
  });
  const { data: proformaInvoices = [] } = useQuery({
    queryKey: queryKeys.forCompany(company.id).invoices,
    queryFn: () => getAll<ProformaInvoice>(COLLECTIONS.PROFORMA_INVOICES),
    staleTime: 60_000,
  });
  const { data: products = [] } = useQuery({
    queryKey: queryKeys.forCompany(company.id).productsAll,
    queryFn: () => getAll<Product>(COLLECTIONS.PRODUCTS),
    staleTime: 60_000,
  });
  const { data: customers = [] } = useQuery({
    queryKey: queryKeys.forCompany(company.id).customersAll,
    queryFn: () => getAll<any>(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });

  const canCreate = perms.canCreate('tax_invoices');
  const canEdit = perms.canEdit('tax_invoices');
  const canCancel = perms.canCancel('tax_invoices');

  // ── URL Sync ──
  function syncParams(nextState: {
    q?: string; status?: string; date?: string; from?: string; to?: string;
    kpi?: string; page?: number; perPage?: number;
  }) {
    const next = new URLSearchParams(searchParams);
    const q = nextState.q ?? search;
    const status = nextState.status ?? statusFilter;
    const date = nextState.date ?? dateRange;
    const from = nextState.from ?? customFrom;
    const to = nextState.to ?? customTo;
    const kpi = nextState.kpi ?? activeKpi;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (status) next.set('status', status); else next.delete('status');
    if (date && date !== 'all') next.set('date', date); else next.delete('date');
    if (from) next.set('from', from); else next.delete('from');
    if (to) next.set('to', to); else next.delete('to');
    if (kpi) next.set('kpi', kpi); else next.delete('kpi');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== PER_PAGE) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    setSearchParams(next, { replace: true });
  }

  // ── Stats ──
  const stats = useMemo(() => {
    const list = (invoices || []) as TaxInvoiceRecord[];
    const totalAmount = list.reduce((s, i) => s + (i.total || 0), 0);
    const issuedAmount = list.filter((i) => i.status === 'Issued').reduce((s, i) => s + (i.total || 0), 0);
    return {
      total: list.length,
      draft: list.filter((i) => i.status === 'Draft').length,
      issued: list.filter((i) => i.status === 'Issued').length,
      cancelled: list.filter((i) => i.status === 'Cancelled').length,
      totalAmount,
      issuedAmount,
    };
  }, [invoices]);

  const KPI_TILES = [
    { key: '', label: 'TOTAL', value: stats.total, icon: <ReceiptText className="h-4 w-4" />, desc: `${stats.issued} issued` },
    { key: 'Draft', label: 'DRAFT', value: stats.draft, icon: <ReceiptText className="h-4 w-4" />, desc: 'Pending issue' },
    { key: 'Issued', label: 'ISSUED', value: stats.issued, icon: <ReceiptText className="h-4 w-4" />, desc: 'Finalized invoices' },
    { key: 'Cancelled', label: 'CANCELLED', value: stats.cancelled, icon: <ReceiptText className="h-4 w-4" />, desc: 'Voided invoices' },
    { key: '_value', label: 'TOTAL VALUE', value: `₹${(stats.totalAmount).toLocaleString('en-IN')}`, icon: <ReceiptText className="h-4 w-4" />, desc: `₹${(stats.issuedAmount).toLocaleString('en-IN')} issued`, displayOnly: true },
    { key: '_filed', label: 'FILED', value: stats.issued, icon: <ReceiptText className="h-4 w-4" />, desc: `${stats.cancelled} cancelled`, displayOnly: true },
  ];

  const isTotalDefault = !activeKpi && !search && !statusFilter && dateRange === 'all';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = (invoices as TaxInvoiceRecord[]).filter((invoice) => {
      const matchesSearch = !q || [
        invoice.invoiceNumber,
        invoice.customerName,
        invoice.orderId,
        invoice.sourcePiId,
        invoice.id,
      ].some((value) => String(value || '').toLowerCase().includes(q));
      const matchesStatus = !statusFilter || invoice.status === statusFilter;
      let matchesDate = true;
      if (dateRange !== 'all') matchesDate = isInDateRange(invoice.createdAt, dateRange as any, customFrom, customTo);
      return matchesSearch && matchesStatus && matchesDate;
    });
    // KPI filter
    if (activeKpi && activeKpi !== 'total') {
      list = list.filter((i) => i.status === activeKpi);
    }
    return list;
  }, [invoices, search, statusFilter, activeKpi, dateRange, customFrom, customTo]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);
  const allSelected = selected.size === paginated.length && paginated.length > 0;

  const activeFilterCount = [search ? 'search' : '', statusFilter ? statusFilter : '', activeKpi ? activeKpi : '', dateRange !== 'all' ? dateRange : ''].filter(Boolean).length;

  function clearFilters() {
    setSearch(''); setStatusFilter(''); setDateRange('all'); setCustomFrom(''); setCustomTo('');
    setActiveKpi(''); setPage(1); setSelected(new Set());
    syncParams({ q: '', status: '', date: 'all', from: '', to: '', kpi: '', page: 1 });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => (current.size === paginated.length ? new Set() : new Set(paginated.map((row) => row.id))));
  }

  function openCreate() {
    setEditId(null);
    setForm(createEmptyTaxInvoiceForm(company));
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setForm(createEmptyTaxInvoiceForm(company));
  }

  function openEdit(invoice: TaxInvoiceRecord) {
    if (!canEdit || invoice.status !== 'Draft') return;
    setEditId(invoice.id);
    setForm(buildTaxInvoiceFormFromRecord(invoice));
    setShowForm(true);
  }

  function openInvoice(invoice: TaxInvoiceRecord) {
    setViewItem(invoice);
    if (openParam !== invoice.id) {
      const next = new URLSearchParams(searchParams);
      next.set('open', invoice.id);
      setSearchParams(next, { replace: true });
    }
  }

  function closeInvoice() {
    setViewItem(null);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }

  function loadSource() {
    if (!form.sourceId) {
      toast.error('Select a source document first');
      return;
    }

    if (form.sourceType === 'order') {
      const order = (orders as Order[]).find((row) => row.id === form.sourceId);
      if (!order) {
        toast.error('Source order not found');
        return;
      }
      const customer = (customers as any[]).find((row) => row.id === order.customerId) || order;
      try {
        setForm((current) => ({
          ...buildTaxInvoiceDraftFromOrder(order, company, products as Product[], customer as any),
          notes: current.notes,
          status: 'Draft',
        }));
      } catch (error: any) {
        toast.error(error?.message || 'Unable to load tax invoice source data');
      }
      return;
    }

    const pi = (proformaInvoices as ProformaInvoice[]).find((row) => row.id === form.sourceId);
    if (!pi) {
      toast.error('Source proforma invoice not found');
      return;
    }
    const customer = (customers as any[]).find((row) => row.id === pi.customerId) || pi;
    try {
      setForm((current) => ({
        ...buildTaxInvoiceDraftFromProformaInvoice(pi, company, products as Product[], customer as any),
        notes: current.notes,
        status: 'Draft',
      }));
    } catch (error: any) {
      toast.error(error?.message || 'Unable to load tax invoice source data');
    }
  }

  const saveDraft = useSaveTaxInvoiceDraft(editId, closeForm);
  const issueInvoice = useIssueTaxInvoice(() => {
    setViewItem(null);
    if (editId && viewItem?.id === editId) closeForm();
  });
  const cancelInvoice = useCancelTaxInvoice(() => {
    setViewItem(null);
  });

  function handleSubmit() {
    saveDraft.mutate(form);
  }

  function handleIssue(invoice: TaxInvoiceRecord) {
    if (!canEdit) {
      toast.error('You do not have permission to issue tax invoices');
      return;
    }
    issueInvoice.mutate(invoice.id);
  }

  function handleCancel(invoice: TaxInvoiceRecord) {
    if (!canCancel) {
      toast.error('You do not have permission to cancel tax invoices');
      return;
    }
    const reason = window.prompt(`Reason for cancelling ${invoice.invoiceNumber || invoice.id}`, 'Cancelled by finance')?.trim();
    if (reason === null) return;
    cancelInvoice.mutate({ invoiceId: invoice.id, reason: reason || 'Cancelled by finance' });
  }

  function handleExportCsv() {
    const rows = (invoices as TaxInvoiceRecord[]).filter((inv) => selected.has(inv.id));
    if (!rows.length) return toast.error('No invoices selected');
    const headers = ['Invoice No.', 'Customer', 'Status', 'Total', 'Date'];
    const lines = rows.map((inv) =>
      [inv.invoiceNumber || '', inv.customerName || '', inv.status || '', String(inv.total || 0), inv.createdAt || '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','),
    );
    const csv = [headers.join(','), ...lines].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `tax-invoices-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported ${rows.length} invoice${rows.length > 1 ? 's' : ''}`);
  }

  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'This Week', value: 'this_week' },
    { label: 'This Month', value: 'this_month' },
    { label: 'Custom', value: 'custom' },
  ];

  function handleDateChange(newDateRange: string) {
    setDateRange(newDateRange);
    setPage(1);
    if (newDateRange !== 'custom') { setCustomFrom(''); setCustomTo(''); }
    syncParams({ date: newDateRange, from: '', to: '', page: 1 });
  }

  const statusOptions = [
    { label: 'All Statuses', value: '' },
    { label: 'Draft', value: 'Draft' },
    { label: 'Issued', value: 'Issued' },
    { label: 'Cancelled', value: 'Cancelled' },
  ];

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero className="gap-3" icon={<ReceiptText className="h-4 w-4" />}
        breadcrumbs={['Home', 'Compliance', 'Tax Invoices']} title="Tax Invoices"
        statusText="Compliance" statusDotColor="bg-[var(--color-success)]"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>Refresh</Button>
            {canCreate && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>Create Invoice</Button>}
          </>
        }
      />

      {/* KPI GRID */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map((k, idx) => (
          <PremiumKpi key={`ti-${k.key || 'total'}-${idx}`} label={k.label} value={k.value} icon={k.icon} description={k.desc}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
              if ((k as any).displayOnly) return; // Non-filterable KPIs (TOTAL VALUE, FILED)
              const nextKpi = activeKpi === k.key ? '' : k.key;
              if (k.key === '' && isTotalDefault) return;
              setActiveKpi(nextKpi);
              // Clear status filter when KPI is clicked to avoid AND conflict
              if (nextKpi && statusFilter && statusFilter !== nextKpi) {
                setStatusFilter('');
              }
              setPage(1);
              syncParams({ kpi: nextKpi, status: nextKpi && statusFilter && statusFilter !== nextKpi ? '' : undefined, page: 1 });
            }}
          />
        ))}
      </div>

      {/* MAIN CARD */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
        {/* SEARCH + FILTERS */}
        <CardHeader className="flex flex-wrap items-center gap-2 px-6 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input className="h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                placeholder="Search invoice, customer, order..." value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); syncParams({ q: e.target.value, page: 1 }); }}
              />
            </div>
            <UiSelect value={dateRange} onChange={(e) => handleDateChange(e.target.value)} options={DATE_OPTIONS} className="h-8 min-w-[110px] py-1" />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(1); syncParams({ from: e.target.value, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPage(1); syncParams({ to: e.target.value, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
              </div>
            )}
            <UiSelect value={statusFilter} onChange={(e) => {
              const v = e.target.value;
              setStatusFilter(v);
              if (v && activeKpi && v !== activeKpi) {
                setActiveKpi('');
                setPage(1);
                syncParams({ status: v, kpi: '', page: 1 });
              } else {
                setPage(1);
                syncParams({ status: v, page: 1 });
              }
            }} options={statusOptions} className="h-8 min-w-[120px] py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button onClick={clearFilters} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">Clear All</button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        {/* BULK ACTION BAR */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-6 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">
              {selected.size} invoice{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={handleExportCsv}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">
                Export CSV
              </Button>
              <button onClick={() => setSelected(new Set())}
                className="ml-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                ✕ Clear
              </button>
            </div>
          </div>
        )}

        {/* TABLE — via TaxInvoiceWorkspacePanel */}
        <div className="flex min-h-0 flex-1">
          <TaxInvoiceWorkspacePanel
            invoices={paginated}
            isLoading={isLoading}
            search={search}
            onSearch={(value) => {
              setSearch(value);
              setPage(1);
              syncParams({ q: value, page: 1 });
            }}
            statusFilter={statusFilter}
            onStatusFilter={(value) => {
              setStatusFilter(value);
              setPage(1);
              syncParams({ status: value, page: 1 });
            }}
            filteredCount={filtered.length}
            totalCount={invoices.length}
            onClearFilters={clearFilters}
            page={page}
            perPage={perPage}
            onPageChange={(nextPage) => {
              setPage(nextPage);
              syncParams({ page: nextPage });
            }}
            onPerPageChange={(nextPerPage) => {
              setPerPage(nextPerPage);
              setPage(1);
              syncParams({ perPage: nextPerPage, page: 1 });
            }}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
            allSelected={allSelected}
            onOpen={openInvoice}
            onEdit={openEdit}
            onIssue={handleIssue}
            onCancel={handleCancel}
            currencySymbol={company.currencySymbol}
          />
        </div>
      </Card>

      <TaxInvoiceEditorModal
        open={showForm}
        title={editId ? 'Edit Tax Invoice Draft' : 'Create Tax Invoice Draft'}
        form={form}
        setForm={setForm}
        onClose={closeForm}
        onSubmit={handleSubmit}
        loading={saveDraft.isPending}
        company={company}
        products={products as Product[]}
        orders={orders as Order[]}
        proformaInvoices={proformaInvoices as ProformaInvoice[]}
        onLoadSource={loadSource}
        editMode={Boolean(editId)}
      />

      <TaxInvoiceDetailModal
        open={Boolean(viewItem)}
        invoice={viewItem}
        onClose={closeInvoice}
        onEdit={openEdit}
        onIssue={handleIssue}
        onCancel={handleCancel}
        currencySymbol={company.currencySymbol}
      />
    </div>
  );
}
