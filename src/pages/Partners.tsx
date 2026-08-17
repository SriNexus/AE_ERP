/**
 * Partners — Channel Partner List (Admin View)
 *
 * Desktop Gold Standard — visually identical to Leads.
 * All business logic preserved from original implementation.
 */

import { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, fmtDate } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange } from '../lib/dateFilters';
import { usePermissions } from '../lib/permissions';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { logActivity } from '../lib/workflow';

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
import { Modal } from '../components/ui/Modal';
import { Select as InputSelect } from '../components/ui/Input';
import {
  Handshake, Plus, RefreshCw, Download, Eye,
  Phone, Users, Shield, Upload, Target,
  UserPlus, UserX, X, CheckCircle2, Clock, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { resolveNotificationCompanyId, sendNotification } from '../lib/notifications';
import { NotificationType } from '../types';
import { usePartners, useSavePartner, useDeletePartner, useApprovePartner, useSuspendPartner, useReactivatePartner } from '../features/channel-partner/hooks/usePartners';
import { PartnerFormModal, type PartnerFormValues } from '../components/channel-partner/PartnerFormModal';
import { PartnerDetailDrawer } from '../components/channel-partner/PartnerDetailDrawer';
import { PARTNER_STATUSES, KYC_STATUSES } from '../features/channel-partner/constants';
import { ChannelPartnerDomainService } from '../services/ChannelPartnerDomainService';
import type { ChannelPartner } from '../features/channel-partner/types';

// ── Constants ──────────────────────────────────────────────

const PER_PAGE = 10;
const ALL = 'All';

const DATE_OPTIONS = [
  { label: 'All dates', value: '' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
];

// ── Date helpers ───────────────────────────────────────────

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCreatedDate(value: any): string {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB');
}

function safeAge(createdAt: any): number {
  if (!createdAt) return 0;
  const date = toDate(createdAt);
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function isThisMonth(value: any): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function recencyDotClass(value: any): string {
  const age = safeAge(value);
  if (age === 0) return 'bg-emerald-500';
  if (age <= 7) return 'bg-blue-500';
  if (age <= 30) return 'bg-amber-400';
  return 'bg-red-500';
}

function MutedValue({ children }: { children?: React.ReactNode }) {
  return <span className={children ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-disabled)]'}>{children || '—'}</span>;
}

function EmptyCell({ children = '-' }: { children?: React.ReactNode }) {
  return <span className="text-[var(--color-text-disabled)]">{children}</span>;
}

function isRowClickIgnored(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  return Boolean(el.closest('button,a,input,select,textarea,[data-action],[data-dropdown],[data-interactive]'));
}

function formatCurrency(value: number | null | undefined): string {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtCompactNumber(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (amount >= 10000000) return `${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return String(amount);
}

// ── Status badges ──────────────────────────────────────────

const PARTNER_STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  active: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  suspended: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  inactive: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
};

const KYC_STATUS_STYLES: Record<string, string> = {
  not_started: 'bg-gray-100 dark:bg-gray-800 text-gray-500',
  pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700',
  submitted: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700',
  verified: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700',
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

// ── Download CSV ───────────────────────────────────────────

function downloadPartnersCsv(rows: any[], filename: string) {
  const headers = [
    'Partner ID', 'Firm Name', 'Contact Person', 'Email', 'Phone',
    'City', 'State', 'Status', 'KYC Status', 'GST', 'PAN',
    'Total Leads', 'Converted', 'Commission Earned', 'Wallet Balance',
    'Assigned To', 'Created Date',
  ];
  const lines = rows.map((p: any) =>
    [
      p.id || '', p.firmName || '', p.contactPerson || '', p.email || '', p.phone || '',
      p.address?.city || '', p.address?.state || '', p.status || '', p.kycStatus || '',
      p.gstNumber || '', p.panNumber || '', p.totalLeadsCreated || 0, p.totalLeadsConverted || 0,
      p.totalCommissionEarned || 0, p.walletBalance || 0, p.assignedSalesPerson || '', fmtDate(p.createdAt) || '',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─────────────────────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

export default function Partners() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const notificationCompanyId = resolveNotificationCompanyId(activeCompanyId);
  const openParam = searchParams.get('open') || '';
  const createParam = searchParams.get('create') || '';

  // ── Filters ──────────────────────────────────────────────
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [kycF, setKycF] = useState(() => searchParams.get('kyc') || '');
  const [assignF, setAssignF] = useState(() => searchParams.get('owner') || '');
  const [createdByF, setCreatedByF] = useState(() => searchParams.get('createdBy') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || '');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');

  // ── Table state ──────────────────────────────────────────
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState(() => searchParams.get('sort') || 'createdAt');
  const [sortDesc, setSortDesc] = useState(() => searchParams.get('sortDesc') !== '0');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Refs ─────────────────────────────────────────────────
  const lastClosedParamRef = useRef<string | null>(null);

  // ── Modal state ──────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editPartner, setEditPartner] = useState<ChannelPartner | null>(null);
  const [viewPartner, setViewPartner] = useState<ChannelPartner | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [bulkStatusTarget, setBulkStatusTarget] = useState('');
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkAssignTarget, setBulkAssignTarget] = useState('');
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvImportFile, setCsvImportFile] = useState<File | null>(null);
  const [csvImportSaving, setCsvImportSaving] = useState(false);
  const [csvImportResult, setCsvImportResult] = useState<{ created: number; errors: string[] } | null>(null);

  // ── URL sync helper ──────────────────────────────────────
  function syncQueueParams(nextState: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(searchParams);
    const keys = ['q', 'status', 'kyc', 'owner', 'createdBy', 'date', 'from', 'to', 'kpi', 'sort', 'sortDesc', 'page', 'perPage', 'open'];
    keys.forEach((key) => {
      const val = nextState[key] ?? searchParams.get(key);
      if (val && val !== '' && val !== 'all' && val !== 1) next.set(key, String(val));
      else next.delete(key);
    });
    setSearchParams(next, { replace: true });
  }

  // ── Queries ──────────────────────────────────────────────
  const { data: partners = [], isLoading, refetch } = usePartners();
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
    [users]
  );

  // Phase 1 identity: candidate ERP users for linking (any active user) and
  // candidate TL/Manager users (manager-capable roles) for manager assignment.
  const linkUserOptions = useMemo(() =>
    (users as any[])
      .filter((u: any) => u.status !== 'Inactive' && !u.isDeleted)
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .map((u: any) => ({ id: u.id, name: u.name || u.email || u.id })),
    [users]
  );
  const managerOptions = useMemo(() =>
    (users as any[])
      .filter((u: any) =>
        ['Manager', 'TL', 'Management', 'Admin'].includes(u.role) &&
        u.status !== 'Inactive' && !u.isDeleted
      )
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .map((u: any) => ({ id: u.id, name: u.name || u.email || u.id })),
    [users]
  );

  const userOptions = useMemo(() => {
    const names = new Set<string>();
    (partners as any[]).forEach((p: any) => names.add(p.createdBy || ''));
    const list = Array.from(names).filter(Boolean).sort();
    return [{ label: 'All Users', value: '' }, ...list.map((n) => ({ label: n, value: n }))];
  }, [partners]);

  // ── Mutations ────────────────────────────────────────────
  const savePartner = useSavePartner(editPartner?.id || null, () => {
    setShowForm(false);
    setEditPartner(null);
  });
  const deletePartner = useDeletePartner();
  const approvePartner = useApprovePartner();
  const suspendPartner = useSuspendPartner();
  const reactivatePartner = useReactivatePartner();

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map((id) => ChannelPartnerDomainService.transitionStatus(id, status, user.id)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel_partners'] });
      toast.success(`Status updated for ${selected.size} partners`);
      setShowBulkStatus(false); setBulkStatusTarget(''); setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, assignedUser }: { ids: string[]; assignedUser: string }) => {
      const assignedName = salesUsers.find((u: any) => u.id === assignedUser)?.name || assignedUser;
      await Promise.all(ids.map((id) =>
        ChannelPartnerDomainService.update(id, {
          assignedSalesPerson: assignedName, assignedSalesPersonId: assignedUser, updatedBy: user.id,
        })
      ));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel_partners'] });
      toast.success(`Assigned ${selected.size} partner${selected.size > 1 ? 's' : ''}`);
      setShowBulkAssign(false); setBulkAssignTarget(''); setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => ChannelPartnerDomainService.delete(id)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel_partners'] });
      toast.success(`Deleted ${selected.size} partner${selected.size > 1 ? 's' : ''}`);
      setShowBulkDelete(false); setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const csvImportMutation = useMutation({
    mutationFn: async (rows: any[]) => {
      const created: string[] = [];
      const errors: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          await ChannelPartnerDomainService.create({
            firmName: row.firmName || row['Firm Name'] || '',
            contactPerson: row.contactPerson || row['Contact Person'] || row.firmName || '',
            email: row.email || row['Email'] || '',
            phone: String(row.phone || row['Phone'] || ''),
            companyId: activeCompanyId,
            createdBy: user.id,
            status: 'pending_approval', kycStatus: 'not_started',
            walletBalance: 0, pendingBalance: 0, totalCommissionEarned: 0, totalCommissionPaid: 0,
            totalLeadsCreated: 0, totalLeadsConverted: 0, conversionRate: 0, averageCommissionPerLead: 0,
            kycDocuments: [],
            statusHistory: [{ status: 'pending_approval', changedBy: user.id, changedAt: new Date().toISOString() }],
          });
          created.push(row.firmName || `Row ${i + 1}`);
        } catch (e: any) { errors.push(`Row ${i + 1}: ${e.message || 'Unknown error'}`); }
      }
      return { created: created.length, errors };
    },
    onSuccess: (result) => {
      setCsvImportResult(result);
      if (result.errors.length === 0) {
        toast.success(`Imported ${result.created} partners`);
        setShowCsvImport(false); setCsvImportFile(null); setCsvImportResult(null);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  function handleCsvFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCsvImportFile(e.target.files?.[0] || null);
    setCsvImportResult(null);
  }

  function handleCsvImport() {
    if (!csvImportFile) return toast.error('Select a CSV file');
    setCsvImportSaving(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) { toast.error('CSV must have header + at least one data row'); setCsvImportSaving(false); return; }
        const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
        const rows = lines.slice(1).map((line) => {
          const values = line.split(',').map((v) => v.replace(/^"|"$/g, '').trim());
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
          return row;
        });
        if (!rows[0]?.firmName && !rows[0]?.['Firm Name']) {
          toast.error('CSV must include a "firmName" or "Firm Name" column');
          setCsvImportSaving(false); return;
        }
        csvImportMutation.mutate(rows, { onSettled: () => setCsvImportSaving(false) });
      } catch { toast.error('Failed to parse CSV file'); setCsvImportSaving(false); }
    };
    reader.onerror = () => { toast.error('Failed to read CSV file'); setCsvImportSaving(false); };
    reader.readAsText(csvImportFile);
  }

  // ── URL param effects ────────────────────────────────────
  useEffect(() => {
    if (createParam !== '1') return;
    setEditPartner(null);
    setShowForm(true);
  }, [createParam]);

  useEffect(() => {
    if (lastClosedParamRef.current === openParam) { lastClosedParamRef.current = null; return; }
    if (!openParam || isLoading) return;
    const target = (partners as any[]).find((p: any) => p.id === openParam);
    if (target) { setViewPartner(target); }
  }, [partners, isLoading, openParam]);

  // ── Handlers ─────────────────────────────────────────────
  function handleFormSubmit(data: PartnerFormValues) {
    const payload = {
      firmName: data.firmName, contactPerson: data.contactPerson, email: data.email, phone: data.phone,
      alternatePhone: data.alternatePhone || undefined,
      address: { line1: data.addressLine1, line2: data.addressLine2 || undefined, city: data.city, state: data.state, pincode: data.pincode, country: data.country },
      gstNumber: data.gstNumber || undefined, panNumber: data.panNumber || undefined,
      bankDetails: data.bankAccountNumber ? { accountNumber: data.bankAccountNumber, ifscCode: data.bankIfscCode, bankName: data.bankName, branchName: data.bankBranch || undefined, accountHolderName: data.bankAccountHolderName, accountType: data.bankAccountType, verified: false } : undefined,
      defaultCommissionType: (data.defaultCommissionType || undefined) as any,
      defaultCommissionValue: data.defaultCommissionValue || 0,
      assignedSalesPerson: data.assignedSalesPerson || undefined,
      // Phase 1 identity: forwarded to the canonical link/manager services.
      userId: data.userId || undefined,
      managerId: data.managerId || undefined,
      notes: data.notes || undefined,
      tags: data.tags ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      updatedBy: user.id,
    };
    savePartner.mutate(payload as any);
  }

  function openEdit(partner: ChannelPartner) {
    setViewPartner(null);
    setEditPartner(partner);
    setShowForm(true);
  }

  function openView(partner: ChannelPartner) {
    setViewPartner(partner);
    if (!partner?.id) return;
    const next = new URLSearchParams(searchParams);
    next.set('open', partner.id);
    setSearchParams(next, { replace: true });
  }

  function closeView() {
    lastClosedParamRef.current = openParam;
    setViewPartner(null);
    if (!openParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }

  function handleRowClick(e: React.MouseEvent, partner: ChannelPartner) {
    if (window.getSelection()?.toString()) return;
    if (isRowClickIgnored(e.target)) return;
    openView(partner);
  }

  function handleRowKeyDown(e: React.KeyboardEvent, partner: ChannelPartner) {
    if (isRowClickIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openView(partner);
  }

  function handleApprove(id: string) {
    const partner = (partners as any[]).find((p: any) => p.id === id);
    approvePartner.mutate(id, {
      onSuccess: () => {
        closeView();
        logActivity('Channel Partners', 'Approved Partner', id, { entityName: partner?.firmName || id, actionLabel: 'Approved channel partner' });
        if (partner?.userId) {
          sendNotification(partner.userId, NotificationType.PARTNER_APPROVED, 'Partner approved', 'Your channel partner account has been approved.', 'partner', id, notificationCompanyId).catch(() => {});
        }
      },
    });
  }

  function handleSuspend(id: string) {
    suspendPartner.mutate({ partnerId: id }, {
      onSuccess: () => { closeView(); logActivity('Channel Partners', 'Suspended Partner', id, { entityName: (partners as any[]).find((p: any) => p.id === id)?.firmName || id, actionLabel: 'Suspended channel partner' }); },
    });
  }

  function handleReactivate(id: string) {
    reactivatePartner.mutate(id, {
      onSuccess: () => { closeView(); logActivity('Channel Partners', 'Reactivated Partner', id, { entityName: (partners as any[]).find((p: any) => p.id === id)?.firmName || id, actionLabel: 'Reactivated channel partner' }); },
    });
  }

  function exportSelected() {
    const rows = (partners as any[]).filter((p: any) => selected.has(p.id));
    if (!rows.length) return toast.error('No partners selected');
    const date = new Date().toISOString().slice(0, 10);
    downloadPartnersCsv(rows, `partners-export-${date}.csv`);
    toast.success(`Exported ${rows.length} partner${rows.length > 1 ? 's' : ''}`);
  }

  // ── Filtering & Sorting ──────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...(partners as any[])];

    if (activeKpi === 'active') list = list.filter((p: any) => p.status === 'active');
    else if (activeKpi === 'pending_approval') list = list.filter((p: any) => p.status === 'pending_approval');
    else if (activeKpi === 'pending_kyc') list = list.filter((p: any) => p.kycStatus !== 'verified');
    else if (activeKpi === 'suspended') list = list.filter((p: any) => p.status === 'suspended');
    else if (activeKpi === 'newMonth') list = list.filter((p: any) => isThisMonth(p.createdAt));

    const q = deferredSearch.toLowerCase();
    if (q) {
      list = list.filter((p: any) =>
        [p.firmName, p.contactPerson, p.phone, p.email, p.gstNumber, p.address?.city]
          .some((v: any) => String(v || '').toLowerCase().includes(q))
      );
    }

    if (statusF) list = list.filter((p: any) => p.status === statusF);
    if (kycF) list = list.filter((p: any) => p.kycStatus === kycF);
    if (assignF) list = list.filter((p: any) => p.assignedSalesPerson === assignF || p.assignedSalesPersonId === assignF);
    if (createdByF) list = list.filter((p: any) => p.createdBy === createdByF || p.createdByName === createdByF);
    if (dateRange) list = list.filter((p: any) => isInDateRange(p.createdAt, dateRange as any, customFrom, customTo));

    list.sort((a: any, b: any) => {
      const numericFields = ['totalCommissionEarned', 'walletBalance', 'totalLeadsCreated', 'totalLeadsConverted'];
      if (numericFields.includes(sortKey)) {
        return sortDesc ? Number(b[sortKey] || 0) - Number(a[sortKey] || 0) : Number(a[sortKey] || 0) - Number(b[sortKey] || 0);
      }
      const av = String(a[sortKey] || '').toLowerCase();
      const bv = String(b[sortKey] || '').toLowerCase();
      return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    });

    return list;
  }, [partners, deferredSearch, statusF, kycF, assignF, dateRange, customFrom, customTo, activeKpi, sortKey, sortDesc, createdByF]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // ── Stats ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const all = partners as any[];
    return {
      total: all.length,
      active: all.filter((p: any) => p.status === 'active').length,
      pendingApproval: all.filter((p: any) => p.status === 'pending_approval').length,
      pendingKYC: all.filter((p: any) => p.kycStatus !== 'verified').length,
      thisMonth: all.filter((p: any) => isThisMonth(p.createdAt)).length,
    };
  }, [partners]);

  const isTotalDefault = !activeKpi && !search && !dateRange && !statusF && !kycF && !assignF && !createdByF;

  const toggleSelect = useCallback((id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);

  const toggleAll = () =>
    setSelected((s) => s.size === paginated.length ? new Set() : new Set(paginated.map((p: any) => p.id)));

  const allSel = selected.size === paginated.length && paginated.length > 0;

  function sort(k: string) {
    if (sortKey === k) { setSortDesc((d) => !d); syncQueueParams({ sort: k, sortDesc: sortDesc ? '' : '1' }); }
    else { setSortKey(k); setSortDesc(false); syncQueueParams({ sort: k, sortDesc: '' }); }
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setKycF(''); setAssignF(''); setCreatedByF('');
    setDateRange(''); setCustomFrom(''); setCustomTo(''); setActiveKpi(''); setPage(1);
    syncQueueParams({ q: '', status: '', kyc: '', owner: '', createdBy: '', date: '', from: '', to: '', kpi: '', page: 1 });
  }

  const KPI_CONFIGS = [
    { key: '', label: 'TOTAL', value: stats.total, icon: <Handshake className="h-4 w-4" />, description: 'All channel partners' },
    { key: 'active', label: 'ACTIVE', value: stats.active, icon: <CheckCircle2 className="h-4 w-4" />, description: 'Active partners' },
    { key: 'pending_approval', label: 'PENDING', value: stats.pendingApproval, icon: <Clock className="h-4 w-4" />, description: 'Awaiting approval' },
    { key: 'pending_kyc', label: 'PENDING KYC', value: stats.pendingKYC, icon: <AlertTriangle className="h-4 w-4" />, description: 'KYC not verified' },
    { key: 'newMonth', label: 'THIS MONTH', value: stats.thisMonth, icon: <Target className="h-4 w-4" />, description: 'Added this month' },
    { key: 'suspended', label: 'SUSPENDED', value: (partners as any[]).filter((p: any) => p.status === 'suspended').length, icon: <Users className="h-4 w-4" />, description: 'Suspended accounts' },
  ];

  const assignOptions = [
    { label: 'All Assigned', value: '' },
    ...salesUsers.map((u: any) => ({ label: u.name, value: u.id })),
  ];

  const activeFilterCount = (activeKpi ? 1 : 0) + (search ? 1 : 0) + (dateRange ? 1 : 0) + (statusF ? 1 : 0) + (kycF ? 1 : 0) + (assignF ? 1 : 0) + (createdByF ? 1 : 0);

  // ─────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <WorkspaceHero
        title="Channel Partners"
        icon={<Handshake className="h-6 w-6" />}
        breadcrumbs={['Home', 'Sales', 'Channel Partners']}
        statusText={`${stats.total} partners · ${stats.active} active`}
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
              Refresh
            </Button>
            {perms.canCreate('partners') && (
              <Button variant="outline" size="sm" icon={<Upload className="h-3.5 w-3.5" />}
                onClick={() => { setCsvImportFile(null); setCsvImportResult(null); setShowCsvImport(true); }}>
                Import CSV
              </Button>
            )}
            {perms.canCreate('partners') && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />}
                onClick={() => { setEditPartner(null); setShowForm(true); }}>
                Add Partner
              </Button>
            )}
          </>
        }
      />

      {/* ── KPI Grid ────────────────────────────────────── */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_CONFIGS.map(k => (
          <PremiumKpi
            key={k.key}
            label={k.label}
            value={k.value}
            icon={k.icon}
            description={k.description}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
              const next = activeKpi === k.key ? '' : k.key;
              setActiveKpi(next); setPage(1);
              syncQueueParams({ kpi: next, page: 1 });
            }}
          />
        ))}
      </div>

      {/* ── Card ─────────────────────────────────────────── */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[var(--shadow-enterprise-surface)]">
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
            <input
              aria-label="Search partners"
              placeholder="Search name, firm, phone, email..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)]
                bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)]
                placeholder:text-[var(--color-text-muted)] outline-none transition-colors
                focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />

            <Select
              aria-label="Date filter"
              value={dateRange}
              onChange={e => {
                const v = e.target.value;
                setDateRange(v); setPage(1);
                if (v !== 'custom') { setCustomFrom(''); setCustomTo(''); }
                syncQueueParams({ date: v, from: v === 'custom' ? customFrom : '', to: v === 'custom' ? customTo : '', page: 1 });
              }}
              options={DATE_OPTIONS}
              className="w-[110px] h-8 py-1"
            />

            {dateRange === 'custom' && (
              <div className="flex items-center gap-1">
                <input type="date" value={customFrom}
                  onChange={e => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-[130px]" />
                <span className="text-xs text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo}
                  onChange={e => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-[130px]" />
              </div>
            )}

            <Select
              aria-label="Status filter"
              value={activeKpi ? '' : statusF}
              onChange={e => { setStatusF(e.target.value); setPage(1); syncQueueParams({ status: e.target.value, page: 1 }); }}
              options={[
                { label: 'All Statuses', value: '' },
                ...PARTNER_STATUSES.map((s: string) => ({
                  label: s.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                  value: s,
                })),
              ]}
              className="w-[120px] h-8 py-1"
            />

            <Select
              aria-label="KYC status filter"
              value={kycF}
              onChange={e => { setKycF(e.target.value); setPage(1); syncQueueParams({ kyc: e.target.value, page: 1 }); }}
              options={[
                { label: 'All KYC', value: '' },
                ...KYC_STATUSES.map((s: string) => ({
                  label: s.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                  value: s,
                })),
              ]}
              className="w-[120px] h-8 py-1"
            />

            <Select
              aria-label="Assigned filter"
              value={assignF}
              onChange={e => { setAssignF(e.target.value); setPage(1); syncQueueParams({ owner: e.target.value, page: 1 }); }}
              options={assignOptions}
              className="w-[120px] h-8 py-1"
            />

            {/* Green status dot */}
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            </div>
          </div>

          {/* Active filter pills */}
          {activeFilterCount > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeKpi && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary-text)]">
                  {KPI_CONFIGS.find(k => k.key === activeKpi)?.label || activeKpi}
                  <button onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }}
                    className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              {search && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  S: {search.length > 20 ? search.slice(0, 20) + '…' : search}
                  <button onClick={() => { setSearch(''); setPage(1); }} className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              {dateRange && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {DATE_OPTIONS.find(d => d.value === dateRange)?.label || dateRange}
                  <button onClick={() => { setDateRange(''); setCustomFrom(''); setCustomTo(''); setPage(1); syncQueueParams({ date: '', from: '', to: '', page: 1 }); }}
                    className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              {statusF && !activeKpi && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {statusF.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  <button onClick={() => { setStatusF(''); setPage(1); syncQueueParams({ status: '', page: 1 }); }}
                    className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              {kycF && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  KYC: {kycF.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  <button onClick={() => { setKycF(''); setPage(1); syncQueueParams({ kyc: '', page: 1 }); }}
                    className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              {assignF && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  Assigned: {assignF}
                  <button onClick={() => { setAssignF(''); setPage(1); syncQueueParams({ owner: '', page: 1 }); }}
                    className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              <button onClick={clearAll}
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <X className="h-3 w-3" /> Clear
              </button>
            </div>
          )}
        </CardHeader>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">
              {selected.size} partner{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">
                Export CSV
              </Button>
              {perms.canEdit('partners') && (
                <Button size="sm" variant="outline"
                  icon={<Shield className="h-3.5 w-3.5" />} onClick={() => setShowBulkStatus(true)}
                  className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">
                  Change Status
                </Button>
              )}
              {perms.canEdit('partners') && (
                <Button size="sm" variant="outline"
                  icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => { setBulkAssignTarget(''); setShowBulkAssign(true); }}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">
                  Assign
                </Button>
              )}
              {perms.canDelete('partners') && (
                <Button size="sm" variant="outline"
                  icon={<UserX className="h-3.5 w-3.5" />} onClick={() => setShowBulkDelete(true)}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">
                  Delete
                </Button>
              )}
              <button onClick={() => setSelected(new Set())}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">✕ Clear</button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="px-6 flex-1 flex flex-col min-h-0">
          <div className="min-h-0 flex-1 overflow-auto scroll-pt-10">
            <Table>
              <Thead>
                <Th style={{ width: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel}
                    onChange={toggleAll} aria-label="Select all rows" />
                </Th>
                <Th sortable sorted={sortKey === 'firmName'} desc={sortDesc} onSort={() => sort('firmName')} style={{ minWidth: 200 }}>PARTNER</Th>
                <Th style={{ width: 160 }}>CONTACT</Th>
                <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')} style={{ width: 120 }}>STATUS</Th>
                <Th style={{ width: 110 }}>KYC</Th>
                <Th style={{ width: 90 }}>LEADS</Th>
                <Th sortable sorted={sortKey === 'totalCommissionEarned'} desc={sortDesc} onSort={() => sort('totalCommissionEarned')} style={{ width: 110 }}>COMMISSION</Th>
                <Th sortable sorted={sortKey === 'walletBalance'} desc={sortDesc} onSort={() => sort('walletBalance')} style={{ width: 100 }}>WALLET</Th>
                <Th sortable sorted={sortKey === 'createdAt'} desc={sortDesc} onSort={() => sort('createdAt')} style={{ width: 100 }}>CREATED</Th>
                <Th style={{ width: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? (
                  <SkeletonRows cols={10} rows={6} />
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={10}>
                      <EmptyState
                        icon={<Handshake className="h-9 w-9" />}
                        title={search || dateRange || statusF || kycF || assignF || activeKpi ? 'No partners match filters' : 'No partners yet'}
                        description={search || dateRange || statusF || kycF || assignF || activeKpi ? undefined : 'Add your first channel partner to get started.'}
                        action={(!search && !dateRange && !statusF && !kycF && !assignF && !activeKpi && perms.canCreate('partners')) ? (
                          <Button size="sm" icon={<Plus className="h-4 w-4" />}
                            onClick={() => { setEditPartner(null); setShowForm(true); }}>
                            Add Partner
                          </Button>
                        ) : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((p: any) => {
                    const displayName = p.firmName || p.contactPerson || 'Untitled';
                    const location = [p.address?.city, p.address?.state].filter(Boolean).join(', ');
                    return (
                      <Tr key={p.id} selected={selected.has(p.id)}
                        data-record-id={p.id} role="button" tabIndex={0}
                        onClick={(e) => handleRowClick(e, p)}
                        onKeyDown={(e) => handleRowKeyDown(e, p)}
                        className="group cursor-pointer transition-all duration-200 ease-out
                          hover:bg-[var(--color-table-row-hover)] focus-visible:bg-[var(--color-table-row-hover)]
                          focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset">
                        <Td>
                          <span data-interactive onClick={(e) => e.stopPropagation()}>
                            <UniversalCheckbox checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                          </span>
                        </Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 flex items-center justify-center text-xs font-bold shrink-0">
                              {displayName[0]?.toUpperCase() || '?'}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-[var(--color-text)] leading-tight">{p.firmName || p.contactPerson || '—'}</p>
                              <p className="text-[12px] text-[var(--color-text-muted)] truncate max-w-44 leading-tight">{location || <EmptyCell />}</p>
                            </div>
                          </div>
                        </Td>
                        <Td>
                          <div className="space-y-0.5">
                            {p.phone && (
                              <a href={`tel:${p.phone}`} data-interactive onClick={(e) => e.stopPropagation()}
                                className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 text-xs font-medium">
                                <Phone className="h-3 w-3" />{p.phone}
                              </a>
                            )}
                            {p.email && <p className="text-[10px] text-[var(--color-text-muted)] truncate max-w-32">{p.email}</p>}
                          </div>
                        </Td>
                        <Td><span data-interactive onClick={(e) => e.stopPropagation()}><PartnerStatusBadge status={p.status || 'pending_approval'} /></span></Td>
                        <Td><KYCStatusBadge status={p.kycStatus || 'not_started'} /></Td>
                        <Td><div className="flex items-center gap-2 text-xs"><span className="font-semibold text-[var(--color-text)]">{p.totalLeadsCreated || 0}</span><span className="text-[var(--color-text-muted)]">/ {p.totalLeadsConverted || 0}</span></div></Td>
                        <Td className="text-xs font-semibold text-[var(--color-text)] tabular-nums">{formatCurrency(p.totalCommissionEarned)}</Td>
                        <Td className="text-xs font-semibold text-[var(--color-text)] tabular-nums">{formatCurrency(p.walletBalance)}</Td>
                        <Td className="text-xs">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <span className={`h-1.5 w-1.5 rounded-full ${recencyDotClass(p.createdAt)}`} />
                            {formatCreatedDate(p.createdAt)}
                          </span>
                        </Td>
                        <Td>
                          <div data-action onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
                            className="flex items-center justify-end gap-1">
                            <button type="button" onClick={() => openView(p)}
                              className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)]
                                bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)]
                                shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out
                                hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[var(--shadow-enterprise-row)]
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
                              <Eye className="h-3.5 w-3.5" /> View
                            </button>
                          </div>
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </Tbody>
            </Table>
          </div>
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage}
              onChange={(p) => { setPage(p); syncQueueParams({ page: p }); }}
              onPerPageChange={(n) => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }} />
          </div>
        </div>
      </Card>

      {/* ── Create/Edit Modal ──────────────────────────────── */}
      <PartnerFormModal open={showForm} onClose={() => { setShowForm(false); setEditPartner(null); }}
        onSubmit={handleFormSubmit} editPartner={editPartner} loading={savePartner.isPending} salesUsers={salesUsers}
        linkUserOptions={linkUserOptions} managerOptions={managerOptions} />

      {/* ── Detail Drawer ─────────────────────────────────── */}
      <PartnerDetailDrawer partner={viewPartner} open={!!viewPartner} onClose={closeView}
        onEdit={openEdit} onApprove={handleApprove} onSuspend={handleSuspend} onReactivate={handleReactivate} />

      {/* ── Bulk Status Modal ──────────────────────────────── */}
      <Modal open={showBulkStatus} onClose={() => { setShowBulkStatus(false); setBulkStatusTarget(''); }}
        title="Change Partner Status" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Changing status for <span className="font-semibold text-[var(--color-text)]">{selected.size} partner{selected.size > 1 ? 's' : ''}</span>.
          </p>
          <InputSelect label="New Status" value={bulkStatusTarget} onChange={(e) => setBulkStatusTarget(e.target.value)}
            options={[{ label: 'Select Status...', value: '' },
              ...PARTNER_STATUSES.map((s: string) => ({
                label: s.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                value: s,
              })),
            ]} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowBulkStatus(false); setBulkStatusTarget(''); }}>Cancel</Button>
            <Button onClick={() => { if (!bulkStatusTarget) return toast.error('Select a status'); bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatusTarget }); }}
              loading={bulkStatusMutation.isPending}>Update {selected.size} Partners</Button>
          </div>
        </div>
      </Modal>

      {/* ── Import CSV Modal ────────────────────────────────── */}
      <Modal open={showCsvImport} onClose={() => { setShowCsvImport(false); setCsvImportFile(null); setCsvImportResult(null); }}
        title="Import Partners from CSV" size="md">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">Upload a CSV file with columns: firmName, contactPerson, phone, email, city, state, gstNumber, panNumber.</p>
          <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-6 text-center">
            <Upload className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
            <label className="mt-2 block cursor-pointer text-sm font-semibold text-[var(--color-primary-text)] hover:underline">
              {csvImportFile ? csvImportFile.name : 'Click to select CSV file'}
              <input type="file" accept=".csv" hidden onChange={handleCsvFileChange} />
            </label>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{csvImportFile ? `${(csvImportFile.size / 1024).toFixed(1)} KB` : 'Supports .csv files up to 5MB'}</p>
          </div>
          {csvImportResult && csvImportResult.errors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <p className="mb-1 text-sm font-semibold text-red-700 dark:text-red-400">{csvImportResult.created} imported, {csvImportResult.errors.length} errors</p>
              <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                {csvImportResult.errors.map((err, i) => (<li key={i} className="text-xs text-red-600 dark:text-red-400">{err}</li>))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowCsvImport(false); setCsvImportFile(null); setCsvImportResult(null); }}>Cancel</Button>
            <Button onClick={handleCsvImport} loading={csvImportMutation.isPending || csvImportSaving} disabled={!csvImportFile}>Import Partners</Button>
          </div>
        </div>
      </Modal>

      {/* ── Bulk Assign Modal ────────────────────────────────── */}
      <Modal open={showBulkAssign} onClose={() => { setShowBulkAssign(false); setBulkAssignTarget(''); }}
        title="Assign Sales Person" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Assign to <span className="font-semibold text-[var(--color-text)]">{selected.size} partner{selected.size > 1 ? 's' : ''}</span>.
          </p>
          <InputSelect label="Sales Person" value={bulkAssignTarget} onChange={(e) => setBulkAssignTarget(e.target.value)}
            options={[{ label: 'Select person...', value: '' }, ...salesUsers.map((u: any) => ({ label: u.name, value: u.id }))]} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowBulkAssign(false); setBulkAssignTarget(''); }}>Cancel</Button>
            <Button onClick={() => { if (!bulkAssignTarget) return toast.error('Select a sales person'); bulkAssignMutation.mutate({ ids: Array.from(selected), assignedUser: bulkAssignTarget }); }}
              loading={bulkAssignMutation.isPending} disabled={!bulkAssignTarget}>Assign {selected.size} Partner{selected.size > 1 ? 's' : ''}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Bulk Delete Confirm ──────────────────────────────── */}
      <ConfirmDialog open={showBulkDelete} onClose={() => setShowBulkDelete(false)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selected))}
        loading={bulkDeleteMutation.isPending}
        title="Delete Partners" message={`Delete ${selected.size} partner${selected.size > 1 ? 's' : ''} permanently?`} />

      {/* ── Delete Confirm ─────────────────────────────────── */}
      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => delId && deletePartner.mutate(delId, { onSuccess: () => { if (viewPartner?.id === delId) closeView(); } })}
        loading={deletePartner.isPending}
        title="Delete Partner" message="Delete this partner permanently? All logs will be lost." />
    </div>
  );
}
