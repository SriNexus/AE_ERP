/**
 * MobileQCWorkspace — Native mobile QC (Quality Check) workspace
 *
 * Provides:
 * - Card-based QC list with search, filters (status, project), pagination (10/page)
 * - Mini stat pills (no KPI cards per P0)
 * - Create QC flow with project/installation selector
 * - Detail full-screen with interactive checklist (pass/fail, submit decision, reset)
 * - Timeline/activity via MobileTimelinePreview
 * - Loading/empty/error states
 * - Selection + bulk clear
 * - Permission gates (create, approve)
 *
 * Reuses: createQCCheck, submitQCDecision, updateQCChecklistItem, resetQCCheck, normalizeQCRecord from qcWorkflow
 * Reuses: Project query, Installation query for create form
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ClipboardCheck,
  XCircle,
  FolderKanban,
  UserCheck,

  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { Pagination } from '../../ui';
import { cn } from '../../../utils/cn';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll, fmtDate } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';
import {
  normalizeQCRecord,
  createQCCheck,
  updateQCChecklistItem,
  submitQCDecision,
  resetQCCheck,
  DEFAULT_QC_CHECKLIST,
  type QCRecord,
  type QCCheckStatus,
} from '../../../lib/qcWorkflow';

const PER_PAGE = 10;
const ALL = 'All';

interface QCFilters {
  search: string;
  status: string;
  project: string;
}

function statusBadgeColor(status: QCCheckStatus | string): string {
  switch (status) {
    case 'passed': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
    case 'failed': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    case 'in_progress': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    default: return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }
}

function statusIcon(status: QCCheckStatus | string) {
  if (status === 'passed') return <CheckCircle2 className="h-2.5 w-2.5 mr-1" />;
  if (status === 'failed') return <XCircle className="h-2.5 w-2.5 mr-1" />;
  return null;
}

function filterQCRecords(records: QCRecord[], filters: QCFilters): QCRecord[] {
  const term = filters.search.trim().toLowerCase();
  return records
    .filter((qc) => {
      if (filters.status !== ALL && qc.status !== filters.status) return false;
      if (filters.project !== ALL && qc.projectId !== filters.project) return false;
      if (!term) return true;
      return [qc.id, qc.inspectorName, qc.projectId, qc.installationName]
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
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-lg bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-36 bg-[var(--color-bg-sunken)] rounded" />
          <div className="h-3 w-24 bg-[var(--color-bg-sunken)] rounded" />
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-[var(--color-bg-sunken)]" />
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────── */

