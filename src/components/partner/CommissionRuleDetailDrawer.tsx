/**
 * CommissionRuleDetailDrawer — Read-only commission rule detail modal
 *
 * Displays: general info, priority, scope, calculation details,
 * applicability, slabs, effective dates, created/modified by, timeline.
 * No editing — read-only view for admins.
 */

import { useState, useMemo } from 'react';
import { DollarSign, Clock, FileText, File, Eye, Download } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { fmtDate, fmtDateTime } from '../../lib/firestore';
import { DocumentViewer, useDocumentViewer, formatFileSize } from '../shared/DocumentViewer';
import type { DocumentViewerFile } from '../shared/DocumentViewer';
import type { CommissionRule } from '../../features/channel-partner/types';

interface CommissionRuleDetailDrawerProps {
  rule: CommissionRule | null;
  open: boolean;
  onClose: () => void;
  onEdit?: (rule: CommissionRule) => void;
  onDuplicate?: (rule: CommissionRule) => void;
}

const TYPE_LABELS: Record<string, string> = {
  percentage: 'Percentage (%)',
  fixed: 'Fixed (₹)',
  per_kw: 'Per kW (₹/kW)',
  per_deal: 'Per Deal (₹)',
  slab: 'Slab (Tiered)',
};

const SCOPE_LABELS: Record<string, string> = {
  all: 'Default (All)',
  partner: 'Specific Partner',
  partner_tier: 'Partner Tier',
  product_category: 'Product Category',
  location: 'Location (State)',
};

const SLAB_TYPE_LABELS: Record<string, string> = {
  per_kw: '₹/kW',
  percentage: '%',
  fixed: '₹',
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0 min-w-[120px]">{label}</span>
      <span className="text-sm font-medium text-[var(--color-text)] text-right break-all">{children}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{value}</div>
    </div>
  );
}

