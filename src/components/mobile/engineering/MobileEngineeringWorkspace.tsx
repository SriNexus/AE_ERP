import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DraftingCompass, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Modal } from '../../ui/Modal';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { Pagination } from '../../ui/Pagination';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';
import { cn } from '../../../utils/cn';
import type { SurveyRecord } from '../../../features/surveys/types';
import type { DesignInput, EngineeringDesignRecord } from '../../../features/engineering/types';
import {
  useEngineeringActions,
  useEngineeringDesigns,
} from '../../../features/engineering/hooks/useEngineeringDesigns';
import { EngineeringDesignForm } from '../../../features/engineering/components/EngineeringDesignForm';
import { EngineeringDesignDetail } from '../../../features/engineering/components/EngineeringDesignDetail';

const PAGE_SIZE = 10;

export function MobileEngineeringWorkspace({ mode }: { mode?: 'list' | 'create' }) {
  const companyId = useAppStore((state) => state.activeCompanyId);
  const [params, setParams] = useSearchParams();
  const { data: designs = [], isLoading } = useEngineeringDesigns();
  const { data: surveys = [] } = useQuery({
    queryKey: queryKeys.forCompany(companyId).surveysAll,
    queryFn: () => getAll<SurveyRecord>(COLLECTIONS.SURVEYS),
  });
  const { data: users = [] } = useQuery({
    queryKey: queryKeys.global.users,
    queryFn: () => getAll<{ id: string; name?: string; email?: string; role?: string }>(COLLECTIONS.USERS),
    staleTime: 300_000,
  });

  const actions = useEngineeringActions();
  const [selected, setSelected] = useState<EngineeringDesignRecord | null>(null);
  const [editing, setEditing] = useState<EngineeringDesignRecord | null>(null);
  const [formOpen, setFormOpen] = useState(mode === 'create' || params.get('create') === '1');
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // URL params
  const searchQuery = params.get('q') || '';
  const statusFilter = params.get('status') || 'All';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10));
  const openParam = params.get('open') || '';

  // Auto-open detail from ?open= param (Desktop parity)
  useEffect(() => {
    if (!openParam || designs.length === 0) return;
    const found = designs.find((d) => d.id === openParam);
    if (found) setSelected(found);
  }, [designs, openParam]);

  // Auto-open create form from ?create=1 param
  useEffect(() => {
    if (params.get('create') === '1') {
      setFormOpen(true);
    }
  }, [params]);

  // Derived
  const approvedSurveys = surveys.filter(
    (survey) =>
      survey.approvalStatus === 'Approved' &&
      (!designs.some((design) => design.surveyId === survey.id) || editing?.surveyId === survey.id),
  );
  const designers = users.filter((user) => user.role === 'Engineer');
  const busy = Object.values(actions).some((action) => action.isPending);

  // Filter + Search
  const filtered = useMemo(() => {
    let list = [...designs];
    if (statusFilter !== 'All') list = list.filter((d) => d.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((d) =>
        `${d.designId ?? ''} ${d.projectId ?? ''} ${d.surveyId ?? ''} ${d.designerId ?? ''} ${d.inverterSpec ?? ''}`
          .toLowerCase()
          .includes(q),
      );
    }
    list.sort((a, b) => {
      const aDate = (b as any).modifiedAt || b.updatedAt || b.createdAt;
      const bDate = (a as any).modifiedAt || a.updatedAt || a.createdAt;
      return (aDate ? new Date(aDate).getTime() : 0) - (bDate ? new Date(bDate).getTime() : 0);
    });
    return list;
  }, [designs, statusFilter, searchQuery]);

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

  /** Remove ?create=1 from the URL so the create form can be reopened on the next attempt */
  function closeCreateForm() {
    setFormOpen(false);
    setEditing(null);
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }

  function closeDetail() {
    setSelected(null);
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
  }

  function save(input: DesignInput) {
    setError('');
    if (editing) {
      const { surveyId: _surveyId, ...update } = input;
      void _surveyId;
      actions.update.mutate(
        { id: editing.id, input: update },
        {
          onSuccess: () => {
            closeCreateForm();
          },
          onError: (failure) => setError(failure.message),
        },
      );
    } else {
      actions.create.mutate(input, {
        onSuccess: () => closeCreateForm(),
        onError: (failure) => setError(failure.message),
      });
    }
  }

  const hasActiveFilters = searchQuery || statusFilter !== 'All';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[var(--color-text)]">Engineering</h1>
          <p className="text-xs text-[var(--color-text-muted)]">System designs and review</p>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="text"
          placeholder="Search designs..."
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
            <div key={i} className="animate-pulse rounded-xl bg-[var(--color-surface)] p-4">
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
          <DraftingCompass className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--color-text)]">
            {hasActiveFilters ? 'No designs match your search' : 'No engineering designs'}
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
        paginated.map((design) => (
          <Card
            key={design.id}
            className="p-4"
            onClick={() => {
              setSelected(design);
              const next = new URLSearchParams(params);
              next.set('open', design.id);
              setParams(next, { replace: true });
            }}
          >
            <div className="flex items-start gap-3">
              {/* Selection checkbox */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(design.id);
                }}
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-2 transition-colors',
                  selectedIds.has(design.id)
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]'
                    : 'border-[var(--color-border)]',
                )}
              >
                {selectedIds.has(design.id) && (
                  <span className="text-[10px] font-bold text-white">✓</span>
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--color-text)]">
                      {design.designId}
                    </p>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">
                      {design.systemCapacityKw} kW · {design.panelCount} panels
                    </p>
                  </div>
                  <Badge
                    variant={
                      design.status === 'Approved'
                        ? 'success'
                        : design.status === 'Revised'
                          ? 'warning'
                          : 'info'
                    }
                  >
                    {design.status}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                  Project {design.projectId} · Revision {design.revisionNumber}
                </p>
              </div>
            </div>

            {/* Timeline preview */}
            <div className="mt-3 border-t border-[var(--color-border)] pt-3">
              <MobileTimelinePreview
                entries={[
                  design.createdAt ? { createdAt: design.createdAt, type: 'Created' } : null,
                  design.updatedAt ? { updatedAt: design.updatedAt, type: 'Updated' } : null,
                  (design as any).modifiedAt ? { modifiedAt: (design as any).modifiedAt, type: 'Modified' } : null,
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

      {/* Create/Edit form modal */}
      <Modal
        open={formOpen}
        onClose={closeCreateForm}
        title={editing ? 'Revise design' : 'Create design'}
        size="lg"
      >
        <EngineeringDesignForm
          surveys={approvedSurveys}
          designers={designers}
          initial={editing}
          onCancel={closeCreateForm}
          onSubmit={save}
          loading={actions.create.isPending || actions.update.isPending}
        />
      </Modal>

      {/* Detail modal */}
      <Modal
        open={Boolean(selected) && !formOpen}
        onClose={closeDetail}
        title="Design workspace"
        size="lg"
      >
        {selected && (
          <EngineeringDesignDetail
            design={selected}
            loading={busy}
            onEdit={() => {
              setEditing(selected);
              setFormOpen(true);
            }}
            onSubmit={() => actions.submit.mutate(selected.id)}
            onApprove={async (note) => {
              await actions.approve.mutateAsync({ id: selected.id, note });
              closeDetail();
            }}
            onRevise={async (reason) => {
              await actions.revise.mutateAsync({ id: selected.id, reason });
              closeDetail();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