export function MobileQCWorkspace({ mode }: { mode?: 'records' | 'create' }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const user = useAppStore((s) => s.user);

  // ── Queries ─────────────────────────────────────────────
  const { data: qcData = [], isLoading, isError, refetch } = useQuery({
    queryKey: companyKeys.qcChecksAll,
    queryFn: () => getAll<QCRecord>(COLLECTIONS.QC_CHECKS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: projects = [] } = useQuery({
    queryKey: companyKeys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: installations = [] } = useQuery({
    queryKey: companyKeys.installationsAll,
    queryFn: () => getAll(COLLECTIONS.INSTALLATIONS),
    staleTime: 60_000,
    enabled: Boolean(activeCompanyId),
  });

  // Normalize records
  const normalizedData = useMemo(() => (qcData as QCRecord[]).map(normalizeQCRecord), [qcData]);

  // Project map for display
  const projectMap = useMemo(() => {
    const map = new Map<string, any>();
    (projects as any[]).forEach((p: any) => { map.set(p.id, p); map.set(p.projectId, p); });
    return map;
  }, [projects]);

  // ── Filters from URL params ────────────────────────────
  const filters = useMemo<QCFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    project: params.get('project') || ALL,
  }), [params]);

  // ── Filtered / Paginated ───────────────────────────────
  const filteredRecords = useMemo(() => filterQCRecords(normalizedData, filters), [normalizedData, filters]);
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const paginatedRecords = useMemo(() => filteredRecords.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredRecords, page]);

  // ── Selection ──────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Detail View ────────────────────────────────────────
  const [viewQC, setViewQC] = useState<QCRecord | null>(null);

  // ── Create QC Modal ────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ projectId: '', installationId: '' });

  const createMutation = useMutation({
    mutationFn: async (input: { projectId: string; installationId?: string; installationName?: string }) => {
      return createQCCheck({
        ...input,
        inspectorId: user?.id || 'system',
        inspectorName: user?.name || 'System',
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: companyKeys.qcChecksAll });
      toast.success('QC check created');
      closeCreateForm();
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create QC check'),
  });

  // ── Checklist interaction state ────────────────────────
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [resettingCheck, setResettingCheck] = useState(false);

  // ── URL sync: page reset on filter change ─────────────
  useEffect(() => {
    setPage(1);
  }, [filters.search, filters.status, filters.project]);

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

  // ── Submit QC Decision ─────────────────────────────────
  async function handleSubmitDecision(passed: boolean) {
    if (!viewQC?.id) return;
    setSubmittingDecision(true);
    try {
      const result = await submitQCDecision(viewQC.id);
      toast.success(passed
        ? 'QC passed — project advancing to Commissioning'
        : 'QC failed — project returned to Installation'
      );
      void qc.invalidateQueries({ queryKey: companyKeys.qcChecksAll });
      setViewQC(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit QC decision');
    } finally {
      setSubmittingDecision(false);
    }
  }

  // ── Toggle Checklist Item ──────────────────────────────
  async function handleToggleChecklist(index: number, currentPassed: boolean | undefined) {
    if (!viewQC?.id) return;
    setSavingIndex(index);
    try {
      await updateQCChecklistItem(viewQC.id, index, !currentPassed);
      // Reload the updated record
      void qc.invalidateQueries({ queryKey: companyKeys.qcChecksAll });
      // Update local view state
      const updated = normalizedData.find((r) => r.id === viewQC.id);
      if (updated) setViewQC({ ...updated });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update checklist item');
    } finally {
      setSavingIndex(null);
    }
  }

  // ── Reset QC Check ─────────────────────────────────────
  async function handleResetCheck() {
    if (!viewQC?.id) return;
    setResettingCheck(true);
    try {
      await resetQCCheck(viewQC.id);
      toast.success('QC check reset for re-inspection');
      void qc.invalidateQueries({ queryKey: companyKeys.qcChecksAll });
      setViewQC(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to reset QC check');
    } finally {
      setResettingCheck(false);
    }
  }

  /** Remove ?create=1 from the URL so the create form can be reopened on the next attempt */
  function closeCreateForm() {
    setShowCreate(false);
    setCreateForm({ projectId: '', installationId: '' });
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }

  // ── Handle ?create=1 from URL ─────────────────────────
  useEffect(() => {
    if (mode === 'create' || params.get('create') === '1') {
      setShowCreate(true);
    }
  }, [mode, params]);

  const canApprove = perms.canApprove('qc');

  // ── Render ────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-4 pt-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Quality Checks</h1>
          <p className="text-xs text-[var(--color-text-muted)]">{normalizedData.length} total</p>
        </div>
      </div>

      {/* Bulk Selection Bar */}
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
          <ClipboardCheck className="h-10 w-10 text-rose-500 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">Failed to load QC checks</h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-[260px]">Could not load quality check data.</p>
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
          <ClipboardCheck className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--color-text)]">
            {params.get('q') || params.get('status') ? 'No QC checks match filters' : 'No quality checks yet'}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {params.get('q') || params.get('status') ? 'Try adjusting your search or filters.' : 'QC checks are created when projects reach installation completion.'}
          </p>
        </div>
      )}

      {/* QC Cards */}
      {!isLoading && !isError && (
        <div className="space-y-3">
          {paginatedRecords.map((qcRecord) => {
            const totalItems = qcRecord.totalItems ?? qcRecord.checklistItems.length;
            const passRate = totalItems > 0 ? Math.round((qcRecord.passedCount || 0) / totalItems * 100) : 0;
            const project = projectMap.get(qcRecord.projectId);
            return (
              <div
                key={qcRecord.id}
                className={cn(
                  'rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 shadow-sm transition-shadow',
                  'hover:shadow-[var(--shadow-enterprise-row)]',
                  selected.has(qcRecord.id) && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
                )}
              >
                <div className="flex items-start gap-2.5">
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selected.has(qcRecord.id)}
                    onChange={() => toggleSelect(qcRecord.id)}
                    className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
                    aria-label={`Select ${qcRecord.id}`}
                  />
                  {/* Card Body */}
                  <button
                    type="button"
                    onClick={() => setViewQC(qcRecord)}
                    className="min-w-0 flex-1 text-left"
                  >
                    {/* Header */}
                    <div className="flex items-start gap-2">
                      <div className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                        qcRecord.status === 'passed' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                        : qcRecord.status === 'failed' ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                        : 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400',
                      )}>
                        {qcRecord.status === 'passed' ? <CheckCircle2 className="h-4 w-4" />
                        : qcRecord.status === 'failed' ? <XCircle className="h-4 w-4" />
                        : <ClipboardCheck className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-bold text-[var(--color-text)]">{qcRecord.id}</p>
                          <span className={cn(
                            'inline-flex items-center shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            statusBadgeColor(qcRecord.status),
                          )}>
                            {statusIcon(qcRecord.status)}
                            {qcRecord.status === 'in_progress' ? 'In Progress' : qcRecord.status.charAt(0).toUpperCase() + qcRecord.status.slice(1)}
                          </span>
                        </div>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                          <UserCheck className="h-3 w-3" />
                          {qcRecord.inspectorName}
                        </p>
                      </div>
                    </div>

                    {/* Project */}
                    {project && (
                      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--color-primary)]">
                        <FolderKanban className="h-3 w-3" /> {project.projectId || qcRecord.projectId}
                      </p>
                    )}

                    {/* Pass Rate */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--color-bg-sunken)] overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', passRate >= 80 ? 'bg-emerald-500' : passRate >= 50 ? 'bg-amber-500' : 'bg-red-500')}
                          style={{ width: `${passRate}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-semibold text-[var(--color-text-muted)]">{passRate}%</span>
                    </div>

                    {/* Meta */}
                    <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                      <span>{qcRecord.passedCount ?? 0}/{totalItems} passed</span>
                      <span>{fmtDate(qcRecord.createdAt)}</span>
                    </div>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && !isError && filteredRecords.length > 0 && (
        <Pagination page={page} total={filteredRecords.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      {/* ══════════════════════════════════════════════════════
         DETAIL MODAL
         ══════════════════════════════════════════════════════ */}
      {viewQC && (() => {
        const qcRecord = viewQC;
        const totalItems = qcRecord.totalItems ?? qcRecord.checklistItems.length;
        const passCount = qcRecord.passedCount ?? qcRecord.checklistItems.filter((i) => i.passed).length;
        const isComplete = qcRecord.status === 'passed' || qcRecord.status === 'failed';
        const allChecked = qcRecord.checklistItems.every((i) => i.passed !== undefined);
        const project = projectMap.get(qcRecord.projectId);

        return (
          <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface)]">
            {/* Sticky Header */}
            <div className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border-subtle)] px-4 py-3 flex items-center gap-3">
              <button
                onClick={() => { setViewQC(null); void qc.invalidateQueries({ queryKey: companyKeys.qcChecksAll }); }}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[var(--color-text)] truncate">QC: {qcRecord.id}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">Quality Check Details</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Status + Pass Rate */}
              <div className="flex items-center justify-between">
                <span className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  statusBadgeColor(qcRecord.status),
                )}>
                  {statusIcon(qcRecord.status)}
                  {qcRecord.status === 'in_progress' ? 'In Progress' : qcRecord.status.charAt(0).toUpperCase() + qcRecord.status.slice(1)}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">{passCount}/{totalItems} passed</span>
              </div>

              {/* Metadata */}
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-3 space-y-2 text-xs">
                <p className="font-bold text-[var(--color-text)] mb-1">Details</p>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Inspector</span>
                  <span className="font-semibold text-[var(--color-text)]">{qcRecord.inspectorName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Project</span>
                  <span className="font-semibold text-[var(--color-text)]">{project?.projectId || qcRecord.projectId}</span>
                </div>
                {qcRecord.installationName && (
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">Installation</span>
                    <span className="font-semibold text-[var(--color-text)]">{qcRecord.installationName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Created</span>
                  <span className="font-semibold text-[var(--color-text)]">{fmtDate(qcRecord.createdAt)}</span>
                </div>
                {qcRecord.completedAt && (
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">Completed</span>
                    <span className="font-semibold text-[var(--color-text)]">{fmtDate(qcRecord.completedAt)}</span>
                  </div>
                )}
              </div>

              {/* Interactive Checklist */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wide">
                  Checklist ({passCount}/{totalItems})
                </p>
                {qcRecord.checklistItems.map((item, index) => {
                  const isChecked = item.passed !== undefined;
                  return (
                    <label
                      key={index}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-2.5 text-xs transition-colors',
                        item.passed === true && 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/10',
                        item.passed === false && 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10',
                        !isChecked && 'border-[var(--color-border-subtle)] hover:border-[var(--color-border)]',
                        isComplete && 'cursor-default opacity-80',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={item.passed === true}
                        disabled={isComplete || !canApprove || savingIndex === index}
                        onChange={() => handleToggleChecklist(index, item.passed)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'font-medium text-[var(--color-text)]',
                          item.passed === true && 'line-through text-emerald-700 dark:text-emerald-300',
                          item.passed === false && 'text-red-700 dark:text-red-300',
                        )}>
                          {item.item}
                        </p>
                        {item.notes && <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{item.notes}</p>}
                      </div>
                      {item.passed === true && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />}
                      {item.passed === false && <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
                    </label>
                  );
                })}
              </div>

              {/* Submit Decision */}
              {!isComplete && allChecked && canApprove && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => handleSubmitDecision(true)}
                    disabled={submittingDecision}
                    className="flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
                    {submittingDecision ? 'Submitting...' : 'Approve & Pass'}
                  </button>
                  <button
                    onClick={() => handleSubmitDecision(false)}
                    disabled={submittingDecision}
                    className="flex-1 rounded-lg bg-red-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="mr-1.5 inline h-3.5 w-3.5" />
                    {submittingDecision ? 'Submitting...' : 'Fail & Send Back'}
                  </button>
                </div>
              )}

              {!isComplete && !allChecked && (
                <p className="text-xs text-[var(--color-text-muted)] text-center">
                  Complete all checklist items before submitting the QC decision.
                </p>
              )}

              {/* Reset for Re-inspection */}
              {qcRecord.status === 'failed' && canApprove && (
                <div className="text-center">
                  <button
                    onClick={handleResetCheck}
                    disabled={resettingCheck}
                    className="text-xs text-[var(--color-primary)] hover:underline disabled:opacity-50"
                  >
                    {resettingCheck ? 'Resetting...' : 'Reset for re-inspection'}
                  </button>
                </div>
              )}

              {/* Notes */}
              {qcRecord.overallNotes && (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Notes</p>
                  <p className="mt-1 text-xs text-[var(--color-text)]">{qcRecord.overallNotes}</p>
                </div>
              )}

              {/* Timeline / Activity */}
              <div className="pt-2 border-t border-[var(--color-border-subtle)]">
                {(qcRecord as any).activityLog?.length > 0 ? (
                  <MobileTimelinePreview
                    title="Activity"
                    entries={(qcRecord as any).activityLog.slice(0, 2).map((entry: any) => ({
                      ...entry,
                      date: entry.timestamp || entry.createdAt || entry.date,
                      user: entry.userName || entry.createdByName || entry.user || 'System',
                      description: entry.actionLabel || entry.action || entry.description || entry.message || '',
                    }))}
                  />
                ) : (
                  <p className="text-xs text-[var(--color-text-muted)] text-center py-4">No activity recorded yet.</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════
         CREATE QC MODAL
         ══════════════════════════════════════════════════════ */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--color-text)]">New Quality Check</h3>
              <button onClick={closeCreateForm} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Project *</label>
                <select
                  value={createForm.projectId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, projectId: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                  <option value="">Select project</option>
                  {(projects as any[]).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.projectId || p.id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Installation (optional)</label>
                <select
                  value={createForm.installationId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, installationId: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                  <option value="">No specific installation</option>
                  {(installations as any[])
                    .filter((inst: any) => !createForm.projectId || inst.projectId === createForm.projectId)
                    .map((inst: any) => (
                      <option key={inst.id} value={inst.id}>{projectMap.get(inst.projectId)?.projectId || inst.projectId || inst.id}</option>
                    ))}
                </select>
              </div>
              <p className="text-[10px] text-[var(--color-text-muted)]">
                QC will be initialized with the standard {DEFAULT_QC_CHECKLIST.length}-item inspection checklist.
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
                  if (!createForm.projectId) { toast.error('Please select a project'); return; }
                  createMutation.mutate({
                    projectId: createForm.projectId,
                    installationId: createForm.installationId || undefined,
                    installationName: createForm.installationId
                      ? (() => {
                          const inst = (installations as any[]).find((i: any) => i.id === createForm.installationId);
                          return inst ? (projectMap.get(inst.projectId)?.projectId || inst.projectId) : undefined;
                        })()
                      : undefined,
                  });
                }}
                disabled={createMutation.isPending || !createForm.projectId}
                className="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating...' : 'Create QC Check'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MobileQCWorkspace;