export function CommissionRuleDetailDrawer({ rule, open, onClose, onEdit, onDuplicate }: CommissionRuleDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const { doc: viewerDoc, open: viewerOpen, viewDocument, closeViewer } = useDocumentViewer();

  // Document attachments — moved BEFORE early return to preserve hook order
  const documents = useMemo(() => {
    if (!rule) return [];
    const p = rule as any;
    const docs: { label: string; doc: DocumentViewerFile; metadata: { date?: string; size?: number } }[] = [];
    if (p?.docFileName || p?.docUrl) {
      docs.push({ label: 'Document', doc: { name: p.docFileName || 'document.pdf', url: p.docUrl || '', mimeType: p.docMimeType, size: p.docSize }, metadata: { date: p.docDate || p.createdAt, size: p.docSize } });
    }
    if (p?.attachmentName || p?.fileUrl) {
      docs.push({ label: 'Attachment', doc: { name: p.attachmentName || 'attachment.pdf', url: p.fileUrl || p.attachmentUrl || '', mimeType: p.attachmentMimeType, size: p.attachmentSize }, metadata: { date: p.attachmentDate || p.createdAt, size: p.attachmentSize } });
    }
    return docs.filter((d) => d.doc?.name && d.doc?.url);
  }, [rule]);

  if (!rule) return null;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'conditions', label: 'Conditions' },
    { key: 'products', label: 'Products' },
    { key: 'partners', label: 'Partners' },
    { key: 'documents', label: 'Documents' },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="flex h-[78vh] max-h-[700px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="shrink-0 flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-4">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-[var(--color-primary)]" />
            <div>
              <h2 className="font-semibold text-[var(--color-text)]">{rule.name}</h2>
              {rule.description && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{rule.description}</p>}
            </div>
          </div>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
            rule.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}>
            {rule.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* ── Tabs ─────────────────────────────────────────── */}
        <nav className="shrink-0 flex gap-1 border-b border-[var(--color-border-subtle)] py-3">
          {tabs.map((tab) => (
            <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab.key ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* ── Tab Content ──────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto pt-4 space-y-4">
          {activeTab === 'overview' && (
            <>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] divide-y divide-[var(--color-border-subtle)]">
                <DetailRow label="Rule ID"><code className="text-xs font-mono bg-[var(--color-surface)] px-1.5 py-0.5 rounded">{rule.id}</code></DetailRow>
                <DetailRow label="Priority">{rule.priority}</DetailRow>
                <DetailRow label="Type">{TYPE_LABELS[rule.type] || rule.type}</DetailRow>
                {rule.type !== 'slab' && <DetailRow label="Value">{rule.type === 'percentage' ? `${rule.value}%` : `₹${rule.value?.toLocaleString('en-IN')}`}</DetailRow>}
                <DetailRow label="Scope">{SCOPE_LABELS[rule.applicableTo] || rule.applicableTo}</DetailRow>
                {rule.partnerTier && <DetailRow label="Tier"><span className="capitalize">{rule.partnerTier}</span></DetailRow>}
                {rule.productCategoryId && <DetailRow label="Category"><span className="capitalize">{rule.productCategoryId}</span></DetailRow>}
                {rule.locationStates && rule.locationStates.length > 0 && <DetailRow label="States">{rule.locationStates.join(', ')}</DetailRow>}
                <DetailRow label="Effective From">{rule.effectiveFrom ? fmtDate(rule.effectiveFrom) : '—'}</DetailRow>
                <DetailRow label="Effective To">{rule.effectiveTo ? fmtDate(rule.effectiveTo) : 'No expiry'}</DetailRow>
                {rule.minAmount != null && <DetailRow label="Min Deal Value">₹{rule.minAmount.toLocaleString('en-IN')}</DetailRow>}
                {rule.maxAmount != null && <DetailRow label="Max Cap">₹{rule.maxAmount.toLocaleString('en-IN')}</DetailRow>}
              </div>

              {rule.type === 'slab' && rule.slabs && rule.slabs.length > 0 && (
                <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                  <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Slabs ({rule.slabs.length})</p>
                  <div className="px-4 pb-3 space-y-1.5">
                    {rule.slabs.sort((a, b) => a.fromKW - b.fromKW).map((slab, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-[var(--color-bg-sunken)]">
                        <span className="text-xs font-medium text-[var(--color-text)]">{slab.fromKW} - {slab.toKW} kW</span>
                        <span className="text-xs font-semibold text-[var(--color-primary-text)]">
                          {slab.type === 'percentage' ? `${slab.value}%` : slab.type === 'fixed' ? `₹${slab.value.toLocaleString('en-IN')}` : `₹${slab.value.toLocaleString('en-IN')}/kW`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'conditions' && (
            <div className="rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Conditions</p>
              <div className="space-y-3">
                {rule.applicableTo === 'all' && <p className="text-sm text-[var(--color-text)]">Applies to all partners and deals.</p>}
                {rule.applicableTo === 'partner_tier' && <p className="text-sm text-[var(--color-text)]">Applies to <span className="font-semibold capitalize">{rule.partnerTier || 'specified'}</span> tier partners.</p>}
                {rule.applicableTo === 'product_category' && <p className="text-sm text-[var(--color-text)]">Applies to <span className="font-semibold capitalize">{rule.productCategoryId || 'specified'}</span> product category.</p>}
                {rule.applicableTo === 'location' && <p className="text-sm text-[var(--color-text)]">Applies to <span className="font-semibold">{rule.locationStates?.join(', ') || 'specified'}</span> state(s).</p>}
                {rule.applicableTo === 'partner' && <p className="text-sm text-[var(--color-text)]">Applies to specific partner.</p>}
                {rule.minAmount != null && <p className="text-sm text-[var(--color-text)]">Minimum deal value: <span className="font-semibold">₹{rule.minAmount.toLocaleString('en-IN')}</span></p>}
                {rule.maxAmount != null && <p className="text-sm text-[var(--color-text)]">Maximum cap: <span className="font-semibold">₹{rule.maxAmount.toLocaleString('en-IN')}</span></p>}
                {rule.effectiveTo && <p className="text-sm text-[var(--color-text)]">Expires: <span className="font-semibold">{fmtDate(rule.effectiveTo)}</span></p>}
              </div>
            </div>
          )}

          {activeTab === 'products' && (
            <div className="rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Product Mapping</p>
              {rule.productCategoryId ? (
                <div className="space-y-2">
                  <Field label="Product Category" value={<span className="capitalize">{rule.productCategoryId}</span>} />
                  <p className="text-sm text-[var(--color-text)] mt-2">
                    This rule applies to products in the <span className="font-semibold capitalize">{rule.productCategoryId}</span> category.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">No product category restrictions. Rule applies to all products.</p>
              )}
              {rule.applicableTo === 'product_category' && (
                <p className="mt-3 text-xs text-[var(--color-text-muted)]">Scope is set to <span className="font-semibold">Product Category</span>. Only deals with matching product categories will use this rule.</p>
              )}
            </div>
          )}

          {activeTab === 'partners' && (
            <div className="rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Partner Mapping</p>
              {rule.partnerTier ? (
                <div className="space-y-2">
                  <Field label="Partner Tier" value={<span className="capitalize">{rule.partnerTier}</span>} />
                  <p className="text-sm text-[var(--color-text)] mt-2">
                    This rule applies to <span className="font-semibold capitalize">{rule.partnerTier}</span> tier partners.
                  </p>
                </div>
              ) : rule.applicableIds && rule.applicableIds.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-[var(--color-text)]">Affected Partners ({rule.applicableIds.length})</p>
                  <ul className="space-y-1.5">
                    {rule.applicableIds.map((id, idx) => (
                      <li key={idx} className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-sunken)] px-3 py-2 text-sm text-[var(--color-text)]">
                        <code className="text-xs font-mono bg-[var(--color-surface)] px-1.5 py-0.5 rounded">{id}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">No partner restrictions. Rule applies to all partners.</p>
              )}
              {rule.applicableTo === 'partner' && (
                <p className="mt-3 text-xs text-[var(--color-text-muted)]">Scope is set to <span className="font-semibold">Specific Partner</span>. Only the selected partner(s) will use this rule.</p>
              )}
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Documents</p>
              {documents.length > 0 ? (
                <div className="space-y-2">
                  {documents.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <File className="h-4 w-4 shrink-0 text-[var(--color-primary-text)]" />
                          <p className="truncate text-sm font-semibold text-[var(--color-text)]">{item.label}</p>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{item.doc.name}{item.metadata.size ? ` · ${formatFileSize(item.metadata.size)}` : ''}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2" data-action>
                        {item.doc.url && (
                          <Button size="xs" variant="outline" icon={<Eye className="h-3 w-3" />} onClick={() => viewDocument(item.doc)}>View</Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">No documents attached.</p>
              )}
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Timeline</p>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 shrink-0">
                    <Clock className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text)]">Created</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{rule.createdAt ? fmtDateTime(rule.createdAt) : '—'}{rule.createdBy ? ` by ${rule.createdBy}` : ''}</p>
                  </div>
                </div>
                {rule.updatedAt && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 shrink-0">
                      <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--color-text)]">Last Modified</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{fmtDateTime(rule.updatedAt)}{rule.updatedBy ? ` by ${rule.updatedBy}` : ''}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Actions ─────────────────────────────────────── */}
        <div className="shrink-0 flex justify-end gap-2 pt-4 border-t border-[var(--color-border-subtle)]">
          {onDuplicate && <Button variant="outline" size="sm" onClick={() => onDuplicate(rule)}>Duplicate</Button>}
          {onEdit && <Button size="sm" onClick={() => onEdit(rule)}>Edit Rule</Button>}
        </div>
      </div>

      <DocumentViewer document={viewerDoc} open={viewerOpen} onClose={closeViewer} fullScreen />
    </Modal>
  );
}

export default CommissionRuleDetailDrawer;
