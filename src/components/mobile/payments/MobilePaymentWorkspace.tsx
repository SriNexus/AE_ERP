/**
 * MobilePaymentWorkspace — Mobile Payments workspace
 *
 * Reuses existing:
 *   - usePayments, useSavePayment, useDeletePayment, exportPaymentsCSV
 *   - useCustomers, useOrders
 *   - PAYMENT_FORM_DEFAULT, PAYMENT_MODES, PAYMENT_STATUSES
 *   - fmtCurrency, fmtDate, statusBadge
 *
 * Architecture: Matches MobileDispatchWorkspace / MobileInvoiceWorkspace pattern.
 * No Firestore SDK in UI.
 * No duplicated business logic.
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CreditCard,
  Download,
  Mail,
  MessageCircle,
  Phone,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PAYMENT_MODES, PAYMENT_STATUSES } from '../../../config/company';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtCurrency, fmtDate, getAll, updateDocById } from '../../../lib/firestore';

import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { resolveBusinessMode } from '../../../lib/companyBusinessMode';
import { filterCustomersForBusinessMode } from '../../../lib/customerClassification';
import { cn } from '../../../utils/cn';
import {
  usePayments,
  useSavePayment,
  useDeletePayment,
  exportPaymentsCSV,
  PAYMENT_FORM_DEFAULT,
  type PaymentForm,
  useOrders,
} from '../../../features/sales/hooks/useSales';
import { useCustomers } from '../../../features/customers/hooks/useCustomers';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';

type Payment = Record<string, any> & { id: string };
type Mode = 'records' | 'create';
type PaymentFilters = {
  search: string;
  mode: string;
  status: string;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function paymentId(payment: Payment) {
  return String(payment.id || 'Payment');
}

function paymentCustomer(payment: Payment) {
  return payment.customer || 'Customer not set';
}

function paymentAmount(payment: Payment) {
  return Number(payment.amount) || 0;
}

function paymentPhone(payment: Payment, customers: any[]) {
  const customer = customers.find((entry) => entry.id === payment.customerId);
  return payment.customerPhone || payment.phone || customer?.phone || customer?.mobile || customer?.businessPhone || '';
}

function paymentEmail(payment: Payment, customers: any[]) {
  const customer = customers.find((entry) => entry.id === payment.customerId);
  return payment.customerEmail || payment.email || customer?.email || customer?.businessEmail || '';
}

function whatsappHref(phone?: string) {
  const clean = String(phone || '').replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : undefined;
}

function filterPayments(rows: Payment[], filters: PaymentFilters) {
  const term = filters.search.trim().toLowerCase();
  return rows
    .filter((payment) => {
      if (filters.mode !== ALL && (payment.mode || 'UPI') !== filters.mode) return false;
      if (filters.status !== ALL && (payment.status || 'Paid') !== filters.status) return false;
      if (!term) return true;
      return [
        payment.id,
        payment.customer,
        payment.customerId,
        payment.orderId,
        payment.reference,
        payment.mode,
        payment.status,
      ].some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt || a.createdAt || a.date)?.getTime() || 0;
      const bTime = toDate(b.updatedAt || b.createdAt || b.date)?.getTime() || 0;
      return bTime - aTime;
    });
}

export function MobilePaymentWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const company = useAppStore((state) => state.company);
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();

  const { data: payments = [], isLoading, error } = usePayments();
  const { data: customers = [] } = useQuery({ queryKey: keys.customersAll, queryFn: () => getAll(COLLECTIONS.CUSTOMERS), staleTime: 60000 });
  // Phase 2: Payments are shared B2B+B2C infrastructure — exclude only
  // customers whose type isn't valid for this company's Business Mode.
  const businessMode = resolveBusinessMode(company);
  const paymentCustomerOptions = useMemo(() => filterCustomersForBusinessMode(customers as any[], businessMode), [customers, businessMode]);
  const { data: orders = [] } = useOrders();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<PaymentForm>({ ...PAYMENT_FORM_DEFAULT, date: new Date().toISOString().split('T')[0] });
  const [viewPayment, setViewPayment] = useState<Payment | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [dirty, setDirty] = useState(false);
  const createParam = params.get('create');

  const saveMut = useSavePayment((payment) => {
    setFormOpen(false);
    setForm({ ...PAYMENT_FORM_DEFAULT, date: new Date().toISOString().split('T')[0] });
    if (payment?.id) setViewPayment(payment as Payment);
  });
  const deleteMut = useDeletePayment();

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setForm({ ...PAYMENT_FORM_DEFAULT, date: new Date().toISOString().split('T')[0] });
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  useEffect(() => {
    const order = (location.state as any)?.prefillOrder;
    const customer = (location.state as any)?.prefillCustomer;
    if (!order && !customer) return;
    setForm({
      ...PAYMENT_FORM_DEFAULT,
      customer: order?.customer || customer?.name || customer?.company || '',
      customerId: order?.customerId || customer?.id || '',
      orderId: order?.id || '',
      amount: String(order?.balanceAmount || order?.total || ''),
      date: new Date().toISOString().split('T')[0],
    });
    setDirty(true);
    setFormOpen(true);
    window.history.replaceState({}, document.title);
  }, [location.state]);

  const canEdit = perms.canEdit('payments');
  const canDelete = perms.canDelete('payments');
  const canExport = perms.canExport('payments') || canEdit;

  const filters = useMemo<PaymentFilters>(() => ({
    search: params.get('q') || '',
    mode: params.get('mode') || ALL,
    status: params.get('status') || ALL,
  }), [params]);

  const filteredPayments = useMemo(() => filterPayments(payments as Payment[], filters), [payments, filters]);
  const paginatedPayments = useMemo(() => filteredPayments.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredPayments, page]);
  const selectedRows = useMemo(() => (payments as Payment[]).filter((payment) => selected.has(payment.id)), [payments, selected]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredPayments.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredPayments.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((payments as Payment[]).map((p) => p.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [payments]);

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

  function closeForm() {
    setFormOpen(false);
    setForm({ ...PAYMENT_FORM_DEFAULT, date: new Date().toISOString().split('T')[0] });
    setDirty(false);
    if (mode === 'create') {
      navigate('/app', { replace: true });
      return;
    }
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function requestCloseForm() {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    closeForm();
  }

  function updateForm(patch: Partial<PaymentForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!form.customer || !form.amount) return toast.error('Customer & amount required');
    saveMut.mutate(form);
  }

  function exportRows(rows: Payment[]) {
    if (!rows.length) return toast.error('No payments selected');
    exportPaymentsCSV(rows);
    toast.success(`Exported ${rows.length} payment${rows.length > 1 ? 's' : ''}`);
  }

  const markRefunded = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) =>
        updateDocById(COLLECTIONS.PAYMENTS, id, { status: 'Refunded', updatedAt: new Date().toISOString(), updatedBy: user.id, updatedByName: user.name })
      ));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.payments });
      toast.success(`Marked ${selectedRows.length} payment${selectedRows.length > 1 ? 's' : ''} as refunded`);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (mode === 'create') {
    return (
      <PaymentFormSheet
        formOpen={formOpen}
        form={form}
        customers={paymentCustomerOptions}
        orders={orders as any[]}
        saving={saveMut.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        onClose={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onSubmit={submitForm}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 data-tour="mobile-payments-header" className="text-xl font-bold text-[var(--color-text)]">Payments</h1>
      </div>

      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            {canExport && <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>Export</Button>}
            {canEdit && <Button size="xs" variant="outline" icon={<RotateCcw className="h-3 w-3" />} onClick={() => markRefunded.mutate(Array.from(selected))}>Refund</Button>}
            {canDelete && <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Clear</button>
          </div>
        </Card>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
          {(error as Error).message}
        </div>
      )}

      <div className="space-y-3" data-tour="payments-table">
        {isLoading && Array.from({ length: 5 }).map((_, index) => <PaymentSkeletonCard key={index} />)}
        {!isLoading && filteredPayments.length === 0 && (
          <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-text-muted)]">
            <CreditCard className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
            <p className="mt-3 text-sm font-bold text-[var(--color-text)]">No payments recorded</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Record a payment to see it here.</p>
          </Card>
        )}
        {!isLoading && paginatedPayments.map((payment) => (
          <PaymentCard
            key={payment.id}
            payment={payment}
            customers={customers as any[]}
            selected={selected.has(payment.id)}
            currencySymbol={company?.currencySymbol || '₹'}
            onSelect={() => toggleSelect(payment.id)}
            onView={() => setViewPayment(payment)}
          />
        ))}
      </div>

      {!isLoading && filteredPayments.length > 0 && (
        <div data-tour="payments-pagination">
          <Pagination page={page} total={filteredPayments.length} perPage={PER_PAGE} onChange={changePage} />
        </div>
      )}

      <PaymentViewModal
        payment={viewPayment}
        customers={customers as any[]}
        orders={orders as any[]}
        currencySymbol={company?.currencySymbol || '₹'}
        canDelete={canDelete}
        onClose={() => setViewPayment(null)}
        onDelete={(payment) => { setSelected(new Set([payment.id])); setViewPayment(null); setDeleteOpen(true); }}
      />

      <PaymentFormSheet
        formOpen={formOpen}
        form={form}
        customers={paymentCustomerOptions}
        orders={orders as any[]}
        saving={saveMut.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        onClose={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onSubmit={submitForm}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          const ids = Array.from(selected);
          ids.forEach((id) => deleteMut.mutate(id));
          setSelected(new Set());
        }}
        loading={deleteMut.isPending}
        title="Delete Payment"
        message={`Delete ${selectedRows.length} selected payment${selectedRows.length === 1 ? '' : 's'}?`}
      />
    </div>
  );
}

function PaymentCard({ payment, customers, selected, currencySymbol, onSelect, onView }: {
  payment: Payment;
  customers: any[];
  selected: boolean;
  currencySymbol: string;
  onSelect: () => void;
  onView: () => void;
}) {
  const phone = paymentPhone(payment, customers);
  const email = paymentEmail(payment, customers);
  const whatsapp = whatsappHref(phone);
  return (
    <Card data-tour="mobile-payments-card" className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${paymentId(payment)}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{fmtCurrency(paymentAmount(payment), currencySymbol)}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{paymentCustomer(payment)}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{payment.mode || '—'}</p>
            <p className="truncate">{payment.date ? fmtDate(payment.date) : 'Date not set'}</p>
            <p className="truncate font-mono text-xs">{payment.reference || '—'}</p>
            <p className="truncate">{payment.orderId || '—'}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(payment.status || 'Paid')}
            <Badge variant="info">{payment.mode || 'UPI'}</Badge>
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsapp} target="_blank" rel="noreferrer" aria-label="WhatsApp payment" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !whatsapp && 'pointer-events-none opacity-40')}>
            <MessageCircle className="h-4 w-4" strokeWidth={2.25} />
          </a>
          <a href={email ? `mailto:${email}?subject=${encodeURIComponent('Payment ' + paymentId(payment))}` : undefined} aria-label="Email payment" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !email && 'pointer-events-none opacity-40')}>
            <Mail className="h-4 w-4" strokeWidth={2.2} />
          </a>
          <a href={phone ? `tel:${phone}` : undefined} aria-label="Call payment" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !phone && 'pointer-events-none opacity-40')}>
            <Phone className="h-4 w-4" strokeWidth={2.25} />
          </a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function PaymentSkeletonCard() {
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

function PaymentFormSheet({ formOpen, form, customers, orders, saving, dirty, confirmClose, onClose, onDiscard, onKeepEditing, onFormChange, onSubmit }: {
  formOpen: boolean;
  form: PaymentForm;
  customers: any[];
  orders: any[];
  saving: boolean;
  dirty: boolean;
  confirmClose: boolean;
  onClose: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onFormChange: (patch: Partial<PaymentForm>) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onClose} title="Record Payment" size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <Section title="Customer & Order">
            <Select
              label="Customer"
              required
              value={form.customerId}
              onChange={(event) => {
                const customer = customers.find((entry) => entry.id === event.target.value);
                onFormChange({ customerId: event.target.value, customer: customer?.name || customer?.company || '' });
              }}
              options={[{ label: 'Select Customer...', value: '' }, ...customers.map((c: any) => ({ label: c.name || c.company || c.id, value: c.id }))]}
            />
            <Select
              label="Link to Order"
              value={form.orderId}
              onChange={(event) => onFormChange({ orderId: event.target.value })}
              options={[{ label: 'No order linked', value: '' }, ...orders.map((order: any) => ({ label: `${order.orderNumber || order.id} — ${order.customer || ''}`, value: order.id }))]}
            />
          </Section>

          <Section title="Payment Details">
            <Input label="Amount (₹)" type="number" min="0" required value={form.amount} onChange={(event) => onFormChange({ amount: event.target.value })} />
            <Input label="Date" type="date" value={form.date} onChange={(event) => onFormChange({ date: event.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Payment Mode" value={form.mode} onChange={(event) => onFormChange({ mode: event.target.value })} options={PAYMENT_MODES.map((m) => ({ label: m, value: m }))} />
              <Select label="Status" value={form.status} onChange={(event) => onFormChange({ status: event.target.value })} options={PAYMENT_STATUSES.map((s) => ({ label: s, value: s }))} />
            </div>
            <Input label="Reference / UTR / Cheque No." value={form.reference} onChange={(event) => onFormChange({ reference: event.target.value })} placeholder="Transaction reference" />
            <Textarea label="Notes" value={form.notes} onChange={(event) => onFormChange({ notes: event.target.value })} rows={2} />
          </Section>

          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>Record Payment</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={confirmClose} onClose={onKeepEditing} onConfirm={onDiscard} title="Discard Changes" message="Close this form and discard unsaved changes?" />
    </>
  );
}

function PaymentViewModal({ payment, customers, orders, currencySymbol, canDelete, onClose, onDelete }: {
  payment: Payment | null;
  customers: any[];
  orders: any[];
  currencySymbol: string;
  canDelete: boolean;
  onClose: () => void;
  onDelete: (payment: Payment) => void;
}) {
  if (!payment) return null;
  const phone = paymentPhone(payment, customers);
  const email = paymentEmail(payment, customers);
  const order = orders.find((entry) => entry.id === payment.orderId);
  const activity = [
    { type: 'Recorded', desc: 'Payment recorded', date: payment.createdAt || payment.date, userName: payment.createdBy || 'System' },
    ...(payment.status === 'Refunded' ? [{ type: 'Refunded', desc: 'Payment refunded', date: payment.updatedAt || payment.date, userName: payment.updatedBy || 'System' }] : []),
  ];

  return (
    <Modal open={!!payment} onClose={onClose} title={paymentId(payment)} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="text-center py-3">
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{fmtCurrency(paymentAmount(payment), currencySymbol)}</p>
            <p className="text-muted mt-1 text-xs">{payment.mode} · {payment.date ? fmtDate(payment.date) : 'Date not set'}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {statusBadge(payment.status || 'Paid')}
            <Badge variant="info">{payment.mode || 'UPI'}</Badge>
          </div>
        </section>

        <Section title="Payment Information">
          <Detail label="Payment ID" value={paymentId(payment)} />
          <Detail label="Customer" value={paymentCustomer(payment)} />
          <Detail label="Order" value={payment.orderId || 'Not linked'} />
          <Detail label="Reference" value={payment.reference || 'Not available'} />
          <Detail label="Mode" value={payment.mode || 'Not available'} />
          <Detail label="Status" value={payment.status || 'Paid'} />
        </Section>

        <Section title="Order Reference">
          <Detail label="Order ID" value={payment.orderId || 'No order linked'} />
          <Detail label="Order Number" value={order?.orderNumber || order?.orderNo || 'Not available'} />
          <Detail label="Order Status" value={order?.status || 'Not available'} />
        </Section>

        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{payment.notes || 'No notes recorded.'}</p>
        </Section>

        <Section title="Timeline">
          <MobileTimelinePreview title={`${paymentId(payment)} Timeline`} entries={activity} />
        </Section>

        <Section title="Audit Information">
          <Detail label="Created By" value={payment.createdByName || payment.createdBy || 'System'} />
          <Detail label="Created" value={payment.createdAt ? fmtDate(payment.createdAt) : 'Not available'} />
          <Detail label="Updated" value={payment.updatedAt ? fmtDate(payment.updatedAt) : 'Not available'} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {phone ? <a className={linkButtonClass} href={`tel:${phone}`}><Phone className="h-4 w-4" />Call</a> : null}
          {phone ? <a className={linkButtonClass} href={whatsappHref(phone)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a> : null}
          {email ? <a className={linkButtonClass} href={`mailto:${email}`}><Mail className="h-4 w-4" />Email</a> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(payment)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

const linkButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  );
}

export default MobilePaymentWorkspace;
