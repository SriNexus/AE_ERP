import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, createDocWithId, genId, fmtDate } from '../lib/firestore';
import { batchCreateLeadProjections, useLeads, useSaveLead } from '../features/leads/hooks/useLeads';
import { deleteProjectionWithEntity, updateProjectionWithEntity } from '../lib/entityProjection';
import { COLLECTIONS } from '../lib/firebase';
import { LEAD_SOURCES, LEAD_STATUSES } from '../config/company';
import { isInDateRange } from '../lib/dateFilters';
import { usePermissions } from '../lib/permissions';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { scoreLead } from '../lib/leadScoring';
import { logActivity } from '../lib/workflow';
import { statusBadge } from '../components/ui/Badge';
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Pagination,
  PremiumKpi,
  Select,
  SkeletonRows,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  UniversalCheckbox,
  WorkspaceHero,
} from '../components/ui';
import {
  CreatedDateCell,
  EmptyCell,
  FollowupBadge,
} from '../features/leads/components/LeadWorkspaceParts';
import { LeadWorkspaceDialogs } from '../features/leads/components/LeadWorkspaceDialogs';
import { InactiveRecordsModal } from '../components/shared/InactiveRecordsModal';
import {
  Plus, Trash2, Target, Phone, Calendar, RefreshCw,
  UploadCloud, Download, Archive,
  User, AlertTriangle, Users, ListChecks,
  Handshake, Eye, X, GraduationCap,
} from 'lucide-react';
import { TutorialCenter } from '../features/tutorials';
import { parseCSV } from '../features/leads/utils/leadsCsv';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { notifyRoleUsers, notifyUsersOnce, resolveNotificationCompanyId, sendNotification } from '../lib/notifications';
import { NotificationType } from '../types';
import { COMMISSION_STATUS_LABELS, INSTALLATION_STATUS_LABELS, DOCUMENTATION_STATUS_LABELS, INSTALLATION_STATUSES } from '../features/channel-partner/types/leadIntegration';
import {
  updateInstallationStatus as updatePartnerInstallationStatus,
  updateDocumentationStatus as updatePartnerDocumentationStatus,
  updateCommissionStatus as updatePartnerCommissionStatus,
} from '../lib/partnerLeadIntegration';
import { filterPartnerOwnedLeads } from '../lib/partnerOwnership';

const PER_PAGE = 10;

const FORM0 = {
  name: '', phone: '', email: '', city: '', state: '',
  source: 'Website', status: 'New',
  assignedToId: '', assignedToName: '', notes: '', next_date: '',
};

// ── CSV parser imported from leadsCsv.ts

// ── isOverdue: strictly before midnight today
// Supports Firestore Timestamp, {seconds}, ISO string, Date-string
function isOverdue(next_date: any): boolean {
  if (!next_date) return false;
  let d: Date;
  if (typeof next_date === 'object' && typeof next_date.toDate === 'function') {
    d = next_date.toDate();
  } else if (typeof next_date === 'object' && next_date.seconds) {
    d = new Date(next_date.seconds * 1000);
  } else {
    d = new Date(next_date);
  }
  if (isNaN(d.getTime())) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d < today;
}

