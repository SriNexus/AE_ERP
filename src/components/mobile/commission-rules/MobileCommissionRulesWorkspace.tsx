import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  DollarSign,
  Edit2,
  Eye,
  FileText,
  RefreshCw,
  Shield,
  Trash2,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, ConfirmDialog, Modal, Pagination } from '../../ui';
import { CommissionRuleFormModal } from '../../partner/CommissionRuleFormModal';
import { CommissionRuleDetailDrawer } from '../../partner/CommissionRuleDetailDrawer';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtDate, getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';
import { ChannelPartnerDomainService } from '../../../services/ChannelPartnerDomainService';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';
import type { CommissionRule } from '../../../features/channel-partner/types';

const PER_PAGE = 10;
const ALL = 'All';

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: any): string {
  if (!value) return '—';
  if (typeof value === 'object' && typeof value.toDate === 'function') return fmtDate(value.toDate());
  if (typeof value === 'object' && value.seconds) return fmtDate(new Date(value.seconds * 1000));
  return fmtDate(value) || '—';
}

const TYPE_BADGE: Record<string, string> = {
  percentage:    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  fixed:         'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  per_kw:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  per_deal:      'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  slab:          'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

const SCOPE_LABELS: Record<string, string> = {
  all: 'Default',
  partner: 'Partner',
  partner_tier: 'Tier',
  product_category: 'Category',
  location: 'Location',
};

const SCOPE_BADGE: Record<string, string> = {
  all:             'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  partner:         'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  partner_tier:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  product_category:'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  location:        'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
};

function TypeBadge({ type }: { type?: string }) {
  if (!type) return null;
  const t = type.toLowerCase();
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_BADGE[t] || 'bg-gray-100 text-gray-600'}`}>
      {t.replace(/_/g, ' ')}
    </span>
  );
}

function ScopeBadge({ scope }: { scope?: string }) {
  if (!scope) return null;
  const s = scope.toLowerCase();
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${SCOPE_BADGE[s] || 'bg-gray-100 text-gray-600'}`}>
      {SCOPE_LABELS[s] || s.replace(/_/g, ' ')}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
      active
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    }`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export function MobileCommissionRulesWorkspace(_props?: { mode?: 'records' | 'create' }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const openId = params.get('open') || '';
  const createParam = params.get('create') || '';

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editRule, setEditRule] = useState<CommissionRule | null>(null);
  const [viewRule, setViewRule] = useState<CommissionRule | null>(null);
  const [bulkToggleOpen, setBulkToggleOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const canCreate = perms.canCreate('partners');
  const canEdit = perms.canEdit('partners');
  const canDelete = perms.canDelete('partners');

  const userClosedRef = useRef(false);

  const companyKeys = queryKeys.forCompany(activeCompanyId);

  const { data: allRules = [], isLoading, error, refetch } = useQuery({
    queryKey: companyKeys.commissionRules,
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RULES),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const rules = useMemo(
    () => (allRules as CommissionRule[]).filter((r) => !r.isDeleted),
    [allRules],
  );

  // Filters from URL params
  const filters = useMemo(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    scope: params.get('scope') || ALL,
    type: params.get('type') || ALL,
    tier: params.get('tier') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  // ── Filtering ────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...rules];

    const q = filters.search.toLowerCase();
    if (q) {
      list = list.filter((r) =>
        [r.name, r.description, r.type, r.applicableTo, r.id]
          .some((v) => String(v || '').toLowerCase().includes(q)),
      );
    }
    if (filters.status !== ALL) {
      list = list.filter((r) => filters.status === 'active' ? r.isActive : !r.isActive);
    }
    if (filters.scope !== ALL) list = list.filter((r) => r.applicableTo === filters.scope);
    if (filters.type !== ALL) list = list.filter((r) => r.type === filters.type);
    if (filters.tier !== ALL) list = list.filter((r) => r.partnerTier === filters.tier || r.applicableTo === 'partner');
    if (filters.date !== 'all') {
      const cutoff = new Date(Date.now() - (filters.date === 'today' ? 0 : filters.date === '7d' ? 7 : filters.date === '30d' ? 30 : 90) * 86400000);
      cutoff.setHours(0, 0, 0, 0);
      list = list.filter((r) => {
        const d = toDate(r.createdAt);
        return d && d >= cutoff;
      });
    }

    list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return list;
  }, [rules, filters]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  // ── Selection cleanup ────────────────────────────────────
  useEffect(() => {
    setSelected((current) => {
      const available = new Set(rules.map((r) => r.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [rules]);

  // ── URL-driven open effect with race condition guard ────
  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    if (!openId || isLoading) return;
    const target = rules.find((r) => r.id === openId);
    if (target && !viewRule) {
      setViewRule(target);
    }
  }, [openId, isLoading, rules, viewRule]);

  function openMobileDetail(rule: CommissionRule) {
    userClosedRef.current = false;
    setViewRule(rule);
    const next = new URLSearchParams(params);
    next.set('open', rule.id);
    setParams(next, { replace: true });
  }

  function closeMobileDetail() {
    userClosedRef.current = true;
    setViewRule(null);
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
  }

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

  function invalidate() {
    qc.invalidateQueries({ queryKey: companyKeys.commissionRules });
  }

  // ── Mutations ────────────────────────────────────────────
  const deleteRule = useMutation({
    mutationFn: (id: string) => ChannelPartnerDomainService.deleteCommissionRule(id),
    onSuccess: () => { invalidate(); toast.success('Rule deleted'); },
    onError: (e: any) => toast.error(e?.message || 'Failed to delete'),
  });

  const toggleActive = useMutation({
    mutationFn: async (rule: CommissionRule) => {
      await ChannelPartnerDomainService.updateCommissionRule(rule.id, {
        isActive: !rule.isActive,
        updatedBy: 'system',
      });
    },
    onSuccess: () => { invalidate(); toast.success('Rule status updated'); },
    onError: (e: any) => toast.error(e?.message || 'Failed to update'),
  });

  const bulkToggleMutation = useMutation({
    mutationFn: async ({ ids, isActive }: { ids: string[]; isActive: boolean }) => {
      await Promise.all(ids.map((id) =>
        ChannelPartnerDomainService.updateCommissionRule(id, { isActive, updatedBy: 'system' }),
      ));
    },
    onSuccess: () => {
      invalidate();
      toast.success(`${selected.size} rule${selected.size > 1 ? 's' : ''} updated`);
      setBulkToggleOpen(false);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to update'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => ChannelPartnerDomainService.deleteCommissionRule(id)));
    },
    onSuccess: () => {
      invalidate();
      toast.success(`Deleted ${selected.size} rule${selected.size > 1 ? 's' : ''}`);
      setBulkDeleteOpen(false);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to delete'),
  });

  // Open form when ?create=1 is present (triggered by Bottom Nav Create tab)
  useEffect(() => {
    if (createParam === '1') {
      setEditRule(null);
      setFormOpen(true);
    }
  }, [createParam]);

  const hasActiveFilters = Boolean(
    filters.search || filters.status !== ALL || filters.scope !== ALL ||
    filters.type !== ALL || filters.tier !== ALL || filters.date !== 'all',
  );

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3 px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-1">
        {/* Header — no create button (uses Quick Actions + bottom FAB) */}
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Commission Rules</h1>
          <button
            type="button"
            onClick={() => refetch()}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
            {(error as Error).message}
          </div>
        )}

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <Card className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/35 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm font-bold text-[var(--color-primary-text)]">{selected.size} selected</p>
              {canEdit && (
                <Button size="xs" variant="outline" icon={<Shield className="h-3.5 w-3.5" />} onClick={() => setBulkToggleOpen(true)}>
                  Toggle
                </Button>
              )}
              {canDelete && (
                <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setBulkDeleteOpen(true)}>
                  Delete
                </Button>
              )}
              <button type="button" className="text-xs font-medium text-[var(--color-text-muted)]" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          </Card>
        )}

        {/* Cards list */}
        <div className="space-y-2">
          {isLoading && Array.from({ length: 5 }).map((_, i) => (
            <CommissionRuleSkeletonCard key={i} />
          ))}

          {!isLoading && paginated.length === 0 && (
            <Card className="rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
              <DollarSign className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
              <p className="mt-2">
                {hasActiveFilters
                  ? 'No rules match your filters.'
                  : 'No commission rules yet.'}
              </p>
              {hasActiveFilters && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const next = new URLSearchParams();
                    setParams(next, { replace: true });
                    setPage(1);
                  }}
                  className="mt-3"
                >
                  Clear Filters
                </Button>
              )}
            </Card>
          )}

          {paginated.map((rule) => (
            <CommissionRuleCard
              key={rule.id}
              rule={rule}
              selected={selected.has(rule.id)}
              onSelect={() => toggleSelect(rule.id)}
              onView={() => openMobileDetail(rule)}
              onEdit={(r) => { setEditRule(r); setFormOpen(true); }}
              onToggle={(r) => toggleActive.mutate(r)}
              onDuplicate={(r) => {
                setEditRule({ ...r, id: '', name: `${r.name} (Copy)`, isActive: false } as CommissionRule);
                setFormOpen(true);
              }}
              onDelete={(r) => deleteRule.mutate(r.id)}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ))}
        </div>

        {/* Pagination — 10 per page */}
        {filtered.length > 0 && (
          <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={changePage} />
        )}
      </div>

      {/* Create/Edit Form Modal */}
      <CommissionRuleFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditRule(null); }}
        rule={editRule}
        onSuccess={() => invalidate()}
      />

      {/* Detail Drawer */}
      <CommissionRuleDetailDrawer
        rule={viewRule}
        open={!!viewRule}
        onClose={closeMobileDetail}
        onEdit={(r) => { closeMobileDetail(); setEditRule(r); setFormOpen(true); }}
        onDuplicate={(r) => {
          closeMobileDetail();
          setEditRule({ ...r, id: '', name: `${r.name} (Copy)`, isActive: false } as CommissionRule);
          setFormOpen(true);
        }}
      />

      {/* Bulk Toggle Modal */}
      <Modal open={bulkToggleOpen} onClose={() => setBulkToggleOpen(false)} title="Toggle Rule Status" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Activate or deactivate <span className="font-semibold text-[var(--color-text)]">{selected.size}</span> rule{selected.size > 1 ? 's' : ''}?
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setBulkToggleOpen(false)}>Cancel</Button>
            <Button variant="outline" className="flex-1" onClick={() => bulkToggleMutation.mutate({ ids: Array.from(selected), isActive: true })} loading={bulkToggleMutation.isPending}>
              Activate
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => bulkToggleMutation.mutate({ ids: Array.from(selected), isActive: false })} loading={bulkToggleMutation.isPending}>
              Deactivate
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bulk Delete Confirm */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selected))}
        loading={bulkDeleteMutation.isPending}
        title="Delete Rules"
        message={`Delete ${selected.size} rule${selected.size > 1 ? 's' : ''} permanently?`}
      />
    </div>
  );
}

// ── Commission Rule Card ──────────────────────────────────

function CommissionRuleCard({ rule, selected, onSelect, onView, onEdit, onToggle, onDuplicate, onDelete, canEdit, canDelete }: {
  rule: CommissionRule;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
  onEdit: (rule: CommissionRule) => void;
  onToggle: (rule: CommissionRule) => void;
  onDuplicate: (rule: CommissionRule) => void;
  onDelete: (rule: CommissionRule) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <Card className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${rule.name}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{rule.name}</p>
              {rule.description && (
                <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{rule.description}</p>
              )}
            </div>
            <StatusBadge active={rule.isActive} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <TypeBadge type={rule.type} />
            <ScopeBadge scope={rule.applicableTo} />
            <span className="rounded-full bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
              {rule.type === 'percentage' ? `${rule.value}%` :
               rule.type === 'slab' ? `${rule.slabs?.length || 0} slabs` :
               `₹${rule.value?.toLocaleString('en-IN')}`}
            </span>
            <span className="rounded-full bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
              P{rule.priority}
            </span>
          </div>
          <div className="mt-1.5 text-[10px] text-[var(--color-text-disabled)]">
            {rule.effectiveFrom ? `From ${formatDate(rule.effectiveFrom)}` : ''}
            {rule.updatedAt ? ` · Updated ${formatDate(rule.updatedAt)}` : ''}
          </div>
        </button>

        {/* Actions */}
        <div className="flex shrink-0 flex-col items-center gap-1" data-action onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => onView()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
            aria-label="View rule"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          {canEdit && <button type="button" onClick={() => onEdit(rule)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors" aria-label="Edit rule"><Edit2 className="h-3.5 w-3.5" /></button>}
          {canEdit && <button type="button" onClick={() => onToggle(rule)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors" aria-label={rule.isActive ? 'Deactivate' : 'Activate'}>{rule.isActive ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}</button>}
          {canEdit && <button type="button" onClick={() => onDuplicate(rule)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors" aria-label="Duplicate rule"><Copy className="h-3.5 w-3.5" /></button>}
          {canDelete && <button type="button" onClick={() => onDelete(rule)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" aria-label="Delete rule"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      </div>
    </Card>
  );
}

function CommissionRuleSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-6 w-full rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

export default MobileCommissionRulesWorkspace;
