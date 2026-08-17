/**
 * PartnerProjectDetailDrawer — Read-only project detail for Partner Portal
 *
 * Shows the partner's own project (already filtered by partnerId upstream).
 * Read-only view of project, stage, ownership and linked customer. Project
 * creation happened via the canonical createProject path (customer-inherited
 * ownership), so no write controls live here.
 */

import { FolderKanban, MapPin, ArrowRight, X } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { statusBadge } from '../../components/ui/Badge';

interface PartnerProjectDetailDrawerProps {
  project: any;
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

function formatDate(value: any): string {
  if (!value) return '—';
  const date = typeof value === 'object' && typeof value.toDate === 'function'
    ? value.toDate()
    : typeof value === 'object' && value.seconds
      ? new Date(value.seconds * 1000)
      : new Date(value);
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB');
}

export function PartnerProjectDetailDrawer({ project, open, onClose }: PartnerProjectDetailDrawerProps) {
  if (!project) return null;

  const location = [project.city, project.state].filter(Boolean).join(', ');

  return (
    <Modal open={open} onClose={onClose} size="2xl">
      <div className="flex h-[70vh] max-h-[680px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
        {/* ── Header ─────────────────────────────────────── */}
        <div className="shrink-0 flex flex-col gap-4 border-b border-[var(--color-border-subtle)] pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40 text-2xl font-bold text-blue-700 dark:text-blue-400">
                {(project.name || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-bold text-[var(--color-text)]">
                    {project.name || project.projectId || 'Untitled Project'}
                  </h2>
                  {statusBadge(project.currentStage || 'New')}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--color-text-muted)]">
                  <span>{project.projectId || '—'}</span>
                  {location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {location}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Scrollable Content ─────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto pt-4 space-y-5">
          {/* Project Information */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project Information</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Project Type" value={project.projectType || <MutedValue />} />
              <Field label="Capacity" value={project.capacityKw ? `${project.capacityKw} kW` : <MutedValue />} />
              <Field label="Current Stage">{statusBadge(project.currentStage || 'New')}</Field>
              <Field label="Status" value={project.status || <MutedValue />} />
              <Field label="System Type" value={project.systemType || <MutedValue />} />
              <Field label="Site Address" value={project.siteAddress || <MutedValue />} />
            </div>
          </section>

          {/* Ownership */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Ownership</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Partner" value={project.partnerName || project.partnerId || <MutedValue>—</MutedValue>} />
              <Field label="Customer" value={project.customerName || project.customerId || <MutedValue />} />
              <Field label="Source Lead" value={project.leadId || <MutedValue />} />
            </div>
          </section>

          {/* Stage Timeline */}
          {Array.isArray(project.stageHistory) && project.stageHistory.length > 0 && (
            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Stage Timeline</h3>
              <div className="mt-3 space-y-2">
                {project.stageHistory.map((entry: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-2.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                    <span className="text-sm font-semibold text-[var(--color-text)] capitalize">{entry.stage}</span>
                    <span className="ml-auto text-xs text-[var(--color-text-muted)]">{formatDate(entry.changedAt)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Record Info */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Record Info</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Project ID" value={project.projectId || <MutedValue />} />
              <Field label="Created" value={project.createdAt ? formatDate(project.createdAt) : <MutedValue />} />
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
}

export default PartnerProjectDetailDrawer;
