import { useMemo } from 'react';
import { CheckCircle2, Edit2, FileText, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/shared';
import { FilterBar } from '../../../components/ui/FilterBar';
import { Input, Select, Textarea, FormRow, FormSection } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { Pagination } from '../../../components/ui/Pagination';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../../../components/ui/Table';
import { statusBadge } from '../../../components/ui/Badge';
import { fmtCurrency } from '../../../lib/firestore';
import type { CompanyConfig, Order, Product, ProformaInvoice } from '../../../types';
import type { TaxInvoiceFormState, TaxInvoiceRecord } from '../types';
import { buildTaxInvoiceFormFromRecord, recalculateTaxInvoiceForm } from '../utils';

type TaxInvoiceWorkspacePanelProps = {
  invoices: TaxInvoiceRecord[];
  isLoading: boolean;
  search: string;
  onSearch: (value: string) => void;
  statusFilter: string;
  onStatusFilter: (value: string) => void;
  filteredCount: number;
  totalCount: number;
  onClearFilters: () => void;
  page: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  onOpen: (invoice: TaxInvoiceRecord) => void;
  onEdit: (invoice: TaxInvoiceRecord) => void;
  onIssue: (invoice: TaxInvoiceRecord) => void;
  onCancel: (invoice: TaxInvoiceRecord) => void;
  currencySymbol: string;
};

export function TaxInvoiceWorkspacePanel({
  invoices,
  isLoading,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  filteredCount,
  totalCount,
  onClearFilters,
  page,
  perPage,
  onPageChange,
  onPerPageChange,
  selected,
  onToggleSelect,
  onToggleAll,
  allSelected,
  onOpen,
  onEdit,
  onIssue,
  onCancel,
  currencySymbol,
}: TaxInvoiceWorkspacePanelProps) {
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-enterprise-surface)]">
      <FilterBar
        search={search}
        onSearch={onSearch}
        searchPlaceholder="Search invoice number, customer…"
        filters={[
          {
            label: 'Status',
            value: statusFilter,
            onChange: onStatusFilter,
            options: [
              { label: 'All Status', value: '' },
              { label: 'Draft', value: 'Draft' },
              { label: 'Issued', value: 'Issued' },
              { label: 'Cancelled', value: 'Cancelled' },
            ],
          },
        ]}
        count={filteredCount}
        total={totalCount}
        label="tax invoices"
        onClearAll={onClearFilters}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Table className="min-h-0 flex-1 overflow-y-auto">
          <Thead>
            <Th className="w-8">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} className="cursor-pointer rounded border-[var(--color-border)] text-indigo-600" />
            </Th>
            <Th>INVOICE ID</Th>
            <Th>CUSTOMER</Th>
            <Th>DATE</Th>
            <Th>PLACE OF SUPPLY</Th>
            <Th>VALUE</Th>
            <Th>STATUS</Th>
            <Th>ACTIONS</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <SkeletonRows cols={8} />
            ) : invoices.length === 0 ? (
              <EmptyState variant="table" colSpan={8} title="No tax invoices found" description="Create the first GST invoice from an order or proforma invoice." />
            ) : invoices.map((invoice) => (
              <Tr
                key={invoice.id}
                selected={selected.has(invoice.id)}
                role="button"
                tabIndex={0}
                className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-enterprise-row)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-inset"
                onClick={() => onOpen(invoice)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen(invoice);
                  }
                }}
              >
                <Td>
                  <input
                    type="checkbox"
                    checked={selected.has(invoice.id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => onToggleSelect(invoice.id)}
                    className="cursor-pointer rounded border-[var(--color-border)] text-indigo-600"
                  />
                </Td>
                <Td className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{invoice.invoiceNumber || invoice.id}</Td>
                <Td className="text-xs font-medium">{invoice.customerName || '—'}</Td>
                <Td className="text-xs text-[var(--color-text-muted)]">{invoice.date || '—'}</Td>
                <Td className="text-xs text-[var(--color-text-muted)]">{invoice.placeOfSupply || '—'}</Td>
                <Td className="text-sm font-semibold">{fmtCurrency(invoice.total, currencySymbol)}</Td>
                <Td>{statusBadge(invoice.status || 'Draft')}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-1 opacity-80 transition-opacity duration-150 group-hover:opacity-100" data-action>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); onOpen(invoice); }}
                      className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[var(--shadow-enterprise-row)]"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      View
                    </button>
                    {invoice.status === 'Draft' && (
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); onEdit(invoice); }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-primary-text)] transition-colors hover:bg-[var(--color-primary-light)]"
                        title="Edit draft"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {invoice.status === 'Draft' && (
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); onIssue(invoice); }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-emerald-600 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                        title="Issue invoice"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {invoice.status !== 'Cancelled' && (
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); onCancel(invoice); }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-900/30"
                        title="Cancel invoice"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      <Pagination page={page} total={filteredCount} perPage={perPage} onChange={onPageChange} onPerPageChange={onPerPageChange} />
    </Card>
  );
}

