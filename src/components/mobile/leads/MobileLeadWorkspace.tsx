import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Calendar,
  CornerUpRight,
  Download,
  Edit2,
  File,
  FileText,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Target,
  Trash2,
  UserCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import { scoreLead } from '../../../lib/leadScoring';
import { LEAD_FORM_DEFAULT, type LeadForm, SOURCE_OPTIONS, STATUS_OPTIONS, useDeleteLead, useLeads, useSaveLead } from '../../../features/leads/hooks/useLeads';
import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, fmtDate, genId, getAll, toInputDate } from '../../../lib/firestore';
import { updateProjectionWithEntity } from '../../../lib/entityProjection';
import { convertLeadToCustomer } from '../../../lib/leadWorkflow';
import { logActivity } from '../../../lib/workflow';
import { notifyUsersOnce, resolveNotificationCompanyId, sendNotification } from '../../../lib/notifications';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { resolveBusinessMode } from '../../../lib/companyBusinessMode';
import { getAllowedCustomerTypesForBusinessMode } from '../../../lib/customerClassification';

import { NotificationType } from '../../../types';
import { DocumentViewer, useDocumentViewer, formatFileSize } from '../../shared';
import type { DocumentViewerFile } from '../../shared';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';
const DATE_OPTIONS = [
  { label: 'All dates', value: 'all' },
  { label: 'Follow-up today', value: 'today' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'No follow-up', value: 'none' },
];

