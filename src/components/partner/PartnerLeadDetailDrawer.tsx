/**
 * PartnerLeadDetailDrawer — Read-only lead detail view for Partner Portal
 *
 * Partners can view:
 *   - Customer details, contact info, address, notes, timeline
 *   - Installation status, documentation status, commission status
 *
 * Partners may edit only allowed fields: customer name, phone, notes
 *
 * No admin controls (transfer, delete, convert, commission actions).
 */

import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Phone,
  Mail,
  MapPin,
  Calendar,
  User,
  FileText,
  Handshake,
  X,
  Edit2,
  Check,
  Clock,
  ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { statusBadge } from '../../components/ui/Badge';
import { fmtDate, resolveWriteCompanyId } from '../../lib/firestore';
import { updateProjectionWithEntity } from '../../lib/entityProjection';
import { COLLECTIONS } from '../../lib/firebase';
import { useCurrentUser } from '../../store/useAppStore';
import { queryKeys } from '../../lib/queryKeys';
import { convertLeadToCustomer } from '../../lib/leadWorkflow';
import { useAppStore } from '../../store/useAppStore';
import { getAllowedCustomerTypesForBusinessMode } from '../../lib/customerClassification';
import { resolveBusinessMode } from '../../lib/companyBusinessMode';
import {
  COMMISSION_STATUS_STYLES,
  COMMISSION_STATUS_LABELS,
  INSTALLATION_STATUS_STYLES,
  INSTALLATION_STATUS_LABELS,
  DOCUMENTATION_STATUS_STYLES,
  DOCUMENTATION_STATUS_LABELS,
} from '../../features/channel-partner/types/leadIntegration';

interface PartnerLeadDetailDrawerProps {
  lead: any;
  open: boolean;
  onClose: () => void;
}

function MutedValue({ children = 'Not available' }: { children?: React.ReactNode }) {
  return <span className="text-[var(--color-text-muted)]">{children}</span>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{children ?? value}</div>
    </div>
  );
}

