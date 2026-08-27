import { useEffect, useMemo, useState } from 'react';
import { Building2, CornerUpRight, Edit2, FileText, Printer, ShoppingCart, X } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { statusBadge } from '../../../components/ui/Badge';
import { fmtCurrency, fmtDate } from '../../../lib/firestore';
import { DetailCard, InvoiceField as Field } from '../../invoices/components/InvoiceWorkspaceParts';
import { quotationDisplayNumber } from '../utils/quotationEmail';

interface QuotationDetailModalProps {
  open: boolean;
  quotation: any;
  currencySymbol: string;
  orderNumberById: Map<string, string>;
  canDelete: boolean;
  canConvert: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSend: () => void;
  onDownload: () => void;
  onConvert: () => void;
  onOpenProject?: () => void;
  onDelete: () => void;
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString('en-GB') : '—';
}

// This modal deliberately mirrors InvoiceDetailModal.tsx (same Modal size,
// header layout, tab pattern, footer button row, DetailCard/Field building
// blocks) — the goal is one consistent document-preview system across
// Invoice and Quotation, not two visually different popups.
export function QuotationDetailModal({
  open,
  quotation,
  currencySymbol,
  orderNumberById,
  canDelete,
  canConvert,
  onClose,
  onEdit,
  onSend,
  onDownload,
  onConvert,
  onOpenProject,
  onDelete,
}: QuotationDetailModalProps) {
  const [detailsTab, setDetailsTab] = useState<'overview' | 'items' | 'notes' | 'documents'>('overview');

  useEffect(() => {
    if (open) setDetailsTab('overview');
  }, [open, quotation?.id]);

  const isConverted = Boolean(quotation?.convertedOrderId) || quotation?.status === 'Converted to Order';
  const canShowConvert = canConvert && !isConverted && quotation?.status !== 'Rejected';
  const quotationItems = Array.isArray(quotation?.items) ? quotation.items : [];
  const subtotal = useMemo(
    () => quotationItems.reduce((sum: number, item: any) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0),
    [quotationItems],
  );
  const taxAmount = useMemo(
    () => quotationItems.reduce((sum: number, item: any) => {
      const lineTotal = (Number(item.qty) || 0) * (Number(item.price) || 0);
      return sum + lineTotal * ((Number(item.tax) || 0) / 100);
    }, 0),
    [quotationItems],
  );
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'items', label: 'Items' },
    { key: 'notes', label: 'Notes' },
    { key: 'documents', label: 'Documents' },
  ] as const;

  return (
    <Modal
      open={!!quotation && open}
      onClose={onClose}
      size="2xl"
      footer={quotation ? (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>
          <Button variant="outline" size="sm" icon={<CornerUpRight className="h-3.5 w-3.5" />} onClick={onSend}>Send Email</Button>
          <Button variant="outline" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={onDownload}>Download PDF</Button>
          {canShowConvert && <Button variant="outline" size="sm" icon={<ShoppingCart className="h-3.5 w-3.5" />} onClick={onConvert}>Convert to Order</Button>}
          {onOpenProject && <Button variant="outline" size="sm" icon={<Building2 className="h-3.5 w-3.5" />} onClick={onOpenProject}>Open Project Workspace</Button>}
          {canDelete && <Button variant="danger" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={onDelete}>Delete</Button>}
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      ) : undefined}
    >
      {quotation && (
        <div className="flex h-[78vh] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
          <header className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
                {(quotation.customer || quotationDisplayNumber(quotation) || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{quotationDisplayNumber(quotation)}</h2>
                  {statusBadge(quotation.status || 'Draft')}
                  {isConverted && statusBadge('Converted to Order')}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                  <span>{quotation.customer || 'Customer not available'}</span>
                  <span>Created: {formatDate(quotation.date || quotation.createdAt)}</span>
                  <span>Valid Until: {formatDate(quotation.validUntil)}</span>
                  {quotation.assignedToName && <span>Assigned: {quotation.assignedToName}</span>}
                </div>
              </div>
            </div>

            <button onClick={onClose} aria-label="Close quotation details" className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
              <X className="h-4 w-4" />
            </button>
          </header>

          <nav className="shrink-0 grid grid-cols-2 gap-1 border-b border-[var(--color-border-subtle)] py-4 sm:grid-cols-4">
            {tabs.map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setDetailsTab(tab.key)}
                className={[
                  'rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors',
                  detailsTab === tab.key
                    ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto transition-opacity duration-150">
            {detailsTab === 'overview' && (
              <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="space-y-5">
                  <DetailCard title="Quotation Summary">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Customer" value={quotation.customer || '—'} />
                      <Field label="Linked Order" value={orderNumberById.get(String(quotation.orderId)) || '—'} />
                      <Field label="Status">{statusBadge(quotation.status || 'Draft')}</Field>
                      <Field label="Project" value={quotation.projectId || '—'} />
                      <Field label="Quotation Date" value={formatDate(quotation.date || quotation.createdAt)} />
                      <Field label="Valid Until" value={formatDate(quotation.validUntil)} />
                      <Field label="Customer GST" value={quotation.customerGst || '—'} />
                      <Field label="Grand Total" value={fmtCurrency(quotation.total || 0, currencySymbol)} />
                    </div>
                  </DetailCard>

                  <DetailCard title="Terms & Conditions">
                    {quotation.terms ? (
                      <p className="whitespace-pre-wrap leading-relaxed text-[var(--color-text)]">{quotation.terms}</p>
                    ) : (
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-5 text-sm text-[var(--color-text-muted)]">
                        No terms have been recorded for this quotation.
                      </div>
                    )}
                  </DetailCard>
                </div>

                <aside className="space-y-4">
                  <DetailCard title="Created">
                    <div className="space-y-1">
                      <p className="font-semibold text-[var(--color-text)]">{formatDate(quotation.createdAt || quotation.date)}</p>
                      {quotation.createdByName && <p className="text-xs text-[var(--color-text-muted)]">{quotation.createdByName}</p>}
                    </div>
                  </DetailCard>

                  <DetailCard title="Quick Actions">
                    <div className="space-y-2" data-action>
                      <Button className="w-full justify-start" variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={onEdit}>Edit Quotation</Button>
                      <Button className="w-full justify-start border-[var(--color-primary-muted)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)]" variant="outline" size="sm" icon={<CornerUpRight className="h-3.5 w-3.5" />} onClick={onSend}>Send Email</Button>
                      <Button className="w-full justify-start" variant="outline" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={onDownload}>Download PDF</Button>
                      {canShowConvert && <Button className="w-full justify-start border-[var(--color-primary-muted)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)]" variant="outline" size="sm" icon={<ShoppingCart className="h-3.5 w-3.5" />} onClick={onConvert}>Convert to Order</Button>}
                      {onOpenProject && <Button className="w-full justify-start" variant="outline" size="sm" icon={<Building2 className="h-3.5 w-3.5" />} onClick={onOpenProject}>Open Project Workspace</Button>}
                    </div>
                  </DetailCard>
                </aside>
              </div>
            )}

            {detailsTab === 'items' && (
              <div className="pt-5">
                <DetailCard title="Quotation Items">
                  {quotationItems.length ? (
                    <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
                      <div className="max-h-[42vh] overflow-auto">
                        <table className="min-w-full text-xs">
                          <thead className="sticky top-0 z-10 bg-[var(--color-bg-sunken)]">
                            <tr>
                              {['Product', 'Qty', 'Unit Price', 'Tax %', 'Total'].map((h) => (
                                <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-surface)]">
                            {quotationItems.map((item: any, idx: number) => {
                              const lineTotal = (Number(item.qty) || 0) * (Number(item.price) || 0);
                              return (
                                <tr key={idx}>
                                  <td className="px-3 py-2 text-[var(--color-text)]">{item.product || 'Item'}</td>
                                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.qty || 0}</td>
                                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{fmtCurrency(Number(item.price) || 0, currencySymbol)}</td>
                                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{Number(item.tax) || 0}</td>
                                  <td className="px-3 py-2 font-semibold text-[var(--color-text)]">{fmtCurrency(lineTotal, currencySymbol)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-5 text-sm text-[var(--color-text-muted)]">
                      No line items available for this quotation.
                    </div>
                  )}
                  <div className="mt-4 flex justify-end">
                    <div className="w-full max-w-sm rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4">
                      <div className="flex justify-between text-sm text-[var(--color-text-secondary)]">
                        <span>Subtotal</span>
                        <span className="font-semibold text-[var(--color-text)]">{fmtCurrency(quotation.subtotal ?? subtotal, currencySymbol)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-[var(--color-text-secondary)]">
                        <span>Tax</span>
                        <span className="font-semibold text-[var(--color-text)]">{fmtCurrency(quotation.taxTotal ?? taxAmount, currencySymbol)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-[var(--color-text-secondary)]">
                        <span>Discount</span>
                        <span className="font-semibold text-[var(--color-text)]">{fmtCurrency(quotation.discount || quotation.specialDiscount || 0, currencySymbol)}</span>
                      </div>
                      <div className="mt-2 flex justify-between border-t border-[var(--color-border-subtle)] pt-2">
                        <span className="font-semibold text-[var(--color-text)]">Grand Total</span>
                        <span className="font-semibold text-[var(--color-text)]">{fmtCurrency(quotation.total || 0, currencySymbol)}</span>
                      </div>
                    </div>
                  </div>
                </DetailCard>
              </div>
            )}

            {detailsTab === 'notes' && (
              <div className="pt-5">
                <DetailCard title="Notes">
                  {quotation.notes ? (
                    <div className="space-y-3">
                      <p className="whitespace-pre-wrap rounded-xl bg-[var(--color-bg-sunken)] p-4 text-[var(--color-text)]">{quotation.notes}</p>
                      <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                        <span>{quotation.createdByName || quotation.createdBy || 'System'}</span>
                        <span>{formatDate(quotation.updatedAt || quotation.createdAt)}</span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">No notes have been recorded.</span>
                  )}
                </DetailCard>
              </div>
            )}

            {detailsTab === 'documents' && (
              <div className="pt-5">
                <DetailCard title="Documents">
                  <div className="space-y-3">
                    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <p className="font-semibold text-[var(--color-text)]">Quotation PDF</p>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Use Download PDF to open the printable document.</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <p className="font-semibold text-[var(--color-text)]">Linked Order</p>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{orderNumberById.get(String(quotation.orderId)) || '—'}</p>
                    </div>
                    {quotation.projectId && (
                      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                        <p className="font-semibold text-[var(--color-text)]">Linked Project</p>
                        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{quotation.projectId}</p>
                      </div>
                    )}
                  </div>
                </DetailCard>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
