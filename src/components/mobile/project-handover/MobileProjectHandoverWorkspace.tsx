/**
 * MobileProjectHandoverWorkspace — Native mobile Project Handover workspace
 *
 * Provides:
 * - Card-based list with search (URL-synced), pagination (10/page)
 * - Mini stat pills (total, completed)
 * - Create handover modal with project selector, customer, dates, engineer, notes
 * - Detail modal with status badge, info sections, timeline, transition actions
 * - Loading/empty/error states
 * - Selection + bulk clear
 * - Permission gates (create, transitions)
 *
 * Reuses: useProjectHandovers, useCreateHandover, useTransitionHandover from features
 * Reuses: isValidTransition, HandoverCreateInput, HandoverRecord, HandoverStatus
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Handshake } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import { cn } from '../../../utils/cn';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtDate, getAll } from '../../../lib/firestore';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';

import { useCreateHandover, useProjectHandovers, useTransitionHandover } from '../../../features/project-handover/hooks/useProjectHandover';
import type { HandoverCreateInput, HandoverRecord, HandoverStatus } from '../../../lib/projectHandoverWorkflow';
import { isValidTransition } from '../../../lib/projectHandoverWorkflow';

const PER_PAGE = 10;

/* ── Skeleton Card ─────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <Card className="rounded-xl p-4">
      <div className="flex gap-3">
        <div className="h-10 w-10 rounded-lg bg-[var(--color-bg-sunken)] shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

export function MobileProjectHandoverWorkspace({ mode }: { mode?: 'records' | 'create' }) {
  const [params, setParams] = useSearchParams();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();

  const { data: handovers = [], isLoading, isError, refetch } = useProjectHandovers();
  const { data: projects = [] } = useQuery({
    queryKey: keys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
    enabled: Boolean(activeCompanyId),
  });

  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [viewItem, setViewItem] = useState<HandoverRecord | null>(null);

  const createMut = useCreateHandover();
  const transitionMut = useTransitionHandover();

  const [form, setForm] = useState<HandoverCreateInput>({
    projectId: '',
    projectName: '',
    customerId: '',
    customerName: '',
    handoverDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const eligibleProjects = useMemo(() =>
    (projects as any[]).filter((p: any) =>
      ['NetMetering', 'Subsidy', 'Handover'].includes(p.currentStage)
    ), [projects]);

  function handleProjectSelect(projectId: string) {
    const project = (projects as any[]).find((p: any) => p.id === projectId);
    setForm({
      ...form,
      projectId,
      projectName: project?.projectId || project?.name || projectId,
      customerId: project?.customerId || '',
      customerName: project?.customerName || project?.customer || '',
    });
  }

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.projectId) return toast.error('Please select a project');
    if (!form.customerName) return toast.error('Customer name is required');
    if (!form.handoverDate) return toast.error('Handover date is required');
    createMut.mutate(form, { onSuccess: () => {
      closeCreateForm();
    }});
  }

  function resetForm() {
    setForm({
      projectId: '',
      projectName: '',
      customerId: '',
      customerName: '',
      handoverDate: new Date().toISOString().split('T')[0],
      notes: '',
    });
  }

  const search = params.get('q') || '';

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return (handovers as HandoverRecord[]).filter((h) =>
      !term || [h.id, h.handoverNumber, h.customerName, h.projectName, h.assignedEngineerName]
        .some((v) => String(v || '').toLowerCase().includes(term))
    );
  }, [handovers, search]);

  const paginated = useMemo(() =>
    filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE),
  [filtered, page]);

  // URL sync
  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  /** Remove ?create=1 from the URL so the create form can be reopened on the next attempt */
  function closeCreateForm() {
    setFormOpen(false);
    resetForm();
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }

  // Handle ?create=1
  useEffect(() => {
    if (mode === 'create' || params.get('create') === '1') {
      setFormOpen(true);
    }
  }, [mode, params]);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleTransition(handoverId: string, nextStatus: HandoverStatus) {
    const payload: any = { handoverId, nextStatus };
    const target = handovers.find((h) => h.id === handoverId);
    if (nextStatus === 'Scheduled' && target) {
      const date = target.scheduledDate || target.handoverDate || new Date().toISOString().split('T')[0];
      payload.scheduledDate = date;
      if (target.assignedEngineerName) {
        payload.assignedEngineerName = target.assignedEngineerName;
        payload.assignedEngineer = target.assignedEngineer;
      }
    }
    if (nextStatus === 'Cancelled') {
      payload.note = 'Cancelled';
    }
    transitionMut.mutate(payload);
  }

  const canCreate = perms.canEdit('projects');

  return (
    <div className="space-y-4 pb-4 pt-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Handovers</h1>
          <p className="text-xs text-[var(--color-text-muted)]">{handovers.length} total</p>
        </div>
      </div>

      {/* Selection Bar */}
      {selected.size > 0 && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">
              {selected.size} selected
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="flex flex-col items-center justify-center min-h-[30vh] text-center px-6">
          <Handshake className="h-10 w-10 text-rose-500 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">Failed to load handovers</h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-[260px]">Could not load handover data.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && paginated.length === 0 && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <Handshake className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--color-text)]">
            {params.get('q') ? 'No handovers match your search' : 'No handovers yet'}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {params.get('q') ? 'Try a different search term.' : 'Create a handover when a project is ready for final sign-off.'}
          </p>
        </div>
      )}

      {/* Handover Cards */}
      {!isLoading && !isError && (
        <div className="space-y-3">
          {paginated.map((h) => (
            <div
              key={h.id}
              className={cn(
                'rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 shadow-sm transition-shadow',
                'hover:shadow-[var(--shadow-enterprise-row)]',
                selected.has(h.id) && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
              )}
            >
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(h.id)}
                  onChange={() => toggleSelect(h.id)}
                  className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
                  aria-label={`Select ${h.handoverNumber}`}
                />
                <button
                  type="button"
                  onClick={() => setViewItem(h)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 text-xs font-bold">
                          <Handshake className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="truncate text-sm font-bold text-[var(--color-text)]">{h.handoverNumber}</p>
                          <p className="truncate text-xs text-[var(--color-text-muted)]">{h.customerName}</p>
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0">{statusBadge(h.status)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
                    <span>{h.projectName}</span>
                    {h.handoverDate && <span>· {fmtDate(h.handoverDate)}</span>}
                  </div>
                  {h.assignedEngineerName && (
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                      Engineer: {h.assignedEngineerName}
                    </p>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && !isError && filtered.length > 0 && (
        <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      {/* ══════════════════════════════════════════════════════
         CREATE MODAL
         ══════════════════════════════════════════════════════ */}
      <Modal open={formOpen} onClose={closeCreateForm} title="New Handover" size="full">
        <form onSubmit={submitForm} className="space-y-4">
          <Select
            label="Project"
            required
            value={form.projectId}
            onChange={(e) => handleProjectSelect(e.target.value)}
            options={[
              { label: 'Select project...', value: '' },
              ...eligibleProjects.map((p: any) => ({
                label: `${p.projectId || p.name || p.id} — ${p.customerName || p.customer || ''}`,
                value: p.id,
              })),
            ]}
          />
          <Input label="Customer Name" required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Handover Date" type="date" required value={form.handoverDate} onChange={(e) => setForm({ ...form, handoverDate: e.target.value })} />
            <Input label="Scheduled Date" type="date" value={form.scheduledDate || ''} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
          </div>
          <Input label="Assigned Engineer" value={form.assignedEngineerName || ''} onChange={(e) => setForm({ ...form, assignedEngineerName: e.target.value, assignedEngineer: e.target.value })} />
          <Textarea label="Notes" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={closeCreateForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={createMut.isPending}>Create</Button>
          </div>
        </form>
      </Modal>

      {/* ══════════════════════════════════════════════════════
         DETAIL MODAL
         ══════════════════════════════════════════════════════ */}
      <Modal open={!!viewItem} onClose={() => setViewItem(null)} title={viewItem?.handoverNumber || ''} size="full">
        {viewItem && (
          <div className="space-y-4">
            {/* Status Badge */}
            <div className="text-center py-1">
              <p className="text-lg font-bold text-[var(--color-text)]">{viewItem.handoverNumber}</p>
              <div className="mt-1 inline-flex">{statusBadge(viewItem.status)}</div>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Created {fmtDate(viewItem.createdAt)}
              </p>
            </div>

            {/* Info Sections */}
            <Section title="Customer">
              <Detail label="Name" value={viewItem.customerName} />
              <Detail label="Project" value={viewItem.projectName} />
            </Section>

            <Section title="Schedule">
              <Detail label="Handover Date" value={viewItem.handoverDate ? fmtDate(viewItem.handoverDate) : '—'} />
              <Detail label="Scheduled" value={viewItem.scheduledDate ? fmtDate(viewItem.scheduledDate) : '—'} />
              <Detail label="Engineer" value={viewItem.assignedEngineerName || '—'} />
            </Section>

            {viewItem.completedAt && (
              <Section title="Completion">
                <Detail label="Completed At" value={fmtDate(viewItem.completedAt)} />
                <Detail label="Completed By" value={viewItem.completedBy || '—'} />
              </Section>
            )}

            {viewItem.cancelledAt && (
              <Section title="Cancellation">
                <Detail label="Cancelled At" value={fmtDate(viewItem.cancelledAt)} />
                <Detail label="Reason" value={viewItem.cancellationReason || '—'} />
              </Section>
            )}

            {viewItem.notes && (
              <Section title="Notes">
                <p className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap">{viewItem.notes}</p>
              </Section>
            )}

            {/* Timeline */}
            {viewItem.statusHistory.length > 1 && (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Timeline</p>
                <div className="space-y-2">
                  {viewItem.statusHistory.map((entry, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        entry.status === 'Completed' ? 'bg-emerald-500' :
                        entry.status === 'Cancelled' ? 'bg-red-500' : 'bg-amber-500'
                      }`} />
                      <div>
                        <p className="font-medium text-[var(--color-text)]">{entry.status}</p>
                        <p className="text-[var(--color-text-muted)]">{entry.changedBy} · {fmtDate(entry.changedAt)}</p>
                        {entry.note && <p className="text-[var(--color-text-muted)] italic">{entry.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Transition Actions */}
            <div className="flex flex-col gap-2 pt-1">
              {perms.canEdit('projects') && isValidTransition(viewItem.status as HandoverStatus, 'Scheduled') && (
                <Button size="sm" variant="outline" onClick={() => { setViewItem(null); handleTransition(viewItem.id, 'Scheduled'); }}>Schedule</Button>
              )}
              {perms.canEdit('projects') && isValidTransition(viewItem.status as HandoverStatus, 'Completed') && (
                <Button size="sm" onClick={() => { setViewItem(null); handleTransition(viewItem.id, 'Completed'); }}>Complete Handover</Button>
              )}
              {perms.canEdit('projects') && isValidTransition(viewItem.status as HandoverStatus, 'Cancelled') && (
                <Button size="sm" variant="danger" onClick={() => { setViewItem(null); handleTransition(viewItem.id, 'Cancelled'); }}>Cancel</Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ── Shared Sub-Components ─────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className="text-xs font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  );
}

export default MobileProjectHandoverWorkspace;