function StatusBadgeInline({ status, stylesMap, labelsMap }: {
  status: string;
  stylesMap: Record<string, string>;
  labelsMap: Record<string, string>;
}) {
  const style = stylesMap[status] || 'bg-gray-100 dark:bg-gray-800 text-gray-500';
  const label = labelsMap[status] || status.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatCreatedDate(value: any): string {
  const date = toDateValue(value);
  if (!date) return '';
  return date.toLocaleDateString('en-GB');
}

export function PartnerLeadDetailDrawer({ lead, open, onClose }: PartnerLeadDetailDrawerProps) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Reset edit state when lead changes
  useEffect(() => {
    if (lead) {
      setEditName(lead.name || '');
      setEditPhone(lead.phone || '');
      setEditNotes(lead.notes || '');
      setEditing(false);
    }
  }, [lead?.id]);

  const saveEdit = useMutation({
    mutationFn: async () => {
      if (!lead?.id) return;
      await updateProjectionWithEntity(COLLECTIONS.LEADS, lead.id, {
        name: editName,
        phone: editPhone,
        notes: editNotes,
        updatedBy: user.id,
      });
    },
    onSuccess: () => {
      const activeCompanyId = lead?.companyId || resolveWriteCompanyId();
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).leadsRoot });
      toast.success('Lead updated');
      setEditing(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Convert to Customer (Phase 5) ────────────────────
  // Reuses the canonical convertLeadToCustomer service. The customer inherits
  // the lead's partnerId/partnerName (Phase 3 §9.2) and the service rejects
  // any partner converting a lead owned by a different partner (Phase 5 §9.3).
  const [converting, setConverting] = useState(false);
  const [convertType, setConvertType] = useState<'B2B' | 'B2C'>('B2C');
  // Default to the type the company's Business Mode actually allows (single
  // mode ⇒ auto-selected, matching LeadWorkspaceConversionFlow).
  const businessMode = resolveBusinessMode(useAppStore((s) => s.company));
  const allowedConvertTypes = useMemo(
    () => getAllowedCustomerTypesForBusinessMode(businessMode),
    [businessMode],
  );
  useEffect(() => {
    if (allowedConvertTypes.length === 1) {
      setConvertType(allowedConvertTypes[0] as 'B2B' | 'B2C');
    }
  }, [allowedConvertTypes]);

  async function handleConvert() {
    if (!lead?.id || converting) return;
    setConverting(true);
    try {
      const customerId = await convertLeadToCustomer(lead, convertType);
      const activeCompanyId = lead?.companyId || resolveWriteCompanyId();
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).leadsRoot });
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).customersRoot });
      toast.success(`Lead converted to ${convertType} customer!`);
      onClose();
      // Surface the freshly-created customer in the portal (SPA navigation).
      if (customerId) {
        navigate(`/partner/customers?view=${encodeURIComponent(customerId)}`);
      } else {
        navigate('/partner/customers');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Conversion failed');
    } finally {
      setConverting(false);
    }
  }

  if (!lead) return null;

  const location = [lead.city, lead.state].filter(Boolean).join(', ');
  const activity = lead.activityLog || [];
  const latestNote = [...activity].reverse().find((item: any) => item?.desc || item?.note);
  const followups = activity.filter((log: any) => String(log.type || '').toLowerCase().includes('follow'));

  return (
    <Modal open={open} onClose={onClose} size="2xl">
      <div className="flex h-[78vh] max-h-[760px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
        {/* ── Header ─────────────────────────────────────── */}
        <div className="shrink-0 flex flex-col gap-4 border-b border-[var(--color-border-subtle)] pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-2xl font-bold text-indigo-700 dark:text-indigo-400">
                {(lead.name || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-bold text-[var(--color-text)]">
                    {editing ? (
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="text-lg font-bold" />
                    ) : (
                      lead.name || 'Untitled Lead'
                    )}
                  </h2>
                  {statusBadge(lead.status || 'New')}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--color-text-muted)]">
                  {location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {location}
                    </span>
                  )}
                  <span>Source: {lead.source || '—'}</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Contact action buttons */}
          <div className="flex flex-wrap gap-2">
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]">
                <Phone className="h-3.5 w-3.5" /> Call
              </a>
            )}
            {lead.phone && (
              <a href={`https://wa.me/${String(lead.phone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]">
                <Mail className="h-3.5 w-3.5" /> WhatsApp
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]">
                <Mail className="h-3.5 w-3.5" /> Email
              </a>
            )}
            {!editing && (
              <Button variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {!editing && lead.status !== 'Converted' && (
              <Button
                size="sm"
                icon={<ArrowRight className="h-3.5 w-3.5" />}
                onClick={handleConvert}
                loading={converting}
                disabled={converting}
                title="Convert this lead to a customer"
              >
                Convert to Customer
              </Button>
            )}
          </div>
        </div>

        {/* ── Convert type toggle ────────────────────────── */}
        {!editing && lead.status !== 'Converted' && !converting && (
          <div className="shrink-0 -mt-2 flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Convert as</span>
            <div className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5">
              {(['B2C', 'B2B'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setConvertType(t)}
                  className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${
                    convertType === t
                      ? 'bg-[var(--color-primary)] text-white shadow-sm'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Scrollable Content ─────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto pt-4 space-y-5">
          {/* Lead Information */}
          <DetailSection title="Lead Information">
            <div className="grid gap-3 sm:grid-cols-2">
              {editing ? (
                <>
                  <Field label="Name">
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </Field>
                  <Field label="Phone">
                    <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Name" value={lead.name || <MutedValue />} />
                  <Field label="Phone">
                    {lead.phone ? (
                      <a href={`tel:${lead.phone}`} className="text-[var(--color-primary-text)] hover:underline">{lead.phone}</a>
                    ) : <MutedValue />}
                  </Field>
                </>
              )}
              <Field label="Email">
                {lead.email ? (
                  <a href={`mailto:${lead.email}`} className="text-[var(--color-primary-text)] hover:underline">{lead.email}</a>
                ) : <MutedValue />}
              </Field>
              <Field label="Source" value={lead.source || <MutedValue />} />
              <Field label="Status">{statusBadge(lead.status || 'New')}</Field>
              <Field label="City" value={lead.city || <MutedValue />} />
            </div>
          </DetailSection>

          {/* Partner Workflow Status */}
          <DetailSection title="Partner Workflow">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Installation Status">
                {lead.installationStatus ? (
                  <StatusBadgeInline
                    status={lead.installationStatus}
                    stylesMap={INSTALLATION_STATUS_STYLES}
                    labelsMap={INSTALLATION_STATUS_LABELS}
                  />
                ) : <MutedValue>Pending</MutedValue>}
              </Field>
              <Field label="Documentation Status">
                {lead.documentationStatus ? (
                  <StatusBadgeInline
                    status={lead.documentationStatus}
                    stylesMap={DOCUMENTATION_STATUS_STYLES}
                    labelsMap={DOCUMENTATION_STATUS_LABELS}
                  />
                ) : <MutedValue>Pending</MutedValue>}
              </Field>
              <Field label="Commission Status">
                {lead.commissionStatus ? (
                  <StatusBadgeInline
                    status={lead.commissionStatus}
                    stylesMap={COMMISSION_STATUS_STYLES}
                    labelsMap={COMMISSION_STATUS_LABELS}
                  />
                ) : <MutedValue>Not Eligible</MutedValue>}
              </Field>
              <Field label="Commission Amount">
                {lead.commissionAmount != null
                  ? `₹${Number(lead.commissionAmount).toLocaleString('en-IN')}`
                  : <MutedValue>—</MutedValue>}
              </Field>
            </div>

            {/* Installation Progress */}
            {lead.installationStatus && (
              <div className="mt-4 pt-3 border-t border-[var(--color-border-subtle)]">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
                  Installation Progress
                </p>
                <div className="flex items-center gap-1">
                  {INSTALLATION_STATUS_LABELS[lead.installationStatus as keyof typeof INSTALLATION_STATUS_LABELS] || String(lead.installationStatus).replace(/_/g, ' ')}
                </div>
                {/* Simple progress indicator */}
                <div className="mt-2 h-1.5 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.max(0,
                        (Object.keys(INSTALLATION_STATUS_LABELS).indexOf(lead.installationStatus) / (Object.keys(INSTALLATION_STATUS_LABELS).length - 1)) * 100
                      ))}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </DetailSection>

          {/* Notes */}
          <DetailSection title="Notes">
            {editing ? (
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Add notes..."
                rows={4}
              />
            ) : (
              <div className="whitespace-pre-wrap rounded-xl bg-[var(--color-bg-sunken)] p-4 text-sm text-[var(--color-text-secondary)] leading-relaxed">
                {lead.notes || 'No notes recorded.'}
              </div>
            )}
          </DetailSection>

          {/* Next Follow-up */}
          {lead.next_date && (
            <DetailSection title="Next Follow-up">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[var(--color-text-muted)]" />
                <span className="font-semibold text-[var(--color-text)]">{formatCreatedDate(lead.next_date)}</span>
              </div>
            </DetailSection>
          )}

          {/* Activity Timeline */}
          <DetailSection title="Activity Timeline">
            {activity.length > 0 ? (
              <div className="space-y-3">
                {activity.map((log: any, idx: number) => (
                  <div key={log.id || idx} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-[var(--color-text)]">{log.type || 'Activity'}</p>
                        <time className="text-xs text-[var(--color-text-muted)]">{formatCreatedDate(log.date)}</time>
                      </div>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{log.desc || 'No details.'}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">by {log.userName || 'Unknown'}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <Clock className="h-4 w-4" /> No recorded activity.
              </div>
            )}
          </DetailSection>

          {/* Created / Updated Info */}
          <DetailSection title="Record Info">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Created" value={lead.createdAt ? formatCreatedDate(lead.createdAt) : <MutedValue />} />
              <Field label="Last Updated" value={lead.updatedAt ? formatCreatedDate(lead.updatedAt) : <MutedValue />} />
            </div>
          </DetailSection>
        </div>

        {/* ── Edit Save/Cancel Footer ──────────────────────── */}
        {editing && (
          <div className="shrink-0 flex items-center gap-2 pt-4 border-t border-[var(--color-border-subtle)]">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
                setEditName(lead.name || '');
                setEditPhone(lead.phone || '');
                setEditNotes(lead.notes || '');
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              icon={<Check className="h-3.5 w-3.5" />}
              onClick={() => saveEdit.mutate()}
              loading={saveEdit.isPending}
            >
              Save Changes
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default PartnerLeadDetailDrawer;
