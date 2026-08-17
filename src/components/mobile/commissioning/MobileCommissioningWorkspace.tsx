/**
 * MobileCommissioningWorkspace — Native mobile Commissioning workspace
 *
 * Provides full Desktop parity:
 * - Card-based list with search, project filter, pagination (10/page)
 * - Mini stat pills (total, total kWh, avg kWh)
 * - Pending commissioning alert bar
 * - Create flow with generation test, warranty, signature capture, notes
 * - Detail bottom sheet with signature display
 * - Loading/empty/error states
 * - Selection + bulk clear
 * - Permission gates
 *
 * Reuses: createCommissioningRecord, SignatureCapture, CommissioningRecord
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap,
  CheckCircle2,
  Calendar,
  UserCheck,
  FolderKanban,

  X,
  ExternalLink,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { Pagination } from '../../ui';
import { cn } from '../../../utils/cn';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll, fmtDate, resolveWriteCompanyId } from '../../../lib/firestore';
import { isLoadableUrl } from '../../../lib/url';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';
import {
  createCommissioningRecord,
  type CommissioningRecord,
} from '../../../lib/commissioningWorkflow';
import { SignatureCapture } from '../../commissioning/SignatureCapture';

const PER_PAGE = 10;
const ALL = 'All';

interface CommissioningFilters {
  search: string;
  project: string;
}

function filterRecords(records: CommissioningRecord[], filters: CommissioningFilters): CommissioningRecord[] {
  const term = filters.search.trim().toLowerCase();
  return records
    .filter((r) => {
      if (filters.project !== ALL && r.projectId !== filters.project) return false;
      if (!term) return true;
      return [r.projectName, r.projectId, r.commissionedByName, r.id]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = a.updatedAt || a.createdAt ? new Date(a.updatedAt || a.createdAt).getTime() : 0;
      const bTime = b.updatedAt || b.createdAt ? new Date(b.updatedAt || b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
}

/* ── Skeleton Card ─────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 animate-pulse">
      <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)] mb-3" />
      <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)] mb-2" />
      <div className="h-3 w-1/3 rounded bg-[var(--color-bg-sunken)]" />
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────── */

