import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CornerUpRight, Edit2, FileText, Printer, X } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { statusBadge } from '../../../components/ui/Badge';
import { fmtCurrency, fmtDate } from '../../../lib/firestore';
import { DetailCard, InvoiceField } from './InvoiceWorkspaceParts';

interface InvoiceDetailModalProps {
  open: boolean;
  invoice: any;
  currencySymbol: string;
  orderNumberById: Map<string, string>;
  canDelete: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSend: () => void;
  onSendReminder?: () => void;
  onDownload: () => void;
  onDuplicate: () => void;
  onMarkPaid: () => void;
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

function formatTime(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
}

function daysAgoText(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'Not available';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(date); then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function invoiceDisplayNumber(inv: any): string {
  return String(inv?.invoiceNumber || inv?.piNumber || '').trim() || '—';
}

export function InvoiceDetailModal({
  open,
  invoice,
  currencySymbol,
  orderNumberById,
  canDelete,
  onClose,
  onEdit,
  onSend,
  onSendReminder,
  onDownload,
  onDuplicate,
  onMarkPaid,
  onDelete,
}: InvoiceDetailModalProps) {
  const [detailsTab, setDetailsTab] = useState<'overview' | 'items' | 'activity' | 'notes' | 'payments' | 'documents'>('overview');

  useEffect(() => {
    if (open) setDetailsTab('overview');
  }, [open, invoice?.id]);

  const createdBy = invoice?.createdByName || invoice?.updatedByName || 'System';
  const paymentLogs = useMemo(() => [
    { type: 'Created', desc: 'Invoice record created', date: invoice?.createdAt || invoice?.date, userName: createdBy },
    ...(invoice?.updatedAt ? [{ type: 'Updated', desc: 'Invoice was updated', date: invoice.updatedAt, userName: invoice?.updatedByName || createdBy }] : []),
    ...(invoice?.paymentStatus === 'Paid' ? [{ type: 'Paid', desc: 'Invoice marked as paid', date: invoice?.paidAt || invoice?.updatedAt || invoice?.createdAt, userName: invoice?.updatedByName || createdBy }] : []),
  ], [createdBy, invoice]);
  const invoiceItems = Array.isArray(invoice?.items) ? invoice.items : [];
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'items', label: 'Items' },
    { key: 'activity', label: 'Activity Timeline' },
    { key: 'notes', label: 'Notes' },
    { key: 'payments', label: 'Payment History' },
    { key: 'documents', label: 'Documents' },
  ] as const;

