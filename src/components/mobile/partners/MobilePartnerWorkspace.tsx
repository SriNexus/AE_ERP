import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Calendar,
  CornerUpRight,
  Edit2,
  File,
  FileText,
  Handshake,
  Mail,
  MessageCircle,
  Phone,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea } from '../../ui';
import { usePartners, useSavePartner, useDeletePartner, useApprovePartner, useSuspendPartner, useReactivatePartner } from '../../../features/channel-partner/hooks/usePartners';
import { PartnerFormModal, type PartnerFormValues } from '../../../components/channel-partner/PartnerFormModal';
import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, fmtDate, genId, getAll } from '../../../lib/firestore';
import { ChannelPartnerDomainService } from '../../../services/ChannelPartnerDomainService';
import { logActivity } from '../../../lib/workflow';
import { resolveNotificationCompanyId, sendNotification } from '../../../lib/notifications';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { NotificationType } from '../../../types';
import { DocumentViewer, useDocumentViewer, formatFileSize } from '../../shared';
import type { DocumentViewerFile } from '../../shared';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';

type Partner = Record<string, any> & { id: string };
type Mode = 'records' | 'create';
type PartnerFilters = {
  search: string;
  status: string;
  kyc: string;
  date: string;
};

// ── Helper utilities ──────────────────────────────────────

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isInDateRange(value: any, range: string) {
  if (range === 'all' || range === ALL) return true;
  const date = toDate(value);
  if (!date) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return date >= start;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 0;
  return days ? date >= new Date(Date.now() - days * 86400000) : true;
}

function partnerName(partner: Partner) {
  return partner.firmName || partner.contactPerson || 'Untitled Partner';
}

function partnerCompany(partner: Partner) {
  return partner.companyName || partner.firmName || '';
}

function partnerCode(partner: Partner) {
  return partner.partnerCode || partner.code || partner.id?.slice(-8) || '—';
}

function cleanPhone(phone?: string) {
  return String(phone || '').replace(/\D/g, '');
}

function phoneHref(phone?: string) {
  return phone ? `tel:${phone}` : undefined;
}

function whatsappHref(phone?: string) {
  const value = cleanPhone(phone);
  return value ? `https://wa.me/${value}` : undefined;
}

function formatCurrency(value: number | null | undefined): string {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(value: any): string {
  if (!value) return '—';
  if (typeof value === 'object' && typeof value.toDate === 'function') return fmtDate(value.toDate());
  if (typeof value === 'object' && value.seconds) return fmtDate(new Date(value.seconds * 1000));
  return fmtDate(value) || '—';
}

// ── Status styling (matching desktop) ─────────────────────

const PARTNER_STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  active: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  suspended: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  inactive: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
};

const KYC_STATUS_STYLES: Record<string, string> = {
  not_started: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  submitted: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  verified: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};

function PartnerStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const style = PARTNER_STATUS_STYLES[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

function KYCStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const style = KYC_STATUS_STYLES[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────

export function MobilePartnerWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const notificationCompanyId = resolveNotificationCompanyId(activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const openId = params.get('open') || '';
  const createParam = params.get('create') || '';

  // ── Data queries ────────────────────────────────────────
  const { data: partners = [], isLoading, error } = usePartners();
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300000,
  });

  const salesUsers = useMemo(() =>
    (users as any[])
      .filter((u: any) =>
        ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL', 'Admin'].includes(u.role) &&
        u.status !== 'Inactive' && !u.isDeleted
      )
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [users],
  );

  // ── State ────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [viewPartner, setViewPartner] = useState<Partner | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editPartner, setEditPartner] = useState<Partner | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [followupPartner, setFollowupPartner] = useState<Partner | null>(null);
  const [followupNote, setFollowupNote] = useState('');
  const [followupDate, setFollowupDate] = useState('');
  const [transferPartner, setTransferPartner] = useState<Partner | null>(null);
  const [transferUserId, setTransferUserId] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssignId, setBulkAssignId] = useState('');


  const canCreate = perms.canCreate('partners');
  const canEdit = perms.canEdit('partners');
  const canDelete = perms.canDelete('partners');

  const userClosedRef = useRef(false);
  const reopenPartnerIdRef = useRef<string | null>(null);

  // ── Filters from URL params ─────────────────────────────
  const filters = useMemo<PartnerFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    kyc: params.get('kyc') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  // ── Mutations ───────────────────────────────────────────
  const savePartner = useSavePartner(editPartner?.id || null, () => {
    setFormOpen(false);
    if (editPartner?.id) reopenPartnerIdRef.current = editPartner.id;
    setEditPartner(null);
    void qc.invalidateQueries({ queryKey: ['channel_partners'] });
  });

  const deletePartner = useDeletePartner();
  const approvePartner = useApprovePartner();
  const suspendPartner = useSuspendPartner();
  const reactivatePartner = useReactivatePartner();

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(
        ids.map((id) => ChannelPartnerDomainService.transitionStatus(id, status, user.id)),
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.partnersRoot });
      toast.success(`Status updated for ${selected.size} partners`);
      setSelected(new Set());
      setBulkStatus('');
      setBulkStatusOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, assignedUser }: { ids: string[]; assignedUser: string }) => {
      const assignedName = salesUsers.find((u: any) => u.id === assignedUser)?.name || assignedUser;
      await Promise.all(
        ids.map((id) =>
          ChannelPartnerDomainService.update(id, {
            assignedSalesPerson: assignedName,
            assignedSalesPersonId: assignedUser,
            updatedBy: user.id,
          }),
        ),
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.partnersRoot });
      toast.success(`Assigned ${selected.size} partner${selected.size > 1 ? 's' : ''}`);
      setSelected(new Set());
      setBulkAssignId('');
      setBulkAssignOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => ChannelPartnerDomainService.delete(id)));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.partnersRoot });
      toast.success(`Deleted ${selected.size} partner${selected.size > 1 ? 's' : ''}`);
      setSelected(new Set());
      setDeleteOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addFollowup = useMutation({
    mutationFn: async ({ partner, note, next }: { partner: Partner; note: string; next: string }) => {
      await createDocWithId(COLLECTIONS.FOLLOWUPS, genId.generic('FU'), { partnerId: partner.id, note, next_date: next });
      const logEntry = { id: genId.generic('LOG'), type: 'Follow-up', desc: note, date: new Date().toISOString(), userName: user.name };
      await ChannelPartnerDomainService.update(partner.id, {
        next_date: next,
        last_note: note,
        activityLog: [...(partner.activityLog || []), logEntry],
        updatedBy: user.id,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.partnersRoot });
      toast.success('Follow-up added');
      setFollowupPartner(null);
      setFollowupNote('');
      setFollowupDate('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const transferMutation = useMutation({
    mutationFn: async ({ partner, newUserId, newUserName, note }: { partner: Partner; newUserId: string; newUserName: string; note: string }) => {
      const logEntry = { id: genId.generic('LOG'), type: 'Transfer', desc: `Transferred to ${newUserName}. Note: ${note}`, date: new Date().toISOString(), userName: user.name };
      await ChannelPartnerDomainService.update(partner.id, {
        assignedSalesPerson: newUserName,
        assignedSalesPersonId: newUserId,
        activityLog: [...(partner.activityLog || []), logEntry],
        updatedBy: user.id,
      });
      await sendNotification(newUserId, NotificationType.PARTNER_APPROVED, 'Partner assigned', `Partner ${partnerName(partner)} was assigned to you.`, 'partner', partner.id, notificationCompanyId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.partnersRoot });
      toast.success('Partner assigned');
      setTransferPartner(null);
      setTransferUserId('');
      setTransferNote('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Filtering & pagination ──────────────────────────────
  // NOTE: These useMemo/const declarations are placed BEFORE effects to avoid
  // TypeScript errors about variables used before declaration.
  const filtered = useMemo(() => {
    let list = [...(partners as any[])];

    const q = filters.search.toLowerCase();
    if (q) {
      list = list.filter((p: any) =>
        [p.firmName, p.contactPerson, p.phone, p.email, p.gstNumber, p.address?.city]
          .some((v: any) => String(v || '').toLowerCase().includes(q)),
      );
    }
    if (filters.status !== ALL) list = list.filter((p: any) => p.status === filters.status);
    if (filters.kyc !== ALL) list = list.filter((p: any) => p.kycStatus === filters.kyc);
    if (filters.date !== 'all') list = list.filter((p: any) => isInDateRange(p.createdAt, filters.date));

    return list.sort((a: any, b: any) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
  }, [partners, filters]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const hasActiveFilters = Boolean(
    filters.search || filters.status !== ALL || filters.kyc !== ALL || filters.date !== 'all',
  );

  // ── Effects ─────────────────────────────────────────────
  useEffect(() => {
    if (createParam !== '1' || mode !== 'records') return;
    setEditPartner(null);
    setFormOpen(true);
  }, [mode, createParam]);

  // Clamp page when filtered list shrinks
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((partners as Partner[]).map((p) => p.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [partners]);

  // Reopen detail after save
  useEffect(() => {
    if (!reopenPartnerIdRef.current) return;
    const updated = (partners as Partner[]).find((p) => p.id === reopenPartnerIdRef.current);
    if (updated) {
      reopenPartnerIdRef.current = null;
      openMobileDetail(updated);
    }
  }, [partners]);

  // Sync viewPartner with URL 'open' param (race-condition guarded)
  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    if (!openId || isLoading) return;
    const target = (partners as Partner[]).find((p) => p.id === openId);
    if (target && !viewPartner) {
      setViewPartner(target);
    }
  }, [openId, isLoading, partners, viewPartner]);

  // ── Handlers ────────────────────────────────────────────
  function openMobileDetail(partner: Partner) {
    userClosedRef.current = false;
    setViewPartner(partner);
    const next = new URLSearchParams(params);
    next.set('open', partner.id);
    setParams(next, { replace: true });
  }

  function closeMobileDetail() {
    userClosedRef.current = true;
    setViewPartner(null);
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

  function openEdit(partner: Partner) {
    closeMobileDetail();
    setEditPartner(partner);
    setFormOpen(true);
  }

  function handleFormSubmit(data: PartnerFormValues) {
    savePartner.mutate(data as any);
  }

  function handleApprove(id: string) {
    const partner = (partners as any[]).find((p: any) => p.id === id);
    approvePartner.mutate(id, {
      onSuccess: () => {
        closeMobileDetail();
        logActivity('Channel Partners', 'Approved Partner', id, {
          entityName: partner?.firmName || id,
          actionLabel: 'Approved channel partner',
        });
      },
    });
  }

  function handleSuspend(id: string) {
    suspendPartner.mutate({ partnerId: id }, {
      onSuccess: () => closeMobileDetail(),
    });
  }

  function handleReactivate(id: string) {
    reactivatePartner.mutate(id, {
      onSuccess: () => closeMobileDetail(),
    });
  }

  // ── RENDER ──────────────────────────────────────────────
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3 px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-1">
        {/* Header — no create button (uses Quick Actions + bottom FAB) */}
        <div className="pt-1">
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Partners</h1>
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
                <Button size="xs" variant="outline" icon={<Shield className="h-3.5 w-3.5" />} onClick={() => { setBulkStatus(''); setBulkStatusOpen(true); }}>
                  Status
                </Button>
              )}
              {canEdit && (
                <Button size="xs" variant="outline" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => { setBulkAssignId(''); setBulkAssignOpen(true); }}>
                  Assign
                </Button>
              )}
              {canDelete && (
                <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleteOpen(true)}>
                  Delete
                </Button>
              )}
              <button
                type="button"
                className="text-xs font-medium text-[var(--color-text-muted)]"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          </Card>
        )}

        {/* Partner cards list */}
        <div className="space-y-2">
          {isLoading && Array.from({ length: 5 }).map((_, i) => <PartnerSkeletonCard key={i} />)}

          {!isLoading && paginated.length === 0 && (
            <Card className="rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
              <Handshake className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
              <p className="mt-2">
                {hasActiveFilters
                  ? 'No partners match your filters.'
                  : 'No partners yet. Add your first partner!'}
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

          {paginated.map((partner: Partner) => (
            <PartnerCard
              key={partner.id}
              partner={partner}
              selected={selected.has(partner.id)}
              onSelect={() => toggleSelect(partner.id)}
              onView={() => openMobileDetail(partner)}
            />
          ))}
        </div>

        {/* Pagination — 10 per page, visible above bottom nav */}
        {filtered.length > 0 && (
          <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={changePage} />
        )}
      </div>

      {/* ── Create/Edit Modal ─────────────────────────────── */}
      <PartnerFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditPartner(null); }}
        onSubmit={handleFormSubmit}
        editPartner={editPartner as any}
        loading={savePartner.isPending}
        salesUsers={salesUsers}
      />

      {/* ── Detail Modal (full 7-tab) ────────────────────── */}
      <PartnerMobileDetailModal
        partner={viewPartner}
        onClose={closeMobileDetail}
        onEdit={openEdit}
        onFollowup={(p) => { closeMobileDetail(); setFollowupPartner(p); }}
        onTransfer={(p) => { closeMobileDetail(); setTransferPartner(p); }}
        onDelete={(p) => { setSelected(new Set([p.id])); closeMobileDetail(); setDeleteOpen(true); }}
        onApprove={handleApprove}
        onSuspend={handleSuspend}
        onReactivate={handleReactivate}
        canEdit={canEdit}
        canDelete={canDelete}
      />

      {/* ── Follow-up Modal ──────────────────────────────── */}
      <Modal open={!!followupPartner} onClose={() => setFollowupPartner(null)} title="Add Follow-up" size="full">
        {followupPartner && (
          <div className="space-y-4">
            <Textarea label="Follow-up Note" required value={followupNote} onChange={(e) => setFollowupNote(e.target.value)} />
            <Input label="Next Follow-up Date" type="date" value={followupDate} onChange={(e) => setFollowupDate(e.target.value)} />
            <Button
              className="w-full"
              loading={addFollowup.isPending}
              onClick={() => {
                if (!followupNote.trim()) return toast.error('Note required');
                addFollowup.mutate({ partner: followupPartner, note: followupNote, next: followupDate });
              }}
            >
              Save Follow-up
            </Button>
          </div>
        )}
      </Modal>

      {/* ── Transfer / Assign Modal ──────────────────────── */}
      <Modal open={!!transferPartner} onClose={() => setTransferPartner(null)} title="Assign Partner" size="full">
        {transferPartner && (
          <div className="space-y-4">
            <div className="rounded-lg bg-[var(--color-bg-sunken)] p-3 text-sm">
              <p className="text-[var(--color-text-muted)]">Current Assignee</p>
              <p className="font-semibold text-[var(--color-text)]">{transferPartner.assignedSalesPerson || 'Unassigned'}</p>
            </div>
            <Select
              label="New Assignee"
              value={transferUserId}
              onChange={(e) => setTransferUserId(e.target.value)}
              options={[{ label: 'Select Salesperson...', value: '' }, ...salesUsers.map((u) => ({ label: u.name, value: u.id }))]}
            />
            <Textarea label="Assignment Note" required value={transferNote} onChange={(e) => setTransferNote(e.target.value)} />
            <Button
              className="w-full"
              loading={transferMutation.isPending}
              onClick={() => {
                const assignee = salesUsers.find((u) => u.id === transferUserId);
                if (!assignee || !transferNote.trim()) return toast.error('Assignee and note required');
                transferMutation.mutate({ partner: transferPartner, newUserId: assignee.id, newUserName: assignee.name, note: transferNote });
              }}
            >
              Confirm Assignment
            </Button>
          </div>
        )}
      </Modal>

      {/* ── Bulk Status Modal ──────────────────────────────── */}
      <Modal open={bulkStatusOpen} onClose={() => { setBulkStatusOpen(false); setBulkStatus(''); }} title="Change Status" size="sm">
        <div className="space-y-4">
          <Select
            label="New Status"
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            options={[
              { label: 'Select status...', value: '' },
              { label: 'Active', value: 'active' },
              { label: 'Suspended', value: 'suspended' },
              { label: 'Inactive', value: 'inactive' },
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
            Update {selected.size} Partners
          </Button>
        </div>
      </Modal>

      {/* ── Bulk Assign Modal ──────────────────────────────── */}
      <Modal open={bulkAssignOpen} onClose={() => { setBulkAssignOpen(false); setBulkAssignId(''); }} title="Assign Partners" size="sm">
        <div className="space-y-4">
          <Select
            label="Assign To"
            value={bulkAssignId}
            onChange={(e) => setBulkAssignId(e.target.value)}
            options={[{ label: 'Select salesperson...', value: '' }, ...salesUsers.map((u) => ({ label: u.name, value: u.id }))]}
          />
          <Button
            className="w-full"
            loading={bulkAssignMutation.isPending}
            onClick={() => {
              const assignee = salesUsers.find((u: any) => u.id === bulkAssignId);
              if (!assignee) return toast.error('Select a salesperson');
              bulkAssignMutation.mutate({ ids: Array.from(selected), assignedUser: assignee.id });
            }}
          >
            Assign {selected.size} Partners
          </Button>
        </div>
      </Modal>

      {/* ── Delete Confirm ─────────────────────────────────── */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          const ids = selected.size > 0 ? Array.from(selected) : [];
          if (ids.length <= 1 && viewPartner?.id) {
            deletePartner.mutate(viewPartner.id, { onSuccess: () => { closeMobileDetail(); setDeleteOpen(false); setSelected(new Set()); } });
          } else if (ids.length > 0) {
            bulkDeleteMutation.mutate(ids);
          }
        }}
        loading={deletePartner.isPending || bulkDeleteMutation.isPending}
        title="Delete Partner"
        message={`Delete ${selected.size || 1} partner${selected.size !== 1 ? 's' : ''} permanently?`}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  PARTNER CARD (P0-compliant layout)
// ══════════════════════════════════════════════════════════════

function PartnerCard({ partner, selected, onSelect, onView }: {
  partner: Partner;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
}) {
  const phone = cleanPhone(partner.phone);
  const displayName = partnerName(partner);
  const company = partnerCompany(partner);
  const pCode = partnerCode(partner);
  const earnings = formatCurrency(partner.totalCommissionEarned);
  const manager = partner.assignedSalesPerson || '';

  return (
    <Card className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
    )}>
      <div className="flex items-start gap-2.5">
        {/* Top Left: Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${displayName}`}
        />

        {/* Body */}
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          {/* Header: Partner Name + Company Name */}
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{displayName}</p>
          {company && <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{company}</p>}
          {!company && <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{pCode}</p>}

          {/* Body: Partner Code, Status, Commission Type, Total Leads, Total Earnings, Assigned Manager */}
          <div className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-[var(--color-text-disabled)]">{pCode}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <PartnerStatusBadge status={partner.status || 'pending_approval'} />
              <KYCStatusBadge status={partner.kycStatus || 'not_started'} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {partner.defaultCommissionType ? (
                <span className="inline-flex items-center gap-1">
                  <span className="font-medium text-[var(--color-text-secondary)]">Comm:</span>
                  <span className="capitalize">{partner.defaultCommissionType.replace(/_/g, ' ')}</span>
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <span className="font-medium text-[var(--color-text-secondary)]">Leads:</span>
                <span>{partner.totalLeadsCreated || 0}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="font-medium text-[var(--color-text-secondary)]">Earned:</span>
                <span className="font-semibold text-[var(--color-text)]">{earnings}</span>
              </span>
            </div>
            {manager && (
              <p className="truncate text-[10px] text-[var(--color-text-disabled)]">
                Manager: {manager}
              </p>
            )}
          </div>
        </button>

        {/* Top Right: WhatsApp, Email, Call */}
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a
            href={whatsappHref(phone)}
            target="_blank" rel="noreferrer"
            aria-label="WhatsApp"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95',
              'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60',
              !phone && 'pointer-events-none opacity-40',
            )}
          >
            <MessageCircle className="h-4 w-4" strokeWidth={2.25} />
          </a>
          <a
            href={partner.email ? `mailto:${partner.email}` : undefined}
            aria-label="Email"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95',
              'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60',
              !partner.email && 'pointer-events-none opacity-40',
            )}
          >
            <Mail className="h-4 w-4" strokeWidth={2.2} />
          </a>
          <a
            href={phoneHref(phone)}
            aria-label="Call"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95',
              'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60',
              !phone && 'pointer-events-none opacity-40',
            )}
          >
            <Phone className="h-4 w-4" strokeWidth={2.25} />
          </a>
        </div>
      </div>
    </Card>
  );
}

function PartnerSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-6 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════
//  PARTNER MOBILE DETAIL MODAL (7 tabs matching desktop)
// ══════════════════════════════════════════════════════════════

function PartnerMobileDetailModal({ partner, onClose, onEdit, onFollowup, onTransfer, onDelete, onApprove, onSuspend, onReactivate, canEdit, canDelete }: {
  partner: Partner | null;
  onClose: () => void;
  onEdit: (partner: Partner) => void;
  onFollowup: (partner: Partner) => void;
  onTransfer: (partner: Partner) => void;
  onDelete: (partner: Partner) => void;
  onApprove: (id: string) => void;
  onSuspend: (id: string) => void;
  onReactivate: (id: string) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const { doc: viewerDoc, open: viewerOpen, viewDocument, closeViewer } = useDocumentViewer();

  // Document attachments — before early return to preserve hook order
  const partnerDocuments = useMemo(() => {
    if (!partner) return [];
    const p = partner;
    const docs: { label: string; doc: DocumentViewerFile; metadata: { date?: string; size?: number } }[] = [];
    if (p?.gstFileName || p?.gstFileUrl) {
      docs.push({ label: 'GST Certificate', doc: { name: p.gstFileName || 'gst.pdf', url: p.gstFileUrl || '', mimeType: p.gstFileMimeType, size: p.gstFileSize }, metadata: { date: p.gstDate || p.createdAt, size: p.gstFileSize } });
    }
    if (p?.panFileName || p?.panFileUrl) {
      docs.push({ label: 'PAN Card', doc: { name: p.panFileName || 'pan.pdf', url: p.panFileUrl || '', mimeType: p.panFileMimeType, size: p.panFileSize }, metadata: { date: p.panDate || p.createdAt, size: p.panFileSize } });
    }
    if (p?.agreementFileName || p?.agreementFileUrl) {
      docs.push({ label: 'Agreement', doc: { name: p.agreementFileName || 'agreement.pdf', url: p.agreementFileUrl || '', mimeType: p.agreementFileMimeType, size: p.agreementFileSize }, metadata: { date: p.agreementDate || p.createdAt, size: p.agreementFileSize } });
    }
    if (p?.bankDocFileName || p?.bankDocUrl) {
      docs.push({ label: 'Bank Document', doc: { name: p.bankDocFileName || 'bank-doc.pdf', url: p.bankDocUrl || '', mimeType: p.bankDocMimeType, size: p.bankDocSize }, metadata: { date: p.bankDocDate || p.createdAt, size: p.bankDocSize } });
    }
    if (p?.aadhaarFileName || p?.aadhaarUrl) {
      docs.push({ label: 'Aadhaar', doc: { name: p.aadhaarFileName || 'aadhaar.pdf', url: p.aadhaarUrl || '', mimeType: p.aadhaarMimeType, size: p.aadhaarSize }, metadata: { date: p.aadhaarDate || p.createdAt, size: p.aadhaarSize } });
    }
    if (p?.photoUrl || p?.profilePhotoUrl) {
      docs.push({ label: 'Photo', doc: { name: 'photo.jpg', url: p.photoUrl || p.profilePhotoUrl || '', mimeType: 'image/jpeg', size: p.photoSize }, metadata: { date: p.createdAt, size: p.photoSize } });
    }
    return docs.filter((d) => d.doc?.name && d.doc?.url);
  }, [partner]);

  if (!partner) return null;

  const address = partner.address;
  const location = [address?.city, address?.state].filter(Boolean).join(', ') || '—';
  const bank = partner.bankDetails;
  const activity = partner.activityLog || partner.statusHistory || [];

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'kyc', label: 'KYC' },
    { key: 'commission', label: 'Commission' },
    { key: 'wallet', label: 'Wallet' },
    { key: 'performance', label: 'Performance' },
    { key: 'documents', label: 'Documents' },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <Modal open={!!partner} onClose={onClose} title={partnerName(partner)} size="full">
      <div className="space-y-4">
        {/* Header with status badges */}
        <div className="flex items-start gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
            {(partnerName(partner)[0] || '?').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-[var(--color-text)]">{partnerName(partner)}</h2>
            {partnerCompany(partner) && <p className="truncate text-xs text-[var(--color-text-muted)]">{partnerCompany(partner)}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <PartnerStatusBadge status={partner.status || 'pending_approval'} />
              <KYCStatusBadge status={partner.kycStatus || 'not_started'} />
            </div>
          </div>
        </div>

        {/* Quick info strip */}
        <div className="grid grid-cols-2 gap-2">
          <Detail label="Partner Code" value={partnerCode(partner)} />
          <Detail label="Partner Since" value={formatDate(partner.createdAt)} />
          {partner.phone && <Detail label="Phone" value={partner.phone} />}
          {partner.email && <Detail label="Email" value={partner.email} />}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'rounded-lg px-3 py-2 text-xs font-bold transition-colors whitespace-nowrap',
                activeTab === tab.key
                  ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]'
                  : 'text-[var(--color-text-muted)]',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ──────────────────────────────────── */}
        {activeTab === 'overview' && (
          <>
            <Section title="Contact Information">
              <Detail label="Contact Person" value={partner.contactPerson || '—'} />
              <Detail label="Firm Name" value={partner.firmName || '—'} />
              <Detail label="Phone" value={partner.phone || '—'} />
              <Detail label="Email" value={partner.email || '—'} />
              <Detail label="Alternate Phone" value={partner.alternatePhone || '—'} />
              <Detail label="GST Number" value={partner.gstNumber || '—'} />
              <Detail label="PAN Number" value={partner.panNumber || '—'} />
            </Section>

            <Section title="Address">
              <p className="text-sm text-[var(--color-text-secondary)]">
                {address?.line1 ? `${address.line1}, ` : ''}
                {address?.line2 ? `${address.line2}, ` : ''}
                {address?.city ? `${address.city}, ` : ''}
                {address?.state ? `${address.state} ` : ''}
                {address?.pincode ? `- ${address.pincode}` : ''}
                {!address?.line1 && !address?.city ? '—' : ''}
              </p>
            </Section>

            <Section title="Performance Summary">
              <div className="grid grid-cols-2 gap-2">
                <Detail label="Total Leads" value={String(partner.totalLeadsCreated || 0)} />
                <Detail label="Converted" value={String(partner.totalLeadsConverted || 0)} />
                <Detail label="Conversion Rate" value={`${partner.conversionRate || 0}%`} />
                <Detail label="Commission Earned" value={formatCurrency(partner.totalCommissionEarned)} />
                <Detail label="Wallet Balance" value={formatCurrency(partner.walletBalance)} />
                <Detail label="Avg Commission/Lead" value={formatCurrency(partner.averageCommissionPerLead)} />
              </div>
            </Section>

            <Section title="Bank Details">
              <Detail label="Account Holder" value={bank?.accountHolderName || '—'} />
              <Detail label="Account Number" value={bank?.accountNumber ? `****${bank.accountNumber.slice(-4)}` : '—'} />
              <Detail label="Bank Name" value={bank?.bankName || '—'} />
              <Detail label="IFSC Code" value={bank?.ifscCode || '—'} />
            </Section>

            <Section title="Assignment">
              <Detail label="Assigned To" value={partner.assignedSalesPerson || 'Unassigned'} />
              {partner.approvedBy && <Detail label="Approved By" value={partner.approvedBy} />}
            </Section>

            {partner.notes && (
              <Section title="Notes">
                <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{partner.notes}</p>
              </Section>
            )}
          </>
        )}

        {/* ── KYC TAB ────────────────────────────────────────── */}
        {activeTab === 'kyc' && (
          <>
            <Section title="KYC Status">
              <div className="grid grid-cols-2 gap-2">
                <Detail label="KYC Status">
                  <KYCStatusBadge status={partner.kycStatus || 'not_started'} />
                </Detail>
                <Detail label="Submitted At" value={formatDate(partner.kycSubmittedAt)} />
                <Detail label="Verified At" value={formatDate(partner.kycVerifiedAt)} />
                <Detail label="Verified By" value={partner.kycVerifiedBy || '—'} />
                {partner.kycRejectionReason && (
                  <Detail label="Rejection Reason" value={partner.kycRejectionReason} />
                )}
              </div>
            </Section>

            <Section title="KYC Documents">
              {partner.kycDocuments && partner.kycDocuments.length > 0 ? (
                <div className="space-y-2">
                  {partner.kycDocuments.map((doc: string, i: number) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-sm">
                      <FileText className="h-4 w-4 text-[var(--color-text-muted)]" />
                      <span className="text-[var(--color-text)]">{doc}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">No documents uploaded yet.</p>
              )}
            </Section>

            <Section title="Bank Details">
              {bank ? (
                <div className="grid grid-cols-2 gap-2">
                  <Detail label="Account Holder" value={bank.accountHolderName} />
                  <Detail label="Account Number" value={bank.accountNumber} />
                  <Detail label="Bank Name" value={bank.bankName} />
                  <Detail label="IFSC Code" value={bank.ifscCode} />
                  <Detail label="Branch" value={bank.branchName || '—'} />
                  <Detail label="Account Type" value={bank.accountType === 'current' ? 'Current' : 'Savings'} />
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">No bank details provided.</p>
              )}
            </Section>
          </>
        )}

        {/* ── COMMISSION TAB ─────────────────────────────────── */}
        {activeTab === 'commission' && (
          <>
            <Section title="Commission Configuration">
              <div className="grid grid-cols-2 gap-2">
                <Detail label="Default Commission Type">
                  {partner.defaultCommissionType ? (
                    <span className="capitalize">{partner.defaultCommissionType.replace(/_/g, ' ')}</span>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">Not configured</span>
                  )}
                </Detail>
                <Detail label="Default Commission Value">
                  {partner.defaultCommissionValue ? `₹${partner.defaultCommissionValue}` : '—'}
                </Detail>
                <Detail label="Total Commission Earned" value={formatCurrency(partner.totalCommissionEarned)} />
                <Detail label="Total Commission Paid" value={formatCurrency(partner.totalCommissionPaid)} />
                <Detail label="Avg Commission Per Lead" value={formatCurrency(partner.averageCommissionPerLead)} />
              </div>
            </Section>
            <Section title="Commission Rules">
              <p className="text-sm text-[var(--color-text-muted)]">
                Commission rules and records are managed from the Commission Rules module.
              </p>
            </Section>
          </>
        )}

        {/* ── WALLET TAB ──────────────────────────────────────── */}
        {activeTab === 'wallet' && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Card className="rounded-xl p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Balance</p>
                <p className="mt-1 text-xl font-bold text-[var(--color-text)]">{formatCurrency(partner.walletBalance)}</p>
              </Card>
              <Card className="rounded-xl p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Pending</p>
                <p className="mt-1 text-xl font-bold text-amber-600">{formatCurrency(partner.pendingBalance)}</p>
              </Card>
              <Card className="rounded-xl p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Total Earned</p>
                <p className="mt-1 text-xl font-bold text-[var(--color-text)]">{formatCurrency(partner.totalCommissionEarned)}</p>
              </Card>
            </div>
            <Section title="Recent Transactions">
              <p className="text-sm text-[var(--color-text-muted)]">
                Wallet transactions are managed from the Settlements module.
              </p>
            </Section>
          </>
        )}

        {/* ── PERFORMANCE TAB ────────────────────────────────── */}
        {activeTab === 'performance' && (
          <>
            <Section title="Performance Overview">
              <div className="grid grid-cols-3 gap-2">
                <Card className="rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Revenue</p>
                  <p className="mt-1 text-xl font-bold text-[var(--color-text)]">{formatCurrency(partner.totalCommissionEarned)}</p>
                </Card>
                <Card className="rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Leads</p>
                  <p className="mt-1 text-xl font-bold text-[var(--color-text)]">{partner.totalLeadsCreated || 0}</p>
                </Card>
                <Card className="rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Conversion</p>
                  <p className="mt-1 text-xl font-bold text-emerald-600">{partner.conversionRate || 0}%</p>
                </Card>
              </div>
            </Section>
            <Section title="Performance Details">
              <div className="grid grid-cols-2 gap-2">
                <Detail label="Total Leads Created" value={String(partner.totalLeadsCreated || 0)} />
                <Detail label="Total Leads Converted" value={String(partner.totalLeadsConverted || 0)} />
                <Detail label="Conversion Rate" value={`${partner.conversionRate || 0}%`} />
                <Detail label="Avg Commission/Lead" value={formatCurrency(partner.averageCommissionPerLead)} />
                <Detail label="Total Commission Earned" value={formatCurrency(partner.totalCommissionEarned)} />
                <Detail label="Total Commission Paid" value={formatCurrency(partner.totalCommissionPaid)} />
              </div>
            </Section>
          </>
        )}

        {/* ── DOCUMENTS TAB ──────────────────────────────────── */}
        {activeTab === 'documents' && (
          <Section title="Documents">
            {partnerDocuments.length > 0 ? (
              <div className="space-y-2">
                {partnerDocuments.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <File className="h-4 w-4 shrink-0 text-[var(--color-primary-text)]" />
                        <p className="truncate text-sm font-semibold text-[var(--color-text)]">{item.label}</p>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{item.doc.name}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--color-text-disabled)]">
                        {item.metadata.date ? formatDate(item.metadata.date) : ''}
                        {item.metadata.size ? ` · ${formatFileSize(item.metadata.size)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2" data-action>
                      {item.doc.url ? (
                        <Button
                          size="xs" variant="outline"
                          icon={<FileText className="h-3 w-3" />}
                          onClick={() => viewDocument(item.doc)}
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
              <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-8 text-center">
                <FileText className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
                <p className="mt-2 text-sm font-medium text-[var(--color-text)]">No documents attached</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Documents will appear here once uploaded.
                </p>
              </div>
            )}
          </Section>
        )}

        {/* ── ACTIVITY TAB ──────────────────────────────────── */}
        {activeTab === 'activity' && (
          <Section title="Timeline">
            {activity.length > 0 ? (
              <MobileTimelinePreview
                title={`${partnerName(partner)} Timeline`}
                entries={activity.map((log: any) => ({
                  type: log.status || log.type || 'Activity',
                  desc: log.actionLabel || log.desc || log.remarks || 'No details',
                  date: log.changedAt || log.date || partner.createdAt,
                  userName: log.changedByName || log.userName || log.changedBy || 'System',
                }))}
              />
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">No activity recorded.</p>
            )}
          </Section>
        )}

        {/* ── Action buttons ───────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          {partner.phone && (
            <a href={phoneHref(partner.phone)} target="_blank" rel="noreferrer" className={linkButtonClass}>
              <Phone className="h-4 w-4" /> Call
            </a>
          )}
          {partner.phone && (
            <a href={whatsappHref(partner.phone)} target="_blank" rel="noreferrer" className={linkButtonClass}>
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
          )}
          {partner.email && (
            <a href={`mailto:${partner.email}`} className={linkButtonClass}>
              <Mail className="h-4 w-4" /> Email
            </a>
          )}
          {canEdit && (
            <Button variant="outline" icon={<Calendar className="h-4 w-4" />} onClick={() => onFollowup(partner as Partner)}>
              Follow-up
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" icon={<CornerUpRight className="h-4 w-4" />} onClick={() => onTransfer(partner as Partner)}>
              Assign
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" icon={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(partner as Partner)}>
              Edit
            </Button>
          )}
          {partner.status === 'pending_approval' && canEdit && (
            <Button icon={<UserCheck className="h-4 w-4" />} onClick={() => onApprove(partner.id)}>
              Approve
            </Button>
          )}
          {partner.status === 'active' && canEdit && (
            <Button variant="danger" icon={<UserX className="h-4 w-4" />} onClick={() => onSuspend(partner.id)}>
              Suspend
            </Button>
          )}
          {partner.status === 'suspended' && canEdit && (
            <Button icon={<UserCheck className="h-4 w-4" />} onClick={() => onReactivate(partner.id)}>
              Reactivate
            </Button>
          )}
          {canDelete && (
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(partner as Partner)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Document Viewer */}
      <DocumentViewer document={viewerDoc} open={viewerOpen} onClose={closeViewer} fullScreen />
    </Modal>
  );
}

const linkButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]';

// ── Shared UI components ────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Detail({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{children ?? value ?? '—'}</div>
    </div>
  );
}

export default MobilePartnerWorkspace;
