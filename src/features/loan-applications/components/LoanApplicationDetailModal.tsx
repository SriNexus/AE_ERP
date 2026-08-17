import { useEffect, useMemo, useState } from 'react';
import { Edit2, FileText, Phone, Trash2, X, Download, ExternalLink, Plus, ListChecks, Layers } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { DetailCard, RegField, MutedValue, loanApplicationStatusBadge, signStatusBadge } from './LoanApplicationWorkspaceParts';
import { DocumentViewer, useDocumentViewer, formatFileSize } from '../../../components/shared';
import type { DocumentViewerFile } from '../../../components/shared';
import { fmtCurrency } from '../../../lib/firestore';

interface LoanApplicationDetailModalProps {
  open: boolean;
  registration: any;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewCustomer?: () => void;
  onCreateProject?: () => void;
  onCreatePayment?: () => void;
  companyId?: string;
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: any): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString('en-GB') : '—';
}

function formatTime(value: any): string {
  const date = toDate(value);
  return date ? date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
}

export function LoanApplicationDetailModal({
  open, registration, onClose, onEdit, onDelete, onViewCustomer,
  onCreateProject, onCreatePayment,
}: LoanApplicationDetailModalProps) {
  const [detailsTab, setDetailsTab] = useState<'overview' | 'banking' | 'documents' | 'timeline'>('overview');
  const { doc: viewerDoc, open: viewerOpen, viewDocument, closeViewer } = useDocumentViewer();

  useEffect(() => {
    if (open) setDetailsTab('overview');
  }, [open, registration?.id]);

  const activity = useMemo(() => [...(registration?.activityLog || [])].reverse(), [registration]);
  const regDocuments = useMemo(() => {
    const docs: { label: string; doc: DocumentViewerFile; metadata: { date?: string; size?: number } }[] = [];
    const rawDocs = registration?.documents || [];
    if (Array.isArray(rawDocs)) rawDocs.forEach((item: any) => {
      docs.push({ label: item.label || item.type || 'Document', doc: { name: item.name || item.fileName, url: item.url || '', mimeType: item.mimeType, size: item.size }, metadata: { date: item.date || registration.createdAt, size: item.size } });
    });
    return docs.filter((d) => d.doc?.name);
  }, [registration]);

  const r = registration || {};
  const displayName = r.customerName || 'Loan Application';
  const regId = r.registrationId || r.id;
  const status = r.status || 'Draft';

  const tabs = [
    ['overview', 'Overview'],
    ['banking', 'Banking'],
    ['documents', 'Documents'],
    ['timeline', 'Timeline'],
  ] as const;

  return (
    <Modal open={!!registration && open} onClose={onClose} size="2xl">
      {registration && (
        <div className="flex h-[78vh] max-h-[760px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
          <header className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
                {displayName[0]?.toUpperCase() || 'R'}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{displayName}</h2>
                  <span data-interactive>{loanApplicationStatusBadge(status)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                  <span className="font-mono">{regId}</span>
                  <span>{r.bankName || '—'} · {r.branch || '—'}</span>
                  <span>Assigned: {r.assignedToName || 'Unassigned'}</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-start gap-2" data-action>
              <div className="flex flex-wrap justify-end gap-2">
                {r.customerPhone && (
                  <a href={`tel:${r.customerPhone}`} className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold shadow-sm hover:bg-[var(--color-surface-hover)]">
                    <Phone className="h-3.5 w-3.5" /> Call
                  </a>
                )}
              </div>
              <button onClick={onClose} className="rounded-xl p-2 hover:bg-[var(--color-surface-hover)]" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
          </header>

          <nav className="shrink-0 grid grid-cols-2 gap-1 border-b border-[var(--color-border-subtle)] py-4 sm:grid-cols-4">
            {tabs.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setDetailsTab(key)}
                className={['rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors',
                  detailsTab === key ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]',
                ].join(' ')}>{label}</button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* ── Overview (Customer details + Assignment + Notes + Status history) ── */}
            {detailsTab === 'overview' && (
              <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="space-y-5">
                  <DetailCard title="Customer Information">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <RegField label="Customer Name" value={displayName} />
                      <RegField label="Phone" value={r.customerPhone || <MutedValue />} />
                      <RegField label="Address" value={r.customerAddress || <MutedValue />} />
                      <RegField label="Loan Application ID" value={regId} />
                    </div>
                  </DetailCard>

                  <DetailCard title="Bank Details">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <RegField label="Bank" value={r.bankName || <MutedValue />} />
                      <RegField label="Branch" value={r.branch || <MutedValue />} />
                      <RegField label="Loan Amount" value={Number(r.loanAmount) ? fmtCurrency(Number(r.loanAmount)) : <MutedValue />} />
                      <RegField label="Application Number" value={r.applicationNumber || <MutedValue />} />
                    </div>
                  </DetailCard>

                  <DetailCard title="Workflow Status">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <RegField label="Digital Sign" value={r.digitalSignStatus === 'completed' ? '✅ Completed' : '✍️ Pending'} />
                      <RegField label="Bank Submission" value={r.submissionDate ? formatDate(r.submissionDate) : <MutedValue>Not submitted</MutedValue>} />
                      <RegField label="Approval Date" value={r.approvalDate ? formatDate(r.approvalDate) : <MutedValue />} />
                      <RegField label="Payment Date" value={r.paymentDate ? formatDate(r.paymentDate) : <MutedValue />} />
                    </div>
                    {r.status === 'Rejected' && r.rejectionReason && (
                      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-3">
                        <p className="text-xs font-medium text-red-700 dark:text-red-400">Rejection Reason: {r.rejectionReason}</p>
                      </div>
                    )}
                  </DetailCard>

                  <DetailCard title="Assignment">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <RegField label="Assigned To" value={r.assignedToName || <MutedValue>Unassigned</MutedValue>} />
                    </div>
                  </DetailCard>

                  {r.notes && (
                    <DetailCard title="Notes">
                      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 whitespace-pre-wrap">{r.notes}</div>
                    </DetailCard>
                  )}

                  <DetailCard title="Status History">
                    {activity.length ? (
                      <div className="space-y-2">
                        {activity.map((log: any, idx: number) => (
                          <div key={log.id || idx} className="flex gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-2.5">
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-semibold text-[var(--color-text)] text-xs">{log.type || 'Activity'}</p>
                                <span className="text-[10px] text-[var(--color-text-muted)]">{formatDate(log.date)} {formatTime(log.date)}</span>
                              </div>
                              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{log.desc}</p>
                              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{log.userName || 'System'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-sm text-[var(--color-text-muted)]">No history recorded.</p>}
                  </DetailCard>
                </div>

                <aside className="space-y-4">
                  <DetailCard title="Created">
                    <p className="font-semibold text-[var(--color-text)]">{formatDate(r.createdAt)}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{formatTime(r.createdAt)}</p>
                  </DetailCard>

                  <DetailCard title="Quick Actions">
                    <div className="space-y-2">
                      <Button variant="outline" size="sm" className="w-full justify-start" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>
                      {onViewCustomer && (
                        <button type="button" onClick={onViewCustomer} className="inline-flex h-7 w-full items-center justify-start gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-hover)]">
                          <ExternalLink className="h-3.5 w-3.5" /> View Customer
                        </button>
                      )}
                      {status === 'Approved' && onCreatePayment && (
                        <Button variant="primary" size="sm" className="w-full justify-start" icon={<Plus className="h-3.5 w-3.5" />} onClick={onCreatePayment}>Create Payment</Button>
                      )}
                      {onCreateProject && (
                        <button
                          type="button"
                          disabled={status !== 'Payment Received'}
                          onClick={status === 'Payment Received' ? onCreateProject : undefined}
                          className={`inline-flex h-7 w-full items-center justify-start gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            status === 'Payment Received'
                              ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 cursor-pointer'
                              : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-disabled)] cursor-not-allowed'
                          }`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {status === 'Payment Received' ? 'Create Project' : 'Payment Required'}
                        </button>
                      )}
                      <div className="pt-3 mt-3 border-t border-[var(--color-border-subtle)]">
                        <Button variant="danger" size="sm" className="w-full justify-start" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDelete}>Delete</Button>
                      </div>
                    </div>
                  </DetailCard>
                </aside>
              </div>
            )}

            {/* ── Banking Tab ── */}
            {detailsTab === 'banking' && (
              <div className="pt-5 space-y-5">
                <DetailCard title="Bank & Loan Details">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <RegField label="Bank Name" value={r.bankName || <MutedValue />} />
                    <RegField label="Branch" value={r.branch || <MutedValue />} />
                    <RegField label="Loan Amount" value={Number(r.loanAmount) ? fmtCurrency(Number(r.loanAmount)) : <MutedValue />} />
                    <RegField label="Application Number" value={r.applicationNumber || <MutedValue />} />
                    <RegField label="Digital Sign" value={r.digitalSignStatus === 'completed' ? '✅ Completed' : '✍️ Pending'} />
                    <RegField label="Bank Submission Date" value={r.submissionDate ? formatDate(r.submissionDate) : <MutedValue>Not submitted</MutedValue>} />
                    <RegField label="Approval Date" value={r.approvalDate ? formatDate(r.approvalDate) : <MutedValue />} />
                    <RegField label="Payment Date" value={r.paymentDate ? formatDate(r.paymentDate) : <MutedValue />} />
                  </div>
                </DetailCard>

                <DetailCard title="Status Pipeline">
                  <div className="space-y-2">
                    {[
                      { label: 'Draft', done: true },
                      { label: 'Digital Sign Pending', done: status !== 'Draft' },
                      { label: 'Digital Sign Completed', done: r.digitalSignStatus === 'completed' || ['Under Review','Approved','Rejected','Payment Received','Closed'].includes(status) },
                      { label: 'Bank Submission Pending', done: r.submissionDate ? true : ['Submitted To Bank','Under Review','Approved','Payment Received','Closed'].includes(status) || false },
                      { label: 'Submitted To Bank', done: r.submissionDate ? true : ['Under Review','Approved','Payment Received','Closed'].includes(status) || false },
                      { label: 'Under Review', done: ['Under Review','Approved','Payment Received','Closed'].includes(status) ? true : false },
                      { label: status === 'Rejected' ? 'Rejected' : 'Approved', done: status === 'Approved' || status === 'Payment Received' || status === 'Closed' },
                      { label: 'Payment Received', done: status === 'Payment Received' || status === 'Closed' },
                      { label: 'Closed', done: status === 'Closed' },
                    ].filter(s => s.label !== status || status !== 'Rejected').map((step, i) => (
                      <div key={i} className={`flex items-center gap-3 rounded-lg border p-2.5 ${step.done ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10' : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] opacity-60'}`}>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${step.done ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                        <span className={`text-xs font-semibold ${step.done ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--color-text-muted)]'}`}>{step.label}</span>
                        {status === step.label && <span className="ml-auto text-[10px] font-bold text-indigo-600 dark:text-indigo-400">● Current</span>}
                      </div>
                    ))}
                  </div>
                </DetailCard>
              </div>
            )}

            {/* ── Documents Tab ── */}
            {detailsTab === 'documents' && (
              <div className="pt-5">
                <DetailCard title="Documents">
                  {regDocuments.length > 0 ? (
                    <div className="space-y-3">
                      {regDocuments.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 shrink-0 text-[var(--color-primary-text)]" />
                              <p className="truncate text-sm font-semibold text-[var(--color-text)]">{item.label}</p>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{item.doc.name}</p>
                            {item.metadata.size ? <p className="mt-0.5 text-[10px] text-[var(--color-text-disabled)]">{formatFileSize(item.metadata.size)}</p> : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-2" data-action>
                            {item.doc.url ? (
                              <>
                                <Button size="xs" variant="outline" icon={<FileText className="h-3 w-3" />} onClick={() => viewDocument(item.doc)}>View</Button>
                                <a href={item.doc.url} download={item.doc.name} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs font-medium hover:bg-[var(--color-surface-hover)]"><Download className="h-3 w-3" /></a>
                              </>
                            ) : <span className="text-xs text-[var(--color-text-muted)]">Reference only</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-8 text-center">
                      <FileText className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
                      <p className="mt-2 text-sm font-medium text-[var(--color-text)]">No documents uploaded</p>
                    </div>
                  )}
                </DetailCard>
              </div>
            )}

            {/* ── Timeline Tab ── */}
            {detailsTab === 'timeline' && (
              <div className="pt-5">
                <DetailCard title="Activity Timeline">
                  {activity.length ? (
                    <div className="space-y-3">
                      {activity.map((log: any, idx: number) => (
                        <div key={log.id || idx} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-semibold text-[var(--color-text)] text-xs">{log.type || 'Activity'}</p>
                              <time className="text-[10px] text-[var(--color-text-muted)]">{formatDate(log.date)} {formatTime(log.date)}</time>
                            </div>
                            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{log.desc || 'No details recorded.'}</p>
                            <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{log.userName ? `by ${log.userName}` : 'Unknown'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-[var(--color-text-muted)]">No activity recorded.</p>}
                </DetailCard>
              </div>
            )}
          </div>
        </div>
      )}
      <DocumentViewer document={viewerDoc} open={viewerOpen} onClose={closeViewer} fullScreen />
    </Modal>
  );
}
