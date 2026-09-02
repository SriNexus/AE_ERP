import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Download,
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
import { createDocWithId, fmtDate, genId, toInputDate } from '../../../lib/firestore';
import { useAssignableSalesUsers } from '../../../hooks/useAssignableSalesUsers';
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
import { cn } from '../../../utils/cn';

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
  // Canonical company-scoped Sales Executive roster (see useAssignableSalesUsers)
  // — every active sales-eligible user in this tenant, not narrowed by the
  // viewer's own role / ownership visibility / assignments.
  const { data: salesUsers } = useAssignableSalesUsers();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [form, setForm] = useState<LeadForm>({ ...LEAD_FORM_DEFAULT });
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

  const saveLead = useSaveLead(editingLead?.id || null, () => {
    setFormOpen(false);
    setEditingLead(null);
    setForm({ ...LEAD_FORM_DEFAULT });
    setDirty(false);
    void qc.invalidateQueries({ queryKey: keys.leadsRoot });
  });

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

  // Opening a Lead navigates to the shared Lead Details page (LeadWorkspace),
  // the same implementation desktop uses — no more mobile detail popup.
  function openMobileDetail(lead: Lead) {
    navigate(`/leads/workspace/${encodeURIComponent(lead.id)}`);
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
    // Enterprise-density pass: reclaim ~half of the mobile shell's outer
    // gutter on the sides/top so the list uses more of the screen.
    <div className="-mx-2 -mt-2 space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-1">
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


export default MobileLeadWorkspace;
