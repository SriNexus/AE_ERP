/**
 * MobileTaxInvoiceWorkspace — Mobile workspace for tax invoices
 *
 * Net Metering parity implementation for Compliance module mobile.
 * Reference: MobileNetMeteringWorkspace
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Download,
  FileText,
  Trash2,
  ReceiptText,
  Clock,
  CheckCircle2,
  XCircle,
  ListChecks,
  DollarSign,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea } from '../../ui';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtDate, fmtCurrency, getAll, deleteDocById } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';

import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

import type { TaxInvoiceFormState, TaxInvoiceRecord } from '../../../features/tax-invoices/types';
import { createEmptyTaxInvoiceForm, buildTaxInvoiceDraftFromOrder, buildTaxInvoiceDraftFromProformaInvoice } from '../../../features/tax-invoices/utils';
import { TaxInvoiceEditorModal } from '../../../features/tax-invoices/components/TaxInvoiceWorkspaceParts';
import { useSaveTaxInvoiceDraft } from '../../../features/tax-invoices/hooks/useTaxInvoices';

const PER_PAGE = 10;
const ALL = 'All';

const TI_STATUSES = ['All', 'Draft', 'Issued', 'Cancelled'] as const;

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Issued: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

type TIFilters = {
  search: string;
  status: string;
  date: string;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function filterInvs(apps: any[], filters: TIFilters) {
  const term = filters.search.trim().toLowerCase();
  return apps
    .filter((inv) => {
      if (filters.status !== ALL && inv.status !== filters.status) return false;
      if (filters.date !== 'all') {
        if (filters.date === 'today') {
          const d = toDate(inv.createdAt);
          if (!d) return false;
          const now = new Date();
          if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) return false;
        } else if (filters.date === '7d') {
          const d = toDate(inv.createdAt);
          if (!d) return false;
          const weekAgo = new Date(Date.now() - 7 * 86400000);
          if (d < weekAgo) return false;
        } else if (filters.date === '30d') {
          const d = toDate(inv.createdAt);
          if (!d) return false;
          const monthAgo = new Date(Date.now() - 30 * 86400000);
          if (d < monthAgo) return false;
        }
      }
      if (!term) return true;
      return [inv.invoiceNumber, inv.customerName, inv.id]
        .some((v) => String(v || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
}

function downloadCsv(rows: any[], filename: string) {
  const headers = ['Invoice No.', 'Customer', 'Status', 'Total', 'Date'];
  const lines = rows.map((inv) =>
    [
      inv.invoiceNumber || '', inv.customerName || '',
      inv.status || '', inv.total || '', inv.date || '',
    ].map((v) => `"${v}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function statusBadgeTI(status: string) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    )}>
      {status}
    </span>
  );
}

export function MobileTaxInvoiceWorkspace() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const company = useAppStore((s) => s.company);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const currencySymbol = company?.currencySymbol || '₹';

  const { data: invoices = [], isLoading, error } = useQuery({
    queryKey: keys.taxInvoices,
    queryFn: () => getAll<any>(COLLECTIONS.TAX_INVOICES),
    staleTime: 15_000,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [viewInv, setViewInv] = useState<any>(null);
  const openId = params.get('open') || '';
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');
  const createParam = params.get('create');

  // ── Create flow ──
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<TaxInvoiceFormState>(() => createEmptyTaxInvoiceForm(company || {} as any));
  const saveDraft = useSaveTaxInvoiceDraft(editId, () => {
    setShowForm(false);
    setEditId(null);
    setForm(createEmptyTaxInvoiceForm(company || {} as any));
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  });

  const { data: orders = [] } = useQuery({
    queryKey: keys.ordersAll,
    queryFn: () => getAll<any>(COLLECTIONS.ORDERS),
    staleTime: 60_000,
  });
  const { data: proformaInvoices = [] } = useQuery({
    queryKey: keys.invoices,
    queryFn: () => getAll<any>(COLLECTIONS.PROFORMA_INVOICES),
    staleTime: 60_000,
  });
  const { data: products = [] } = useQuery({
    queryKey: keys.productsAll,
    queryFn: () => getAll<any>(COLLECTIONS.PRODUCTS),
    staleTime: 60_000,
  });
  const { data: customers = [] } = useQuery({
    queryKey: keys.customersAll,
    queryFn: () => getAll<any>(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });

  // ── Create flow: ?create=1 ──
  useEffect(() => {
    if (createParam !== '1') return;
    setEditId(null);
    if (company) {
      setForm(createEmptyTaxInvoiceForm(company as any));
    }
    setShowForm(true);
  }, [createParam, company]);

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    if (company) {
      setForm(createEmptyTaxInvoiceForm(company as any));
    }
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function handleCreateSubmit() {
    saveDraft.mutate(form);
  }

  function loadSource() {
    if (!form.sourceId || !company) {
      toast.error('Select a source document first');
      return;
    }
    if (form.sourceType === 'order') {
      const order = (orders as any[]).find((row: any) => row.id === form.sourceId);
      if (!order) { toast.error('Source order not found'); return; }
      try {
        const customer = (customers as any[]).find((row: any) => row.id === order.customerId) || order;
        setForm((current) => ({
          ...buildTaxInvoiceDraftFromOrder(order, company as any, products as any[], customer as any),
          notes: current.notes,
          status: 'Draft',
        }));
      } catch (error: any) {
        toast.error(error?.message || 'Unable to load source data');
      }
    } else {
      const pi = (proformaInvoices as any[]).find((row: any) => row.id === form.sourceId);
      if (!pi) { toast.error('Source proforma invoice not found'); return; }
      try {
        const customer = (customers as any[]).find((row: any) => row.id === pi.customerId) || pi;
        setForm((current) => ({
          ...buildTaxInvoiceDraftFromProformaInvoice(pi, company as any, products as any[], customer as any),
          notes: current.notes,
          status: 'Draft',
        }));
      } catch (error: any) {
        toast.error(error?.message || 'Unable to load source data');
      }
    }
  }

  // ── Filters ──
  const filters = useMemo<TIFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const filteredInvs = useMemo(() => filterInvs(invoices as any[], filters), [invoices, filters]);
  const paginatedInvs = useMemo(() => filteredInvs.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredInvs, page]);
  const selectedRows = useMemo(() => (invoices as any[]).filter((inv) => selected.has(inv.id)), [invoices, selected]);
  const canDelete = perms.canDelete('tax_invoices');

  // ── Pagination sync ──
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredInvs.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredInvs.length, page]);

  // ── Selection cleanup ──
  useEffect(() => {
    setSelected((current) => {
      const available = new Set((invoices as any[]).map((inv) => inv.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [invoices]);

  // ── Detail modal URL sync ──
  const userClosedRef = useRef(false);

  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    if (!openId || isLoading) return;
    const target = (invoices as any[]).find((inv) => inv.id === openId);
    if (target && !viewInv) {
      setViewInv(target);
      setDetailTab('overview');
    }
  }, [openId, isLoading, invoices, viewInv]);

  function openMobileDetail(inv: any) {
    userClosedRef.current = false;
    setViewInv(inv);
    setDetailTab('overview');
    const next = new URLSearchParams(params);
    next.set('open', inv.id);
    setParams(next, { replace: true });
  }

  function closeMobileDetail() {
    userClosedRef.current = true;
    setViewInv(null);
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Delete ──
  const delMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteDocById(COLLECTIONS.TAX_INVOICES, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.taxInvoices });
      toast.success('Deleted');
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function deleteSelected() {
    await Promise.all(selectedRows.map((inv) => delMutation.mutateAsync(inv.id)));
    setSelected(new Set());
    setDeleteOpen(false);
  }

  function exportRows(rows: any[]) {
    if (!rows.length) return toast.error('No invoices selected');
    downloadCsv(rows, `tax-invoices-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} invoice${rows.length > 1 ? 's' : ''}`);
  }

  // ── Timeline entries ──
  const timelineEntries = useMemo(() => {
    const entries: { type: string; description: string; date: string; user?: string }[] = [];
    if (viewInv) {
      entries.push({
        type: 'Created',
        description: `Invoice ${viewInv.invoiceNumber || viewInv.id} created`,
        date: viewInv.createdAt,
      });
      if (viewInv.issuedAt) {
        entries.push({
          type: 'Issued',
          description: 'Invoice issued',
          date: viewInv.issuedAt,
        });
      }
      if (viewInv.cancelledAt) {
        entries.push({
          type: 'Cancelled',
          description: viewInv.cancellationReason || 'Invoice cancelled',
          date: viewInv.cancelledAt,
        });
      }
      if (viewInv.updatedAt) {
        entries.push({
          type: 'Updated',
          description: 'Invoice details updated',
          date: viewInv.updatedAt,
        });
      }
    }
    return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [viewInv]);

  // ── Render ──
  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Tax Invoices</h1>
      </div>

      {/* ── Selection Bar ── */}
      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>Export</Button>
            {canDelete && <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Clear</button>
          </div>
        </Card>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
          {(error as Error).message}
        </div>
      )}

      {/* ── List ── */}
      <div className="space-y-3">
        {isLoading && Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 animate-pulse">
            <div className="h-4 w-3/4 bg-[var(--color-bg-sunken)] rounded mb-2" />
            <div className="h-3 w-1/2 bg-[var(--color-bg-sunken)] rounded" />
          </div>
        ))}
        {!isLoading && filteredInvs.length === 0 && (
          <Card className="rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
            <ReceiptText className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
            <p className="mt-2">
              {filters.search || filters.status !== ALL || filters.date !== 'all'
                ? 'No invoices match the current filters.'
                : 'No tax invoices yet.'}
            </p>
          </Card>
        )}
        {!isLoading && paginatedInvs.map((inv) => (
          <div
            key={inv.id}
            onClick={() => openMobileDetail(inv)}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 cursor-pointer active:scale-[0.99] transition-transform"
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={selected.has(inv.id)}
                onChange={(e) => { e.stopPropagation(); toggleSelect(inv.id); }}
                onClick={(e) => e.stopPropagation()}
                className="mt-1 rounded border-[var(--color-border)] shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ReceiptText className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                    <span className="text-xs font-semibold text-[var(--color-text)] truncate">
                      {inv.invoiceNumber || inv.id}
                    </span>
                  </div>
                  {statusBadgeTI(inv.status)}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] min-w-0">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{inv.customerName || '—'}</span>
                  <span className="mx-1">·</span>
                  <DollarSign className="h-3 w-3 shrink-0" />
                  <span className="font-medium">{fmtCurrency(inv.total, currencySymbol)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[var(--color-text-muted)]">
                  <Clock className="h-3 w-3" />
                  <span>{inv.date ? fmtDate(inv.date) : '—'}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Pagination ── */}
      {!isLoading && filteredInvs.length > 0 && (
        <Pagination page={page} total={filteredInvs.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      {/* ── Create/Edit Editor Modal ── */}
      <TaxInvoiceEditorModal
        open={showForm}
        title={editId ? 'Edit Tax Invoice Draft' : 'Create Tax Invoice Draft'}
        form={form}
        setForm={setForm}
        onClose={closeForm}
        onSubmit={handleCreateSubmit}
        loading={saveDraft.isPending}
        company={company as any}
        products={products as any[]}
        orders={orders as any[]}
        proformaInvoices={proformaInvoices as any[]}
        onLoadSource={loadSource}
        editMode={Boolean(editId)}
      />

      {/* ── Detail Modal ── */}
      <Modal open={!!viewInv} onClose={closeMobileDetail} title={viewInv?.invoiceNumber || 'Tax Invoice'} size="full">
        {viewInv && (
          <div className="space-y-4">
            {/* Status header */}
            <div className="flex items-center gap-2 mb-1">
              {statusBadgeTI(viewInv.status)}
              <span className="text-[10px] font-mono text-[var(--color-text-muted)]">{viewInv.id}</span>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-[var(--color-border-subtle)]">
              {['overview', 'items', 'timeline', 'history'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={cn(
                    'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                    detailTab === tab
                      ? 'text-[var(--color-primary)] border-b-2 border-[var(--color-primary)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                  )}
                >
                  {tab === 'overview' && 'Overview'}
                  {tab === 'items' && 'Items'}
                  {tab === 'timeline' && 'Timeline'}
                  {tab === 'history' && 'History'}
                </button>
              ))}
            </div>

            {/* Overview tab */}
            {detailTab === 'overview' && (
              <div className="space-y-3">
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                    <span className="text-[var(--color-text-muted)]">Customer</span>
                    <span className="font-semibold text-[var(--color-text)] truncate ml-2">{viewInv.customerName || '—'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                    <span className="text-[var(--color-text-muted)]">Invoice Date</span>
                    <span className="font-semibold">{viewInv.date ? fmtDate(viewInv.date) : '—'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                    <span className="text-[var(--color-text-muted)]">Place of Supply</span>
                    <span className="font-semibold">{viewInv.placeOfSupply || '—'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                    <span className="text-[var(--color-text-muted)]">Company GSTIN</span>
                    <span className="font-semibold font-mono">{viewInv.companyGst || '—'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                    <span className="text-[var(--color-text-muted)]">Customer GSTIN</span>
                    <span className="font-semibold font-mono">{viewInv.customerGst || '—'}</span>
                  </div>
                  {viewInv.notes && (
                    <div className="py-1.5">
                      <span className="text-[var(--color-text-muted)]">Notes</span>
                      <p className="mt-1 text-[var(--color-text)]">{viewInv.notes}</p>
                    </div>
                  )}
                </div>

                {/* Amount Summary */}
                <div className="rounded-xl bg-[var(--color-bg-sunken)] p-3 space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--color-text-muted)]">Sub Total</span>
                    <span className="font-medium">{fmtCurrency(viewInv.subtotal || viewInv.total || 0, currencySymbol)}</span>
                  </div>
                  {(viewInv.cgst || viewInv.sgst) && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--color-text-muted)]">CGST + SGST</span>
                      <span className="font-medium">{fmtCurrency((viewInv.cgst || 0) + (viewInv.sgst || 0), currencySymbol)}</span>
                    </div>
                  )}
                  {viewInv.igst ? (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--color-text-muted)]">IGST</span>
                      <span className="font-medium">{fmtCurrency(viewInv.igst, currencySymbol)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between text-xs font-bold border-t border-[var(--color-border-subtle)] pt-1.5">
                    <span>Grand Total</span>
                    <span className="text-emerald-600">{fmtCurrency(viewInv.total, currencySymbol)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Items tab */}
            {detailTab === 'items' && viewInv.items && viewInv.items.length > 0 && (
              <div className="space-y-2">
                {viewInv.items.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between text-xs py-2 border-b border-[var(--color-border-subtle)] last:border-0">
                    <div className="flex-1">
                      <p className="font-medium text-[var(--color-text)]">{item.product || item.description || 'Item'}</p>
                      <p className="text-[9px] text-[var(--color-text-muted)]">HSN: {item.hsn || '—'} · Qty: {item.quantity} × Rate: {fmtCurrency(item.rate, currencySymbol)}</p>
                    </div>
                    <span className="font-medium ml-2">{fmtCurrency(item.lineTotal || item.quantity * item.rate, currencySymbol)}</span>
                  </div>
                ))}
              </div>
            )}
            {detailTab === 'items' && (!viewInv.items || viewInv.items.length === 0) && (
              <p className="text-xs text-[var(--color-text-muted)] text-center py-4">No items.</p>
            )}

            {/* Timeline tab */}
            {detailTab === 'timeline' && (
              <MobileTimelinePreview entries={timelineEntries} title="Invoice Timeline" />
            )}

            {/* History tab */}
            {detailTab === 'history' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs py-2 border-b border-[var(--color-border-subtle)]">
                  <div>
                    <span className="font-semibold text-emerald-600">Issued</span>
                    {viewInv.issuedAt && <span className="text-[var(--color-text-muted)] ml-1">— Invoice issued</span>}
                  </div>
                  <span className="text-[10px] text-[var(--color-text-muted)]">{viewInv.issuedAt ? fmtDate(viewInv.issuedAt) : '—'}</span>
                </div>
                <div className="flex items-center justify-between text-xs py-2 border-b border-[var(--color-border-subtle)]">
                  <div>
                    <span className="font-semibold">{viewInv.status}</span>
                    <span className="text-[var(--color-text-muted)] ml-1">— Current status</span>
                  </div>
                  <span className="text-[10px] text-[var(--color-text-muted)]">{fmtDate(viewInv.updatedAt || viewInv.createdAt)}</span>
                </div>
              </div>
            )}

            {/* Status banners */}
            {viewInv.status === 'Issued' && (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="inline h-3 w-3 mr-1" />
                Issued on {viewInv.issuedAt ? fmtDate(viewInv.issuedAt) : '—'}
              </div>
            )}
            {viewInv.status === 'Cancelled' && viewInv.cancellationReason && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300">
                <XCircle className="inline h-3 w-3 mr-1" />
                Cancelled: {viewInv.cancellationReason}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Delete Confirm ── */}
      <ConfirmDialog
        open={deleteOpen}
        title="Delete Invoices"
        message={`Are you sure you want to delete ${selected.size} invoice${selected.size > 1 ? 's' : ''}?`}
        onConfirm={deleteSelected}
        onClose={() => setDeleteOpen(false)}
        loading={delMutation.isPending}
      />
    </div>
  );
}

export default MobileTaxInvoiceWorkspace;
