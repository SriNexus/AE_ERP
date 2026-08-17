import { useEffect, useMemo, useState } from 'react';
import { Building2, Edit2, Trash2, Phone, Mail, MessageCircle, X, FileText, Download, File as FileIcon } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { statusBadge } from '../../../components/ui/Badge';
import { DetailCard, VendorField, MutedValue } from './VendorWorkspaceParts';
import { fmtDate } from '../../../lib/firestore';
import type { VendorRecord } from '../types';

interface VendorDetailModalProps {
  open: boolean;
  vendor: VendorRecord | null;
  onClose: () => void;
  onEdit: (vendor: VendorRecord) => void;
  onDelete: (vendor: VendorRecord) => void;
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCreatedDate(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString('en-GB') : '';
}

function formatTime(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
}

function daysAgoText(value: any): string {
  const date = toDateValue(value);
  if (!date) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(date); then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function recencyDotClass(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'bg-[var(--color-text-disabled)]';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(date); then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'bg-emerald-500';
  if (days <= 7) return 'bg-blue-500';
  if (days <= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

export function VendorDetailModal({ open, vendor, onClose, onEdit, onDelete }: VendorDetailModalProps) {
  const [detailsTab, setDetailsTab] = useState<'overview' | 'activity' | 'notes' | 'history'>('overview');

  useEffect(() => {
    if (open) setDetailsTab('overview');
  }, [open, vendor?.id]);

  const tabs = [
    ['overview', 'Overview'],
    ['activity', 'Activity'],
    ['notes', 'Notes'],
    ['history', 'History'],
  ] as const;

  return (
    <Modal open={!!vendor && open} onClose={onClose} size="2xl">
      {vendor && (
        <div className="flex h-[78vh] max-h-[760px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
          <header className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
                <Building2 className="h-10 w-10" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{vendor.name || 'Vendor'}</h2>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                  <span>{vendor.vendorId} · {vendor.gstin || 'No GSTIN'}</span>
                  <span>Categories: {vendor.categoryTags?.join(', ') || 'None'}</span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-start gap-2" data-action>
              <div className="flex flex-wrap justify-end gap-2">
                {vendor.contactInfo?.phone ? <a href={`tel:${vendor.contactInfo.phone}`} className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]"><Phone className="h-3.5 w-3.5" /> Call</a> : null}
                {vendor.contactInfo?.phone ? <a href={`https://wa.me/${String(vendor.contactInfo.phone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a> : null}
                {vendor.contactInfo?.email ? <a href={`mailto:${vendor.contactInfo.email}`} className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]"><Mail className="h-3.5 w-3.5" /> Email</a> : null}
              </div>
              <button onClick={onClose} className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]" aria-label="Close vendor details">
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <nav className="shrink-0 grid grid-cols-2 gap-1 border-b border-[var(--color-border-subtle)] py-4 sm:grid-cols-4">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDetailsTab(key)}
                className={[
                  'rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors',
                  detailsTab === key
                    ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto transition-opacity duration-150">
            {detailsTab === 'overview' && (
              <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="space-y-5">
                  <DetailCard title="Vendor Information">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <VendorField label="Vendor Code" value={vendor.vendorId} />
                      <VendorField label="GSTIN" value={vendor.gstin || <MutedValue>Not provided</MutedValue>} />
                      <VendorField label="Payment Terms" value={vendor.paymentTerms || <MutedValue>Not set</MutedValue>} />
                      <VendorField label="Categories" value={vendor.categoryTags?.join(', ') || <MutedValue>None</MutedValue>} />
                      <VendorField label="Created" value={formatCreatedDate(vendor.createdAt)} />
                      <VendorField label="Last Updated" value={vendor.updatedAt ? formatCreatedDate(vendor.updatedAt) : <MutedValue />} />
                    </div>
                  </DetailCard>

                  <DetailCard title="Contact Information">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <VendorField label="Contact Person" value={vendor.contactInfo?.contactPerson || <MutedValue>Not provided</MutedValue>} />
                      <VendorField label="Phone" value={vendor.contactInfo?.phone || <MutedValue>Not provided</MutedValue>} />
                      <VendorField label="Email" value={vendor.contactInfo?.email || <MutedValue>Not provided</MutedValue>} />
                    </div>
                  </DetailCard>

                  {vendor.contactInfo?.address ? (
                    <DetailCard title="Address">
                      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 text-[var(--color-text-secondary)] whitespace-pre-wrap">
                        {vendor.contactInfo.address}
                      </div>
                    </DetailCard>
                  ) : null}
                </div>

                <aside className="space-y-4">
                  <DetailCard title="Created">
                    <div className="space-y-1">
                      <p className="font-semibold text-[var(--color-text)]">{formatCreatedDate(vendor.createdAt) || 'Not available'}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{formatTime(vendor.createdAt) || 'Time not available'}</p>
                      <p className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                        <span className={`h-1.5 w-1.5 rounded-full ${recencyDotClass(vendor.createdAt)}`} />
                        {daysAgoText(vendor.createdAt) || 'Age not available'}
                      </p>
                    </div>
                  </DetailCard>

                  <DetailCard title="Quick Actions">
                    <div className="space-y-2">
                      <Button variant="outline" size="sm" className="w-full justify-start" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => { onClose(); onEdit(vendor); }}>Edit Vendor</Button>
                      <div className="border-t border-[var(--color-border-subtle)] pt-3">
                        <Button variant="danger" size="sm" className="w-full justify-start" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { onClose(); onDelete(vendor); }}>Delete Vendor</Button>
                      </div>
                    </div>
                  </DetailCard>

                  <DetailCard title="Timeline">
                    <div className="space-y-3">
                      {vendor.createdAt ? (
                        <div className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                          <div>
                            <p className="font-semibold text-[var(--color-text)]">Created</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{formatCreatedDate(vendor.createdAt)} {formatTime(vendor.createdAt)}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">by {vendor.createdBy || 'System'}</p>
                          </div>
                        </div>
                      ) : null}
                      {vendor.updatedAt ? (
                        <div className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                          <div>
                            <p className="font-semibold text-[var(--color-text)]">Last Modified</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{formatCreatedDate(vendor.updatedAt)} {formatTime(vendor.updatedAt)}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">by {vendor.updatedBy || 'System'}</p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </DetailCard>
                </aside>
              </div>
            )}

            {detailsTab === 'activity' && (
              <div className="pt-5">
                <DetailCard title="Activity Timeline">
                  <p className="text-sm text-[var(--color-text-muted)]">No activity recorded yet.</p>
                </DetailCard>
              </div>
            )}

            {detailsTab === 'notes' && (
              <div className="pt-5">
                <DetailCard title="Notes">
                  <p className="text-sm text-[var(--color-text-muted)]">No notes recorded.</p>
                </DetailCard>
              </div>
            )}

            {detailsTab === 'history' && (
              <div className="pt-5">
                <DetailCard title="Change History">
                  <p className="text-sm text-[var(--color-text-muted)]">No history recorded yet.</p>
                </DetailCard>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
