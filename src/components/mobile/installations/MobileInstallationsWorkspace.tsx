/**
 * MobileInstallationsWorkspace — Native mobile Installations workspace
 *
 * Replaces the Desktop page lazy-loaded rendering. Provides:
 * - Card-based installation list with search, filters, pagination
 * - Full detail view with tabs (Overview, Timeline, Visits, Checklist, Documents)
 * - Visit scheduling using `scheduleVisit()` from installationEngine
 * - Visit status management using `updateVisitStatus()` from installationEngine
 * - Engineer assignment using `assignEngineer()` from installationEngine
 * - Stage management using `updateInstallationStatus()` from partnerLeadIntegration
 * - Installation checklist with `toggleChecklistItem()`
 * - Serial number capture
 * - Timeline with stage history
 *
 * Reuses: statusBadge, Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea
 * Reuses: installationEngine helpers (stageLabel, stageBadgeColor, etc.)
 * Reuses: assignEngineer, scheduleVisit, updateVisitStatus, getLeadVisits from installationEngine
 * Reuses: toggleChecklistItem, captureInstallationSerial from installationEngine
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  HardHat,
  User,
  UserPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Input, Modal, Pagination, Textarea } from '../../ui';
import { cn } from '../../../utils/cn';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtDate, getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';
import {
  stageLabel,
  stageBadgeColor,
  calculateCompletion,
  isInstallationDelayed,
  delayDays,
  isValidInstallation,
  INSTALLATION_STAGES,
  scheduleVisit,
  updateVisitStatus,
  getLeadVisits,
  assignEngineer,
  toggleChecklistItem,
  captureInstallationSerial,
  DEFAULT_INSTALLATION_CHECKLIST,
  type InstallationVisit,
  type VisitStatus,
} from '../../../lib/installationEngine';
import { updateInstallationStatus } from '../../../lib/partnerLeadIntegration';

const PER_PAGE = 10;
const ALL = 'All';

type Mode = 'records' | 'create';

interface InstallationFilters {
  search: string;
  stage: string;
  delay: string;
}

function filterInstallations(records: any[], filters: InstallationFilters) {
  const term = filters.search.trim().toLowerCase();
  return records
    .filter((inst) => {
      if (filters.stage !== ALL && inst.installationStatus !== filters.stage) return false;
      if (filters.delay === 'delayed' && !inst._delayed) return false;
      if (filters.delay === 'ontrack' && (inst._delayed || inst.installationStatus === 'completed')) return false;
      if (!term) return true;
      return [inst.name, inst.phone, inst.city, inst._partnerName, inst.assignedEngineerName]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a: any, b: any) => {
      if (a._delayed !== b._delayed) return a._delayed ? -1 : 1;
      const aTime = a.updatedAt || a.createdAt ? new Date(a.updatedAt || a.createdAt).getTime() : 0;
      const bTime = b.updatedAt || b.createdAt ? new Date(b.updatedAt || b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
}

/* ── Delay Badge ────────────────────────────────────────────── */

function DelayBadge({ days }: { days: number }) {
  if (days <= 0) return null;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
      days <= 7 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
      days <= 30 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' :
      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    )}>
      <AlertTriangle className="h-3 w-3" /> {days}d
    </span>
  );
}

/* ── Skeleton Card ──────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <Card className="rounded-xl p-4">
      <div className="flex gap-3">
        <div className="h-10 w-10 rounded-lg bg-[var(--color-bg-sunken)] shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/3 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

/* ── Main Component ─────────────────────────────────────────── */

