/**
 * PartnerDetailDrawer — Modal-based detail view for Channel Partner
 *
 * Follows the exact same pattern as Leads.tsx and Customers.tsx detail modals.
 * All tabs render inline content, no separate page navigation.
 * Editing is done via the PartnerFormModal — not inside the drawer.
 */

import { useState, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Phone, Mail, MessageCircle, MapPin, FileText, Edit2, X, File, Download, Eye } from 'lucide-react';
import { fmtDate } from '../../lib/firestore';
import { ActivityTimeline } from '../shared/ActivityTimeline';
import { DocumentViewer, useDocumentViewer, formatFileSize } from '../shared/DocumentViewer';
import type { DocumentViewerFile } from '../shared/DocumentViewer';
import type { ChannelPartner } from '../../features/channel-partner/types';
import { useAppStore } from '../../store/useAppStore';

// ── Status styling map (matching Leads.tsx pattern) ────────

const PARTNER_STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  active: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  suspended: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  inactive: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
};

const KYC_STATUS_STYLES: Record<string, string> = {
  not_started: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  submitted: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  verified: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};

// ── Helper components ──────────────────────────────────────

function MutedValue({ children }: { children?: React.ReactNode }) {
  return <span className="text-[var(--color-text-muted)]">{children || '—'}</span>;
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PartnerField({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{children ?? value ?? <MutedValue />}</div>
    </div>
  );
}

function PartnerStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const style = PARTNER_STATUS_STYLES[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
}

function KYCStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const style = KYC_STATUS_STYLES[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

function formatDate(value: any): string {
  if (!value) return '—';
  if (typeof value === 'object' && typeof value.toDate === 'function') return fmtDate(value.toDate());
  if (typeof value === 'object' && value.seconds) return fmtDate(new Date(value.seconds * 1000));
  return fmtDate(value) || '—';
}

function formatCurrency(value: number | null | undefined): string {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// ── Main Component ─────────────────────────────────────────

interface PartnerDetailDrawerProps {
  partner: ChannelPartner | null;
  open: boolean;
  onClose: () => void;
  onEdit?: (partner: ChannelPartner) => void;
  onApprove?: (id: string) => void;
  onSuspend?: (id: string) => void;
  onReactivate?: (id: string) => void;
}

export function PartnerDetailDrawer({
  partner, open, onClose, onEdit, onApprove, onSuspend, onReactivate,
}: PartnerDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const { doc: viewerDoc, open: viewerOpen, viewDocument, closeViewer } = useDocumentViewer();

  // Document attachments — moved BEFORE early return to preserve hook order
  const partnerDocuments = useMemo(() => {
    if (!partner) return [];
    const p = partner as any;
    const docs: { label: string; doc: DocumentViewerFile; metadata: { date?: string; size?: number } }[] = [];
    if (p?.gstFileName || p?.gstFileUrl) {
      docs.push({ label: 'GST Certificate', doc: { name: p.gstFileName || 'gst.pdf', url: p.gstFileUrl || '', mimeType: p.gstFileMimeType, size: p.gstFileSize }, metadata: { date: p.gstDate || p.createdAt, size: p.gstFileSize } });
    }
    if (p?.panFileName || p?.panFileUrl) {
      docs.push({ label: 'PAN Card', doc: { name: p.panFileName || 'pan.pdf', url: p.panFileUrl || '', mimeType: p.panFileMimeType, size: p.panFileSize }, metadata: { date: p.panDate || p.createdAt, size: p.panFileSize } });
    }
    if (p?.agreementFileName || p?.agreementFileUrl) {
      docs.push({ label: 'Agreement', doc: { name: p.agreementFileName || 'agreement.pdf', url: p.agreementFileUrl || '', mimeType: p.agreementFileMimeType, size: p.agreementFileSize }, metadata: { date: p.agreementDate || p.createdAt, size: p.agreementFileSize } });
    }
    if (p?.bankDocFileName || p?.bankDocUrl) {
      docs.push({ label: 'Bank Document', doc: { name: p.bankDocFileName || 'bank-doc.pdf', url: p.bankDocUrl || '', mimeType: p.bankDocMimeType, size: p.bankDocSize }, metadata: { date: p.bankDocDate || p.createdAt, size: p.bankDocSize } });
    }
    if (p?.aadhaarFileName || p?.aadhaarUrl) {
      docs.push({ label: 'Aadhaar', doc: { name: p.aadhaarFileName || 'aadhaar.pdf', url: p.aadhaarUrl || '', mimeType: p.aadhaarMimeType, size: p.aadhaarSize }, metadata: { date: p.aadhaarDate || p.createdAt, size: p.aadhaarSize } });
    }
    if (p?.photoUrl || p?.profilePhotoUrl) {
      docs.push({ label: 'Photo', doc: { name: 'photo.jpg', url: p.photoUrl || p.profilePhotoUrl || '', mimeType: 'image/jpeg', size: p.photoSize }, metadata: { date: p.createdAt, size: p.photoSize } });
    }
    return docs.filter((d) => d.doc?.name && d.doc?.url);
  }, [partner]);

  if (!partner) return null;

  const address = partner.address;
  const location = [address?.city, address?.state].filter(Boolean).join(', ') || '—';
  const bank = partner.bankDetails;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'kyc', label: 'KYC' },
    { key: 'commission', label: 'Commission' },
    { key: 'wallet', label: 'Wallet' },
    { key: 'performance', label: 'Performance' },
    { key: 'documents', label: 'Documents' },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <Modal open={open} onClose={onClose} size="2xl">
      <div className="flex h-[78vh] max-h-[760px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
              {((partner.firmName || partner.contactPerson || '?')[0]).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">
                  {partner.firmName || partner.contactPerson || 'Untitled Partner'}
                </h2>
                <PartnerStatusBadge status={partner.status} />
                <KYCStatusBadge status={partner.kycStatus} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {location}
                </span>
                <span>Partner since {formatDate(partner.createdAt)}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-start gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              {partner.phone && (
                <a href={`tel:${partner.phone}`} className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]">
                  <Phone className="h-3.5 w-3.5" /> Call
                </a>
              )}
              {partner.phone && (
                <a href={`https://wa.me/${String(partner.phone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]">
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              )}
              {partner.email && (
                <a href={`mailto:${partner.email}`} className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]">
                  <Mail className="h-3.5 w-3.5" /> Email
                </a>
              )}
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────── */}
        <nav className="shrink-0 grid grid-cols-2 gap-1 border-b border-[var(--color-border-subtle)] py-4 sm:grid-cols-3 lg:grid-cols-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors ${
                activeTab === tab.key
                  ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* ── Tab Content ──────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto transition-opacity duration-150">
          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-5">
                <DetailCard title="Contact Information">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <PartnerField label="Contact Person" value={partner.contactPerson || <MutedValue />} />
                    <PartnerField label="Firm / Business Name" value={partner.firmName || <MutedValue />} />
                    <PartnerField label="Phone">
                      {partner.phone ? (
                        <a href={`tel:${partner.phone}`} className="text-[var(--color-primary-text)] hover:underline">{partner.phone}</a>
                      ) : <MutedValue />}
                    </PartnerField>
                    <PartnerField label="Email">
                      {partner.email ? (
                        <a href={`mailto:${partner.email}`} className="text-[var(--color-primary-text)] hover:underline">{partner.email}</a>
                      ) : <MutedValue />}
                    </PartnerField>
                    <PartnerField label="Alternate Phone" value={partner.alternatePhone || <MutedValue />} />
                    <PartnerField label="GST Number" value={partner.gstNumber || <MutedValue />} />
                    <PartnerField label="PAN Number" value={partner.panNumber || <MutedValue />} />
                    <PartnerField label="Assigned Sales Person" value={partner.assignedSalesPerson || <MutedValue>Unassigned</MutedValue>} />
                  </div>
                </DetailCard>

                <DetailCard title="Identity & Hierarchy">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <PartnerField label="Linked User ID">
                      {partner.userId ? (
                        <span className="font-mono text-xs">{partner.userId}</span>
                      ) : <MutedValue>Not linked</MutedValue>}
                    </PartnerField>
                    <PartnerField label="Manager">
                      {partner.managerId ? (
                        <span className="font-mono text-xs">{partner.managerName || partner.managerId}</span>
                      ) : <MutedValue>Not assigned</MutedValue>}
                    </PartnerField>
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                    The linked user can sign in to the Partner Portal and resolves this record via
                    <span className="font-mono"> usePartnerSelf()</span> (users.channelPartnerId → channel_partners).
                  </p>
                </DetailCard>

                <DetailCard title="Address">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <PartnerField label="Address">
                      {address ? (
                        <span>{[address.line1, address.line2].filter(Boolean).join(', ')}</span>
                      ) : <MutedValue />}
                    </PartnerField>
                    <PartnerField label="City / State" value={location} />
                    <PartnerField label="Pincode" value={address?.pincode || <MutedValue />} />
                    <PartnerField label="Country" value={address?.country || 'India'} />
                  </div>
                </DetailCard>

                {partner.notes && (
                  <DetailCard title="Notes">
                    <p className="whitespace-pre-wrap leading-relaxed text-[var(--color-text)]">{partner.notes}</p>
                  </DetailCard>
                )}
              </div>

              <aside className="space-y-4">
                <DetailCard title="Summary">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-text-muted)]">Status</span>
                      <PartnerStatusBadge status={partner.status} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-text-muted)]">KYC</span>
                      <KYCStatusBadge status={partner.kycStatus} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-text-muted)]">Total Leads</span>
                      <span className="text-sm font-bold text-[var(--color-text)]">{partner.totalLeadsCreated || 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-text-muted)]">Converted</span>
                      <span className="text-sm font-bold text-[var(--color-text)]">{partner.totalLeadsConverted || 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-text-muted)]">Conversion Rate</span>
                      <span className="text-sm font-bold text-[var(--color-text)]">{partner.conversionRate || 0}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-text-muted)]">Commission Earned</span>
                      <span className="text-sm font-bold text-[var(--color-text)]">{formatCurrency(partner.totalCommissionEarned)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-text-muted)]">Wallet Balance</span>
                      <span className="text-sm font-bold text-[var(--color-text)]">{formatCurrency(partner.walletBalance)}</span>
                    </div>
                  </div>
                </DetailCard>

                <DetailCard title="Quick Actions">
                  <div className="space-y-2">
                    {onEdit && (
                      <Button variant="outline" size="sm" className="w-full justify-start" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => onEdit(partner)}>
                        Edit Partner
                      </Button>
                    )}
                    {partner.status === 'pending_approval' && onApprove && (
                      <Button variant="outline" size="sm" className="w-full justify-start border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => onApprove(partner.id)}>
                        Approve Partner
                      </Button>
                    )}
                    {partner.status === 'active' && onSuspend && (
                      <Button variant="outline" size="sm" className="w-full justify-start border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => onSuspend(partner.id)}>
                        Suspend Partner
                      </Button>
                    )}
                    {partner.status === 'suspended' && onReactivate && (
                      <Button variant="outline" size="sm" className="w-full justify-start border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => onReactivate(partner.id)}>
                        Reactivate Partner
                      </Button>
                    )}
                  </div>
                </DetailCard>

                <DetailCard title="Created">
                  <div className="space-y-1">
                    <p className="font-semibold text-[var(--color-text)]">{formatDate(partner.createdAt)}</p>
                    {partner.createdBy && (
                      <p className="text-xs text-[var(--color-text-muted)]">by {partner.createdBy}</p>
                    )}
                  </div>
                </DetailCard>
              </aside>
            </div>
          )}

          {/* KYC TAB */}
          {activeTab === 'kyc' && (
            <div className="pt-5 space-y-5">
              <DetailCard title="KYC Status">
                <div className="grid gap-3 sm:grid-cols-2">
                  <PartnerField label="KYC Status">
                    <KYCStatusBadge status={partner.kycStatus} />
                  </PartnerField>
                  <PartnerField label="Submitted At" value={formatDate(partner.kycSubmittedAt)} />
                  <PartnerField label="Verified At" value={formatDate(partner.kycVerifiedAt)} />
                  <PartnerField label="Verified By" value={partner.kycVerifiedBy || <MutedValue />} />
                  {partner.kycRejectionReason && (
                    <PartnerField label="Rejection Reason" value={partner.kycRejectionReason} />
                  )}
                </div>
              </DetailCard>
              <DetailCard title="KYC Documents">
                {partner.kycDocuments && partner.kycDocuments.length > 0 ? (
                  <div className="space-y-2">
                    {partner.kycDocuments.map((doc, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-sm">
                        <FileText className="h-4 w-4 text-[var(--color-text-muted)]" />
                        <span className="text-[var(--color-text)]">{doc}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">No documents uploaded yet.</p>
                )}
              </DetailCard>
              <DetailCard title="Bank Details">
                {bank ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <PartnerField label="Account Holder" value={bank.accountHolderName} />
                    <PartnerField label="Account Number" value={bank.accountNumber} />
                    <PartnerField label="Bank Name" value={bank.bankName} />
                    <PartnerField label="IFSC Code" value={bank.ifscCode} />
                    <PartnerField label="Branch" value={bank.branchName || <MutedValue />} />
                    <PartnerField label="Account Type">
                      <span className="capitalize">{bank.accountType}</span>
                    </PartnerField>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">No bank details provided.</p>
                )}
              </DetailCard>
            </div>
          )}

          {/* COMMISSION TAB */}
          {activeTab === 'commission' && (
            <div className="pt-5 space-y-5">
              <DetailCard title="Commission Configuration">
                <div className="grid gap-3 sm:grid-cols-2">
                  <PartnerField label="Default Commission Type">
                    {partner.defaultCommissionType ? (
                      <span className="capitalize">{partner.defaultCommissionType.replace(/_/g, ' ')}</span>
                    ) : <MutedValue>Not configured</MutedValue>}
                  </PartnerField>
                  <PartnerField label="Default Commission Value">
                    {partner.defaultCommissionValue ? `₹${partner.defaultCommissionValue}` : <MutedValue>Not set</MutedValue>}
                  </PartnerField>
                  <PartnerField label="Total Commission Earned" value={formatCurrency(partner.totalCommissionEarned)} />
                  <PartnerField label="Total Commission Paid" value={formatCurrency(partner.totalCommissionPaid)} />
                  <PartnerField label="Avg Commission Per Lead" value={formatCurrency(partner.averageCommissionPerLead)} />
                </div>
              </DetailCard>
              <DetailCard title="Commission Records">
                <p className="text-sm text-[var(--color-text-muted)]">
                  Commission records will be available after the Commission Engine is implemented (Phase 5).
                </p>
              </DetailCard>
            </div>
          )}

          {/* WALLET TAB */}
          {activeTab === 'wallet' && (
            <div className="pt-5 space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Wallet Balance</p>
                  <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{formatCurrency(partner.walletBalance)}</p>
                </div>
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Pending</p>
                  <p className="mt-2 text-2xl font-bold text-amber-600">{formatCurrency(partner.pendingBalance)}</p>
                </div>
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Total Earned</p>
                  <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{formatCurrency(partner.totalCommissionEarned)}</p>
                </div>
              </div>
              <DetailCard title="Recent Transactions">
                <p className="text-sm text-[var(--color-text-muted)]">
                  Wallet transactions will be available after the Wallet System is implemented (Phase 5).
                </p>
              </DetailCard>
            </div>
          )}

          {/* ACTIVITY TAB */}
          {activeTab === 'activity' && (
            <div className="pt-5">
              <DetailCard title="Activity Timeline">
                <ActivityTimeline
                  entityId={partner.id}
                  companyId={activeCompanyId}
                  limit={20}
                />
              </DetailCard>
            </div>
          )}

          {/* PERFORMANCE TAB */}
          {activeTab === 'performance' && (
            <div className="pt-5 space-y-5">
              <DetailCard title="Performance Overview">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm text-center">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Revenue</p>
                    <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{formatCurrency(partner.totalCommissionEarned)}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm text-center">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Leads</p>
                    <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{partner.totalLeadsCreated || 0}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm text-center">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Conversion</p>
                    <p className="mt-2 text-2xl font-bold text-emerald-600">{partner.conversionRate || 0}%</p>
                  </div>
                </div>
              </DetailCard>
              <DetailCard title="Performance Details">
                <div className="grid gap-3 sm:grid-cols-2">
                  <PartnerField label="Total Leads Created" value={String(partner.totalLeadsCreated || 0)} />
                  <PartnerField label="Total Leads Converted" value={String(partner.totalLeadsConverted || 0)} />
                  <PartnerField label="Conversion Rate" value={`${partner.conversionRate || 0}%`} />
                  <PartnerField label="Average Commission Per Lead" value={formatCurrency(partner.averageCommissionPerLead)} />
                  <PartnerField label="Total Commission Earned" value={formatCurrency(partner.totalCommissionEarned)} />
                  <PartnerField label="Total Commission Paid" value={formatCurrency(partner.totalCommissionPaid)} />
                </div>
              </DetailCard>
              <DetailCard title="Rankings">
                <p className="text-sm text-[var(--color-text-muted)]">
                  Partner rankings and leaderboards will be available after the Performance Engine is implemented (Phase 5).
                </p>
              </DetailCard>
            </div>
          )}

          {/* DOCUMENTS TAB */}
          {activeTab === 'documents' && (
            <div className="pt-5">
              <DetailCard title="Documents">
                {partnerDocuments.length > 0 ? (
                  <div className="space-y-2">
                    {partnerDocuments.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <File className="h-4 w-4 shrink-0 text-[var(--color-primary-text)]" />
                            <p className="truncate text-sm font-semibold text-[var(--color-text)]">{item.label}</p>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{item.doc.name}</p>
                          <p className="mt-0.5 text-[10px] text-[var(--color-text-disabled)]">
                            {item.metadata.date ? formatDate(item.metadata.date) : ''}
                            {item.metadata.size ? ` · ${formatFileSize(item.metadata.size)}` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2" data-action>
                          {item.doc.url ? (
                            <a
                              href={item.doc.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5"
                            >
                              <Download className="h-3 w-3" />
                            </a>
                          ) : null}
                          {item.doc.url ? (
                            <Button
                              size="xs" variant="outline"
                              icon={<Eye className="h-3 w-3" />}
                              onClick={() => viewDocument(item.doc)}
                            >
                              View
                            </Button>
                          ) : (
                            <span className="text-xs text-[var(--color-text-muted)]">Reference only</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-8 text-center">
                    <FileText className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
                    <p className="mt-2 text-sm font-medium text-[var(--color-text)]">No documents attached</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Documents will appear here once uploaded.
                    </p>
                  </div>
                )}
              </DetailCard>
            </div>
          )}
        </div>
      </div>

      {/* Document Viewer */}
      <DocumentViewer
        document={viewerDoc}
        open={viewerOpen}
        onClose={closeViewer}
        fullScreen
      />
    </Modal>
  );
}

export default PartnerDetailDrawer;
