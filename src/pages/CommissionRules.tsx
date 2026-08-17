/**
 * CommissionRules — Admin Commission Rule Management Workspace
 *
 * Desktop Gold Standard — visually identical to Leads.
 * All business logic preserved from original implementation.
 */

import { useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Download, FileText, Plus, RefreshCw, Upload, Eye,
  Copy, CheckCircle2, XCircle, Archive, Shield, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
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
import { fmtDate, getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange } from '../lib/dateFilters';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { usePermissions } from '../lib/permissions';
import { ChannelPartnerDomainService } from '../services/ChannelPartnerDomainService';
import { logActivity } from '../lib/workflow';
import { notifyRoleUsers } from '../lib/notifications';
import { NotificationType } from '../types';
import type { CommissionRule } from '../features/channel-partner/types';
import { CommissionRuleFormModal } from '../components/partner/CommissionRuleFormModal';
import { CommissionRuleDetailDrawer } from '../components/partner/CommissionRuleDetailDrawer';

const PER_PAGE = 10;
const ALL = 'All';

const DATE_OPTIONS = [
  { label: 'All dates', value: '' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
];

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'All Status', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
];

const SCOPE_OPTIONS: { label: string; value: string }[] = [
  { label: 'All Scopes', value: '' },
  { label: 'Default', value: 'all' },
  { label: 'Partner Tier', value: 'partner_tier' },
  { label: 'Category', value: 'product_category' },
  { label: 'Location', value: 'location' },
  { label: 'Partner', value: 'partner' },
];

const TYPE_OPTIONS: { label: string; value: string }[] = [
  { label: 'All Types', value: '' },
  { label: 'Percentage', value: 'percentage' },
  { label: 'Fixed', value: 'fixed' },
  { label: 'Per kW', value: 'per_kw' },
  { label: 'Per Deal', value: 'per_deal' },
  { label: 'Slab', value: 'slab' },
];

const TIER_OPTIONS: { label: string; value: string }[] = [
  { label: 'All Tiers', value: '' },
  { label: 'Bronze', value: 'bronze' },
  { label: 'Silver', value: 'silver' },
  { label: 'Gold', value: 'gold' },
  { label: 'Platinum', value: 'platinum' },
];

const TYPE_BADGE: Record<string, string> = {
  percentage: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  fixed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  per_kw: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  per_deal: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  slab: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

const SCOPE_BADGE: Record<string, string> = {
  all: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  partner: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  partner_tier: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  product_category: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  location: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
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
      {s === 'all' ? 'Default' : s.replace(/_/g, ' ')}
    </span>
  );
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

export default function CommissionRules() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const user = useAppStore((s) => s.user);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [scopeF, setScopeF] = useState(() => searchParams.get('scope') || '');
  const [typeF, setTypeF] = useState(() => searchParams.get('type') || '');
  const [tierF, setTierF] = useState(() => searchParams.get('tier') || '');
  const [createdByF, setCreatedByF] = useState(() => searchParams.get('createdBy') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || '');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState(() => searchParams.get('sort') || 'priority');
  const [sortDesc, setSortDesc] = useState(() => searchParams.get('sortDesc') !== '0');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Refs
  const lastClosedParamRef = useRef<string | null>(null);

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState<CommissionRule | null>(null);
  const [viewRule, setViewRule] = useState<CommissionRule | null>(null);
  const [showBulkToggle, setShowBulkToggle] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvImportFile, setCsvImportFile] = useState<File | null>(null);
  const [csvImportSaving, setCsvImportSaving] = useState(false);
  const [csvImportResult, setCsvImportResult] = useState<{ created: number; errors: string[] } | null>(null);

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();

  // ── Queries ──────────────────────────────────────────────
  const { data: allRules = [], isLoading, refetch } = useQuery({
    queryKey: companyKeys.commissionRules,
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RULES),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300000,
  });

  const rules = useMemo(() => (allRules as CommissionRule[]).filter((r) => !r.isDeleted), [allRules]);

  const userOptions = useMemo(() => {
    const names = new Set<string>();
    (rules as any[]).forEach((r: any) => names.add(r.createdBy || ''));
    const list = Array.from(names).filter(Boolean).sort();
    return [{ label: 'All Users', value: '' }, ...list.map((n) => ({ label: n, value: n }))];
  }, [rules]);

  // ── KPIs ──────────────────────────────────────────────────
  const kpis = useMemo(() => ({
    total: rules.length,
    active: rules.filter((r) => r.isActive).length,
    inactive: rules.filter((r) => !r.isActive).length,
    default: rules.filter((r) => r.applicableTo === 'all').length,
    location: rules.filter((r) => r.applicableTo === 'location').length,
    byTier: rules.filter((r) => r.applicableTo === 'partner_tier' || r.applicableTo === 'partner').length,
  }), [rules]);

  const isTotalDefault = !activeKpi && !search && !dateRange && !statusF && !scopeF && !typeF && !tierF && !createdByF;

  // ── Filtering ────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...rules];

    if (activeKpi === 'active') list = list.filter((r) => r.isActive);
    else if (activeKpi === 'inactive') list = list.filter((r) => !r.isActive);
    else if (activeKpi === 'default') list = list.filter((r) => r.applicableTo === 'all');
    else if (activeKpi === 'location') list = list.filter((r) => r.applicableTo === 'location');
    else if (activeKpi === 'byTier') list = list.filter((r) => r.applicableTo === 'partner_tier' || r.applicableTo === 'partner');

    const q = deferredSearch.toLowerCase().trim();
    if (q) {
      list = list.filter((r) =>
        [r.name, r.description, r.type, r.applicableTo, r.id]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (statusF) list = list.filter((r) => statusF === 'active' ? r.isActive : !r.isActive);
    if (scopeF) list = list.filter((r) => r.applicableTo === scopeF);
    if (typeF) list = list.filter((r) => r.type === typeF);
    if (tierF) list = list.filter((r) => r.partnerTier === tierF || r.applicableTo === 'partner');
    if (createdByF) list = list.filter((r: any) => r.createdBy === createdByF);
    if (dateRange) list = list.filter((r) => isInDateRange(r.createdAt, dateRange as any, customFrom, customTo));

    list.sort((a, b) => {
      const av = String(a[sortKey as keyof CommissionRule] || '');
      const bv = String(b[sortKey as keyof CommissionRule] || '');
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDesc ? -cmp : cmp;
    });

    return list;
  }, [rules, deferredSearch, statusF, scopeF, typeF, tierF, createdByF, dateRange, customFrom, customTo, activeKpi, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / perPage));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page, perPage]);

  // ── Mutations ───────────────────────────────────────────
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: companyKeys.commissionRules });
  }

  const toggleActive = useMutation({
    mutationFn: async (rule: CommissionRule) => {
      await ChannelPartnerDomainService.updateCommissionRule(rule.id, {
        isActive: !rule.isActive, updatedBy: user?.id || 'system',
      });
      await logActivity('Commission Rules', rule.isActive ? 'Deactivated' : 'Activated', rule.id, {
        entityName: rule.name, actionLabel: `Commission rule "${rule.name}" ${rule.isActive ? 'deactivated' : 'activated'}`,
      });
      void notifyRoleUsers(['Admin'], NotificationType.SETTLEMENT_COMPLETED, 'Rule status changed',
        `Commission rule "${rule.name}" has been ${rule.isActive ? 'deactivated' : 'activated'}.`,
        'commission_rule', rule.id, activeCompanyId).catch(() => {});
    },
    onSuccess: () => { invalidate(); toast.success('Rule status updated'); },
    onError: (err: any) => toast.error(err?.message || 'Failed to update'),
  });

  const archiveRule = useMutation({
    mutationFn: async (rule: CommissionRule) => {
      await ChannelPartnerDomainService.deleteCommissionRule(rule.id);
      await logActivity('Commission Rules', 'Archived', rule.id, {
        entityName: rule.name, actionLabel: `Commission rule "${rule.name}" archived`,
      });
    },
    onSuccess: () => { invalidate(); toast.success('Rule archived'); },
    onError: (err: any) => toast.error(err?.message || 'Failed to archive'),
  });

  const bulkToggleMutation = useMutation({
    mutationFn: async ({ ids, isActive }: { ids: string[]; isActive: boolean }) => {
      await Promise.all(ids.map((id) =>
        ChannelPartnerDomainService.updateCommissionRule(id, { isActive, updatedBy: user?.id || 'system' })
      ));
    },
    onSuccess: () => { invalidate(); toast.success(`${selected.size} rule${selected.size > 1 ? 's' : ''} updated`);
      setShowBulkToggle(false); setSelected(new Set()); },
    onError: (err: any) => toast.error(err?.message || 'Failed to update'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => ChannelPartnerDomainService.deleteCommissionRule(id)));
    },
    onSuccess: () => { invalidate(); toast.success(`Deleted ${selected.size} rule${selected.size > 1 ? 's' : ''}`);
      setShowBulkDelete(false); setSelected(new Set()); },
    onError: (err: any) => toast.error(err?.message || 'Failed to delete'),
  });

  // ── CSV Import ────────────────────────────────────────────
  const exportCsvMutation = useMutation({
    mutationFn: async (rows: any[]) => {
      const created: string[] = []; const errors: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          await ChannelPartnerDomainService.createCommissionRule({
            name: row.name || row['Name'] || `Imported Rule ${i + 1}`,
            type: (row.type || row['Type'] || 'per_kw').toLowerCase(),
            value: Number(row.value || row['Value'] || 0),
            applicableTo: 'all', isActive: true, priority: Number(row.priority || row['Priority'] || 1),
            companyId: activeCompanyId, createdBy: user?.id || 'system',
          });
          created.push(row.name || `Row ${i + 1}`);
        } catch (e: any) { errors.push(`Row ${i + 1}: ${e.message || 'Unknown error'}`); }
      }
      return { created: created.length, errors };
    },
    onSuccess: (result) => {
      setCsvImportResult(result);
      if (result.errors.length === 0) {
        toast.success(`Imported ${result.created} rule${result.created > 1 ? 's' : ''}`);
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
        if (!rows[0]?.name && !rows[0]?.['Name']) {
          toast.error('CSV must include a "name" or "Name" column');
          setCsvImportSaving(false); return;
        }
        exportCsvMutation.mutate(rows, { onSettled: () => setCsvImportSaving(false) });
      } catch { toast.error('Failed to parse CSV file'); setCsvImportSaving(false); }
    };
    reader.onerror = () => { toast.error('Failed to read CSV'); setCsvImportSaving(false); };
    reader.readAsText(csvImportFile);
  }

  function downloadRulesCsv(rows: any[], filename: string) {
    const headers = ['Name', 'Type', 'Value', 'Scope', 'Status', 'Priority', 'Effective From', 'Effective To', 'Created'];
    const lines = rows.map((r: any) =>
      [r.name, r.type, r.value, r.applicableTo, r.isActive ? 'Active' : 'Inactive', r.priority, r.effectiveFrom || '', r.effectiveTo || '', fmtDate(r.createdAt) || '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    const csv = [headers.join(','), ...lines].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportSelectedCsv() {
    const rows = rules.filter((r) => selected.has(r.id));
    if (!rows.length) return toast.error('No rules selected');
    const date = new Date().toISOString().slice(0, 10);
    downloadRulesCsv(rows, `commission-rules-export-${date}.csv`);
    toast.success(`Exported ${rows.length} rule${rows.length > 1 ? 's' : ''}`);
  }

  // ── URL sync ──────────────────────────────────────────
  const openParam = searchParams.get('open') || '';

  function syncQueueParams(nextState: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(searchParams);
    const keys = ['q', 'status', 'scope', 'type', 'tier', 'createdBy', 'date', 'from', 'to', 'kpi', 'sort', 'sortDesc', 'page', 'perPage', 'open'];
    keys.forEach((key) => {
      const val = nextState[key] ?? searchParams.get(key);
      if (val && val !== '' && val !== ALL && val !== 'all' && val !== 1) next.set(key, String(val));
      else next.delete(key);
    });
    setSearchParams(next, { replace: true });
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setScopeF(''); setTypeF(''); setTierF('');
    setCreatedByF(''); setDateRange(''); setCustomFrom(''); setCustomTo('');
    setActiveKpi(''); setPage(1);
    syncQueueParams({ q: '', status: '', scope: '', type: '', tier: '', createdBy: '', date: '', from: '', to: '', kpi: '', page: 1 });
  }

  function sort(k: string) {
    if (sortKey === k) { setSortDesc((d) => !d); syncQueueParams({ sort: k, sortDesc: sortDesc ? '' : '1' }); }
    else { setSortKey(k); setSortDesc(false); syncQueueParams({ sort: k, sortDesc: '' }); }
  }

  // ── URL param effect for detail open ─────────────────────
  useEffect(() => {
    if (lastClosedParamRef.current === openParam) { lastClosedParamRef.current = null; return; }
    if (!openParam || isLoading) return;
    const target = (rules as any[]).find((r: any) => r.id === openParam);
    if (target) { setViewRule(target); }
  }, [rules, isLoading, openParam]);

  const loading = isLoading;
  const hasActiveFilters = Boolean(search || statusF || scopeF || typeF || tierF || createdByF || dateRange || activeKpi);

  // ── Row selection ────────────────────────────────────────
  const toggleSelect = useCallback((id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);

  const toggleAll = () =>
    setSelected((s) => s.size === paginated.length ? new Set() : new Set(paginated.map((p) => p.id)));

  const allSel = selected.size === paginated.length && paginated.length > 0;

  const KPI_CONFIGS = [
    { key: '', label: 'TOTAL', value: kpis.total, icon: <FileText className="h-4 w-4" />, description: 'All commission rules' },
    { key: 'active', label: 'ACTIVE', value: kpis.active, icon: <CheckCircle2 className="h-4 w-4" />, description: 'Active rules' },
    { key: 'inactive', label: 'INACTIVE', value: kpis.inactive, icon: <XCircle className="h-4 w-4" />, description: 'Inactive rules' },
    { key: 'default', label: 'DEFAULT', value: kpis.default, icon: <Shield className="h-4 w-4" />, description: 'Applies to all' },
    { key: 'location', label: 'LOCATION', value: kpis.location, icon: <FileText className="h-4 w-4" />, description: 'Location-based' },
    { key: 'byTier', label: 'TIER/PARTNER', value: kpis.byTier, icon: <Copy className="h-4 w-4" />, description: 'By partner tier' },
  ];

  const activeFilterCount = (activeKpi ? 1 : 0) + (search ? 1 : 0) + (dateRange ? 1 : 0) + (statusF ? 1 : 0) + (scopeF ? 1 : 0) + (typeF ? 1 : 0) + (tierF ? 1 : 0) + (createdByF ? 1 : 0);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <WorkspaceHero
        title="Commission Rules"
        icon={<FileText className="h-6 w-6" />}
        breadcrumbs={['Home', 'Sales', 'Commission Rules']}
        statusText={`${kpis.total} rules · ${kpis.active} active`}
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            {perms.canCreate('partners') && (
              <Button variant="outline" size="sm" icon={<Upload className="h-3.5 w-3.5" />}
                onClick={() => { setCsvImportFile(null); setCsvImportResult(null); setShowCsvImport(true); }}>
                Import CSV
              </Button>
            )}
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />}
              onClick={() => { setEditRule(null); setShowForm(true); }}>
              New Rule
            </Button>
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
              aria-label="Search rules"
              placeholder="Search rules by name, type, scope..."
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
              options={STATUS_OPTIONS}
              className="w-[110px] h-8 py-1"
            />

            <Select
              aria-label="Scope filter"
              value={scopeF}
              onChange={e => { setScopeF(e.target.value); setPage(1); syncQueueParams({ scope: e.target.value, page: 1 }); }}
              options={SCOPE_OPTIONS}
              className="w-[120px] h-8 py-1"
            />

            <Select
              aria-label="Type filter"
              value={typeF}
              onChange={e => { setTypeF(e.target.value); setPage(1); syncQueueParams({ type: e.target.value, page: 1 }); }}
              options={TYPE_OPTIONS}
              className="w-[110px] h-8 py-1"
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
                  {statusF === 'active' ? 'Active' : 'Inactive'}
                  <button onClick={() => { setStatusF(''); setPage(1); syncQueueParams({ status: '', page: 1 }); }}
                    className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              {scopeF && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {SCOPE_OPTIONS.find(s => s.value === scopeF)?.label || scopeF}
                  <button onClick={() => { setScopeF(''); setPage(1); syncQueueParams({ scope: '', page: 1 }); }}
                    className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              {typeF && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {TYPE_OPTIONS.find(t => t.value === typeF)?.label || typeF}
                  <button onClick={() => { setTypeF(''); setPage(1); syncQueueParams({ type: '', page: 1 }); }}
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
              {selected.size} rule{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelectedCsv}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">
                Export CSV
              </Button>
              {perms.canEdit('partners') && (
                <Button size="sm" variant="outline"
                  icon={<Shield className="h-3.5 w-3.5" />} onClick={() => setShowBulkToggle(true)}
                  className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">
                  Toggle Status
                </Button>
              )}
              {perms.canDelete('partners') && (
                <Button size="sm" variant="outline"
                  icon={<Archive className="h-3.5 w-3.5" />} onClick={() => setShowBulkDelete(true)}
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
                <Th sortable sorted={sortKey === 'name'} desc={sortDesc} onSort={() => sort('name')} style={{ minWidth: 200 }}>RULE NAME</Th>
                <Th sortable sorted={sortKey === 'priority'} desc={sortDesc} onSort={() => sort('priority')} style={{ width: 80 }}>PRIORITY</Th>
                <Th style={{ width: 100 }}>SCOPE</Th>
                <Th style={{ width: 100 }}>TYPE</Th>
                <Th style={{ width: 100 }}>VALUE</Th>
                <Th sortable sorted={sortKey === 'isActive'} desc={sortDesc} onSort={() => sort('isActive')} style={{ width: 100 }}>STATUS</Th>
                <Th sortable sorted={sortKey === 'effectiveFrom'} desc={sortDesc} onSort={() => sort('effectiveFrom')} style={{ width: 100 }}>EFFECTIVE</Th>
                <Th style={{ width: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {loading ? (
                  <SkeletonRows cols={9} rows={6} />
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        icon={<FileText className="h-9 w-9" />}
                        title={hasActiveFilters ? 'No rules match filters' : 'No commission rules yet'}
                        description={hasActiveFilters ? undefined : 'Create your first commission rule to get started.'}
                        action={(!hasActiveFilters && perms.canCreate('partners')) ? (
                          <Button size="sm" icon={<Plus className="h-4 w-4" />}
                            onClick={() => { setEditRule(null); setShowForm(true); }}>
                            Create Your First Rule
                          </Button>
                        ) : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((rule: CommissionRule) => (
                    <Tr key={rule.id} selected={selected.has(rule.id)}
                      data-record-id={rule.id} role="button" tabIndex={0}
                      onClick={(e) => {
                        if ((e.target as HTMLElement)?.closest('button,a,input,select,textarea,[data-action]')) return;
                        if (window.getSelection()?.toString()) return;
                        setViewRule(rule);
                        syncQueueParams({ open: rule.id });
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewRule(rule); } }}
                      className="group cursor-pointer transition-all duration-200 ease-out
                        hover:bg-[var(--color-table-row-hover)] focus-visible:bg-[var(--color-table-row-hover)]
                        focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset">
                      <Td>
                        <span data-interactive onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox checked={selected.has(rule.id)} onChange={() => toggleSelect(rule.id)} />
                        </span>
                      </Td>
                      <Td>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--color-text)] leading-tight truncate max-w-[200px]">{rule.name}</p>
                          {rule.description && <p className="text-[10px] text-[var(--color-text-muted)] truncate max-w-[200px]">{rule.description}</p>}
                        </div>
                      </Td>
                      <Td className="text-xs font-medium text-center">{rule.priority}</Td>
                      <Td><ScopeBadge scope={rule.applicableTo} /></Td>
                      <Td><TypeBadge type={rule.type} /></Td>
                      <Td className="text-xs font-semibold tabular-nums">
                        {rule.type === 'percentage' ? `${rule.value}%` :
                         rule.type === 'slab' ? `${rule.slabs?.length || 0} slabs` :
                         `₹${rule.value?.toLocaleString('en-IN')}`}
                      </Td>
                      <Td>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          rule.isActive
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                          {rule.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </Td>
                      <Td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                        {rule.effectiveFrom ? fmtDate(rule.effectiveFrom) : '—'}
                      </Td>
                      <Td>
                        <div data-action onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
                          className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => { setViewRule(rule); syncQueueParams({ open: rule.id }); }}
                            className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)]
                              bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)]
                              shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out
                              hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[var(--shadow-enterprise-row)]
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
                            <Eye className="h-3.5 w-3.5" /> View
                          </button>
                          <button type="button" onClick={() => { setEditRule(rule); setShowForm(true); }}
                            className="p-1 text-[var(--color-text-muted)] hover:text-blue-500 transition-colors" title="Edit">
                            <FileText className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => toggleActive.mutate(rule)}
                            className="p-1 text-[var(--color-text-muted)] hover:text-amber-500 transition-colors"
                            title={rule.isActive ? 'Deactivate' : 'Activate'}>
                            {rule.isActive ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button" onClick={() => {
                            setEditRule({ ...rule, id: '', name: `${rule.name} (Copy)`, isActive: false });
                            setShowForm(true);
                          }} className="p-1 text-[var(--color-text-muted)] hover:text-green-500 transition-colors" title="Duplicate">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => { if (confirm(`Archive rule "${rule.name}"?`)) archiveRule.mutate(rule); }}
                            className="p-1 text-[var(--color-text-muted)] hover:text-red-500 transition-colors" title="Archive">
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  ))
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

      {/* ── Create/Edit Form Modal ─────────────────────────── */}
      <CommissionRuleFormModal open={showForm} onClose={() => { setShowForm(false); setEditRule(null); }}
        rule={editRule} onSuccess={() => invalidate()} />

      {/* ── Detail Drawer ─────────────────────────────────── */}
      <CommissionRuleDetailDrawer rule={viewRule} open={!!viewRule}
        onClose={() => { lastClosedParamRef.current = openParam; setViewRule(null);
          const next = new URLSearchParams(searchParams); next.delete('open'); setSearchParams(next, { replace: true }); }}
        onEdit={(r) => { setViewRule(null); setEditRule(r); setShowForm(true); }}
        onDuplicate={(r) => { setViewRule(null); setEditRule({ ...r, id: '', name: `${r.name} (Copy)`, isActive: false }); setShowForm(true); }} />

      {/* ── Bulk Toggle Modal ──────────────────────────────── */}
      <Modal open={showBulkToggle} onClose={() => setShowBulkToggle(false)} title="Toggle Rule Status" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Activate or deactivate <span className="font-semibold text-[var(--color-text)]">{selected.size}</span> rule{selected.size > 1 ? 's' : ''}?
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowBulkToggle(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => bulkToggleMutation.mutate({ ids: Array.from(selected), isActive: true })}
              loading={bulkToggleMutation.isPending}>Activate</Button>
            <Button variant="outline" onClick={() => bulkToggleMutation.mutate({ ids: Array.from(selected), isActive: false })}
              loading={bulkToggleMutation.isPending}>Deactivate</Button>
          </div>
        </div>
      </Modal>

      {/* ── Bulk Delete Confirm ────────────────────────────── */}
      <ConfirmDialog open={showBulkDelete} onClose={() => setShowBulkDelete(false)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selected))}
        loading={bulkDeleteMutation.isPending}
        title="Delete Rules" message={`Delete ${selected.size} rule${selected.size > 1 ? 's' : ''} permanently?`} />

      {/* ── Import CSV Modal ───────────────────────────────── */}
      <Modal open={showCsvImport} onClose={() => { setShowCsvImport(false); setCsvImportFile(null); setCsvImportResult(null); }}
        title="Import Rules from CSV" size="md">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">Upload a CSV file with columns: name, type, value, priority, isActive.</p>
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
            <Button onClick={handleCsvImport} loading={exportCsvMutation.isPending || csvImportSaving} disabled={!csvImportFile}>Import Rules</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