export default function MobileInstallationsWorkspace({ mode }: { mode: Mode }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const user = useAppStore((s) => s.user);
  const isAdmin = user?.role === 'Admin' || user?.role === 'Director';

  // ── Queries ─────────────────────────────────────────────
  const { data: leads = [], isLoading, isError, refetch } = useQuery({
    queryKey: companyKeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: partners = [] } = useQuery({
    queryKey: ['channel_partners_dropdown', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 60_000,
    enabled: Boolean(activeCompanyId),
  });

  // ── Installations with derived fields ──────────────────
  const installations = useMemo(() => {
    return (leads as any[])
      .filter((l: any) => isValidInstallation(l))
      .map((l: any) => {
        const delayed = isInstallationDelayed(l.installationStatus, l.expectedCompletionDate, l.scheduledDate);
        return {
          ...l,
          _completionPct: calculateCompletion(l.installationStatus),
          _delayed: delayed,
          _delayDays: delayed ? delayDays(l.installationStatus, l.expectedCompletionDate, l.scheduledDate) : 0,
          _partnerName: l.partnerName || partners.find((p: any) => p.id === l.partnerId)?.firmName || '—',
        };
      });
  }, [leads, partners]);

  // ── Filters from URL params ────────────────────────────
  const filters = useMemo<InstallationFilters>(() => ({
    search: params.get('q') || '',
    stage: params.get('stage') || ALL,
    delay: params.get('delay') || ALL,
  }), [params]);

  // ── Filtered / Paginated ───────────────────────────────
  const filteredRecords = useMemo(() => filterInstallations(installations, filters), [installations, filters]);
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const paginatedRecords = useMemo(() => filteredRecords.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredRecords, page]);

  // ── Selection ──────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Detail View ────────────────────────────────────────
  const [viewInstallation, setViewInstallation] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'timeline' | 'visits' | 'checklist'>('overview');

  // ── Visits ─────────────────────────────────────────────
  const [visits, setVisits] = useState<InstallationVisit[]>([]);
  const [loadingVisits, setLoadingVisits] = useState(false);

  // ── Schedule Visit Modal ──────────────────────────────
  const [showScheduleVisit, setShowScheduleVisit] = useState(false);
  const [visitDate, setVisitDate] = useState('');
  const [visitTime, setVisitTime] = useState('');
  const [visitNote, setVisitNote] = useState('');
  const [schedulingVisit, setSchedulingVisit] = useState(false);

  // ── Engineer Assignment ───────────────────────────────
  const [showEngineerAssign, setShowEngineerAssign] = useState(false);
  const [engineerName, setEngineerName] = useState('');
  const [engineerPhone, setEngineerPhone] = useState('');
  const [assigningEngineer, setAssigningEngineer] = useState(false);

  // ── Stage Change ──────────────────────────────────────
  const [selectedStage, setSelectedStage] = useState('');
  const [updatingStage, setUpdatingStage] = useState(false);

  // ── Checklist ──────────────────────────────────────────
  const [updatingChecklistIndex, setUpdatingChecklistIndex] = useState<number | null>(null);

  // ── Serial Number ──────────────────────────────────────
  const [serialInput, setSerialInput] = useState('');
  const [savingSerial, setSavingSerial] = useState(false);

  // ── URL sync: page reset on filter change ─────────────
  useEffect(() => {
    setPage(1);
  }, [filters.search, filters.stage, filters.delay]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredRecords.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredRecords.length, page]);

  // ── Load visits when detail opens ─────────────────────
  useEffect(() => {
    if (!viewInstallation?.id) return;
    setLoadingVisits(true);
    getLeadVisits(viewInstallation.id)
      .then(setVisits)
      .catch(() => setVisits([]))
      .finally(() => setLoadingVisits(false));
  }, [viewInstallation?.id]);

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

  // ── Schedule Visit ──────────────────────────────────
  async function handleScheduleVisit() {
    if (!viewInstallation?.id || !visitDate) {
      toast.error('Date is required');
      return;
    }
    setSchedulingVisit(true);
    try {
      await scheduleVisit(viewInstallation.id, visitDate, undefined, undefined, visitTime || undefined, visitNote || undefined);
      toast.success('Visit scheduled');
      setShowScheduleVisit(false);
      setVisitDate('');
      setVisitTime('');
      setVisitNote('');
      // Reload visits
      const updatedVisits = await getLeadVisits(viewInstallation.id);
      setVisits(updatedVisits);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to schedule visit');
    } finally {
      setSchedulingVisit(false);
    }
  }

  // ── Update Visit Status ──────────────────────────────
  async function handleVisitStatus(visitId: string, status: VisitStatus) {
    try {
      await updateVisitStatus(visitId, status);
      toast.success(`Visit ${status}`);
      const updatedVisits = await getLeadVisits(viewInstallation.id);
      setVisits(updatedVisits);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update visit');
    }
  }

  // ── Assign Engineer ──────────────────────────────────
  async function handleAssignEngineer() {
    if (!viewInstallation?.id || !engineerName) {
      toast.error('Engineer name is required');
      return;
    }
    setAssigningEngineer(true);
    try {
      await assignEngineer(viewInstallation.id, engineerName, engineerName, engineerPhone || undefined);
      toast.success('Engineer assigned');
      setShowEngineerAssign(false);
      setEngineerName('');
      setEngineerPhone('');
      void qc.invalidateQueries({ queryKey: companyKeys.leadsAll });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to assign engineer');
    } finally {
      setAssigningEngineer(false);
    }
  }

  // ── Update Stage ─────────────────────────────────────
  async function handleStageChange() {
    if (!viewInstallation?.id || !selectedStage || selectedStage === viewInstallation.installationStatus) return;
    setUpdatingStage(true);
    try {
      await updateInstallationStatus(viewInstallation.id, selectedStage as any);
      toast.success('Stage updated');
      void qc.invalidateQueries({ queryKey: companyKeys.leadsAll });
      setViewInstallation(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update stage');
    } finally {
      setUpdatingStage(false);
    }
  }

  // ── Toggle Checklist Item ────────────────────────────
  async function handleToggleChecklist(index: number) {
    if (!viewInstallation?.id) return;
    setUpdatingChecklistIndex(index);
    try {
      await toggleChecklistItem(viewInstallation.id, index);
      void qc.invalidateQueries({ queryKey: companyKeys.leadsAll });
      // Update local state
      const lead = (leads as any[]).find((l: any) => l.id === viewInstallation.id);
      if (lead) {
        setViewInstallation({ ...viewInstallation, installationChecklist: lead.installationChecklist });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update checklist');
    } finally {
      setUpdatingChecklistIndex(null);
    }
  }

  // ── Capture Serial ──────────────────────────────────
  async function handleCaptureSerial() {
    if (!viewInstallation?.id || !serialInput.trim()) return;
    setSavingSerial(true);
    try {
      await captureInstallationSerial(viewInstallation.id, serialInput.trim());
      toast.success('Serial captured');
      setSerialInput('');
      void qc.invalidateQueries({ queryKey: companyKeys.leadsAll });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to capture serial');
    } finally {
      setSavingSerial(false);
    }
  }

  // ── Render ────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-4 pt-2">
      <div className="flex items-center justify-between px-1">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Installations</h1>
          <p className="text-xs text-[var(--color-text-muted)]">{installations.length} records</p>
        </div>
      </div>

      {/* ── Bulk Actions Bar ──────────────────────────────── */}
      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
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
        </Card>
      )}

      {/* ── Error State ──────────────────────────────────── */}
      {isError && (
        <div className="flex flex-col items-center justify-center min-h-[30vh] text-center px-6">
          <HardHat className="h-10 w-10 text-rose-500 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">Failed to load installations</h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-[260px]">Could not load installation data.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Loading State ────────────────────────────────── */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* ── Empty State ──────────────────────────────────── */}
      {!isLoading && !isError && filteredRecords.length === 0 && (
        <Card className="rounded-xl p-8 text-center">
          <HardHat className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--color-text)]">
            {params.get('q') || params.get('stage') ? 'No installations match filters' : 'No installations yet'}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {params.get('q') || params.get('stage') ? 'Try adjusting your search or filters.' : 'Installations appear when leads progress past approval.'}
          </p>
        </Card>
      )}

      {/* ── Installation Cards ───────────────────────────── */}
      {!isLoading && !isError && (
        <div className="space-y-3">
          {paginatedRecords.map((inst: any) => {
            const delayed = inst._delayed;
            const completionPct = inst._completionPct;
            return (
              <Card
                key={inst.id}
                className={cn(
                  'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow',
                  'hover:shadow-[var(--shadow-enterprise-row)]',
                  selected.has(inst.id) && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
                  delayed && 'border-l-4 border-l-rose-500',
                )}
              >
                <div className="flex items-start gap-2.5">
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selected.has(inst.id)}
                    onChange={() => toggleSelect(inst.id)}
                    className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
                    aria-label={`Select ${inst.name}`}
                  />
                  {/* Card Body */}
                  <button
                    type="button"
                    onClick={() => setViewInstallation(inst)}
                    className="min-w-0 flex-1 text-left"
                  >
                    {/* Name + Partner */}
                    <div className="flex items-start gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 text-xs font-bold">
                        {(inst.name || '?')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-[var(--color-text)]">{inst.name || '—'}</p>
                        <p className="truncate text-xs text-[var(--color-text-muted)]">{inst._partnerName}</p>
                      </div>
                    </div>

                    {/* Stage Badge + Delay */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', stageBadgeColor(inst.installationStatus))}>
                        {stageLabel(inst.installationStatus)}
                      </span>
                      {delayed && <DelayBadge days={inst._delayDays} />}
                    </div>

                    {/* Engineer */}
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                      <User className="h-3 w-3" />
                      {inst.assignedEngineerName || 'Unassigned'}
                    </p>

                    {/* Progress */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--color-bg-sunken)] overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', completionPct >= 100 ? 'bg-emerald-500' : completionPct >= 50 ? 'bg-indigo-500' : 'bg-amber-500')}
                          style={{ width: `${completionPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-semibold text-[var(--color-text-muted)]">{completionPct}%</span>
                    </div>
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Pagination ───────────────────────────────────── */}
      {!isLoading && !isError && filteredRecords.length > 0 && (
        <Pagination page={page} total={filteredRecords.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      {/* ══════════════════════════════════════════════════
         DETAIL MODAL
         ══════════════════════════════════════════════════ */}
      <Modal
        open={!!viewInstallation}
        onClose={() => { setViewInstallation(null); setDetailTab('overview'); }}
        title={viewInstallation?.name || 'Installation'}
        size="full"
      >
        {viewInstallation && (() => {
          const inst = viewInstallation;
          const completionPct = calculateCompletion(inst.installationStatus);
          const isCompleted = inst.installationStatus === 'completed';
          const currentStageIdx = INSTALLATION_STAGES.indexOf(inst.installationStatus);
          const delayed = isInstallationDelayed(inst.installationStatus, inst.expectedCompletionDate, inst.scheduledDate);
          const delayDaysCount = delayed ? delayDays(inst.installationStatus, inst.expectedCompletionDate, inst.scheduledDate) : 0;
          const checklist = Array.isArray(inst.installationChecklist) ? inst.installationChecklist : DEFAULT_INSTALLATION_CHECKLIST.map((i) => ({ ...i }));
          const capturedSerials: any[] = Array.isArray(inst.capturedSerialNumbers) ? inst.capturedSerialNumbers : [];
          const location = [inst.city, inst.state].filter(Boolean).join(', ') || '—';

          return (
            <div className="space-y-4 pb-6">
              {/* Stage Badge */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', stageBadgeColor(inst.installationStatus))}>
                  {stageLabel(inst.installationStatus)}
                </span>
                {delayed && <DelayBadge days={delayDaysCount} />}
                <span className="text-xs text-[var(--color-text-muted)] ml-auto">{completionPct}% complete</span>
              </div>

              {/* Progress */}
              <div className="h-2 rounded-full bg-[var(--color-bg-sunken)] overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', completionPct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500')}
                  style={{ width: `${completionPct}%` }}
                />
              </div>

              {/* ── Tabs ──────────────────────────────────── */}
              <div className="flex gap-1 overflow-x-auto pb-1">
                {(['overview', 'timeline', 'visits', 'checklist'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDetailTab(tab)}
                    className={cn(
                      'shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                      detailTab === tab
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-sunken)]',
                    )}
                  >
                    {tab === 'overview' ? 'Overview' : tab === 'timeline' ? 'Timeline' : tab === 'visits' ? `Visits (${visits.length})` : 'Checklist'}
                  </button>
                ))}
              </div>

              {/* ── TAB: Overview ─────────────────────────── */}
              {detailTab === 'overview' && (
                <div className="space-y-4">
                  {/* Customer Details */}
                  <Section title="Customer Details">
                    <Detail label="Name" value={inst.name || '—'} />
                    <Detail label="Phone" value={inst.phone || '—'} />
                    <Detail label="Location" value={location} />
                    <Detail label="System Size" value={inst.systemSizeKW ? `${inst.systemSizeKW} kW` : '—'} />
                    {inst.value && <Detail label="Deal Value" value={`₹${Number(inst.value).toLocaleString('en-IN')}`} />}
                  </Section>

                  {/* Project Details */}
                  <Section title="Project">
                    <Detail label="Partner" value={inst._partnerName} />
                    <Detail label="Source" value={inst.source || '—'} />
                    {/* Schedule */}
                    <Detail label="Scheduled" value={inst.scheduledDate ? fmtDate(inst.scheduledDate) : '—'} />
                    <Detail label="Expected Completion" value={inst.expectedCompletionDate ? fmtDate(inst.expectedCompletionDate) : '—'} />
                    {inst.installationCompletedAt && (
                      <Detail label="Completed At" value={fmtDate(inst.installationCompletedAt)} />
                    )}
                  </Section>

                  {/* Engineer */}
                  <Section title="Engineer">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-[var(--color-text)]">{inst.assignedEngineerName || 'Not assigned'}</p>
                        {inst.assignedEngineerPhone && (
                          <p className="text-xs text-[var(--color-text-muted)]">{inst.assignedEngineerPhone}</p>
                        )}
                      </div>
                      {isAdmin && !isCompleted && (
                        <Button size="xs" variant="outline" icon={<UserPlus className="h-3 w-3" />} onClick={() => setShowEngineerAssign(true)}>
                          {inst.assignedEngineerName ? 'Reassign' : 'Assign'}
                        </Button>
                      )}
                    </div>
                  </Section>

                  {/* Stage Change */}
                  {isAdmin && !isCompleted && (
                    <Section title="Change Stage">
                      <div className="flex gap-2">
                        <select
                          value={selectedStage || inst.installationStatus || ''}
                          onChange={(e) => setSelectedStage(e.target.value)}
                          className="flex-1 h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                        >
                          {INSTALLATION_STAGES.map((s) => (
                            <option key={s} value={s}>{stageLabel(s)}</option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          onClick={handleStageChange}
                          loading={updatingStage}
                          disabled={!selectedStage || selectedStage === inst.installationStatus}
                        >
                          Update
                        </Button>
                      </div>
                    </Section>
                  )}

                  {/* Notes */}
                  {inst.notes && (
                    <Section title="Notes">
                      <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{inst.notes}</p>
                    </Section>
                  )}

                  {/* Serial Numbers */}
                  {capturedSerials.length > 0 && (
                    <Section title={`Serials (${capturedSerials.length})`}>
                      <div className="space-y-1">
                        {capturedSerials.map((s: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="font-mono font-semibold">{s.serialNumber}</span>
                            {s.product && <span className="text-[var(--color-text-muted)]">{s.product}</span>}
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Capture Serial */}
                  {isAdmin && !isCompleted && (
                    <Section title="Capture Serial">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={serialInput}
                          onChange={(e) => setSerialInput(e.target.value)}
                          placeholder="Scan or type serial..."
                          className="flex-1 h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                        />
                        <Button size="sm" onClick={handleCaptureSerial} loading={savingSerial} disabled={!serialInput.trim()}>
                          Save
                        </Button>
                      </div>
                    </Section>
                  )}

                  {/* Created/Updated */}
                  <Section title="Record Info">
                    <Detail label="Created" value={inst.createdAt ? fmtDate(inst.createdAt) : '—'} />
                    <Detail label="Last Updated" value={inst.updatedAt ? fmtDate(inst.updatedAt) : '—'} />
                  </Section>
                </div>
              )}

              {/* ── TAB: Timeline ──────────────────────────── */}
              {detailTab === 'timeline' && (
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Installation Timeline</p>
                  {INSTALLATION_STAGES.map((stage, i) => {
                    const isCurrent = i === currentStageIdx;
                    const isPast = i < currentStageIdx;
                    return (
                      <div key={stage} className="flex gap-3 pb-2 last:pb-0">
                        <div className="flex flex-col items-center">
                          <div className={cn(
                            'h-6 w-6 rounded-full flex items-center justify-center shrink-0',
                            isPast ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' :
                            isCurrent ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-200 dark:ring-indigo-800' :
                            'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
                          )}>
                            {isPast ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                          </div>
                          {i < INSTALLATION_STAGES.length - 1 && (
                            <div className={cn('w-px flex-1 min-h-[12px] mt-0.5', isPast ? 'bg-emerald-200 dark:bg-emerald-800' : 'bg-[var(--color-border-subtle)]')} />
                          )}
                        </div>
                        <div className="flex-1 pb-0.5">
                          <p className={cn(
                            'text-xs font-semibold',
                            isCurrent ? 'text-[var(--color-text)]' : isPast ? 'text-emerald-700 dark:text-emerald-300' : 'text-[var(--color-text-muted)]',
                          )}>
                            {stageLabel(stage)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {/* Activity log timeline */}
                  <div className="mt-4 pt-3 border-t border-[var(--color-border-subtle)]">
                    {inst.activityLog && inst.activityLog.length > 0 ? (
                      <MobileTimelinePreview title="Activity" entries={inst.activityLog.slice(0, 2).map((entry: any) => ({
                        ...entry,
                        date: entry.timestamp || entry.createdAt || entry.date,
                        user: entry.userName || entry.createdByName || entry.user || 'System',
                        description: entry.actionLabel || entry.action || entry.description || entry.message || '',
                      }))} />
                    ) : (
                      <p className="text-xs text-[var(--color-text-muted)] text-center">No activity recorded yet.</p>
                    )}
                  </div>
                </div>
              )}

              {/* ── TAB: Visits ────────────────────────────── */}
              {detailTab === 'visits' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Visit History</p>
                    {isAdmin && !isCompleted && (
                      <Button
                        size="xs"
                        variant="outline"
                        icon={<Calendar className="h-3 w-3" />}
                        onClick={() => setShowScheduleVisit(true)}
                      >
                        Schedule
                      </Button>
                    )}
                  </div>
                  {loadingVisits ? (
                    <p className="text-xs text-[var(--color-text-muted)] text-center py-4">Loading visits...</p>
                  ) : visits.length === 0 ? (
                    <div className="flex flex-col items-center py-8 text-center">
                      <Calendar className="h-6 w-6 text-[var(--color-text-muted)] mb-2" />
                      <p className="text-xs text-[var(--color-text-muted)]">No visits scheduled</p>
                      {isAdmin && !isCompleted && (
                        <Button size="xs" variant="outline" onClick={() => setShowScheduleVisit(true)} className="mt-2">
                          Schedule First Visit
                        </Button>
                      )}
                    </div>
                  ) : (
                    visits.map((visit) => (
                      <Card key={visit.id} className="rounded-xl p-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-xs font-semibold text-[var(--color-text)]">
                              {visit.scheduledDate ? new Date(visit.scheduledDate + (visit.scheduledTime ? `T${visit.scheduledTime}` : '')).toLocaleDateString('en-GB', {
                                weekday: 'short', day: '2-digit', month: 'short',
                              }) : '—'}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant={
                                visit.status === 'completed' ? 'success' :
                                visit.status === 'scheduled' ? 'info' :
                                visit.status === 'missed' ? 'danger' :
                                visit.status === 'cancelled' ? 'gray' : 'warning'
                              }>
                                {visit.status.charAt(0).toUpperCase() + visit.status.slice(1)}
                              </Badge>
                              {visit.engineerName && (
                                <span className="text-xs text-[var(--color-text-muted)]">{visit.engineerName}</span>
                              )}
                            </div>
                          </div>
                          {/* Visit actions */}
                          {isAdmin && visit.status === 'scheduled' && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleVisitStatus(visit.id, 'completed')}
                                className="rounded-lg px-2 py-1 text-[10px] font-semibold bg-emerald-100 text-emerald-700"
                              >
                                Done
                              </button>
                              <button
                                onClick={() => handleVisitStatus(visit.id, 'missed')}
                                className="rounded-lg px-2 py-1 text-[10px] font-semibold bg-rose-100 text-rose-700"
                              >
                                Miss
                              </button>
                            </div>
                          )}
                        </div>
                        {visit.outcome && (
                          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                            Outcome: {visit.outcome}
                          </p>
                        )}
                        {visit.notes && (
                          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)] italic">{visit.notes}</p>
                        )}
                      </Card>
                    ))
                  )}
                </div>
              )}

              {/* ── TAB: Checklist ─────────────────────────── */}
              {detailTab === 'checklist' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                      Installation Checklist ({checklist.filter((i: any) => i.completed).length}/{checklist.length})
                    </p>
                  </div>
                  {checklist.map((item: any, index: number) => (
                    <label
                      key={index}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors',
                        item.completed
                          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/10'
                          : 'border-[var(--color-border-subtle)] hover:border-[var(--color-border)]',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={item.completed}
                        disabled={!isAdmin || updatingChecklistIndex === index}
                        onChange={() => handleToggleChecklist(index)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={cn('font-medium', item.completed && 'line-through text-emerald-700 dark:text-emerald-300')}>
                          {item.item}
                        </p>
                        {item.completedAt && (
                          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                            Completed {fmtDate(item.completedAt)}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ══════════════════════════════════════════════════════
         SCHEDULE VISIT MODAL
         ══════════════════════════════════════════════════════ */}
      <Modal open={showScheduleVisit} onClose={() => setShowScheduleVisit(false)} title="Schedule Visit" size="full">
        <div className="space-y-4">
          <Input
            label="Visit Date *"
            type="date"
            required
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
          />
          <Input
            label="Time (optional)"
            type="time"
            value={visitTime}
            onChange={(e) => setVisitTime(e.target.value)}
          />
          <Textarea
            label="Notes (optional)"
            value={visitNote}
            onChange={(e) => setVisitNote(e.target.value)}
            placeholder="Visit purpose, instructions..."
            rows={2}
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setShowScheduleVisit(false)}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" onClick={handleScheduleVisit} loading={schedulingVisit}>
              Schedule
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════
         ENGINEER ASSIGNMENT MODAL
         ══════════════════════════════════════════════════════ */}
      <Modal open={showEngineerAssign} onClose={() => setShowEngineerAssign(false)} title="Assign Engineer" size="full">
        <div className="space-y-4">
          <Input
            label="Engineer Name *"
            required
            value={engineerName}
            onChange={(e) => setEngineerName(e.target.value)}
            placeholder="Enter engineer name"
          />
          <Input
            label="Phone (optional)"
            value={engineerPhone}
            onChange={(e) => setEngineerPhone(e.target.value)}
            placeholder="Engineer phone number"
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setShowEngineerAssign(false)}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" onClick={handleAssignEngineer} loading={assigningEngineer}>
              Assign
            </Button>
          </div>
        </div>
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