// ── isToday: date is within today's calendar day
function isToday(next_date: any): boolean {
  if (!next_date) return false;
  let d: Date;
  if (typeof next_date === 'object' && typeof next_date.toDate === 'function') {
    d = next_date.toDate();
  } else if (typeof next_date === 'object' && next_date.seconds) {
    d = new Date(next_date.seconds * 1000);
  } else {
    d = new Date(next_date);
  }
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

// ── safeLeadAge — days since creation, never NaN or negative
function safeLeadAge(createdAt: any): number {
  if (!createdAt) return 0;
  let date: Date;
  if (typeof createdAt === 'object' && typeof createdAt.toDate === 'function') {
    date = createdAt.toDate();
  } else if (typeof createdAt === 'object' && createdAt.seconds) {
    date = new Date(createdAt.seconds * 1000);
  } else {
    date = new Date(createdAt);
  }
  if (isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatCreatedDate(value: any): string {
  const date = toDateValue(value);
  if (!date) return '';
  return date.toLocaleDateString('en-GB');
}

function formatTime(value: any): string {
  const date = toDateValue(value);
  if (!date) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function daysAgoText(value: any): string {
  const date = toDateValue(value);
  if (!date) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(date); then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function recencyDotClass(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'bg-[var(--color-text-disabled)]';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const created = new Date(date); created.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86400000));
  if (days === 0) return 'bg-emerald-500';
  if (days <= 7) return 'bg-blue-500';
  if (days <= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function downloadLeadsCsv(rows: any[], filename: string) {
  const headers = ['Name','Phone','Email','City','State','Source','Status','Assigned To','Last Note','Created Date'];
  const lines = rows.map(l =>
    [
      l.name || '', l.phone || '', l.email || '', l.city || '', l.state || '',
      l.source || '', l.status || '',
      l.assignedToName || l.assigned_t || '',
      (l.last_note || '').replace(/"/g, '""'),
      fmtDate(l.createdAt) || '',
    ].map(v => `"${v}"`).join(',')
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Leads() {
  const qc       = useQueryClient();
  const user     = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const perms    = usePermissions();
  const navigate = useNavigate();
  const canEditPartner = perms.canEdit('partners');

  // ── Partner workflow mutations ────────────────────────────────
  const partnerDocMutation = useMutation({
    mutationFn: async ({ leadId, status, type }: { leadId: string; status: string; type: 'installation' | 'documentation' | 'commission' }) => {
      if (type === 'installation') await updatePartnerInstallationStatus(leadId, status as any);
      else if (type === 'documentation') await updatePartnerDocumentationStatus(leadId, status as any);
      else if (type === 'commission') await updatePartnerCommissionStatus(leadId, status as any);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Partner workflow updated');
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const notificationCompanyId = resolveNotificationCompanyId(activeCompanyId);
  const createParam = searchParams.get('create') || '';

  // ── Filters
  const [search,     setSearch]     = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [statusF,    setStatusF]    = useState(() => searchParams.get('status') || '');
  const [sourceF,    setSourceF]    = useState(() => searchParams.get('source') || '');
  const [assignF,    setAssignF]    = useState(() => searchParams.get('owner') || '');
  const [dateRange,  setDateRange]  = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo,   setCustomTo]   = useState(() => searchParams.get('to') || '');
  const [activeKpi,  setActiveKpi]  = useState(() => searchParams.get('kpi') || '');
  const [staleF,     setStaleF]     = useState(() => searchParams.get('stale') || '');     // '' | '7' | '14' | '30'
  const [overdueF,   setOverdueF]   = useState(() => searchParams.get('overdue') || '');     // '' | 'overdue'
  // Phase 4 (G12): partner drill-down — /leads?partnerId=... (linked from the
  // Partner workspace "View Leads"). Filters the list to one partner's leads
  // through the canonical partnerOwnership helper, mirroring the Partner
  // Portal's own My Leads surface.
  const [partnerF,   setPartnerF]   = useState(() => searchParams.get('partnerId') || '');

  // ── Table
  const [page,     setPage]     = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage,  setPerPage]  = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey,  setSortKey]  = useState('createdAt');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Lead form (create only — editing a lead happens exclusively inside
  // Lead Workspace, never from this list page; see workspace docs §4)
  const [showForm, setShowForm] = useState(false);
  // ── Contextual tutorial entry point (Learn this workspace)
  const [showTutorials, setShowTutorials] = useState(false);
  const [form,     setForm]     = useState({ ...FORM0 });

  // ── Delete
  const [delId,    setDelId]    = useState<string | null>(null);

  // ── Bulk operations
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkStatus,     setBulkStatus]     = useState('');
  const [bulkAssignId,   setBulkAssignId]   = useState('');
  const [bulkAssignName, setBulkAssignName] = useState('');
  function syncQueueParams(nextState: {
    q?: string;
    status?: string;
    source?: string;
    owner?: string;
    date?: string;
    from?: string;
    to?: string;
    kpi?: string;
    stale?: string;
    overdue?: string;
    partnerId?: string;
    page?: number;
    perPage?: number;
  }) {
    const next = new URLSearchParams(searchParams);
    const q = nextState.q ?? search;
    const status = nextState.status ?? statusF;
    const source = nextState.source ?? sourceF;
    const owner = nextState.owner ?? assignF;
    const date = nextState.date ?? dateRange;
    const from = nextState.from ?? customFrom;
    const to = nextState.to ?? customTo;
    const kpi = nextState.kpi ?? activeKpi;
    const stale = nextState.stale ?? staleF;
    const overdue = nextState.overdue ?? overdueF;
    const partnerId = nextState.partnerId ?? partnerF;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (status) next.set('status', status); else next.delete('status');
    if (source) next.set('source', source); else next.delete('source');
    if (owner) next.set('owner', owner); else next.delete('owner');
    if (date && date !== 'all') next.set('date', date); else next.delete('date');
    if (from) next.set('from', from); else next.delete('from');
    if (to) next.set('to', to); else next.delete('to');
    if (kpi) next.set('kpi', kpi); else next.delete('kpi');
    if (stale) next.set('stale', stale); else next.delete('stale');
    if (overdue) next.set('overdue', overdue); else next.delete('overdue');
    if (partnerId) next.set('partnerId', partnerId); else next.delete('partnerId');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== PER_PAGE) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    setSearchParams(next, { replace: true });
  }

  // ── CSV Import
  const [showCsvImport, setShowCsvImport] = useState(false);
  // Phase 13 (Blueprint §13): "show inactive" + restore for soft-deleted Leads
  const [showInactive, setShowInactive] = useState(false);
  const [csvPreview,    setCsvPreview]    = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Queries
  const { data: leads = [], isLoading, refetch, loadMore, hasMore, loadingMore } = useLeads();
  const { data: users = [] } = useQuery({
    queryKey: ['users'], queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 300000,
  });

  const salesUsers = useMemo(() =>
    (users as any[])
      .filter(u => ['Sales','Executive','BDE','BDM','Manager','TL'].includes(u.role) && u.status !== 'Inactive' && !u.isDeleted)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  // Creation is routed through the shared useSaveLead (also used by
  // MobileLeadWorkspace) rather than a separate desktop-only mutation, so
  // desktop-created leads get the same auto-assignment (getNextAssignee),
  // master-user linking (resolveOrCreateMasterUser), and caseId propagation
  // (createCaseForLead) that mobile-created leads always got — a prior
  // divergence where desktop, not mobile, was missing real business logic.
  const save = useSaveLead(null, (id: string) => {
    closeForm();
    if (id) navigate(`/leads/workspace/${encodeURIComponent(id)}`);
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await deleteProjectionWithEntity(COLLECTIONS.LEADS, id);
      await notifyRoleUsers(['Admin', 'Director'], NotificationType.LEAD_DELETED, 'Lead deleted', `Lead ${id} was deleted.`, 'lead', id, notificationCompanyId);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); toast.success('Deleted'); setDelId(null); setSelected(new Set()); },
  });

  const importCsvMutation = useMutation({
    mutationFn: async (parsedData: any[]) => {
      const existingPhones = new Set((leads as any[]).map((l: any) => l.phone));
      const invalid = parsedData.filter(r => !r.name || !r.phone).length;
      const duplicates = parsedData.filter(r => r.name && r.phone && existingPhones.has(r.phone)).length;
      const validRows = parsedData.filter(r => r.name && r.phone && !existingPhones.has(r.phone));
      const items = validRows.map(r => {
        const id = genId.lead();
        return { id, name: r.name, phone: r.phone, email: r.email || '', city: r.city || '', state: r.state || '', source: r.source || 'CSV Import', status: r.status || 'New', notes: r.notes || '', assignedToId: '', assignedToName: r.assignedto || '', activityLog: [{ id: genId.generic('LOG'), type: 'Creation', desc: 'Imported via CSV', date: new Date().toISOString(), userName: user.name }] };
      });
      if (items.length > 0) await batchCreateLeadProjections(items);
      return { total: parsedData.length, imported: items.length, duplicates, invalid };
    },
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['leads'] }); toast.success(`Imported ${res.imported} leads.${res.duplicates > 0 ? ` Skipped ${res.duplicates} duplicates.` : ''}`); setShowCsvImport(false); setCsvPreview([]); },
    onError: (e: any) => toast.error(e.message),
  });

  // Bulk status change
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map(id => updateProjectionWithEntity(COLLECTIONS.LEADS, id, { status, updatedBy: user.id })));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); toast.success(`Status updated for ${selected.size} leads`); setShowBulkStatus(false); setBulkStatus(''); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  // Bulk assign
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, userId, userName }: { ids: string[]; userId: string; userName: string }) => {
      await Promise.all(ids.map(id => updateProjectionWithEntity(COLLECTIONS.LEADS, id, { assignedToId: userId, assignedToName: userName, updatedBy: user.id })));
      await notifyUsersOnce(
        [{ id: userId }],
        NotificationType.LEAD_ASSIGNED,
        'Leads assigned',
        `${ids.length} lead${ids.length === 1 ? '' : 's'} were assigned to you.`,
        'lead',
        ids[0] || 'bulk',
        notificationCompanyId
      );
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); toast.success(`Assigned ${selected.size} leads to ${bulkAssignName}`); setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (createParam !== '1') return;
    setForm({ ...FORM0 });
    setShowForm(true);
  }, [createParam]);

  // Phase 4 (G12): keep the partner drill-down in sync with the URL — a
  // browser back/forward or an in-app link to a different ?partnerId= while
  // the page is mounted must update the filter, not just on first mount.
  const urlPartnerId = searchParams.get('partnerId') || '';
  useEffect(() => {
    setPartnerF(urlPartnerId);
  }, [urlPartnerId]);

  function closeForm() {
    setShowForm(false);
    setForm({ ...FORM0 });
    if (createParam === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    if (!form.name || !form.phone) return toast.error('Name & phone required');
    save.mutate(form);
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const parsed = parseCSV(evt.target?.result as string);
      if (parsed.length > 0) setCsvPreview(parsed.slice(0, 5));
      else toast.error('Empty or invalid CSV file');
    };
    reader.readAsText(file);
  }

  function exportSelected() {
    const rows = (leads as any[]).filter(l => selected.has(l.id));
    if (!rows.length) return toast.error('No leads selected');
    downloadLeadsCsv(rows, `leads-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} lead${rows.length > 1 ? 's' : ''}`);
  }

  // ── Filtering + sorting ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...(leads as any[])];

    // KPI / overdue quick filter
    if (activeKpi === 'overdue' || overdueF === 'overdue') {
      list = list.filter(l => isOverdue(l.next_date) && l.status !== 'Converted');
    } else if (activeKpi) {
      list = list.filter(l => l.status?.toLowerCase() === activeKpi.toLowerCase());
    }

    // Search
    const q = deferredSearch.toLowerCase();
    if (q) list = list.filter(l => [l.name, l.phone, l.city, l.email].some((v: any) => String(v || '').toLowerCase().includes(q)));

    // Status / source / assign
    if (statusF)   list = list.filter(l => l.status === statusF);
    if (sourceF)   list = list.filter(l => l.source === sourceF);
    if (assignF)   list = list.filter(l => l.assignedToId === assignF || l.assignedToName === assignF || l.assigned_t === assignF);

    // Phase 4 (G12): partner drill-down via the canonical ownership filter —
    // same contract as the Partner Portal's own lead surfaces.
    if (partnerF) list = filterPartnerOwnedLeads(list, partnerF);

    // Stale filter: leads with no activity for N days
    if (staleF) {
      const staleDays = Number(staleF);
      list = list.filter(l => safeLeadAge(l.createdAt) >= staleDays && l.status !== 'Converted' && l.status !== 'Lost');
    }

    // Date range (on createdAt)
    if (dateRange !== 'all') list = list.filter(l => isInDateRange(l.createdAt, dateRange as any, customFrom, customTo));

    // Sort
    list.sort((a, b) => {
      const cmp = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''));
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [leads, deferredSearch, statusF, sourceF, assignF, dateRange, customFrom, customTo, activeKpi, staleF, overdueF, partnerF, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const stats = useMemo(() => ({
    total:     (leads as any[]).length,
    new:       (leads as any[]).filter((l: any) => l.status === 'New').length,
    followup:  (leads as any[]).filter((l: any) => l.status === 'Follow-up').length,
    converted: (leads as any[]).filter((l: any) => l.status === 'Converted').length,
    lost:      (leads as any[]).filter((l: any) => l.status === 'Lost').length,
    overdue:   (leads as any[]).filter((l: any) => isOverdue(l.next_date) && l.status !== 'Converted').length,
  }), [leads]);

  // Total KPI active by default when no filters/search/KPI are set
  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && !statusF && !sourceF && !assignF && dateRange === 'all' && !staleF && !overdueF && !partnerF;
  }, [activeKpi, search, statusF, sourceF, assignF, dateRange, staleF, overdueF, partnerF]);

  // Active filter count for Clear All display
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusF) count++;
    if (sourceF) count++;
    if (assignF) count++;
    if (dateRange !== 'all') count++;
    if (activeKpi) count++;
    if (staleF) count++;
    if (overdueF) count++;
    if (partnerF) count++;
    return count;
  }, [search, statusF, sourceF, assignF, dateRange, activeKpi, staleF, overdueF, partnerF]);

  const toggleSelect = useCallback((id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const toggleAll = () =>
    setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map((l: any) => l.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, lead: any) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    navigate(`/leads/workspace/${encodeURIComponent(lead.id)}`);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, lead: any) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    navigate(`/leads/workspace/${encodeURIComponent(lead.id)}`);
  }

  function sort(k: string) {
    if (sortKey === k) { setSortDesc(d => !d); } else { setSortKey(k); setSortDesc(true); }
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setSourceF(''); setAssignF('');
    setDateRange('all'); setCustomFrom(''); setCustomTo('');
    setActiveKpi(''); setStaleF(''); setOverdueF(''); setPartnerF(''); setPage(1);
    syncQueueParams({ q: '', status: '', source: '', owner: '', date: 'all', from: '', to: '', kpi: '', stale: '', overdue: '', page: 1, partnerId: '' });
  }

  const assignOptions = [{ label: 'All Assigned', value: '' }, ...salesUsers.map(u => ({ label: u.name, value: u.id }))];

    const leadScores = useMemo(() => {
    const map = new Map<string, { score: number; band: string; confidence: string }>();
    for (const lead of (leads as any[]) || []) {
      try {
        const result = scoreLead({
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          city: lead.city,
          state: lead.state,
          company: lead.company,
          source: lead.source,
          status: lead.status,
          notes: lead.notes,
          capacityKw: lead.capacityKw || lead.expectedCapacityKw,
          createdAt: lead.createdAt,
          updatedAt: lead.updatedAt,
          next_date: lead.next_date,
          followupCount: lead.followupCount || 0,
          hasQuotation: !!(lead.hasQuotation || lead.linkedQuotationId),
          hasSurvey: !!(lead.hasSurvey || lead.surveyRequested),
        });
        map.set(lead.id, { score: result.score, band: result.band, confidence: result.confidence });
      } catch {
        // Skip scoring for malformed leads
      }
    }
    return map;
  }, [leads]);

  function scoreBadge(score: { score: number; band: string } | undefined) {
    if (!score) return <span className="text-[10px] text-[var(--color-text-disabled)]">—</span>;
    const colors: Record<string, string> = {
      hot: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700',
      warm: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-amber-200 dark:border-amber-700',
      cold: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700',
    };
    return (
      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-tight ${colors[score.band] || colors.cold}`} title={`Score: ${score.score}/100 · ${score.band}`}>
        {score.band === 'hot' ? '🔥 ' : score.band === 'warm' ? '⚡ ' : ''}{score.score}
      </span>
    );
  }

  function sourceBadge(source: string | undefined | null) {
    if (!source) return <EmptyCell />;
    const colors: Record<string, string> = {
      Website: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
      Campaign: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200 dark:border-blue-700',
      Partner: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400 border-purple-200 dark:border-purple-700',
      'Walk-in': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700',
    };
    return (
      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-tight ${colors[source] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700'}`}>
        {source}
      </span>
    );
  }

  const KPI_TILES = [
    { label: 'TOTAL',     value: stats.total,     key: '',        icon: <Target className="h-4 w-4" />,       description: `${stats.total} total leads` },
    { label: 'NEW',       value: stats.new,        key: 'New',     icon: <User className="h-4 w-4" />,        description: 'New unprocessed leads' },
    { label: 'FOLLOW-UP', value: stats.followup,   key: 'Follow-up', icon: <RefreshCw className="h-4 w-4" />, description: 'Pending follow-up' },
    { label: 'CONVERTED', value: stats.converted,  key: 'Converted', icon: <Handshake className="h-4 w-4" />, description: 'Successfully converted' },
    { label: 'LOST',      value: stats.lost,       key: 'Lost',    icon: <AlertTriangle className="h-4 w-4" />, description: 'Lost opportunities' },
    { label: 'OVERDUE',   value: stats.overdue,    key: 'overdue', icon: <Calendar className="h-4 w-4" />,    description: 'Follow-up overdue' },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // ── Date options ──────────────────────────────────────────────
  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: 'week' },
    { label: 'Last 30 days', value: 'month' },
    { label: 'Custom', value: 'custom' },
  ];
  function handleDateChange(newDateRange: string) {
    setDateRange(newDateRange);
    setPage(1);
    if (newDateRange !== 'custom') {
      setCustomFrom('');
      setCustomTo('');
    }
    syncQueueParams({ date: newDateRange, from: '', to: '', page: 1 });
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Premium Workspace Hero ─────────────────────────── */}
      <WorkspaceHero
        title="Leads"
        icon={<Target className="h-6 w-6" />}
        breadcrumbs={['Home', 'Sales', 'Leads']}
        statusText="Last sync · Realtime Connected"
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<UploadCloud className="h-3.5 w-3.5" />} onClick={() => setShowCsvImport(true)}>
              Upload CSV
            </Button>
            <Button variant="outline" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => setShowInactive(true)}>
              Show Inactive
            </Button>
            <Button variant="outline" size="sm" icon={<GraduationCap className="h-3.5 w-3.5" />} onClick={() => setShowTutorials(true)}>
              Learn this workspace
            </Button>
            {perms.canCreate('leads') && (
              <Button size="sm" data-tour="leads-create" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...FORM0 }); setShowForm(true); }}>
                Add Lead
              </Button>
            )}
          </>
        }
      />

      {/* ── Premium Clickable KPI Cards ────────────────────── */}
      {/* data-tour targets: "leads-kpi" (tour) and "leads-kpi-overdue" (follow-up task) */}
      <div data-tour="leads-kpi" className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map(k => {
          const tile = (
            <PremiumKpi
              key={k.key}
              label={k.label}
              value={k.value}
              icon={k.icon}
              description={k.description}
              onClick={() => {
                const nextKpi = activeKpi === k.key ? '' : k.key;
                setActiveKpi(nextKpi);
                setPage(1);
                syncQueueParams({ kpi: nextKpi, page: 1 });
              }}
              active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            />
          );
          // `display: contents` keeps the grid layout intact while exposing a
          // stable tutorial target for the Overdue card.
          return k.key === 'overdue'
            ? <div key={k.key} data-tour="leads-kpi-overdue" className="contents">{tile}</div>
            : tile;
        })}
      </div>

      {/* ── Premium Elevated Table Card ────────────────────── */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] border-[var(--color-border)]">
        {/* ── Card Header with Register Title + Active Filter Pills */}
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              aria-label="Search leads"
              data-tour="leads-search"
              placeholder="Search name, phone, city, email..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            <div data-tour="leads-filters" className="flex items-center gap-2 flex-wrap">
            <Select
              aria-label="Date"
              value={dateRange}
              options={DATE_OPTIONS}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-[110px] h-8 py-1"
            />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, to: customTo, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, from: customFrom, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
              </div>
            )}
            <Select
              aria-label="Status"
              data-tour="leads-filter-status"
              value={statusF}
              onChange={(e) => {
                const v = e.target.value;
                setStatusF(v);
                if (v && activeKpi && v !== activeKpi) {
                  setActiveKpi('');
                  setPage(1);
                  syncQueueParams({ status: v, kpi: '', page: 1 });
                } else {
                  setPage(1);
                  syncQueueParams({ status: v, page: 1 });
                }
              }}
              options={[{ label: 'All Status', value: '' }, ...LEAD_STATUSES.map(s => ({ label: s, value: s }))]}
              className="w-[110px] h-8 py-1"
            />
            <Select
              aria-label="Source"
              value={sourceF}
              onChange={(e) => { setSourceF(e.target.value); setPage(1); syncQueueParams({ source: e.target.value, page: 1 }); }}
              options={[{ label: 'All Sources', value: '' }, ...LEAD_SOURCES.map(s => ({ label: s, value: s }))]}
              className="w-[110px] h-8 py-1"
            />
            <Select
              aria-label="Assigned"
              value={assignF}
              onChange={(e) => { setAssignF(e.target.value); setPage(1); syncQueueParams({ owner: e.target.value, page: 1 }); }}
              options={assignOptions}
              className="w-[120px] h-8 py-1"
            />
            </div>
            {/* Active filter pills + Clear All */}
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">
                    {KPI_TILES.find(t => t.key === activeKpi)?.label || activeKpi}
                    <button type="button" onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }} className="ml-0.5 hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                  </span>
                )}
                {search && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">S: {search.slice(0, 12)}{search.length > 12 ? '…' : ''}</span>
                )}
                {statusF && !activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{statusF}</span>
                )}
                {sourceF && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{sourceF}</span>
                )}
                {partnerF && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 px-1.5 py-0.5 text-[10px] font-semibold">
                    Partner: {(leads as any[]).find(l => l.partnerId === partnerF)?.partnerName || partnerF}
                    <button type="button" onClick={() => { setPartnerF(''); setPage(1); syncQueueParams({ partnerId: '', page: 1 }); }} className="ml-0.5 hover:opacity-70" aria-label="Clear partner filter"><X className="h-2.5 w-2.5" /></button>
                  </span>
                )}
                <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors">
                  <X className="h-2.5 w-2.5" />
                  Clear
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
              
            </div>
          </div>
        </CardHeader>

        {/* ── Bulk action bar */}
        {selected.size > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">
              {selected.size} lead{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">
                Export CSV
              </Button>
              {perms.canEdit('leads') && (
                <Button size="sm" variant="outline"
                  icon={<ListChecks className="h-3.5 w-3.5" />}
                  onClick={() => setShowBulkStatus(true)}
                  className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">
                  Change Status
                </Button>
              )}
              {perms.canEdit('leads') && (
                <Button size="sm" variant="outline"
                  icon={<Users className="h-3.5 w-3.5" />}
                  onClick={() => setShowBulkAssign(true)}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">
                  Assign
                </Button>
              )}
              {perms.canDelete('leads') && (
                <Button size="sm" variant="outline"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setDelId('__bulk__')}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">
                  Delete
                </Button>
              )}
              <button onClick={() => setSelected(new Set())}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1">
                ✕ Clear
              </button>
            </div>
          </div>
        )}

        {/* ── Filter + Table Area + Pagination (unified) */}
        <div className="px-6 flex-1 flex flex-col min-h-0">
          {/* ── Premium Universal Table ──────────────────────── */}
          <div data-tour="leads-table" className="min-h-0 flex-1 overflow-auto scroll-pt-10">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible leads" />
                </Th>
                <Th sortable sorted={sortKey === 'name'} desc={sortDesc} onSort={() => sort('name')} style={{ width: '25%', minWidth: 200 }}>NAME</Th>
                <Th style={{ width: 120, minWidth: 120 }}>PHONE</Th>
                <Th style={{ width: 100, minWidth: 100 }}>SOURCE</Th>
                <Th className="hidden md:table-cell" style={{ width: 80, minWidth: 80 }}>SCORE</Th>
                <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')} style={{ width: 110, minWidth: 110 }}>STATUS</Th>
                <Th style={{ width: '12%', minWidth: 130 }}>ASSIGNED</Th>
                <Th sortable sorted={sortKey === 'next_date'} desc={sortDesc} onSort={() => sort('next_date')} className="hidden md:table-cell" style={{ width: '10%', minWidth: 110 }}>NEXT FOLLOW-UP</Th>
                <Th style={{ width: '12%', minWidth: 130 }}>LAST NOTE</Th>
                <Th sortable sorted={sortKey === 'createdAt'} desc={sortDesc} onSort={() => sort('createdAt')} style={{ width: 90, minWidth: 90 }}>CREATED</Th>
                <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading
                  ? <SkeletonRows cols={11} />
                  : paginated.length === 0
                    ? (
                      <tr>
                        <td colSpan={11} className="py-14 text-center">
                          <EmptyState
                            icon={<Target className="h-9 w-9" />}
                            title={search || statusF || sourceF || overdueF || staleF || partnerF ? 'No leads match filters' : 'No leads yet'}
                            description={search || statusF || sourceF || overdueF || staleF || partnerF ? undefined : 'Add your first lead to get started.'}
                            action={!search && !statusF && !sourceF && !overdueF && !staleF && !partnerF && perms.canCreate('leads') ? (
                              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...FORM0 }); setShowForm(true); }} className="mt-2">Add Your First Lead</Button>
                            ) : undefined}
                          />
                        </td>
                      </tr>
                    )
                    : paginated.map((l: any) => {
                      const overdue = isOverdue(l.next_date) && l.status !== 'Converted';
                      const assignedName = l.assignedToName || l.assigned_t || 'Unassigned';
                      return (
                        <Tr key={l.id} selected={selected.has(l.id)}
                          data-record-id={l.id}
                          data-tour="leads-row"
                          role="button"
                          tabIndex={0}
                          onClick={(e) => handleRowClick(e, l)}
                          onKeyDown={(e) => handleRowKeyDown(e, l)}
                          className={`transition-colors duration-150 ${overdue ? 'bg-[rgba(239,68,68,0.04)] border-l-[3px] border-l-[var(--color-danger)]' : ''}`}
                        >
                          {/* Checkbox */}
                          <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                            <UniversalCheckbox checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} ariaLabel={`Select ${l.name}`} />
                          </Td>

                          {/* Name + Avatar */}
                          <Td className="py-3 min-w-[200px]">
                            <div className="flex items-center gap-2.5">
                              <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                                {(l.name || '?')[0].toUpperCase()}
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{l.name || '—'}</span>
                                  {overdue && <span title="Follow-up overdue"><AlertTriangle className="h-3 w-3 shrink-0 text-[var(--color-danger)]" /></span>}
                                </div>
                                <span className="text-[12px] text-[var(--color-text-muted)] leading-tight">{l.city || <EmptyCell />}</span>
                              </div>
                            </div>
                          </Td>

                          {/* Phone */}
                          <Td className="py-3">
                            {l.phone ? (
                              <a href={`tel:${l.phone}`} title="Call" data-interactive
                                onClick={(e) => e.stopPropagation()}
                                className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-1 text-[13px] font-medium">
                                <Phone className="h-3 w-3" />{l.phone}
                              </a>
                            ) : <EmptyCell />}
                          </Td>

                          {/* Source — themed badge */}
                          <Td className="py-3">{sourceBadge(l.source)}</Td>

                          {/* Score */}
                          <Td className="hidden md:table-cell py-3">{scoreBadge(leadScores.get(l.id))}</Td>

                          {/* Status */}
                          <Td className="py-3"><span data-interactive onClick={(e) => e.stopPropagation()}>{statusBadge(l.status || 'New')}</span></Td>

                          {/* Assigned To */}
                          <Td className="py-3 whitespace-nowrap">
                            {assignedName === 'Unassigned' ? (
                              <span className="inline-flex items-center rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">Unassigned</span>
                            ) : (
                              <span className="text-[13px] text-[var(--color-text-secondary)]">{assignedName}</span>
                            )}
                          </Td>

                          {/* Next Follow-up */}
                          <Td className="hidden md:table-cell py-3">
                            <FollowupBadge next_date={l.next_date} isOverdue={isOverdue} isToday={isToday} />
                          </Td>

                          {/* Last Note — max 2 lines with ellipsis */}
                          <Td className="py-3 max-w-[140px]">
                            {l.last_note ? (
                              <span className="text-[13px] text-[var(--color-text-muted)] line-clamp-2 leading-snug">{l.last_note}</span>
                            ) : (
                              <EmptyCell />
                            )}
                          </Td>

                          {/* Created */}
                          <Td className="py-3">
                            <CreatedDateCell value={l.createdAt} formatCreatedDate={formatCreatedDate} recencyDotClass={recencyDotClass} />
                          </Td>

                          {/* Actions: row click also opens the Workspace; View is an explicit
                              shortcut to the same place. Editing a lead — fields, documents,
                              status, assignment, everything — happens exclusively inside Lead
                              Workspace, never from this list page. Deleting a lead happens via
                              bulk actions (row-selection checkboxes), not per-row here. */}
                          <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="xs"
                                variant="outline"
                                data-tour="leads-row-view"
                                onClick={() => navigate(`/leads/workspace/${encodeURIComponent(l.id)}`)}
                                className="shrink-0"
                              >
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                View
                              </Button>
                            </div>
                          </Td>
                        </Tr>
                      );
                    })
                }
              </Tbody>
            </Table>
          </div>
          {/* ── Premium Pagination (inside table block) ────── */}
          <div data-tour="leads-pagination" className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination
            page={page}
            total={filtered.length}
            perPage={perPage}
            onChange={nextPage => { setPage(nextPage); syncQueueParams({ page: nextPage }); }}
            onPerPageChange={n => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }}
          />
          {hasMore && <div className="pt-2 text-right"><Button variant="outline" size="sm" onClick={() => loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading...' : 'Load More'}</Button></div>}
          </div>
        </div>
      </Card>

      <LeadWorkspaceDialogs
        ctx={{
          showForm,
          closeForm,
          form,
          setForm,
          save,
          salesUsers,
          showCsvImport,
          setShowCsvImport,
          importCsvMutation,
          importResult: importCsvMutation.data || null,
          showBulkStatus,
          setShowBulkStatus,
          bulkStatus,
          setBulkStatus,
          bulkStatusMutation,
          selected,
          showBulkAssign,
          setShowBulkAssign,
          bulkAssignId,
          setBulkAssignId,
          bulkAssignName,
          setBulkAssignName,
          bulkAssignMutation,
          LEAD_SOURCES,
          LEAD_STATUSES,
          toast,
          handleSubmit,
        }}
      />

      <ConfirmDialog
        open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId === '__bulk__') {
            // Bulk delete
            Promise.all(Array.from(selected).map(id => del.mutateAsync(id)))
              .then(() => {
                setSelected(new Set());
                setDelId(null);
              })
              .catch(() => {});
          } else if (delId) {
            del.mutate(delId);
          }
        }}
        loading={del.isPending} title="Delete Lead"
        message={delId === '__bulk__' ? `Delete ${selected.size} selected leads permanently? All logs will be lost.` : 'Delete this lead permanently? All logs will be lost.'}
      />

      <InactiveRecordsModal
        open={showInactive}
        onClose={() => setShowInactive(false)}
        col={COLLECTIONS.LEADS}
        title="Inactive Leads"
        getLabel={(row: any) => row.name || row.phone || row.id}
        getSubtitle={(row: any) => row.phone || row.email || ''}
        onRestored={() => refetch()}
      />

      <TutorialCenter open={showTutorials} onClose={() => setShowTutorials(false)} initialCategory="sales" />
    </div>
  );
}
