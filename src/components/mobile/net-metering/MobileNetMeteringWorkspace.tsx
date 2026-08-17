/**
 * MobileNetMeteringWorkspace — Mobile workspace for net metering applications
 *
 * Leads-parity implementation for Compliance module mobile.
 * Reference: MobileLeadWorkspace
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Download,
  FileText,
  FolderKanban,
  Plus,
  Trash2,
  Zap,
  Building2,
  CheckCircle2,
  XCircle,
  ListChecks,
  CornerUpRight,
  Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea } from '../../ui';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtDate, getAll, deleteDocById } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';

import type { NetMeteringApplication, NetMeteringStatus } from '../../../lib/netMeteringWorkflow';
import {
  useNetMetering,
  useCreateNetMetering,
  useTransitionNetMetering,
} from '../../../features/net-metering/hooks/useNetMetering';

import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';

const NM_STATUSES: (NetMeteringStatus | 'All')[] = [
  'All', 'Submitted', 'UnderReview', 'Approved', 'MeterInstalled', 'Rejected',
];

const STATUS_COLORS: Record<string, string> = {
  Submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  UnderReview: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  MeterInstalled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

type NmFilters = {
  search: string;
  status: string;
  date: string;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function filterApps(apps: NetMeteringApplication[], filters: NmFilters) {
  const term = filters.search.trim().toLowerCase();
  return apps
    .filter((app) => {
      if (filters.status !== ALL && app.status !== filters.status) return false;
      if (filters.date !== 'all') {
        if (filters.date === 'today') {
          const d = toDate(app.createdAt);
          if (!d) return false;
          const now = new Date();
          if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) return false;
        } else if (filters.date === '7d') {
          const d = toDate(app.createdAt);
          if (!d) return false;
          const weekAgo = new Date(Date.now() - 7 * 86400000);
          if (d < weekAgo) return false;
        } else if (filters.date === '30d') {
          const d = toDate(app.createdAt);
          if (!d) return false;
          const monthAgo = new Date(Date.now() - 30 * 86400000);
          if (d < monthAgo) return false;
        }
      }
      if (!term) return true;
      return [app.applicationNumber, app.discomName, app.projectName, app.projectId]
        .some((v) => String(v || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
}

function downloadCsv(rows: NetMeteringApplication[], filename: string) {
  const headers = ['Application No.', 'Project', 'DISCOM', 'Status', 'Submitted Date', 'Notes'];
  const lines = rows.map((app) =>
    [
      app.applicationNumber || '', app.projectName || app.projectId || '',
      app.discomName || '', app.status || '', fmtDate(app.submittedDate) || '',
      (app.notes || '').replace(/"/g, '""'),
    ].map((v) => `"${v}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function statusBadgeNM(status: string) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    )}>
      {status === 'UnderReview' ? 'Under Review' : status}
    </span>
  );
}

const FORM0 = {
  projectId: '', projectName: '', discomName: '', applicationNumber: '',
  submittedDate: '', expectedMeterInstallationDate: '', notes: '',
};

export function MobileNetMeteringWorkspace() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const { data: apps = [], isLoading, error } = useNetMetering();
  const createMutation = useCreateNetMetering();
  const transitionMutation = useTransitionNetMetering();

  const { data: projects = [] } = useQuery({
    queryKey: keys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...FORM0 });
  const [viewApp, setViewApp] = useState<NetMeteringApplication | null>(null);
  const openId = params.get('open') || '';
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [detailTab, setDetailTab] = useState('overview');
  const createParam = params.get('create');

  // ── Filters ──
  const filters = useMemo<NmFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const filteredApps = useMemo(() => filterApps(apps as NetMeteringApplication[], filters), [apps, filters]);
  const paginatedApps = useMemo(() => filteredApps.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredApps, page]);
  const selectedRows = useMemo(() => (apps as NetMeteringApplication[]).filter((app) => selected.has(app.id)), [apps, selected]);
  const canCreate = perms.canCreate('net_metering');
  const canEdit = perms.canEdit('net_metering');
  const canDelete = perms.canDelete('net_metering');

  const projectOpts = useMemo(() => {
    return (projects as any[])
      .filter((p: any) => ['NetMetering', 'Subsidy', 'Handover', 'Archived'].includes(p.currentStage))
      .map((p: any) => ({ label: p.projectId || p.id, value: p.id }));
  }, [projects]);

  // ── Create flow: ?create=1 ──
  useEffect(() => {
    if (createParam !== '1') return;
    setForm({ ...FORM0 });
    setFormOpen(true);
  }, [createParam]);

  // ── Pagination sync ──
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredApps.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredApps.length, page]);

  // ── Selection cleanup ──
  useEffect(() => {
    setSelected((current) => {
      const available = new Set((apps as NetMeteringApplication[]).map((app) => app.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [apps]);

  // ── Detail modal URL sync ──
  const userClosedRef = useRef(false);

  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    if (!openId || isLoading) return;
    const target = (apps as NetMeteringApplication[]).find((app) => app.id === openId);
    if (target && !viewApp) {
      setViewApp(target);
      setDetailTab('overview');
    }
  }, [openId, isLoading, apps, viewApp]);

  function openMobileDetail(app: NetMeteringApplication) {
    userClosedRef.current = false;
    setViewApp(app);
    setDetailTab('overview');
    const next = new URLSearchParams(params);
    next.set('open', app.id);
    setParams(next, { replace: true });
  }

  function closeMobileDetail() {
    userClosedRef.current = true;
    setViewApp(null);
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

  // ── Form ──
  function closeForm() {
    setFormOpen(false);
    setForm({ ...FORM0 });
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.projectId) return toast.error('Please select a project');
    if (!form.discomName.trim()) return toast.error('Please enter DISCOM name');
    if (!form.applicationNumber.trim()) return toast.error('Please enter application number');
    createMutation.mutate(
      {
        projectId: form.projectId,
        projectName: form.projectName || undefined,
        discomName: form.discomName.trim(),
        applicationNumber: form.applicationNumber.trim(),
        submittedDate: form.submittedDate || undefined,
        expectedMeterInstallationDate: form.expectedMeterInstallationDate || undefined,
        notes: form.notes || undefined,
      },
      { onSuccess: () => closeForm() },
    );
  }

  // ── Delete ──
  const delMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteDocById(COLLECTIONS.NET_METERING_APPLICATIONS, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.netMeteringAll });
      toast.success('Deleted');
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function deleteSelected() {
    await Promise.all(selectedRows.map((app) => delMutation.mutateAsync(app.id)));
    setSelected(new Set());
    setDeleteOpen(false);
  }

  function exportRows(rows: NetMeteringApplication[]) {
    if (!rows.length) return toast.error('No applications selected');
    downloadCsv(rows, `net-metering-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} application${rows.length > 1 ? 's' : ''}`);
  }

  // ── Bulk status ──
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const { transitionNetMeteringStatus } = await import('../../../lib/netMeteringWorkflow');
      await Promise.all(ids.map((id) =>
        transitionNetMeteringStatus(id, status as NetMeteringStatus, { note: 'Bulk status update' })
          .catch(() => {}),
      ));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.netMeteringAll });
      toast.success(`Status updated for ${selected.size} application${selected.size > 1 ? 's' : ''}`);
      setBulkStatusOpen(false);
      setBulkStatus('');
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Transition for detail modal ──
  function handleTransition(app: NetMeteringApplication, newStatus: NetMeteringStatus) {
    let options: any = {};
    if (newStatus === 'Rejected') {
      const reason = prompt('Enter rejection reason:');
      if (!reason) { toast.error('Rejection reason is required'); return; }
      options = { rejectionReason: reason };
    }
    if (newStatus === 'Approved') options = { approvedDate: new Date().toISOString() };
    if (newStatus === 'MeterInstalled') options = { meterInstalledDate: new Date().toISOString() };
    transitionMutation.mutate({ id: app.id, status: newStatus, options });
  }

  const transitionsForStatus: Record<string, NetMeteringStatus[]> = {
    Submitted: ['UnderReview', 'Rejected'],
    UnderReview: ['Approved', 'Rejected'],
    Approved: ['MeterInstalled', 'Rejected'],
    MeterInstalled: [],
    Rejected: [],
  };

  // ── Timeline entries ──
  const timelineEntries = useMemo(() => {
    const entries: { type: string; description: string; date: string; user?: string }[] = [];
    if (viewApp) {
      entries.push({
        type: 'Created',
        description: `Application created for ${viewApp.projectName || viewApp.projectId}`,
        date: viewApp.createdAt,
      });
      (viewApp.statusHistory || []).forEach((entry: any) => {
        entries.push({
          type: 'Status Change',
          description: `${entry.status === 'UnderReview' ? 'Under Review' : entry.status}${entry.note ? ` — ${entry.note}` : ''}`,
          date: entry.changedAt,
          user: entry.changedBy,
        });
      });
      if (viewApp.updatedAt) {
        entries.push({
          type: 'Updated',
          description: 'Application details updated',
          date: viewApp.updatedAt,
        });
      }
    }
    return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [viewApp]);

  // ── Render ──
  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Net Metering</h1>
      </div>

      {/* ── Selection Bar ── */}
      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>Export</Button>
            {canEdit && <Button size="xs" variant="outline" icon={<ListChecks className="h-3 w-3" />} onClick={() => setBulkStatusOpen(true)}>Status</Button>}
            {canDelete && <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Clear</button>
          </div>
        </Card>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
          {(error as Error).message}
        </div>
      )}

      {/* ── List ── */}
      <div className="space-y-3">
        {isLoading && Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 animate-pulse">
            <div className="h-4 w-3/4 bg-[var(--color-bg-sunken)] rounded mb-2" />
            <div className="h-3 w-1/2 bg-[var(--color-bg-sunken)] rounded" />
          </div>
        ))}
        {!isLoading && filteredApps.length === 0 && (
          <Card className="rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
            <Zap className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
            <p className="mt-2">
              {filters.search || filters.status !== ALL || filters.date !== 'all'
                ? 'No applications match the current filters.'
                : 'No net metering applications yet.'}
            </p>
            {!filters.search && filters.status === ALL && filters.date === 'all' && canCreate && (
              <Button
                size="sm"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => { setForm({ ...FORM0 }); setFormOpen(true); }}
                className="mt-3"
              >
                Create Your First Application
              </Button>
            )}
          </Card>
        )}
        {!isLoading && paginatedApps.map((app) => (
          <div
            key={app.id}
            onClick={() => openMobileDetail(app)}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 cursor-pointer active:scale-[0.99] transition-transform"
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={selected.has(app.id)}
                onChange={(e) => { e.stopPropagation(); toggleSelect(app.id); }}
                onClick={(e) => e.stopPropagation()}
                className="mt-1 rounded border-[var(--color-border)] shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileText className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
                    <span className="text-xs font-semibold text-[var(--color-text)] truncate">
                      {app.applicationNumber}
                    </span>
                  </div>
                  {statusBadgeNM(app.status)}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] min-w-0">
                  <FolderKanban className="h-3 w-3 shrink-0" />
                  <span className="truncate">{app.projectName || app.projectId}</span>
                  <span className="mx-1">·</span>
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{app.discomName}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[var(--color-text-muted)]">
                  <Clock className="h-3 w-3" />
                  <span>Submitted {fmtDate(app.submittedDate)}</span>
                </div>
              </div>
            </div>
            {/* Quick actions */}
            <div className="flex gap-2 mt-2 pt-2 border-t border-[var(--color-border-subtle)]">
              {canEdit && app.status !== 'MeterInstalled' && app.status !== 'Rejected' && transitionsForStatus[app.status]?.length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextStatus = transitionsForStatus[app.status][0];
                    handleTransition(app, nextStatus);
                  }}
                  disabled={transitionMutation.isPending}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[var(--color-primary)] p-1.5 text-[10px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  <CornerUpRight className="h-3 w-3" /> {nextStatusLabel(transitionsForStatus[app.status][0])}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Pagination ── */}
      {!isLoading && filteredApps.length > 0 && (
        <Pagination page={page} total={filteredApps.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      {/* ── Create Form Modal ── */}
      <Modal open={formOpen} onClose={closeForm} title="New Net Metering Application" size="full">
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <Select
            label="Project *"
            value={form.projectId}
            onChange={(e) => {
              const pid = e.target.value;
              const project = (projects as any[]).find((p: any) => p.id === pid || p.projectId === pid);
              setForm((f) => ({ ...f, projectId: pid, projectName: project?.projectId || pid }));
            }}
            options={[{ label: 'Select project...', value: '' }, ...projectOpts]}
          />
          <Input
            label="DISCOM / Utility *"
            value={form.discomName}
            onChange={(e) => setForm((f) => ({ ...f, discomName: e.target.value }))}
            placeholder="e.g. TPNODL, WESCO, CESU"
          />
          <Input
            label="Application Number *"
            value={form.applicationNumber}
            onChange={(e) => setForm((f) => ({ ...f, applicationNumber: e.target.value }))}
            placeholder="DISCOM reference number"
          />
          <Input
            label="Submitted Date"
            type="date"
            value={form.submittedDate}
            onChange={(e) => setForm((f) => ({ ...f, submittedDate: e.target.value }))}
          />
          <Input
            label="Expected Meter Installation"
            type="date"
            value={form.expectedMeterInstallationDate}
            onChange={(e) => setForm((f) => ({ ...f, expectedMeterInstallationDate: e.target.value }))}
          />
          <Textarea
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Additional notes"
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={closeForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={createMutation.isPending}>Create Application</Button>
          </div>
        </form>
      </Modal>

      {/* ── Detail Modal ── */}
      <Modal open={!!viewApp} onClose={closeMobileDetail} title="Application Details" size="full">
        {viewApp && (
          <div className="space-y-4">
            {/* Status header */}
            <div className="flex items-center gap-2 mb-1">
              {statusBadgeNM(viewApp.status)}
              <span className="text-[10px] font-mono text-[var(--color-text-muted)]">{viewApp.id}</span>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-[var(--color-border-subtle)]">
              {['overview', 'timeline', 'notes', 'history'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={cn(
                    'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                    detailTab === tab
                      ? 'text-[var(--color-primary)] border-b-2 border-[var(--color-primary)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                  )}
                >
                  {tab === 'overview' && 'Overview'}
                  {tab === 'timeline' && 'Timeline'}
                  {tab === 'notes' && 'Notes'}
                  {tab === 'history' && 'History'}
                </button>
              ))}
            </div>

            {/* Overview tab */}
            {detailTab === 'overview' && (
              <div className="space-y-3">
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                    <span className="text-[var(--color-text-muted)]">Project</span>
                    <span className="font-semibold text-[var(--color-text)] truncate ml-2">{viewApp.projectName || viewApp.projectId}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                    <span className="text-[var(--color-text-muted)]">DISCOM</span>
                    <span className="font-semibold text-[var(--color-text)]">{viewApp.discomName}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                    <span className="text-[var(--color-text-muted)]">Application No.</span>
                    <span className="font-semibold font-mono text-[var(--color-text)]">{viewApp.applicationNumber}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                    <span className="text-[var(--color-text-muted)]">Submitted</span>
                    <span className="font-semibold">{fmtDate(viewApp.submittedDate)}</span>
                  </div>
                  {viewApp.expectedMeterInstallationDate && !viewApp.meterInstalledDate && (
                    <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                      <span className="text-[var(--color-text-muted)]">Expected Meter</span>
                      <span className="font-semibold text-amber-600">{fmtDate(viewApp.expectedMeterInstallationDate)}</span>
                    </div>
                  )}
                  {viewApp.approvedDate && (
                    <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                      <span className="text-[var(--color-text-muted)]">Approved</span>
                      <span className="font-semibold text-emerald-600">{fmtDate(viewApp.approvedDate)}</span>
                    </div>
                  )}
                  {viewApp.meterInstalledDate && (
                    <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                      <span className="text-[var(--color-text-muted)]">Meter Installed</span>
                      <span className="font-semibold text-green-600">{fmtDate(viewApp.meterInstalledDate)}</span>
                    </div>
                  )}
                  {viewApp.rejectionReason && (
                    <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)]">
                      <span className="text-[var(--color-text-muted)]">Rejection Reason</span>
                      <span className="font-semibold text-red-600">{viewApp.rejectionReason}</span>
                    </div>
                  )}
                  {viewApp.notes && (
                    <div className="py-1.5">
                      <span className="text-[var(--color-text-muted)]">Notes</span>
                      <p className="mt-1 text-[var(--color-text)]">{viewApp.notes}</p>
                    </div>
                  )}
                </div>

                {/* Quick action buttons */}
                {viewApp.status !== 'MeterInstalled' && viewApp.status !== 'Rejected' && canEdit && transitionsForStatus[viewApp.status]?.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Actions</p>
                    <div className="flex flex-wrap gap-2">
                      {transitionsForStatus[viewApp.status].map((nextStatus) => (
                        <button
                          key={nextStatus}
                          onClick={() => {
                            handleTransition(viewApp, nextStatus);
                            closeMobileDetail();
                          }}
                          disabled={transitionMutation.isPending}
                          className={cn(
                            'flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity disabled:opacity-50 text-center',
                            nextStatus === 'Rejected'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                              : 'bg-[var(--color-primary)] text-white',
                          )}
                        >
                          {nextStatusLabel(nextStatus)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Timeline tab */}
            {detailTab === 'timeline' && (
              <MobileTimelinePreview entries={timelineEntries} title="Application Timeline" />
            )}

            {/* Notes tab */}
            {detailTab === 'notes' && (
              <div className="text-xs text-[var(--color-text-muted)] text-center py-4">
                {viewApp.notes ? viewApp.notes : 'No notes attached.'}
              </div>
            )}

            {/* History tab */}
            {detailTab === 'history' && (
              <div className="space-y-2">
                {(viewApp.statusHistory || []).length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)] text-center py-4">No status history yet.</p>
                ) : (
                  [...(viewApp.statusHistory || [])].reverse().map((entry: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs py-2 border-b border-[var(--color-border-subtle)]">
                      <div>
                        <span className="font-semibold">{entry.status === 'UnderReview' ? 'Under Review' : entry.status}</span>
                        {entry.note && <span className="text-[var(--color-text-muted)] ml-1">— {entry.note}</span>}
                      </div>
                      <span className="text-[10px] text-[var(--color-text-muted)]">{fmtDate(entry.changedAt)}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Status banners */}
            {viewApp.status === 'MeterInstalled' && (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="inline h-3 w-3 mr-1" />
                Net meter installed successfully.
              </div>
            )}
            {viewApp.status === 'Rejected' && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300">
                <XCircle className="inline h-3 w-3 mr-1" />
                This application was rejected.
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Bulk Status Modal ── */}
      <Modal open={bulkStatusOpen} onClose={() => setBulkStatusOpen(false)} title="Change Status" size="full">
        <div className="space-y-4">
          <Select
            label="New Status"
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            options={[
              { label: 'Select status...', value: '' },
              ...NM_STATUSES.filter((s) => s !== 'All' && s !== 'Rejected').map((s) => ({
                label: s === 'UnderReview' ? 'Under Review' : s,
                value: s,
              })),
            ]}
          />
          <Button
            className="w-full"
            loading={bulkStatusMutation.isPending}
            onClick={() => {
              if (!bulkStatus) return toast.error('Select a status');
              bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus });
            }}
          >
            Update {selected.size} Application{selected.size > 1 ? 's' : ''}
          </Button>
        </div>
      </Modal>

      {/* ── Delete Confirm ── */}
      <ConfirmDialog
        open={deleteOpen}
        title="Delete Applications"
        message={`Are you sure you want to delete ${selected.size} application${selected.size > 1 ? 's' : ''}?`}
        onConfirm={deleteSelected}
        onClose={() => setDeleteOpen(false)}
        loading={delMutation.isPending}
      />
    </div>
  );
}

function nextStatusLabel(status: NetMeteringStatus) {
  if (status === 'MeterInstalled') return 'Mark Meter Installed';
  if (status === 'UnderReview') return 'Mark Under Review';
  return `Mark ${status}`;
}

export default MobileNetMeteringWorkspace;