function scoreBadge(score: { score: number; band: string } | undefined) {
  if (!score) return null;
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

type Lead = Record<string, any> & { id: string };
type Mode = 'records' | 'create';
type LeadFilters = {
  search: string;
  status: string;
  source: string;
  date: string;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOverdue(lead: Lead): boolean {
  const date = toDate(lead.next_date);
  if (!date || lead.status === 'Converted') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function isToday(value: any): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function leadTitle(lead: Lead) {
  return lead.name || lead.company || 'Untitled Lead';
}

function phoneHref(phone?: string) {
  return phone ? `tel:${phone}` : undefined;
}

function whatsappHref(phone?: string) {
  const clean = String(phone || '').replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : undefined;
}

function filterLeads(leads: Lead[], filters: LeadFilters) {
  const term = filters.search.trim().toLowerCase();
  return leads
    .filter((lead) => {
      if (filters.status !== ALL && lead.status !== filters.status) return false;
      if (filters.source !== ALL && lead.source !== filters.source) return false;
      if (filters.date === 'today' && !isToday(lead.next_date)) return false;
      if (filters.date === 'overdue' && !isOverdue(lead)) return false;
      if (filters.date === 'none' && lead.next_date) return false;
      if (!term) return true;
      return [lead.name, lead.company, lead.phone, lead.email, lead.city, lead.state, lead.source, lead.assignedToName]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
}

function downloadLeadsCsv(rows: Lead[], filename: string) {
  const headers = ['Name', 'Company', 'Phone', 'Email', 'City', 'State', 'Source', 'Status', 'Assigned To', 'Next Follow-up'];
  const lines = rows.map((lead) =>
    [
      lead.name || '',
      lead.company || '',
      lead.phone || '',
      lead.email || '',
      lead.city || '',
      lead.state || '',
      lead.source || '',
      lead.status || '',
      lead.assignedToName || lead.assigned_t || '',
      fmtDate(lead.next_date) || '',
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function MobileLeadWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const notificationCompanyId = resolveNotificationCompanyId(activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const { data: leads = [], isLoading, error } = useLeads();
  const deleteLead = useDeleteLead();
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300000,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [form, setForm] = useState<LeadForm>({ ...LEAD_FORM_DEFAULT });
  const [viewLead, setViewLead] = useState<Lead | null>(null);
  const openId = params.get('open') || '';
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [followupLead, setFollowupLead] = useState<Lead | null>(null);
  const [followupNote, setFollowupNote] = useState('');
  const [followupDate, setFollowupDate] = useState('');
  const [transferLead, setTransferLead] = useState<Lead | null>(null);
  const [transferUserId, setTransferUserId] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [convertLead, setConvertLead] = useState<Lead | null>(null);
  const [convertType, setConvertType] = useState<'B2B' | 'B2C'>('B2B');
  // Phase 2: Company Business Mode constrains which type(s) a Lead may convert to.
  const businessMode = resolveBusinessMode(useAppStore((state) => state.company));
  const allowedConvertTypes = useMemo(() => getAllowedCustomerTypesForBusinessMode(businessMode), [businessMode]);
  useEffect(() => {
    if (!allowedConvertTypes.includes(convertType)) setConvertType(allowedConvertTypes[0]);
  }, [allowedConvertTypes, convertType]);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const createParam = params.get('create');

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setEditingLead(null);
    setForm({ ...LEAD_FORM_DEFAULT });
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  const salesUsers = useMemo(
    () => (users as any[])
      .filter((entry) => ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL'].includes(entry.role) && entry.status !== 'Inactive' && !entry.isDeleted)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [users],
  );

  const filters = useMemo<LeadFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    source: params.get('source') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const filteredLeads = useMemo(() => filterLeads(leads as Lead[], filters), [leads, filters]);
  const paginatedLeads = useMemo(() => filteredLeads.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredLeads, page]);
  const selectedRows = useMemo(() => (leads as Lead[]).filter((lead) => selected.has(lead.id)), [leads, selected]);
  const canEdit = perms.canEdit('leads');
  const canDelete = perms.canDelete('leads');

  const leadScores = useMemo(() => {
    const map = new Map<string, { score: number; band: string }>();
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
        map.set(lead.id, { score: result.score, band: result.band });
      } catch {
        // Skip scoring for malformed leads
      }
    }
    return map;
  }, [leads]);

  // Guards against race condition: when user closes the detail modal, this ref
  // prevents the URL-sync useEffect from immediately reopening it. Only reset
  // by openMobileDetail (intentional open) or consumed by useEffect itself.
  const userClosedRef = useRef(false);
  const reopenLeadIdRef = useRef<string | null>(null);

  const saveLead = useSaveLead(editingLead?.id || null, () => {
    setFormOpen(false);
    if (editingLead?.id) reopenLeadIdRef.current = editingLead.id;
    setEditingLead(null);
    setForm({ ...LEAD_FORM_DEFAULT });
    setDirty(false);
    void qc.invalidateQueries({ queryKey: keys.leadsRoot });
  });

  // IMP-09: Reopen detail after save — fires only when saveLead explicitly sets reopenLeadIdRef.
  // Does NOT check userClosedRef because the reopen is intentional (triggered by save callback),
  // not driven by URL params. The reopenLeadIdRef itself is the guard — it's only ever
  // populated by the saveLead onSuccess callback.
  useEffect(() => {
    if (!reopenLeadIdRef.current) return;
    const updated = (leads as Lead[]).find((l) => l.id === reopenLeadIdRef.current);
    if (updated) {
      reopenLeadIdRef.current = null;
      openMobileDetail(updated);
    }
  }, [leads]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredLeads.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredLeads.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((leads as Lead[]).map((lead) => lead.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [leads]);

  // Sync viewLead with URL 'open' param (IMP-07)
  // Guarded by userClosedRef: if the user just closed the modal, bail out
  // immediately regardless of openId. This prevents a race condition where
  // setParams (inside closeMobileDetail) hasn't updated openId yet but
  // viewLead is null, causing the effect to reopen the modal.
  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false; // Consume the guard
      return;
    }
    if (!openId || isLoading) return;
    const target = (leads as Lead[]).find((lead) => lead.id === openId);
    if (target && !viewLead) {
      setViewLead(target);
    }
  }, [openId, isLoading, leads, viewLead]);

  function openMobileDetail(lead: Lead) {
    userClosedRef.current = false; // Intentional open — reset guard
    setViewLead(lead);
    const next = new URLSearchParams(params);
    next.set('open', lead.id);
    setParams(next, { replace: true });
  }

  function closeMobileDetail() {
    userClosedRef.current = true; // User closed — prevent URL-driven reopen
    setViewLead(null);
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

  function openEdit(lead: Lead) {
    setEditingLead(lead);
    setForm({
      name: lead.name || '',
      phone: lead.phone || '',
      email: lead.email || '',
      city: lead.city || '',
      state: lead.state || '',
      source: lead.source || 'Website',
      status: lead.status || 'New',
      assignedToId: lead.assignedToId || '',
      assignedToName: lead.assignedToName || lead.assigned_t || '',
      notes: lead.notes || '',
      next_date: toInputDate(lead.next_date),
    });
    setDirty(false);
    setFormOpen(true);
  }

  function requestCloseForm() {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    closeForm();
  }

  function closeForm() {
    setFormOpen(false);
    setEditingLead(null);
    setForm({ ...LEAD_FORM_DEFAULT });
    setDirty(false);
    if (mode === 'create') {
      navigate('/app', { replace: true });
      return;
    }
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function updateForm(patch: Partial<LeadForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function submitLead(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name && !form.phone) return toast.error('Lead name or phone is required');
    saveLead.mutate(form);
  }

  const addFollowup = useMutation({
    mutationFn: async ({ lead, note, next }: { lead: Lead; note: string; next: string }) => {
      await createDocWithId(COLLECTIONS.FOLLOWUPS, genId.generic('FU'), { leadId: lead.id, note, next_date: next });
      const logEntry = { id: genId.generic('LOG'), type: 'Follow-up', desc: note, date: new Date().toISOString(), userName: user.name };
      await updateProjectionWithEntity(COLLECTIONS.LEADS, lead.id, {
        status: 'Follow-up',
        next_date: next,
        last_note: note,
        activityLog: [...(lead.activityLog || []), logEntry],
        updatedBy: user.id,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.leadsRoot });
      toast.success('Follow-up added');
      setFollowupLead(null);
      setFollowupNote('');
      setFollowupDate('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const transferMutation = useMutation({
    mutationFn: async ({ lead, newUserId, newUserName, note }: { lead: Lead; newUserId: string; newUserName: string; note: string }) => {
      const logEntry = { id: genId.generic('LOG'), type: 'Transfer', desc: `Transferred to ${newUserName}. Note: ${note}`, date: new Date().toISOString(), userName: user.name };
      const historyEntry = { fromUserId: user.id, fromUserName: user.name, toUserId: newUserId, toUserName: newUserName, note, transferredAt: new Date().toISOString() };
      await updateProjectionWithEntity(COLLECTIONS.LEADS, lead.id, {
        assignedToId: newUserId,
        assignedToName: newUserName,
        activityLog: [...(lead.activityLog || []), logEntry],
        transferHistory: [...(lead.transferHistory || []), historyEntry],
        updatedBy: user.id,
      });
      await logActivity('Leads', 'Transferred Lead', lead.id, {
        toUser: newUserName,
        note,
        entityName: leadTitle(lead),
        actionLabel: `Transferred lead to ${newUserName}`,
      });
      await sendNotification(newUserId, NotificationType.LEAD_ASSIGNED, 'Lead transferred', `Lead ${leadTitle(lead)} was transferred to you.`, 'lead', lead.id, notificationCompanyId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.leadsRoot });
      toast.success('Lead transferred');
      setTransferLead(null);
      setTransferUserId('');
      setTransferNote('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const convertMutation = useMutation({
    mutationFn: async ({ lead, type }: { lead: Lead; type: 'B2B' | 'B2C' }) => convertLeadToCustomer(lead, type),
    onSuccess: (customerId) => {
      void qc.invalidateQueries({ queryKey: keys.leadsRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).customersRoot });
      toast.success(`Lead converted to ${convertType} customer`);
      setConvertLead(null);
      if (customerId) navigate(`/customers?open=${encodeURIComponent(String(customerId))}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map((id) => updateProjectionWithEntity(COLLECTIONS.LEADS, id, { status, updatedBy: user.id })));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.leadsRoot });
      toast.success(`Updated ${selected.size} lead${selected.size > 1 ? 's' : ''}`);
      setSelected(new Set());
      setBulkStatus('');
      setBulkStatusOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, assigneeId, assigneeName }: { ids: string[]; assigneeId: string; assigneeName: string }) => {
      await Promise.all(ids.map((id) => updateProjectionWithEntity(COLLECTIONS.LEADS, id, { assignedToId: assigneeId, assignedToName: assigneeName, updatedBy: user.id })));
      await notifyUsersOnce([{ id: assigneeId }], NotificationType.LEAD_ASSIGNED, 'Leads assigned', `${ids.length} lead${ids.length === 1 ? '' : 's'} were assigned to you.`, 'lead', ids[0] || 'bulk', notificationCompanyId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.leadsRoot });
      toast.success(`Assigned ${selected.size} lead${selected.size > 1 ? 's' : ''}`);
      setSelected(new Set());
      setBulkAssignId('');
      setBulkAssignOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  function exportRows(rows: Lead[]) {
    if (!rows.length) return toast.error('No leads selected');
    downloadLeadsCsv(rows, `leads-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} lead${rows.length > 1 ? 's' : ''}`);
  }

  async function deleteSelected() {
    await Promise.all(selectedRows.map((lead) => deleteLead.mutateAsync(lead.id)));
    setSelected(new Set());
    setDeleteOpen(false);
  }

  if (mode === 'create') {
    return (
      <LeadDialogs
        formOpen={formOpen}
        form={form}
        editingLead={editingLead}
        salesUsers={salesUsers}
        saving={saveLead.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => {
          setConfirmClose(false);
          closeForm();
        }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitLead}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 data-tour="mobile-leads-header" className="text-xl font-bold text-[var(--color-text)]">Leads</h1>
      </div>

      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>Export</Button>
            {canEdit && <Button size="xs" variant="outline" icon={<UserCheck className="h-3 w-3" />} onClick={() => setBulkAssignOpen(true)}>Assign</Button>}
            {canEdit && <Button size="xs" variant="outline" onClick={() => setBulkStatusOpen(true)}>Status</Button>}
            {canDelete && <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Clear</button>
          </div>
        </Card>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
          {(error as Error).message}
        </div>
      )}

      <div className="space-y-3" data-tour="leads-table">
        {isLoading && Array.from({ length: 5 }).map((_, index) => <LeadSkeletonCard key={index} />)}
        {!isLoading && filteredLeads.length === 0 && (
          <Card className="rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
            <Target className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
            <p className="mt-2">
              {filters.search || filters.status !== ALL || filters.source !== ALL || filters.date !== 'all'
                ? 'No leads match the current filters.'
                : 'No leads yet. Create your first lead!'}
            </p>
            {!filters.search && filters.status === ALL && filters.source === ALL && filters.date === 'all' && canEdit && (
              <Button
                size="sm"
                data-tour="leads-create"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => { setEditingLead(null); setForm({ ...LEAD_FORM_DEFAULT }); setDirty(false); setFormOpen(true); }}
                className="mt-3"
              >
                Create Your First Lead
              </Button>
            )}
          </Card>
        )}
        {!isLoading && paginatedLeads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            selected={selected.has(lead.id)}
            onSelect={() => toggleSelect(lead.id)}
            onView={() => openMobileDetail(lead)}
            score={leadScores.get(lead.id)}
          />
        ))}
      </div>

      {!isLoading && filteredLeads.length > 0 && (
        <div data-tour="leads-pagination">
          <Pagination page={page} total={filteredLeads.length} perPage={PER_PAGE} onChange={changePage} />
        </div>
      )}

      <LeadViewModal
        lead={viewLead}
        score={viewLead ? leadScores.get(viewLead.id) : undefined}
        canEdit={canEdit}
        canDelete={canDelete}
        onClose={closeMobileDetail}
        onEdit={(lead) => {
          closeMobileDetail();
          openEdit(lead);
        }}
        onFollowup={(lead) => {
          closeMobileDetail();
          setFollowupLead(lead);
        }}
        onTransfer={(lead) => {
          closeMobileDetail();
          setTransferLead(lead);
        }}
        onConvert={(lead) => {
          closeMobileDetail();
          setConvertLead(lead);
        }}
        onDelete={(lead) => {
          setSelected(new Set([lead.id]));
          closeMobileDetail();
          setDeleteOpen(true);
        }}
      />

      <LeadDialogs
        formOpen={formOpen}
        form={form}
        editingLead={editingLead}
        salesUsers={salesUsers}
        saving={saveLead.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => {
          setConfirmClose(false);
          closeForm();
        }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitLead}
      />

      <Modal open={!!followupLead} onClose={() => setFollowupLead(null)} title="Add Follow-up" size="full">
        {followupLead && (
          <div className="space-y-4">
            <Textarea label="Follow-up Note" required value={followupNote} onChange={(event) => setFollowupNote(event.target.value)} />
            <Input label="Next Follow-up Date" type="date" value={followupDate} onChange={(event) => setFollowupDate(event.target.value)} />
            <Button
              className="w-full"
              loading={addFollowup.isPending}
              onClick={() => {
                if (!followupNote.trim()) return toast.error('Note required');
                addFollowup.mutate({ lead: followupLead, note: followupNote, next: followupDate });
              }}
            >
              Save Follow-up
            </Button>
          </div>
        )}
      </Modal>

      <Modal open={!!transferLead} onClose={() => setTransferLead(null)} title="Transfer Lead" size="full">
        {transferLead && (
          <div className="space-y-4">
            <div className="rounded-lg bg-[var(--color-bg-sunken)] p-3 text-sm">
              <p className="text-[var(--color-text-muted)]">Current Assignee</p>
              <p className="font-semibold text-[var(--color-text)]">{transferLead.assignedToName || transferLead.assigned_t || 'Unassigned'}</p>
            </div>
            <Select
              label="New Assignee"
              value={transferUserId}
              onChange={(event) => setTransferUserId(event.target.value)}
              options={[{ label: 'Select Salesperson...', value: '' }, ...salesUsers.map((entry) => ({ label: entry.name, value: entry.id }))]}
            />
            <Textarea label="Transfer Note" required value={transferNote} onChange={(event) => setTransferNote(event.target.value)} />
            <Button
              className="w-full"
              loading={transferMutation.isPending}
              onClick={() => {
                const assignee = salesUsers.find((entry) => entry.id === transferUserId);
                if (!assignee || !transferNote.trim()) return toast.error('Assignee and note required');
                transferMutation.mutate({ lead: transferLead, newUserId: assignee.id, newUserName: assignee.name, note: transferNote });
              }}
            >
              Confirm Transfer
            </Button>
          </div>
        )}
      </Modal>

      <Modal open={!!convertLead} onClose={() => setConvertLead(null)} title="Convert Lead" size="full">
        {convertLead && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--color-success)] bg-[var(--color-success-light)] p-4">
              <p className="text-sm font-semibold text-[var(--color-success-text)]">Convert {leadTitle(convertLead)} to customer?</p>
              <p className="mt-1 text-xs text-[var(--color-success-text)]">A customer record will be created and this lead will be marked Converted.</p>
            </div>
            <Select
              label="Customer Type"
              value={convertType}
              onChange={(event) => setConvertType(event.target.value as 'B2B' | 'B2C')}
              options={[
                { label: 'B2B (Business)', value: 'B2B' },
                { label: 'B2C (Retail)', value: 'B2C' },
              ].filter((option) => allowedConvertTypes.includes(option.value as 'B2B' | 'B2C'))}
            />
            <Button className="w-full" variant="success" loading={convertMutation.isPending} onClick={() => convertMutation.mutate({ lead: convertLead, type: convertType })}>
              Convert to {convertType}
            </Button>
          </div>
        )}
      </Modal>

      <Modal open={bulkStatusOpen} onClose={() => setBulkStatusOpen(false)} title="Change Status" size="sm">
        <div className="space-y-4">
          <Select label="New Status" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} options={[{ label: 'Select status...', value: '' }, ...STATUS_OPTIONS]} />
          <Button className="w-full" loading={bulkStatusMutation.isPending} onClick={() => {
            if (!bulkStatus) return toast.error('Select a status');
            bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus });
          }}>
            Update {selected.size} Leads
          </Button>
        </div>
      </Modal>

      <Modal open={bulkAssignOpen} onClose={() => setBulkAssignOpen(false)} title="Assign Leads" size="sm">
        <div className="space-y-4">
          <Select label="Assign To" value={bulkAssignId} onChange={(event) => setBulkAssignId(event.target.value)} options={[{ label: 'Select salesperson...', value: '' }, ...salesUsers.map((entry) => ({ label: entry.name, value: entry.id }))]} />
          <Button className="w-full" loading={bulkAssignMutation.isPending} onClick={() => {
            const assignee = salesUsers.find((entry) => entry.id === bulkAssignId);
            if (!assignee) return toast.error('Select a salesperson');
            bulkAssignMutation.mutate({ ids: Array.from(selected), assigneeId: assignee.id, assigneeName: assignee.name });
          }}>
            Assign {selected.size} Leads
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteSelected()}
        loading={deleteLead.isPending}
        title="Delete Leads"
        message={`Delete ${selectedRows.length} selected lead${selectedRows.length > 1 ? 's' : ''}?`}
      />
    </div>
  );
}

function LeadCard({ lead, selected, onSelect, onView, score }: {
  lead: Lead;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
  score?: { score: number; band: string };
}) {
  const phone = phoneHref(lead.phone);
  const whatsapp = whatsappHref(lead.phone);
  return (
    <Card data-tour="leads-row-view" className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow',
      'hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
      isOverdue(lead) && 'border-l-4 border-l-red-500',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${leadTitle(lead)}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{leadTitle(lead)}</p>
          {lead.name && lead.company ? <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{lead.company}</p> : null}
          <div className="mt-2 space-y-0.5 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{[lead.city, lead.state].filter(Boolean).join(', ') || lead.address || 'Address not available'}</p>
            <p className="truncate">{lead.phone || 'Mobile not available'}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <div className="flex w-full flex-wrap items-center gap-1.5">
              {statusBadge(lead.status || 'New')}
              {lead.source ? <Badge variant="gray">{lead.source}</Badge> : null}
              {score ? scoreBadge(score) : null}
            </div>
            {lead.assignedToName || lead.assigned_t ? <span className="mt-1 block truncate text-xs font-semibold text-[var(--color-text-muted)]">{lead.assignedToName || lead.assigned_t}</span> : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsapp} target="_blank" rel="noreferrer" aria-label="WhatsApp lead" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !whatsapp && 'pointer-events-none opacity-40')}>
            <MessageCircle className="h-4 w-4" strokeWidth={2.25} />
          </a>
          <a href={lead.email ? `mailto:${lead.email}` : undefined} aria-label="Email lead" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !lead.email && 'pointer-events-none opacity-40')}>
            <Mail className="h-4 w-4" strokeWidth={2.2} />
          </a>
          <a href={phone} aria-label="Call lead" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !phone && 'pointer-events-none opacity-40')}>
            <Phone className="h-4 w-4" strokeWidth={2.25} />
          </a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function LeadSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-8 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

function LeadDialogs({ formOpen, form, editingLead, salesUsers, saving, dirty, confirmClose, onCloseForm, onDiscard, onKeepEditing, onChange, onSubmit }: {
  formOpen: boolean;
  form: LeadForm;
  editingLead: Lead | null;
  salesUsers: any[];
  saving: boolean;
  dirty: boolean;
  confirmClose: boolean;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onChange: (patch: Partial<LeadForm>) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title={editingLead ? 'Edit Lead' : 'Create Lead'} size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <Input label="Lead Name" value={form.name} onChange={(event) => onChange({ name: event.target.value })} />
          <Input label="Mobile Number" required value={form.phone} onChange={(event) => onChange({ phone: event.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={(event) => onChange({ email: event.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="City" value={form.city} onChange={(event) => onChange({ city: event.target.value })} />
            <Input label="State" value={form.state} onChange={(event) => onChange({ state: event.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Source" value={form.source} onChange={(event) => onChange({ source: event.target.value })} options={SOURCE_OPTIONS} />
            <Select label="Status" value={form.status} onChange={(event) => onChange({ status: event.target.value })} options={STATUS_OPTIONS} />
          </div>
          <Select
            label="Assigned To"
            value={form.assignedToId}
            onChange={(event) => {
              const assignee = salesUsers.find((entry) => entry.id === event.target.value);
              onChange({ assignedToId: event.target.value, assignedToName: assignee?.name || '' });
            }}
            options={[{ label: 'Auto assign', value: '' }, ...salesUsers.map((entry) => ({ label: entry.name, value: entry.id }))]}
          />
          <Input label="Next Follow-up" type="date" value={form.next_date} onChange={(event) => onChange({ next_date: event.target.value })} />
          <Textarea label="Notes" value={form.notes} onChange={(event) => onChange({ notes: event.target.value })} />
          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editingLead ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmClose}
        onClose={onKeepEditing}
        onConfirm={onDiscard}
        title="Discard Changes"
        message="Close this form and discard unsaved changes?"
      />
    </>
  );
}

function LeadViewModal({ lead, score, canEdit, canDelete, onClose, onEdit, onFollowup, onTransfer, onConvert, onDelete }: {
  lead: Lead | null;
  score?: { score: number; band: string };
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (lead: Lead) => void;
  onFollowup: (lead: Lead) => void;
  onTransfer: (lead: Lead) => void;
  onConvert: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
}) {
  if (!lead) return null;
  const activity = lead.activityLog || [];
  const { doc: leadViewerDoc, open: leadViewerOpen, viewDocument: leadViewDocument, closeViewer: closeLeadViewer } = useDocumentViewer();
  const leadDocuments = useMemo(() => {
    const docs: { label: string; doc: DocumentViewerFile; metadata: { date?: string; size?: number } }[] = [];
    if (lead?.electricityBillFileName) {
      docs.push({ label: 'Electricity Bill', doc: { name: lead.electricityBillFileName, url: lead.electricityBillUrl || '', mimeType: lead.electricityBillMimeType, size: lead.electricityBillSize }, metadata: { date: lead.electricityBillDate || lead.createdAt, size: lead.electricityBillSize } });
    }
    if (lead?.aadhaarFileName) {
      docs.push({ label: 'Aadhaar Card', doc: { name: lead.aadhaarFileName, url: lead.aadhaarUrl || '', mimeType: lead.aadhaarMimeType, size: lead.aadhaarSize }, metadata: { date: lead.aadhaarDate || lead.createdAt, size: lead.aadhaarSize } });
    }
    if (lead?.panFileName) {
      docs.push({ label: 'PAN Card', doc: { name: lead.panFileName, url: lead.panUrl || '', mimeType: lead.panMimeType, size: lead.panSize }, metadata: { date: lead.panDate || lead.createdAt, size: lead.panSize } });
    }
    if (lead?.attachmentName || lead?.fileName) {
      docs.push({ label: 'Attachment', doc: { name: lead.attachmentName || lead.fileName, url: lead.attachmentUrl || lead.fileUrl || '', mimeType: lead.attachmentMimeType, size: lead.attachmentSize }, metadata: { date: lead.attachmentDate || lead.createdAt, size: lead.attachmentSize } });
    }
    return docs.filter((d) => d.doc?.name);
  }, [lead]);
  return (
    <Modal open={!!lead} onClose={onClose} title={leadTitle(lead)} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              {statusBadge(lead.status || 'New')}
              {lead.source ? <Badge variant="gray">{lead.source}</Badge> : null}
              {score ? scoreBadge(score) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Assigned To" value={lead.assignedToName || lead.assigned_t || 'Unassigned'} />
            <Detail label="Next Follow-up" value={lead.next_date ? fmtDate(lead.next_date) : 'Not scheduled'} />
          </div>
        </section>

        <Section title="Lead Information">
          <Detail label="Lead Name" value={lead.name || 'Not available'} />
          <Detail label="Created" value={lead.createdAt ? fmtDate(lead.createdAt) : 'Not available'} />
        </Section>

        <Section title="Company Information">
          <Detail label="Company" value={lead.company || 'Not available'} />
          <Detail label="GST" value={lead.gst || 'Not available'} />
        </Section>

        <Section title="Contact Details">
          <Detail label="Mobile" value={lead.phone || 'Not available'} />
          <Detail label="Email" value={lead.email || 'Not available'} />
        </Section>

        <Section title="Address">
          <p className="text-sm text-[var(--color-text-secondary)]">{lead.address || [lead.city, lead.state].filter(Boolean).join(', ') || 'Not available'}</p>
        </Section>

        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{lead.last_note || lead.notes || 'No notes recorded.'}</p>
        </Section>

        <Section title="Timeline">
          <MobileTimelinePreview title={`${leadTitle(lead)} Timeline`} entries={activity} />
        </Section>

        <Section title="Activities">
          <Detail label="Calls" value={lead.callCount ? String(lead.callCount) : 'No calls logged'} />
          <Detail label="Meetings" value={lead.meetingCount ? String(lead.meetingCount) : 'No meetings logged'} />
          <Detail label="Emails / WhatsApp" value={lead.messageCount ? String(lead.messageCount) : 'No messages logged'} />
        </Section>

        <Section title="Activity Log">
          {(lead.activityLog || []).length > 0 ? (
            <div className="space-y-2">
              {[...(lead.activityLog || [])].reverse().slice(0, 10).map((log: any, idx: number) => (
                <div key={log.id || idx} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{log.type || 'Activity'}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{log.desc || 'No details'}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--color-text-disabled)]">
                    {log.date ? fmtDate(log.date) : ''}{log.userName ? ` · by ${log.userName}` : ''}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No activity recorded.</p>
          )}
        </Section>

        <Section title="Attachments">
          {leadDocuments.length > 0 ? (
            <div className="space-y-2">
              {leadDocuments.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <File className="h-4 w-4 shrink-0 text-[var(--color-primary-text)]" />
                      <p className="truncate text-sm font-semibold text-[var(--color-text)]">{item.label}</p>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{item.doc.name}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--color-text-disabled)]">
                      {item.metadata.date ? fmtDate(item.metadata.date) : ''}
                      {item.metadata.size ? ` · ${formatFileSize(item.metadata.size)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2" data-action>
                    {item.doc.url ? (
                      <Button
                        size="xs" variant="outline"
                        icon={<FileText className="h-3 w-3" />}
                        onClick={() => leadViewDocument(item.doc)}
                      >
                        View
                      </Button>
                    ) : (
                      <span className="text-xs text-[var(--color-text-muted)]">Reference only</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No attachments available.</p>
          )}
        </Section>

        <Section title="History">
          {lead.transferHistory?.length ? (
            <div className="space-y-2">
              {lead.transferHistory.map((entry: any, index: number) => (
                <div key={index} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{entry.fromUserName || 'Unknown'} to {entry.toUserName || 'Unknown'}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{entry.note || 'No note'} {entry.transferredAt ? `· ${fmtDate(entry.transferredAt)}` : ''}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No transfer history recorded.</p>
          )}
        </Section>

        <Section title="Related Records">
          <Detail label="Converted Customer" value={lead.convertedCustomerId || 'Not converted'} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {lead.phone ? <a className={linkButtonClass} href={`tel:${lead.phone}`}><Phone className="h-4 w-4" />Call</a> : null}
          {lead.phone ? <a className={linkButtonClass} href={whatsappHref(lead.phone)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a> : null}
          {lead.email ? <a className={linkButtonClass} href={`mailto:${lead.email}`}><Mail className="h-4 w-4" />Email</a> : null}
          {canEdit ? <Button variant="outline" icon={<Calendar className="h-4 w-4" />} onClick={() => onFollowup(lead)}>Follow-up</Button> : null}
          {canEdit ? <Button variant="outline" icon={<CornerUpRight className="h-4 w-4" />} onClick={() => onTransfer(lead)}>Transfer</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(lead)}>Edit</Button> : null}
          {canEdit && lead.status !== 'Converted' ? <Button variant="success" icon={<UserCheck className="h-4 w-4" />} onClick={() => onConvert(lead)}>Convert</Button> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(lead)}>Delete</Button> : null}
        </div>
      </div>
      <DocumentViewer
        document={leadViewerDoc}
        open={leadViewerOpen}
        onClose={closeLeadViewer}
        fullScreen
      />
    </Modal>
  );
}

const linkButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  );
}

export default MobileLeadWorkspace;
