import { CheckCircle2, CornerUpRight, Download, Edit2, FileText, Plus, Printer, RefreshCw, Trash2 } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { PermissionGate } from '../../../components/shared';
import { statusBadge } from '../../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../../components/ui/Modal';
import { Input, Select, Textarea, FormRow, FormSection } from '../../../components/ui/Input';
import { FilterBar, KpiTile } from '../../../components/ui/FilterBar';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../../../components/ui/Table';
import { Pagination } from '../../../components/ui/Pagination';
import { InvoiceItemsDisplay } from './InvoiceItemsDisplay';
import { InvoiceActionStrip, InvoiceField } from './InvoiceWorkspaceParts';
import { fmtCurrency } from '../../../lib/firestore';
import { PAYMENT_STATUSES, PAYMENT_MODES } from '../../../config/company';

type InvoiceWorkspacePanelProps = { ctx: any };

export function InvoiceWorkspacePanel({ ctx }: InvoiceWorkspacePanelProps) {
  const {
    selectedCount, exportSelected, canDo, bulkSendMutation, bulkMarkPaidMutation, bulkDeleteMutation,
    search, setSearch, syncQueueParams, dateRange, setDateRange, customFrom, customTo, setCustomFrom, setCustomTo,
    statusF, setStatusF, paymentF, setPaymentF, assignedF, setAssignedF, salesUsers, activeKpi, 
    filtered, invoices, clearAll, INVOICE_DATE_RANGES, page, perPage,
    setPage, setPerPage, toggleAll, allSel, safeSelected, handleRowClick, handleRowKeyDown, paginated, isLoading,
    company, invoiceDisplayNumber, orderNumberById, formatInvoiceDate, del, delId, setDelId, items, subtotal, taxAmount,
    form, editId, setForm, handleOrderSelect, orders, showForm, closeForm, save, openEdit, handleSubmit, closeInvoiceDetails,
    InvoiceDetailModal, safeViewItem, currencySymbol, doPrint, duplicateInvoice, markPaidMutation, sendInvoiceMutation,
    InvoiceModalBoundary, setSelected, selected, toast, InvoicePageBoundary, setActiveKpi,
  } = ctx;

  return (
    <>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-enterprise-surface)]">
        {selectedCount > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-primary-light)] px-4 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selectedCount} invoice{selectedCount > 1 ? 's' : ''} selected</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelected} className="border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export</Button>
              {canDo('edit', 'invoices') && <Button size="sm" variant="outline" icon={<CornerUpRight className="h-3.5 w-3.5" />} onClick={() => bulkSendMutation.mutate(Array.from(safeSelected))} loading={bulkSendMutation.isPending} className="border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">Send Email</Button>}
              {canDo('edit', 'invoices') && <Button size="sm" variant="outline" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => bulkMarkPaidMutation.mutate(Array.from(safeSelected))} loading={bulkMarkPaidMutation.isPending} className="border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Mark Paid</Button>}
              {canDo('delete', 'invoices') && <Button size="sm" variant="outline" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => bulkDeleteMutation.mutate(Array.from(safeSelected))} loading={bulkDeleteMutation.isPending} className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">Delete</Button>}
              <button onClick={() => setSelected(new Set())} className="ml-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">✕ Clear</button>
            </div>
          </div>
        )}

        <FilterBar
          search={search}
          onSearch={v => { setSearch(v); setPage(1); syncQueueParams({ q: v, page: 1 }); }}
          searchPlaceholder="Search invoice ID, customer…"
          dateRange={dateRange}
          dateRangeOptions={INVOICE_DATE_RANGES}
          onDateRange={v => { setDateRange(v); setPage(1); syncQueueParams({ date: v, page: 1 }); }}
          customFrom={customFrom}
          customTo={customTo}
          onCustomRange={(from, to) => { setCustomFrom(from); setCustomTo(to); setPage(1); syncQueueParams({ from, to, page: 1 }); }}
          filters={[
            {
              label: 'Invoice Status',
              value: statusF,
              onChange: v => {
                // KPI auto-reset: if active KPI conflicts with selected status filter, deselect KPI
                const kpiStatusMap: Record<string, string> = { draft: 'Draft', sent: 'Sent', paid: '', overdue: '' };
                if (v && activeKpi && kpiStatusMap[activeKpi] && v !== kpiStatusMap[activeKpi]) {
                  setActiveKpi('');
                  syncQueueParams({ status: v, kpi: '', page: 1 });
                }
                setStatusF(v); setPage(1); syncQueueParams({ status: v, page: 1 });
              },
              options: [
                { label: 'All Invoice Status', value: '' },
                { label: 'Draft', value: 'Draft' },
                { label: 'Sent', value: 'Sent' },
                { label: 'Accepted', value: 'Accepted' },
                { label: 'Cancelled', value: 'Cancelled' },
              ],
            },
            {
              label: 'Payment Status',
              value: paymentF,
              onChange: v => { setPaymentF(v); setPage(1); syncQueueParams({ payment: v, page: 1 }); },
              options: [{ label: 'All Payment Status', value: '' }, ...PAYMENT_STATUSES.map((s: string) => ({ label: s, value: s }))],
            },
            {
              label: 'Assigned',
              value: assignedF,
              onChange: v => { setAssignedF(v); setPage(1); syncQueueParams({ assigned: v, page: 1 }); },
              options: [
                { label: 'All Assignments', value: '' },
                ...(salesUsers || []).map((u: any) => ({ label: u.name || u.displayName || u.id, value: u.id })),
              ],
            },
          ]}
          count={filtered.length}
          total={invoices.length}
          label="invoices"
          onClearAll={clearAll}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Table className="min-h-0 flex-1 overflow-y-auto">
            <Thead>
              <Th className="w-8"><input type="checkbox" checked={allSel} onChange={toggleAll} className="cursor-pointer rounded border-[var(--color-border)] text-indigo-600" data-interactive /></Th>
              <Th>INVOICE ID</Th><Th>ORDER ID</Th><Th>CUSTOMER</Th><Th>DATE</Th><Th>DUE DATE</Th><Th>SUBTOTAL</Th><Th>TAX</Th><Th>TOTAL</Th><Th>STATUS</Th><Th>PAYMENT</Th><Th>ACTIONS</Th>
            </Thead>
            <Tbody>
              {isLoading ? <SkeletonRows cols={12} /> :
                paginated.length === 0 ? (
                  <tr><td colSpan={12} className="px-4 py-12 text-center">
                    <FileText className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
                    <p className="mt-3 text-sm font-semibold text-[var(--color-text-muted)]">No invoices found</p>
                    <p className="mt-1 text-xs text-[var(--color-text-disabled)]">
                      {search || statusF || paymentF || assignedF || dateRange !== 'all' 
                        ? 'Try adjusting your search or filters' 
                        : 'Create your first invoice from an order!'}
                    </p>
                    {(search || statusF || paymentF || assignedF || dateRange !== 'all') ? null : (
                      <PermissionGate module="invoices" action="create">
                        <Button size="sm" className="mt-4" icon={<Plus className="h-4 w-4" />} onClick={() => ctx.openCreateForm && ctx.openCreateForm()}>Create First Invoice</Button>
                      </PermissionGate>
                    )}
                  </td></tr>
                ) :
                paginated.map((inv: any) => (
                  <Tr key={inv.id} selected={safeSelected.has(inv.id)} data-record-id={inv.id} role="button" tabIndex={0} onClick={e => handleRowClick(e, inv)} onKeyDown={e => handleRowKeyDown(e, inv)} className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-enterprise-row)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-inset">
                    <Td><input type="checkbox" checked={safeSelected.has(inv.id)} onClick={(e) => e.stopPropagation()} onChange={() => ctx.toggleSelect(inv.id)} className="cursor-pointer rounded border-[var(--color-border)] text-indigo-600" data-interactive /></Td>
                    <Td className="font-mono text-xs text-[var(--color-primary-text)] font-semibold">{invoiceDisplayNumber(inv)}</Td>
                    <Td className="font-mono text-xs text-muted">{orderNumberById.get(String(inv.orderId)) || '—'}</Td>
                    <Td className="text-xs font-medium">{inv.customer || inv.customerName || '—'}</Td>
                    <Td className="text-xs text-muted">{formatInvoiceDate(inv.date || inv.createdAt)}</Td>
                    <Td className="text-xs text-muted">{formatInvoiceDate(inv.dueDate) || '—'}</Td>
                    <Td className="text-xs">{fmtCurrency(inv.subtotal, company.currencySymbol)}</Td>
                    <Td className="text-xs">{fmtCurrency(inv.taxAmount, company.currencySymbol)}</Td>
                    <Td className="font-semibold text-sm">{fmtCurrency(inv.total, company.currencySymbol)}</Td>
                    <Td>{statusBadge(inv.status || 'Draft')}</Td>
                    <Td>{statusBadge(inv.paymentStatus || 'Pending')}</Td>
                    <Td><InvoiceActionStrip onView={() => ctx.openInvoice(inv)} /></Td>
                  </Tr>
                ))}
            </Tbody>
          </Table>
        </div>
        <Pagination page={page} total={filtered.length} perPage={perPage} onChange={(nextPage) => { setPage(nextPage); syncQueueParams({ page: nextPage }); }} onPerPageChange={n => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }} />
      </Card>

      <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit Invoice' : 'New Auto-Invoice'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-5">
          <FormSection title="Source Selection">
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-sm text-indigo-800 mb-4">Select an Order to automatically hydrate customer details, items, taxes, and pricing.</div>
            <Select label="Select Source Order *" required value={form.orderId} onChange={e => handleOrderSelect(e.target.value)} options={[{ label: 'Select Order...', value: '' }, ...orders.map((o: any) => ({ label: `${o.orderNumber || o.orderNo || '—'} — ${o.customer || o.customerName || '—'} (${fmtCurrency(o.total, company.currencySymbol)})`, value: o.id }))]} />
          </FormSection>
          {form.orderId && (
            <>
              <FormSection title="Invoice Details (Auto-Filled)">
                <div className="grid grid-cols-2 gap-4 bg-background p-4 rounded-xl border border-border mb-4">
                  <div><p className="text-xs text-muted uppercase font-semibold">Customer</p><p className="font-bold text-gray-800">{form.customer || '—'}</p></div>
                  <div><p className="text-xs text-muted uppercase font-semibold">Total Value</p><p className="font-bold text-emerald-600">{fmtCurrency(Number(form.total), company.currencySymbol)}</p></div>
                </div>
                <FormRow>
                  <Input label="Invoice Date" type="date" value={form.date} onChange={e => ctx.setForm({ ...form, date: e.target.value })} />
                  <Input label="Due Date" type="date" value={form.dueDate} onChange={e => ctx.setForm({ ...form, dueDate: e.target.value })} />
                </FormRow>
                <FormRow>
                  <Select label="Invoice Status" value={form.status} onChange={e => ctx.setForm({ ...form, status: e.target.value })} options={['Draft', 'Sent', 'Accepted', 'Cancelled'].map((s: string) => ({ label: s, value: s }))} />
                  <Select label="Payment Status" value={form.paymentStatus} onChange={e => ctx.setForm({ ...form, paymentStatus: e.target.value })} options={PAYMENT_STATUSES.map((s: string) => ({ label: s, value: s }))} />
                </FormRow>
              </FormSection>
              <FormSection title="Invoice Items (Read-Only Summary)">
                <InvoiceItemsDisplay items={items} currencySymbol={company.currencySymbol} subtotal={subtotal} taxAmount={taxAmount} discount={form.discount} grandTotal={ctx.grandTotal} onDiscountChange={v => ctx.setForm({ ...form, discount: v })} />
              </FormSection>
              <FormSection title="Additional Information">
                <Select label="Payment Mode" value={form.paymentMode} onChange={e => ctx.setForm({ ...form, paymentMode: e.target.value })} options={[{ label: 'Select Mode', value: '' }, ...PAYMENT_MODES.map((m: string) => ({ label: m, value: m }))]} />
                <Textarea label="Notes / Remarks" value={form.notes} onChange={e => ctx.setForm({ ...form, notes: e.target.value })} placeholder="Any additional notes for the invoice..." rows={2} />
              </FormSection>
            </>
          )}
          <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
            <Button variant="outline" type="button" onClick={closeForm}>Cancel</Button>
            <Button type="submit" disabled={!form.orderId} loading={save.isPending}>{editId ? 'Update Invoice' : 'Generate Invoice'}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={() => delId && del.mutate(delId, { onSuccess: () => { if (ctx.safeViewItem?.id === delId) closeInvoiceDetails(); } })}
        loading={del.isPending}
        title="Delete Invoice"
        message="Delete this invoice?"
      />
    </>
  );
}