type TaxInvoiceEditorModalProps = {
  open: boolean;
  title: string;
  form: TaxInvoiceFormState;
  setForm: (updater: TaxInvoiceFormState | ((current: TaxInvoiceFormState) => TaxInvoiceFormState)) => void;
  onClose: () => void;
  onSubmit: () => void;
  loading: boolean;
  company: CompanyConfig;
  products: Product[];
  orders: Order[];
  proformaInvoices: ProformaInvoice[];
  onLoadSource: () => void;
  editMode: boolean;
};

export function TaxInvoiceEditorModal({
  open,
  title,
  form,
  setForm,
  onClose,
  onSubmit,
  loading,
  company,
  products,
  orders,
  proformaInvoices,
  onLoadSource,
  editMode,
}: TaxInvoiceEditorModalProps) {
  const productOptions = useMemo(() => products.map((product) => ({
    label: `${product.name}${(product as any).hsn ? ` · HSN ${(product as any).hsn}` : ''}`,
    value: product.id,
  })), [products]);
  const orderOptions = useMemo(() => orders.map((order) => ({
    label: `${(order as any).orderNumber || (order as any).orderNo || order.id} — ${order.customer || (order as any).customerName || 'Customer'}`,
    value: order.id,
  })), [orders]);
  const piOptions = useMemo(() => proformaInvoices.map((pi) => ({
    label: `${(pi as any).invoiceNumber || (pi as any).piNumber || pi.id} — ${pi.customer || (pi as any).customerName || 'Customer'}`,
    value: pi.id,
  })), [proformaInvoices]);

  const breakdown = useMemo(() => {
    try {
      return recalculateTaxInvoiceForm(form);
    } catch {
      return {
        placeOfSupply: form.placeOfSupply || company.state || '—',
        subtotal: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        totalTax: 0,
        total: 0,
      } as const;
    }
  }, [company.state, form]);
  const readOnly = editMode && form.status !== 'Draft';

  function updateItem(index: number, field: keyof TaxInvoiceFormState['items'][number], value: string | number) {
    setForm((current) => {
      const items = current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = { ...item, [field]: value } as TaxInvoiceFormState['items'][number];
        if (field === 'productId') {
          const product = products.find((entry) => entry.id === value);
          if (product) {
            next.product = product.name;
            next.description = product.description || product.name;
            next.hsn = (product as any).hsn || next.hsn || '';
            next.rate = Number(product.price) || 0;
            next.taxRate = Number(product.tax) || 0;
          }
        }
        return next;
      });
      return { ...current, items };
    });
  }

  function addItem() {
    setForm((current) => ({
      ...current,
      items: [...current.items, { productId: '', product: '', description: '', hsn: '', quantity: 1, rate: 0, taxRate: 0 }],
    }));
  }

  function removeItem(index: number) {
    setForm((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function onSourceTypeChange(sourceType: string) {
    setForm((current) => ({ ...current, sourceType: sourceType as TaxInvoiceFormState['sourceType'], sourceId: '' }));
  }

  function onSourceIdChange(sourceId: string) {
    setForm((current) => ({ ...current, sourceId }));
  }

  function renderLineRows() {
    return form.items.map((item, index) => (
      <tr key={`${item.productId || index}-${index}`} className="border-b border-[var(--color-border-subtle)] last:border-0">
        <td className="px-2 py-2">
          <Select
            value={item.productId || ''}
            onChange={(event) => updateItem(index, 'productId', event.target.value)}
            options={[{ label: 'Select Product', value: '' }, ...productOptions]}
            disabled={readOnly}
          />
        </td>
        <td className="px-2 py-2">
          <Input value={item.description || ''} onChange={(event) => updateItem(index, 'description', event.target.value)} disabled={readOnly} />
        </td>
        <td className="px-2 py-2">
          <Input value={item.hsn || ''} onChange={(event) => updateItem(index, 'hsn', event.target.value)} disabled={readOnly} />
        </td>
        <td className="px-2 py-2">
          <Input type="number" min="0" step="0.01" value={String(item.quantity)} onChange={(event) => updateItem(index, 'quantity', Number(event.target.value))} disabled={readOnly} />
        </td>
        <td className="px-2 py-2">
          <Input type="number" min="0" step="0.01" value={String(item.rate)} onChange={(event) => updateItem(index, 'rate', Number(event.target.value))} disabled={readOnly} />
        </td>
        <td className="px-2 py-2">
          <Input type="number" min="0" step="0.01" value={String(item.taxRate)} onChange={(event) => updateItem(index, 'taxRate', Number(event.target.value))} disabled={readOnly} />
        </td>
        <td className="px-2 py-2 text-right text-sm font-semibold text-[var(--color-text)]">
          {fmtCurrency(((Number(item.quantity) || 0) * (Number(item.rate) || 0)) + (((Number(item.quantity) || 0) * (Number(item.rate) || 0) * (Number(item.taxRate) || 0)) / 100), company.currencySymbol)}
        </td>
        <td className="px-2 py-2 text-right">
          {!readOnly && (
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-900/30"
              title="Remove row"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </td>
      </tr>
    ));
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="5xl">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="space-y-5"
      >
        <FormSection title="Source">
          <FormRow>
            <Select
              label="Source Type"
              value={form.sourceType}
              onChange={(event) => onSourceTypeChange(event.target.value)}
              options={[
                { label: 'Order', value: 'order' },
                { label: 'Proforma Invoice', value: 'proforma_invoice' },
              ]}
              disabled={readOnly}
            />
            <Select
              label={form.sourceType === 'order' ? 'Source Order' : 'Source Proforma Invoice'}
              value={form.sourceId}
              onChange={(event) => onSourceIdChange(event.target.value)}
              options={[
                { label: form.sourceType === 'order' ? 'Select Order...' : 'Select Proforma Invoice...', value: '' },
                ...(form.sourceType === 'order' ? orderOptions : piOptions),
              ]}
              disabled={readOnly}
            />
          </FormRow>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={onLoadSource} disabled={readOnly || !form.sourceId}>
              Load Source
            </Button>
            <span className="text-xs text-[var(--color-text-muted)]">
              Source data is pulled from the selected document and can be adjusted before issue.
            </span>
          </div>
        </FormSection>

        <FormSection title="Invoice Details">
          <FormRow>
            <Input label="Invoice Date" type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} disabled={readOnly} />
            <Input label="Invoice Number" value={form.invoiceNumber || 'Will be assigned on save'} disabled />
          </FormRow>
          <FormRow>
            <Input label="Company" value={form.companyName || company.shortName || company.name} disabled />
            <Input label="Company GSTIN" value={form.companyGst || company.gst || '—'} disabled />
          </FormRow>
          <FormRow>
            <Input label="Customer" value={form.customerName} onChange={(event) => setForm((current) => ({ ...current, customerName: event.target.value }))} disabled={readOnly} />
            <Input label="Customer GSTIN" value={form.customerGst} onChange={(event) => setForm((current) => ({ ...current, customerGst: event.target.value.toUpperCase() }))} disabled={readOnly} />
          </FormRow>
          <FormRow>
            <Input label="Customer State" value={form.customerState} onChange={(event) => setForm((current) => ({ ...current, customerState: event.target.value }))} disabled={readOnly} />
            <Input label="Place of Supply" value={breakdown.placeOfSupply} disabled />
          </FormRow>
        </FormSection>

        <FormSection title="Line Items">
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--color-bg-sunken)] text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-2 py-2 text-left">Product</th>
                  <th className="px-2 py-2 text-left">Description</th>
                  <th className="px-2 py-2 text-left">HSN</th>
                  <th className="px-2 py-2 text-left">Qty</th>
                  <th className="px-2 py-2 text-left">Rate</th>
                  <th className="px-2 py-2 text-left">GST %</th>
                  <th className="px-2 py-2 text-right">Line Total</th>
                  <th className="px-2 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>{renderLineRows()}</tbody>
            </table>
          </div>
          {!readOnly && (
            <Button type="button" variant="outline" onClick={addItem} className="mt-3" icon={<Plus className="h-4 w-4" />}>
              Add Line Item
            </Button>
          )}
        </FormSection>

        <FormSection title="GST Summary">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Sub Total" value={fmtCurrency(breakdown.subtotal, company.currencySymbol)} />
            <SummaryCard label="CGST" value={fmtCurrency(breakdown.cgst, company.currencySymbol)} />
            <SummaryCard label="SGST" value={fmtCurrency(breakdown.sgst, company.currencySymbol)} />
            <SummaryCard label="IGST" value={fmtCurrency(breakdown.igst, company.currencySymbol)} />
            <SummaryCard label="Total Tax" value={fmtCurrency(breakdown.totalTax, company.currencySymbol)} />
            <SummaryCard label="Grand Total" value={fmtCurrency(breakdown.total, company.currencySymbol)} highlight />
          </div>
        </FormSection>

        <FormSection title="Additional Information">
          <Textarea
            label="Notes"
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            rows={3}
            disabled={readOnly}
          />
          {editMode && (
            <Input label="Status" value={form.status} disabled />
          )}
        </FormSection>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] pt-4">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          {!readOnly && (
            <Button type="submit" loading={loading}>
              {editMode ? 'Update Draft' : 'Save Draft'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

type TaxInvoiceDetailModalProps = {
  open: boolean;
  invoice: TaxInvoiceRecord | null;
  onClose: () => void;
  onEdit: (invoice: TaxInvoiceRecord) => void;
  onIssue: (invoice: TaxInvoiceRecord) => void;
  onCancel: (invoice: TaxInvoiceRecord) => void;
  currencySymbol: string;
};

export function TaxInvoiceDetailModal({
  open,
  invoice,
  onClose,
  onEdit,
  onIssue,
  onCancel,
  currencySymbol,
}: TaxInvoiceDetailModalProps) {
  const summary = useMemo(() => {
    if (!invoice) {
      return {
        placeOfSupply: '—',
        subtotal: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        totalTax: 0,
        total: 0,
      } as const;
    }
    try {
      return recalculateTaxInvoiceForm(buildTaxInvoiceFormFromRecord(invoice));
    } catch {
      return {
        placeOfSupply: invoice.placeOfSupply || '—',
        subtotal: invoice.subtotal || 0,
        cgst: invoice.cgst || 0,
        sgst: invoice.sgst || 0,
        igst: invoice.igst || 0,
        totalTax: invoice.totalTax || 0,
        total: invoice.total || 0,
      } as const;
    }
  }, [invoice]);

  if (!invoice) return null;
  const isDraft = invoice.status === 'Draft';
  const isIssued = invoice.status === 'Issued';

  return (
    <Modal open={open} onClose={onClose} title={invoice.invoiceNumber || 'Tax Invoice'} size="3xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] pb-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--color-text)]">{invoice.invoiceNumber}</h2>
            <p className="text-sm text-[var(--color-text-muted)]">{invoice.customerName || 'Customer'}</p>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(invoice.status)}
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => onClose()}>
              Close
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoCard label="Invoice Date" value={invoice.date || '—'} />
          <InfoCard label="Source" value={invoice.sourceType === 'order' ? `Order: ${invoice.orderId || invoice.sourceId}` : `PI: ${invoice.sourcePiId || invoice.sourceId}`} />
          <InfoCard label="Place of Supply" value={invoice.placeOfSupply || '—'} />
          <InfoCard label="Company GSTIN" value={invoice.companyGst || '—'} />
          <InfoCard label="Customer GSTIN" value={invoice.customerGst || '—'} />
          <InfoCard label="Status" value={invoice.status} />
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-bg-sunken)] text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">HSN</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Rate</th>
                <th className="px-3 py-2 text-right">GST</th>
                <th className="px-3 py-2 text-right">Taxable</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, index) => (
                <tr key={`${item.productId || item.product || index}-${index}`} className="border-b border-[var(--color-border-subtle)] last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-medium text-[var(--color-text)]">{item.product || item.description || '—'}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{item.description || '—'}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">{item.hsn || '—'}</td>
                  <td className="px-3 py-2 text-right">{item.quantity}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(item.rate, currencySymbol)}</td>
                  <td className="px-3 py-2 text-right">
                    {item.cgst || item.sgst ? `${item.cgstRate + item.sgstRate}%` : `${item.igstRate}%`}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(item.taxableValue, currencySymbol)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtCurrency(item.lineTotal, currencySymbol)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoCard label="Sub Total" value={fmtCurrency(summary.subtotal, currencySymbol)} />
          <InfoCard label="CGST" value={fmtCurrency(summary.cgst, currencySymbol)} />
          <InfoCard label="SGST" value={fmtCurrency(summary.sgst, currencySymbol)} />
          <InfoCard label="IGST" value={fmtCurrency(summary.igst, currencySymbol)} />
          <InfoCard label="Total Tax" value={fmtCurrency(summary.totalTax, currencySymbol)} />
          <InfoCard label="Grand Total" value={fmtCurrency(summary.total, currencySymbol)} highlight />
        </div>

        {invoice.notes && (
          <InfoCard label="Notes" value={invoice.notes} />
        )}

        {(invoice.status === 'Draft' || invoice.status === 'Issued') && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-subtle)] pt-4">
            {isDraft && <Button variant="outline" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => onEdit(invoice)}>Edit Draft</Button>}
            {isDraft && <Button icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => onIssue(invoice)}>Issue</Button>}
            {(isDraft || isIssued) && <Button variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onCancel(invoice)}>Cancel</Button>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function SummaryCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${highlight ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]'}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${highlight ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text)]'}`}>{value}</p>
    </div>
  );
}

function InfoCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${highlight ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]'}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${highlight ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text)]'}`}>{value}</p>
    </div>
  );
}
