/**
 * PartnerCustomerDetailDrawer — Read-only customer detail for Partner Portal
 *
 * Shows the partner's own customer (already filtered by partnerId upstream).
 * Read-only view of contact + ownership info. Partners progress the journey
 * by creating a Project from the customer (Phase 5).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { MapPin, Mail, Phone, ArrowRight, X } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { COLLECTIONS } from '../../lib/firebase';
import { getAll } from '../../lib/firestore';

interface PartnerCustomerDetailDrawerProps {
  customer: any;
  open: boolean;
  onClose: () => void;
}

function MutedValue({ children = 'Not available' }: { children?: React.ReactNode }) {
  return <span className="text-[var(--color-text-muted)]">{children}</span>;
}

function Field({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{children ?? value}</div>
    </div>
  );
}

function TypeBadge({ type }: { type?: string }) {
  const isB2B = type === 'B2B';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
      isB2B ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
    }`}>
      {type || '—'}
    </span>
  );
}

function formatDate(value: any): string {
  if (!value) return '—';
  const date = typeof value === 'object' && typeof value.toDate === 'function'
    ? value.toDate()
    : typeof value === 'object' && value.seconds
      ? new Date(value.seconds * 1000)
      : new Date(value);
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB');
}

export function PartnerCustomerDetailDrawer({ customer, open, onClose }: PartnerCustomerDetailDrawerProps) {
  const navigate = useNavigate();

  // Existing linked project (if any) for this customer.
  const { data: projects = [] } = useQuery({
    queryKey: ['partner_customer_projects', customer?.id],
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    enabled: Boolean(open && customer?.id),
    staleTime: 15_000,
  });

  const linkedProject = useMemo(
    () => (projects as any[]).find((p: any) => p.customerId === customer?.id && !p.isDeleted),
    [projects, customer?.id],
  );

  if (!customer) return null;

  const location = [customer.city, customer.state].filter(Boolean).join(', ');

  return (
    <Modal open={open} onClose={onClose} size="2xl">
      <div className="flex h-[70vh] max-h-[680px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
        {/* ── Header ─────────────────────────────────────── */}
        <div className="shrink-0 flex flex-col gap-4 border-b border-[var(--color-border-subtle)] pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                {(customer.name || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-bold text-[var(--color-text)]">
                    {customer.name || 'Untitled Customer'}
                  </h2>
                  <TypeBadge type={customer.type} />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--color-text-muted)]">
                  {location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {location}
                    </span>
                  )}
                  {customer.sourceLeadId && <span>Converted from Lead</span>}
                </div>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Contact actions */}
          <div className="flex flex-wrap gap-2">
            {customer.phone && (
              <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]">
                <Phone className="h-3.5 w-3.5" /> Call
              </a>
            )}
            {customer.email && (
              <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]">
                <Mail className="h-3.5 w-3.5" /> Email
              </a>
            )}
          </div>
        </div>

        {/* ── Scrollable Content ─────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto pt-4 space-y-5">
          {/* Customer Information */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Customer Information</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Name" value={customer.name || <MutedValue />} />
              <Field label="Phone">
                {customer.phone ? (
                  <a href={`tel:${customer.phone}`} className="text-[var(--color-primary-text)] hover:underline">{customer.phone}</a>
                ) : <MutedValue />}
              </Field>
              <Field label="Email">
                {customer.email ? (
                  <a href={`mailto:${customer.email}`} className="text-[var(--color-primary-text)] hover:underline">{customer.email}</a>
                ) : <MutedValue />}
              </Field>
              <Field label="Company" value={customer.company || <MutedValue />} />
              <Field label="Type">{<TypeBadge type={customer.type} />}</Field>
              <Field label="Address" value={customer.address || <MutedValue />} />
            </div>
          </section>

          {/* Ownership */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Ownership</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Partner" value={customer.partnerName || customer.partnerId || <MutedValue>—</MutedValue>} />
              <Field label="Source Lead" value={customer.sourceLeadId || <MutedValue />} />
            </div>
          </section>

          {/* Project */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project</h3>
            {linkedProject ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--color-text)]">{linkedProject.name || linkedProject.projectId}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {linkedProject.projectType || ''} · {linkedProject.capacityKw ? `${linkedProject.capacityKw} kW` : ''} · Created {formatDate(linkedProject.createdAt)}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => navigate(`/partner/projects/${linkedProject.id}`)}>
                  View
                </Button>
              </div>
            ) : (
              <div className="mt-3">
                <p className="text-xs text-[var(--color-text-muted)] mb-3">
                  Create a project for this customer to start the installation journey.
                </p>
                <Button size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => navigate(`/partner/projects/new?customer=${encodeURIComponent(customer.id)}`)}>
                  Create Project
                </Button>
              </div>
            )}
          </section>

          {/* Record Info */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Record Info</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Customer ID" value={customer.id || <MutedValue />} />
              <Field label="Created" value={customer.createdAt ? formatDate(customer.createdAt) : <MutedValue />} />
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
}

export default PartnerCustomerDetailDrawer;