export function MobileCommissioningWorkspace({ mode }: { mode?: 'records' | 'create' }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const user = useAppStore((s) => s.user);

  // ── Queries ─────────────────────────────────────────────
  const { data: commissioningData = [], isLoading, isError, refetch } = useQuery({
    queryKey: companyKeys.commissioningRecordsAll,
    queryFn: () => getAll<CommissioningRecord>(COLLECTIONS.COMMISSIONING_RECORDS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: projects = [] } = useQuery({
    queryKey: companyKeys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
    enabled: Boolean(activeCompanyId),
  });

  // ── Derived Data ────────────────────────────────────────
  const pendingProjects = useMemo(() =>
    (projects as any[]).filter((p: any) => p.currentStage === 'Commissioning'),
    [projects],
  );

  const projectMap = useMemo(() => {
    const map = new Map<string, any>();
    (projects as any[]).forEach((p: any) => { map.set(p.id, p); map.set(p.projectId, p); });
    return map;
  }, [projects]);

  // ── Filters from URL ────────────────────────────────────
  const filters = useMemo<CommissioningFilters>(() => ({
    search: params.get('q') || '',
    project: params.get('project') || ALL,
  }), [params]);

  // ── Filtered / Paginated ───────────────────────────────
  const filteredRecords = useMemo(() => filterRecords(commissioningData as CommissioningRecord[], filters), [commissioningData, filters]);
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const paginatedRecords = useMemo(() => filteredRecords.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredRecords, page]);

  // ── Selection ──────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Detail View ────────────────────────────────────────
  const [viewRecord, setViewRecord] = useState<CommissioningRecord | null>(null);

  // ── Create Modal ────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    projectId: '',
    generationTestKwh: '',
    customerName: '',
    warrantyStartDate: '',
    warrantyMonths: '60',
    notes: '',
  });
  const [signatureUrl, setSignatureUrl] = useState('');
  const signatureUrlRef = useRef(signatureUrl);
  signatureUrlRef.current = signatureUrl;

  const createMutation = useMutation({
    mutationFn: async () => {
      const project = (projects as any[]).find((p: any) => p.id === form.projectId || p.projectId === form.projectId);
      const currentSignatureUrl = signatureUrlRef.current;
      return createCommissioningRecord({
        projectId: form.projectId,
        projectName: project?.projectId || form.projectId,
        generationTestKwh: parseFloat(form.generationTestKwh),
        commissionedByName: user?.name || 'System',
        customerName: form.customerName || undefined,
        customerSignoff: true,
        customerSignoffUrl: currentSignatureUrl,
        warrantyStartDate: form.warrantyStartDate || undefined,
        warrantyMonths: form.warrantyMonths ? parseInt(form.warrantyMonths) : undefined,
        notes: form.notes || undefined,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: companyKeys.commissioningRecordsAll });
      void qc.invalidateQueries({ queryKey: companyKeys.projectsRoot });
      toast.success('Commissioning completed successfully');
      closeCreateForm();
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to complete commissioning'),
  });

  // ── URL sync ────────────────────────────────────────────
  useEffect(() => {
    setPage(1);
  }, [filters.search, filters.project]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredRecords.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredRecords.length, page]);

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  /** Remove ?create=1 from the URL so the create form can be reopened on the next attempt */
  function closeCreateForm() {
    setShowCreate(false);
    setForm({ projectId: '', generationTestKwh: '', customerName: '', warrantyStartDate: '', warrantyMonths: '60', notes: '' });
    setSignatureUrl('');
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }

  // ── Handle ?create=1 ────────────────────────────────────
  useEffect(() => {
    if (mode === 'create' || params.get('create') === '1') {
      setShowCreate(true);
    }
  }, [mode, params]);

  // ── Render ────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-4 pt-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Commissioning</h1>
          <p className="text-xs text-[var(--color-text-muted)]">{(commissioningData as CommissioningRecord[]).length} total</p>
        </div>
      </div>

      {/* Pending Alert */}
      {pendingProjects.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10 px-3 py-2 text-xs">
          <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-amber-700 dark:text-amber-300 font-medium">
            {pendingProjects.length} project{pendingProjects.length !== 1 ? 's' : ''} ready for commissioning
          </span>
        </div>
      )}

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
          <Zap className="h-10 w-10 text-rose-500 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">Failed to load commissioning records</h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-[260px]">Could not load commissioning data.</p>
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
      {!isLoading && !isError && filteredRecords.length === 0 && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <Zap className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--color-text)]">
            {params.get('q') || params.get('project') ? 'No records match filters' : 'No commissioning records yet'}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {params.get('q') || params.get('project') ? 'Try adjusting your search or filters.' : 'Complete QC to commission a project.'}
          </p>
        </div>
      )}

      {/* Commissioning Cards */}
      {!isLoading && !isError && (
        <div className="space-y-3">
          {paginatedRecords.map((record) => (
            <div
              key={record.id}
              className={cn(
                'rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 shadow-sm transition-shadow',
                'hover:shadow-[var(--shadow-enterprise-row)]',
                selected.has(record.id) && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
              )}
            >
              <div className="flex items-start gap-2.5">
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selected.has(record.id)}
                  onChange={() => toggleSelect(record.id)}
                  className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
                  aria-label={`Select ${record.id}`}
                />
                {/* Body */}
                <button
                  type="button"
                  onClick={() => setViewRecord(record)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FolderKanban className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
                      <span className="truncate text-xs font-semibold text-[var(--color-text)]">
                        {record.projectName || record.projectId}
                      </span>
                    </div>
                    <span className={cn(
                      'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                      record.isCompleted
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    )}>
                      {record.isCompleted ? 'Done' : 'Pending'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1 text-[11px]">
                    <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
                      <UserCheck className="h-3 w-3 shrink-0" />
                      <span className="truncate">{record.commissionedByName}</span>
                    </div>
                    <div className="flex items-center gap-1 text-emerald-600 font-medium">
                      <Zap className="h-3 w-3 shrink-0" />
                      <span>{record.generationTestKwh} kWh</span>
                    </div>
                    <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
                      <Calendar className="h-3 w-3 shrink-0" />
                      <span>{fmtDate(record.commissionedDate)}</span>
                    </div>
                    {record.warrantyMonths && (
                      <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        <span>{record.warrantyMonths}mo</span>
                      </div>
                    )}
                  </div>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && !isError && filteredRecords.length > 0 && (
        <Pagination page={page} total={filteredRecords.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      {/* ══════════════════════════════════════════════════════
         DETAIL BOTTOM SHEET
         ══════════════════════════════════════════════════════ */}
      {viewRecord && (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setViewRecord(null)}>
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-[var(--color-surface)] p-4 max-h-[75vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-[var(--color-text)] truncate">Commissioning Details</h3>
                <p className="text-[10px] font-mono text-[var(--color-text-muted)]">{viewRecord.id}</p>
              </div>
              <button onClick={() => setViewRecord(null)} className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                <span className="text-[var(--color-text-muted)]">Project</span>
                <span className="font-semibold text-[var(--color-text)]">{viewRecord.projectName || viewRecord.projectId}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                <span className="text-[var(--color-text-muted)]">Commissioned By</span>
                <span className="font-semibold text-[var(--color-text)]">{viewRecord.commissionedByName}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                <span className="text-[var(--color-text-muted)]">Date</span>
                <span className="font-semibold text-[var(--color-text)]">{fmtDate(viewRecord.commissionedDate)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                <span className="text-[var(--color-text-muted)]">Generation Test</span>
                <span className="font-semibold text-emerald-600">{viewRecord.generationTestKwh} kWh</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                <span className="text-[var(--color-text-muted)]">Status</span>
                <span className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
                  viewRecord.isCompleted ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                )}>
                  {viewRecord.isCompleted ? 'Completed' : 'Pending'}
                </span>
              </div>
              {viewRecord.customerName && (
                <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                  <span className="text-[var(--color-text-muted)]">Customer</span>
                  <span className="font-semibold text-[var(--color-text)]">{viewRecord.customerName}</span>
                </div>
              )}
              {viewRecord.customerSignoff && (
                <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                  <span className="text-[var(--color-text-muted)]">Customer Sign-Off</span>
                  <span className="font-semibold text-emerald-600"><CheckCircle2 className="inline h-3 w-3 mr-0.5" />Confirmed</span>
                </div>
              )}
              {viewRecord.customerSignoffUrl && isLoadableUrl(viewRecord.customerSignoffUrl) && (
                <div className="pt-2 pb-1 border-b border-[var(--color-border-subtle)]">
                  <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Customer Signature</span>
                  <a href={viewRecord.customerSignoffUrl} target="_blank" rel="noopener noreferrer" className="block mt-1">
                    <img
                      src={viewRecord.customerSignoffUrl}
                      alt="Customer signature"
                      className="w-full h-16 object-contain rounded-lg border border-[var(--color-border)] bg-white"
                    />
                  </a>
                  <a
                    href={viewRecord.customerSignoffUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-[var(--color-primary)] hover:underline"
                  >
                    <ExternalLink className="h-2.5 w-2.5" /> Open Signature
                  </a>
                </div>
              )}
              {viewRecord.warrantyStartDate && (
                <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                  <span className="text-[var(--color-text-muted)]">Warranty Start</span>
                  <span className="font-semibold text-[var(--color-text)]">{fmtDate(viewRecord.warrantyStartDate)}</span>
                </div>
              )}
              {viewRecord.warrantyMonths && (
                <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                  <span className="text-[var(--color-text-muted)]">Warranty Period</span>
                  <span className="font-semibold text-[var(--color-text)]">{viewRecord.warrantyMonths} months</span>
                </div>
              )}
            </div>

            {viewRecord.notes && (
              <div className="mt-3 rounded-xl bg-[var(--color-bg-sunken)] p-3">
                <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">Notes</p>
                <p className="mt-1 text-xs text-[var(--color-text)]">{viewRecord.notes}</p>
              </div>
            )}

            {/* Timeline / Activity */}
            <div className="mt-3 pt-2 border-t border-[var(--color-border-subtle)]">
              {(viewRecord as any).activityLog?.length > 0 ? (
                <MobileTimelinePreview
                  title="Activity"
                  entries={(viewRecord as any).activityLog.slice(0, 2).map((entry: any) => ({
                    ...entry,
                    date: entry.timestamp || entry.createdAt || entry.date,
                    user: entry.userName || entry.createdByName || entry.user || 'System',
                    description: entry.actionLabel || entry.action || entry.description || entry.message || '',
                  }))}
                />
              ) : (
                <p className="text-xs text-[var(--color-text-muted)] text-center py-2">No activity recorded yet.</p>
              )}
            </div>

            <p className="mt-3 text-[10px] text-center text-[var(--color-text-muted)]">
              ⚡ Commissioning records are immutable — final sign-off cannot be modified
            </p>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
         CREATE COMMISSIONING MODAL
         ══════════════════════════════════════════════════════ */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--color-text)]">New Commissioning</h3>
              <button onClick={closeCreateForm} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              {/* Project selector — only pending commissioning projects */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Project *</label>
                <select
                  value={form.projectId}
                  onChange={(e) => {
                    const project = pendingProjects.find((p: any) => p.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      projectId: e.target.value,
                      customerName: project?.customerId || '',
                    }));
                  }}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                  <option value="">Select project</option>
                  {pendingProjects.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.projectId || p.id}</option>
                  ))}
                </select>
              </div>

              {/* Generation Test */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Generation Test (kWh) *</label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={form.generationTestKwh}
                  onChange={(e) => setForm((f) => ({ ...f, generationTestKwh: e.target.value }))}
                  placeholder="e.g. 5.2"
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>

              {/* Customer Name */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Customer Name</label>
                <input
                  type="text"
                  value={form.customerName}
                  onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                  placeholder="Customer name for sign-off"
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>

              {/* Warranty */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Warranty Start</label>
                  <input
                    type="date"
                    value={form.warrantyStartDate}
                    onChange={(e) => setForm((f) => ({ ...f, warrantyStartDate: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Warranty (months)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.warrantyMonths}
                    onChange={(e) => setForm((f) => ({ ...f, warrantyMonths: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                </div>
              </div>

              {/* SignatureCapture (reused Desktop component) */}
              <SignatureCapture
                companyId={resolveWriteCompanyId()}
                onUploadComplete={setSignatureUrl}
                onUploadError={(err) => toast.error(err?.message || 'Signature upload failed')}
              />

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Additional notes about the commissioning"
                  rows={2}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none"
                />
              </div>

              <p className="text-[10px] text-[var(--color-text-muted)]">
                <AlertTriangle className="inline h-3 w-3 mr-1" />
                Commissioning is a single sign-off action and cannot be modified after creation.
              </p>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={closeCreateForm}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!form.projectId) { toast.error('Please select a project'); return; }
                  if (!form.generationTestKwh || parseFloat(form.generationTestKwh) <= 0) {
                    toast.error('Generation test reading must be greater than zero');
                    return;
                  }
                  if (!signatureUrl) { toast.error('Please upload the customer signature before completing'); return; }
                  createMutation.mutate();
                }}
                disabled={createMutation.isPending || !signatureUrl}
                className="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {createMutation.isPending ? 'Recording...' : 'Complete Commissioning'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MobileCommissioningWorkspace;
