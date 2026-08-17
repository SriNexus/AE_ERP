import { useEffect, useMemo, useState } from 'react';
import { Archive, Edit2, Link2, X } from 'lucide-react';

import { Badge, statusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { fmtDate, fmtDateTime } from '../../../lib/firestore';
import type { ProjectRecord } from '../types';
import { projectCapacityLabel, projectCustomerLabel, projectSiteAddressSummary, projectStageLabel } from '../utils/projectDisplay';

type CustomerLike = Record<string, unknown> | null | undefined;

interface ProjectDetailModalProps {
  open: boolean;
  project: ProjectRecord | null;
  customer: CustomerLike;
  canEdit: boolean;
  canArchive: boolean;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-[var(--color-text)]">{value ?? <span className="text-[var(--color-text-disabled)]">—</span>}</div>
    </div>
  );
}

export function ProjectDetailModal({
  open,
  project,
  customer,
  canEdit,
  canArchive,
  onClose,
  onEdit,
  onArchive,
}: ProjectDetailModalProps) {
  const [tab, setTab] = useState<'overview' | 'links' | 'history'>('overview');

  useEffect(() => {
    if (open) {
      setTab('overview');
    }
  }, [open, project?.id]);

  const linkedQuotations = useMemo(() => project?.linkedQuotationIds || [], [project]);
  const linkedOrders = useMemo(() => project?.linkedOrderIds || [], [project]);
  const linkedDispatches = useMemo(() => project?.linkedDispatchIds || [], [project]);
  const stageHistory = useMemo(() => project?.stageHistory || [], [project]);

  if (!open || !project) return null;

  const customerName = projectCustomerLabel(customer);
  const statusLabel = project.currentStage || 'New';
  const isArchived = statusLabel === 'Archived';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      footer={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {canEdit && <Button variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>}
          {canArchive && !isArchived && <Button variant="outline" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={onArchive}>Archive</Button>}
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      )}
    >
      <div className="flex h-[78vh] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
        <header className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
              {(project.projectId || project.id || '?')[0]?.toUpperCase() || '?'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{project.projectId || project.id}</h2>
                {statusBadge(statusLabel)}
                {project.leadId && <Badge variant="info">Lead Linked</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                <span>{customerName}</span>
                <span>Capacity: {projectCapacityLabel(project.capacityKw)}</span>
                <span>Created: {fmtDate(project.createdAt)}</span>
                <span>Updated: {fmtDate(project.updatedAt || project.createdAt)}</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close project details"
            className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav className="shrink-0 grid grid-cols-3 gap-1 border-b border-[var(--color-border-subtle)] py-4">
          {([
            ['overview', 'Overview'],
            ['links', 'Links'],
            ['history', 'History'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={[
                'rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors',
                tab === key
                  ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto transition-opacity duration-150">
          {tab === 'overview' && (
            <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-5">
                <DetailCard title="Project Information">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Project ID" value={project.projectId} />
                    <Field label="Customer" value={customerName} />
                    <Field label="Lead ID" value={project.leadId || '—'} />
                    <Field label="Current Stage" value={projectStageLabel(project.currentStage)} />
                    <Field label="Capacity" value={projectCapacityLabel(project.capacityKw)} />
                    <Field label="Project Type" value={project.projectType || '—'} />
                    <Field label="Sales Owner" value={project.salesOwner || '—'} />
                    <Field label="Surveyor" value={project.assignedSurveyor || '—'} />
                    <Field label="Installer" value={project.assignedInstaller || '—'} />
                  </div>
                </DetailCard>

                <DetailCard title="Site Address">
                  <p className="whitespace-pre-wrap leading-relaxed text-[var(--color-text-secondary)]">
                    {projectSiteAddressSummary(project.siteAddress)}
                  </p>
                  {project.siteAddress?.latitude != null && project.siteAddress?.longitude != null && (
                    <a
                      href={`https://www.google.com/maps?q=${project.siteAddress.latitude},${project.siteAddress.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block text-xs font-semibold text-[var(--color-primary-text)] hover:underline"
                    >
                      GPS: {project.siteAddress.latitude.toFixed(5)}, {project.siteAddress.longitude.toFixed(5)} (surveyed) →
                    </a>
                  )}
                </DetailCard>
              </div>

              <aside className="space-y-4">
                <DetailCard title="Quick Actions">
                  <div className="space-y-2" data-action>
                    {canEdit && <Button className="w-full justify-start" variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={onEdit}>Edit Project</Button>}
                    {canArchive && !isArchived && <Button className="w-full justify-start" variant="outline" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={onArchive}>Archive Project</Button>}
                  </div>
                </DetailCard>

                <DetailCard title="Summary">
                  <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
                    <p>Linked quotations: <span className="font-semibold text-[var(--color-text)]">{linkedQuotations.length}</span></p>
                    <p>Linked orders: <span className="font-semibold text-[var(--color-text)]">{linkedOrders.length}</span></p>
                    <p>Linked dispatches: <span className="font-semibold text-[var(--color-text)]">{linkedDispatches.length}</span></p>
                    <p>Archived: <span className="font-semibold text-[var(--color-text)]">{isArchived ? 'Yes' : 'No'}</span></p>
                  </div>
                </DetailCard>
              </aside>
            </div>
          )}

          {tab === 'links' && (
            <div className="grid gap-5 pt-5 lg:grid-cols-3">
              <DetailCard title="Quotations">
                <div className="space-y-2">
                  {linkedQuotations.length ? linkedQuotations.map((id) => (
                    <div key={id} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-sm text-[var(--color-text)]">
                      <Link2 className="mr-2 inline-block h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                      {id}
                    </div>
                  )) : <p className="text-sm text-[var(--color-text-muted)]">No linked quotations yet.</p>}
                </div>
              </DetailCard>
              <DetailCard title="Orders">
                <div className="space-y-2">
                  {linkedOrders.length ? linkedOrders.map((id) => (
                    <div key={id} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-sm text-[var(--color-text)]">
                      <Link2 className="mr-2 inline-block h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                      {id}
                    </div>
                  )) : <p className="text-sm text-[var(--color-text-muted)]">No linked orders yet.</p>}
                </div>
              </DetailCard>
              <DetailCard title="Dispatches">
                <div className="space-y-2">
                  {linkedDispatches.length ? linkedDispatches.map((id) => (
                    <div key={id} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-sm text-[var(--color-text)]">
                      <Link2 className="mr-2 inline-block h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                      {id}
                    </div>
                  )) : <p className="text-sm text-[var(--color-text-muted)]">No linked dispatches yet.</p>}
                </div>
              </DetailCard>
            </div>
          )}

          {tab === 'history' && (
            <div className="pt-5">
              <DetailCard title="Stage History">
                <div className="space-y-3">
                  {stageHistory.length ? stageHistory.map((entry, index) => (
                    <div key={`${entry.stage}-${index}`} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-[var(--color-text)]">{projectStageLabel(entry.stage)}</p>
                          <time className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">{fmtDateTime(entry.changedAt)}</time>
                        </div>
                        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{entry.note || 'Stage change recorded'}</p>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{entry.changedBy || 'System'}</p>
                      </div>
                    </div>
                  )) : <p className="text-sm text-[var(--color-text-muted)]">No stage history recorded yet.</p>}
                </div>
              </DetailCard>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
