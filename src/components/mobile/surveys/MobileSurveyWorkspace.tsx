import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPinned, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';

import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Modal } from '../../ui/Modal';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { Pagination } from '../../ui/Pagination';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';
import { cn } from '../../../utils/cn';
import type { ProjectRecord } from '../../../features/projects/types';
import type { SurveyPhoto, SurveyRecord } from '../../../features/surveys/types';
import { useSurveyActions, useSurveys } from '../../../features/surveys/hooks/useSurveys';
import { SurveyDetail } from '../../../features/surveys/components/SurveyDetail';
import { SurveyReportForm } from '../../../features/surveys/components/SurveyReportForm';
import { uploadSurveyPhotos } from '../../../features/surveys/services/surveyStorage';

const PAGE_SIZE = 10;
const field = 'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm';

export function MobileSurveyWorkspace({ mode }: { mode?: 'list' | 'create' }) {
  const companyId = useAppStore((s) => s.activeCompanyId);
  const [params, setParams] = useSearchParams();
  const { data: surveys = [], isLoading } = useSurveys();
  const { data: projects = [] } = useQuery({
    queryKey: queryKeys.forCompany(companyId).projectsRoot,
    queryFn: () => getAll<ProjectRecord>(COLLECTIONS.PROJECTS),
  });
  const { data: users = [] } = useQuery({
    queryKey: queryKeys.global.users,
    queryFn: () => getAll<any>(COLLECTIONS.USERS),
    staleTime: 300_000,
  });
  const actions = useSurveyActions();
  const [selected, setSelected] = useState<SurveyRecord | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'list' | 'schedule' | 'report'>(mode === 'create' || params.get('create') === '1' ? 'schedule' : 'list');

  // Auto-open create form from ?create=1 param
  useEffect(() => {
    if (params.get('create') === '1') {
      setScheduleMode('schedule');
    }
  }, [params]);

  const [projectId, setProjectId] = useState('');
  const [surveyorId, setSurveyorId] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<SurveyPhoto[]>([]);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // URL params
  const searchQuery = params.get('q') || '';
  const statusFilter = params.get('status') || 'All';
  const dateFilter = params.get('date') || 'All';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10));

  // Derived
  const surveyors = (users as any[]).filter((u) => u.role === 'Surveyor');

  // Filter + Search
  const filtered = useMemo(() => {
    let list = [...surveys];
    if (statusFilter !== 'All') list = list.filter((s) => s.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((s) =>
        `${s.surveyId ?? ''} ${s.projectId ?? ''} ${s.surveyorId ?? ''} ${s.status ?? ''}`
          .toLowerCase()
          .includes(q),
      );
    }
    if (dateFilter !== 'All') {
      const now = Date.now();
      const ranges: Record<string, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 };
      const days = ranges[dateFilter];
      if (days) {
        const cutoff = now - days * 86400000;
        list = list.filter((s) => new Date(s.scheduledDate).getTime() >= cutoff);
      }
    }
    list.sort((a, b) => {
      const aDate = (b as any).modifiedAt || b.updatedAt || b.createdAt;
      const bDate = (a as any).modifiedAt || a.updatedAt || a.createdAt;
      return (aDate ? new Date(aDate).getTime() : 0) - (bDate ? new Date(bDate).getTime() : 0);
    });
    return list;
  }, [surveys, statusFilter, searchQuery, dateFilter]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'All') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function closeDetail() {
    setSelected(null);
  }

  /** Remove ?create=1 from the URL so the create form can be reopened on the next attempt */
  function closeScheduleForm() {
    setScheduleMode('list');
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }

  // ── Schedule mode ──────────────────────────────────────────
  if (scheduleMode === 'schedule') {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-bold text-[var(--color-text)]">Schedule Survey</h1>
          <p className="text-xs text-[var(--color-text-muted)]">Assign field work to a project.</p>
        </div>
        {error && (
          <p className="rounded-xl bg-[var(--color-danger-light)] p-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </p>
        )}
        <Card className="space-y-4 p-4">
          <select
            aria-label="Project"
            className={field}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Select project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.projectId}
              </option>
            ))}
          </select>
          <select
            aria-label="Surveyor"
            className={field}
            value={surveyorId}
            onChange={(e) => setSurveyorId(e.target.value)}
          >
            <option value="">Select surveyor</option>
            {surveyors.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email}
              </option>
            ))}
          </select>
          <input
            aria-label="Scheduled date"
            className={field}
            type="datetime-local"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
          />
          <textarea
            aria-label="Notes"
            className={field}
            rows={3}
            placeholder="Survey notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={closeScheduleForm}>
              Cancel
            </Button>
            <Button
              loading={actions.schedule.isPending}
              onClick={() =>
                actions.schedule.mutate(
                  { projectId, surveyorId, scheduledDate, notes },
                  {
                    onSuccess: () => {
                      closeScheduleForm();
                      setProjectId('');
                      setSurveyorId('');
                      setScheduledDate('');
                      setNotes('');
                    },
                    onError: (e) => setError(e.message),
                  },
                )
              }
            >
              Schedule
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ── Report mode ────────────────────────────────────────────
  if (scheduleMode === 'report' && selected) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-bold text-[var(--color-text)]">Survey Report</h1>
          <p className="text-xs text-[var(--color-text-muted)]">{selected.surveyId}</p>
        </div>
        <SurveyReportForm
          photos={photos}
          loading={actions.submit.isPending}
          onPhotos={async (files) => {
            const uploaded = await uploadSurveyPhotos(selected.id, files);
            setPhotos((current) => [...current, ...uploaded]);
          }}
          onSubmit={(report) =>
            actions.submit.mutate(
              { id: selected.id, report },
              {
                onSuccess: () => {
                  setScheduleMode('list');
                  setSelected(null);
                  setPhotos([]);
                },
                onError: (e) => setError(e.message),
              },
            )
          }
        />
        <Button className="w-full" variant="outline" onClick={closeScheduleForm}>
          Cancel
        </Button>
      </div>
    );
  }

  // ── List mode ──────────────────────────────────────────────
  const hasActiveFilters = searchQuery || statusFilter !== 'All' || dateFilter !== 'All';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[var(--color-text)]">Surveys</h1>
          <p className="text-xs text-[var(--color-text-muted)]">Your project site work</p>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="text"
          placeholder="Search surveys..."
          value={searchQuery}
          onChange={(e) => updateParam('q', e.target.value)}
          className={cn(
            'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pl-9 pr-8',
            'text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
            'focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]',
          )}
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => updateParam('q', '')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-xl bg-[var(--color-danger-light)] p-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </p>
      )}

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-[var(--color-primary)]/10 px-4 py-2">
          <span className="text-xs font-semibold text-[var(--color-primary)]">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs font-bold text-[var(--color-danger)] hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl bg-[var(--color-surface)] p-4"
            >
              <div className="mb-2 h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
              <div className="mb-2 h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
              <div className="h-3 w-1/3 rounded bg-[var(--color-bg-sunken)]" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && paginated.length === 0 && (
        <Card className="p-8 text-center">
          <MapPinned className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--color-text)]">
            {hasActiveFilters ? 'No surveys match your search' : 'No surveys assigned'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                const next = new URLSearchParams();
                setParams(next, { replace: true });
              }}
              className="mt-2 text-xs font-bold text-[var(--color-primary)] hover:underline"
            >
              Clear filters
            </button>
          )}
        </Card>
      )}

      {/* Cards */}
      {!isLoading &&
        paginated.map((survey) => (
          <Card
            key={survey.id}
            className="p-4"
            onClick={() => setSelected(survey)}
          >
            <div className="flex items-start gap-3">
              {/* Selection checkbox */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(survey.id);
                }}
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-2 transition-colors',
                  selectedIds.has(survey.id)
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]'
                    : 'border-[var(--color-border)]',
                )}
              >
                {selectedIds.has(survey.id) && (
                  <span className="text-[10px] font-bold text-white">✓</span>
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--color-text)]">
                      {survey.surveyId}
                    </p>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">
                      Project {survey.projectId}
                    </p>
                  </div>
                  <Badge
                    variant={
                      survey.status === 'Completed'
                        ? 'success'
                        : survey.status === 'Rejected'
                          ? 'danger'
                          : 'info'
                    }
                  >
                    {survey.status}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                  {new Date(survey.scheduledDate).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Timeline preview */}
            <div className="mt-3 border-t border-[var(--color-border)] pt-3">
              <MobileTimelinePreview
                entries={[
                  survey.createdAt ? { createdAt: survey.createdAt, type: 'Created' } : null,
                  survey.updatedAt ? { updatedAt: survey.updatedAt, type: 'Updated' } : null,
                  (survey as any).modifiedAt ? { modifiedAt: (survey as any).modifiedAt, type: 'Modified' } : null,
                ].filter(Boolean) as any[]}
              />
            </div>
          </Card>
        ))}

      {/* Pagination */}
      {filtered.length > PAGE_SIZE && (
        <div className="pb-2">
          <Pagination
            page={page}
            total={filtered.length}
            perPage={PAGE_SIZE}
            onChange={(p) => updateParam('page', String(p))}
          />
        </div>
      )}

      {/* Detail modal */}
      <Modal
        open={Boolean(selected) && scheduleMode !== 'report'}
        onClose={closeDetail}
        title="Survey workspace"
        size="lg"
      >
        {selected && (
          <SurveyDetail
            survey={selected}
            startLoading={actions.start.isPending}
            approveRejectLoading={actions.approve.isPending || actions.reject.isPending}
            onStart={() => actions.start.mutate(selected.id, {
              onSuccess: () => toast.success('Survey started'),
              onError: (e: any) => toast.error(e?.message || 'Failed to start survey'),
            })}
            onReport={() => setScheduleMode('report')}
            onApprove={async (note) => {
              try {
                await actions.approve.mutateAsync({ id: selected.id, note });
                toast.success('Survey approved — engineering draft created');
                closeDetail();
              } catch (e: any) {
                toast.error(e?.message || 'Failed to approve survey');
              }
            }}
            onReject={async (reason) => {
              try {
                await actions.reject.mutateAsync({ id: selected.id, reason });
                toast.success('Survey rejected');
                closeDetail();
              } catch (e: any) {
                toast.error(e?.message || 'Failed to reject survey');
              }
            }}
          />
        )}
      </Modal>
    </div>
  );
}