  return (
    <Modal
      open={!!invoice && open}
      onClose={onClose}
      size="2xl"
      footer={invoice ? (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>
          <Button variant="outline" size="sm" icon={<CornerUpRight className="h-3.5 w-3.5" />} onClick={onSend}>Send Email</Button>
          <Button variant="outline" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={onDownload}>Download PDF</Button>
          <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={onDuplicate}>Duplicate</Button>
          {onSendReminder && String(invoice?.paymentStatus || '').toLowerCase() !== 'paid' ? <Button variant="outline" size="sm" icon={<CornerUpRight className="h-3.5 w-3.5" />} onClick={onSendReminder}>Send Reminder</Button> : null}
          <Button variant="outline" size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={onMarkPaid}>Mark Paid</Button>
          {canDelete && <Button variant="danger" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={onDelete}>Delete</Button>}
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      ) : undefined}
    >
      {invoice && (
        <div className="flex h-[78vh] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
          <header className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
                {(invoice.customer || invoiceDisplayNumber(invoice) || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{invoiceDisplayNumber(invoice)}</h2>
                  {statusBadge(invoice.status || 'Draft')}
                  {statusBadge(invoice.paymentStatus || 'Pending')}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                  <span>{invoice.customer || 'Customer not available'}</span>
                  <span>Created: {formatDate(invoice.date || invoice.createdAt)}</span>
                  <span>Due: {formatDate(invoice.dueDate)}</span>
                  <span>Assigned User: {createdBy}</span>
                </div>
              </div>
            </div>

            <button onClick={onClose} aria-label="Close invoice details" className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
              <X className="h-4 w-4" />
            </button>
          </header>

          <nav className="shrink-0 grid grid-cols-2 gap-1 border-b border-[var(--color-border-subtle)] py-4 sm:grid-cols-3 lg:grid-cols-6">
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
                  <DetailCard title="Invoice Summary">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <InvoiceField label="Customer" value={invoice.customer || '—'} />
                      <InvoiceField label="Linked Order" value={orderNumberById.get(String(invoice.orderId)) || '—'} />
                      <InvoiceField label="Invoice Status">{statusBadge(invoice.status || 'Draft')}</InvoiceField>
                      <InvoiceField label="Payment Status">{statusBadge(invoice.paymentStatus || 'Pending')}</InvoiceField>
                      <InvoiceField label="Invoice Date" value={formatDate(invoice.date || invoice.createdAt)} />
                      <InvoiceField label="Due Date" value={formatDate(invoice.dueDate)} />
                      <InvoiceField label="Payment Mode" value={invoice.paymentMode || '—'} />
                      <InvoiceField label="Grand Total" value={fmtCurrency(invoice.total || 0, currencySymbol)} />
                    </div>
                  </DetailCard>

                  <DetailCard title="Notes">
                    {invoice.notes ? (
                      <p className="whitespace-pre-wrap leading-relaxed text-[var(--color-text)]">{invoice.notes}</p>
                    ) : (
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-5 text-sm text-[var(--color-text-muted)]">
                        No notes have been recorded for this invoice.
                      </div>
                    )}
                  </DetailCard>
                </div>

                <aside className="space-y-4">
                  <DetailCard title="Created">
                    <div className="space-y-1">
                      <p className="font-semibold text-[var(--color-text)]">{formatDate(invoice.createdAt || invoice.date)}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{formatTime(invoice.createdAt || invoice.date)}</p>
                      <p className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
                        {daysAgoText(invoice.createdAt || invoice.date)}
                      </p>
                    </div>
                  </DetailCard>

                  <DetailCard title="Quick Actions">
                    <div className="space-y-2" data-action>
                      <Button className="w-full justify-start" variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={onEdit}>Edit Invoice</Button>
                      <Button className="w-full justify-start border-[var(--color-primary-muted)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)]" variant="outline" size="sm" icon={<CornerUpRight className="h-3.5 w-3.5" />} onClick={onSend}>Send Email</Button>
                      <Button className="w-full justify-start" variant="outline" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={onDownload}>Download PDF</Button>
                      <Button className="w-full justify-start" variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={onDuplicate}>Duplicate</Button>
                      {onSendReminder && String(invoice?.paymentStatus || '').toLowerCase() !== 'paid' ? <Button className="w-full justify-start border-[var(--color-primary-muted)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)]" variant="outline" size="sm" icon={<CornerUpRight className="h-3.5 w-3.5" />} onClick={onSendReminder}>Send Reminder</Button> : null}
                      <Button className="w-full justify-start border-[var(--color-primary-muted)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)]" variant="outline" size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={onMarkPaid}>Mark Paid</Button>
                    </div>
                  </DetailCard>
                </aside>
              </div>
            )}

            {detailsTab === 'items' && (
              <div className="pt-5">
                <DetailCard title="Invoice Items">
                  {invoiceItems.length ? (
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
                            {invoiceItems.map((item: any, idx: number) => {
                              const lineTotal = (Number(item.qty) || 0) * (Number(item.price) || 0);
                              return (
                                <tr key={idx}>
                                  <td className="px-3 py-2 text-[var(--color-text)]">{item.product || 'Item'}</td>
                                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.qty || 0} {item.unit || ''}</td>
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
                      No line items available for this invoice.
                    </div>
                  )}
                  <div className="mt-4 flex justify-end">
                    <div className="w-full max-w-sm rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4">
                      <div className="flex justify-between text-sm text-[var(--color-text-secondary)]">
                        <span>Subtotal</span>
                        <span className="font-semibold text-[var(--color-text)]">{fmtCurrency(invoice.subtotal || 0, currencySymbol)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-[var(--color-text-secondary)]">
                        <span>Tax</span>
                        <span className="font-semibold text-[var(--color-text)]">{fmtCurrency(invoice.taxAmount || 0, currencySymbol)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-[var(--color-text-secondary)]">
                        <span>Discount</span>
                        <span className="font-semibold text-[var(--color-text)]">{fmtCurrency(invoice.discount || 0, currencySymbol)}</span>
                      </div>
                      <div className="mt-2 flex justify-between border-t border-[var(--color-border-subtle)] pt-2">
                        <span className="font-semibold text-[var(--color-text)]">Grand Total</span>
                        <span className="font-semibold text-[var(--color-text)]">{fmtCurrency(invoice.total || 0, currencySymbol)}</span>
                      </div>
                    </div>
                  </div>
                </DetailCard>
              </div>
            )}

            {detailsTab === 'activity' && (
              <div className="pt-5">
                <DetailCard title="Activity Timeline">
                  <div className="space-y-3">
                    {paymentLogs.length ? paymentLogs.map((log: any, idx: number) => (
                      <div key={`${log.type}-${idx}`} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-[var(--color-text)]">{log.type}</p>
                            <time className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">{formatDate(log.date)} {formatTime(log.date)}</time>
                          </div>
                          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{log.desc}</p>
                          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{log.userName || 'System'}</p>
                        </div>
                      </div>
                    )) : <span className="text-[var(--color-text-muted)]">No activity recorded yet.</span>}
                  </div>
                </DetailCard>
              </div>
            )}

            {detailsTab === 'notes' && (
              <div className="pt-5">
                <DetailCard title="Notes">
                  {invoice.notes ? (
                    <div className="space-y-3">
                      <p className="whitespace-pre-wrap rounded-xl bg-[var(--color-bg-sunken)] p-4 text-[var(--color-text)]">{invoice.notes}</p>
                      <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                        <span>{createdBy}</span>
                        <span>{formatDate(invoice.updatedAt || invoice.createdAt)}</span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">No notes have been recorded.</span>
                  )}
                </DetailCard>
              </div>
            )}

            {detailsTab === 'payments' && (
              <div className="pt-5">
                <DetailCard title="Payment History">
                  <div className="space-y-3">
                    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <p className="font-semibold text-[var(--color-text)]">Current Payment Status</p>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{statusBadge(invoice.paymentStatus || 'Pending')}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <p className="font-semibold text-[var(--color-text)]">Paid At</p>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{formatDate(invoice.paidAt || invoice.updatedAt || invoice.createdAt)} · {formatTime(invoice.paidAt || invoice.updatedAt || invoice.createdAt)}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <p className="font-semibold text-[var(--color-text)]">Balance</p>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{fmtCurrency(Math.max(0, Number(invoice.total || 0) - Number(invoice.amountPaid || invoice.paidAmount || 0)), currencySymbol)}</p>
                    </div>
                  </div>
                </DetailCard>
              </div>
            )}

            {detailsTab === 'documents' && (
              <div className="pt-5">
                <DetailCard title="Documents">
                  <div className="space-y-3">
                    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <p className="font-semibold text-[var(--color-text)]">Invoice PDF</p>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Use Download PDF to open the printable document.</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <p className="font-semibold text-[var(--color-text)]">Source Order</p>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{orderNumberById.get(String(invoice.orderId)) || '—'}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <p className="font-semibold text-[var(--color-text)]">Template</p>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{invoice.templateUsed || 'INVOICE'}</p>
                    </div>
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
