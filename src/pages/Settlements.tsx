/**
 * Settlements — Admin Settlement & Withdrawal Workspace
 *
 * Desktop Gold Standard — visually identical to Leads where possible.
 * Tabs (settlements/withdrawals/scheduler) preserved as existing feature.
 * All business logic preserved from original implementation.
 */

import { useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  DollarSign, RefreshCw, Eye, CheckCircle2, XCircle, Clock, AlertTriangle,
  TrendingUp, Ban, Handshake, PlayCircle, Calendar, Download,
  ChevronDown, History, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Button, Card, CardHeader, ConfirmDialog, EmptyState, Pagination,
  PremiumKpi, Select, SkeletonRows, Table, Tbody, Td, Th, Thead, Tr,
  UniversalCheckbox, WorkspaceHero,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { fmtDate, fmtCurrency, fmtCompactCurrency, getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { createSettlementBatch, processSettlementBatch } from '../lib/channelPartnerSettlement';
import { loadSchedulerConfig } from '../lib/autoSettlementScheduler';
import type { CommissionRecord, PartnerWalletTransaction } from '../features/channel-partner/types';
import { SettlementDetailDrawer } from '../components/partner/SettlementDetailDrawer';
import { WithdrawalDetailDrawer } from '../components/partner/WithdrawalDetailDrawer';
import { BatchWithdrawalModal } from '../components/partner/BatchWithdrawalModal';
import { SchedulerConfigModal } from '../components/partner/SchedulerConfigModal';
import { ExportHistoryModal } from '../components/shared/ExportHistoryModal';
import { SchedulerHistoryModal } from '../components/partner/SchedulerHistoryModal';
import {
  downloadCsv, exportSettlementsToCsv, exportWithdrawalsToCsv,
  exportCommissionRecordsToCsv,
} from '../lib/settlementExport';
import { logExport } from '../lib/exportHistory';
import { recordSettlementAudit } from '../lib/settlementAudit';
import { previewRecalculation, previewBatchRecalculation } from '../lib/commissionRecalculation';
import { RecalculationPreviewModal } from '../components/partner/RecalculationPreviewModal';
import type { RecalculationPreview } from '../features/channel-partner/types';

const PER_PAGE = 10;

const DATE_OPTIONS = [
  { label: 'All dates', value: '' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
];

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'All Status', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Processing', value: 'processing' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
];

const WITHDRAWAL_STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'All Status', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Processing', value: 'processing' },
  { label: 'Paid', value: 'paid' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Cancelled', value: 'cancelled' },
];

const SETTLEMENT_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const style = SETTLEMENT_BADGE[s] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {s.charAt(0).toUpperCase() + s.slice(1)}
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

type Tab = 'settlements' | 'withdrawals' | 'scheduler';

export default function Settlements() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>(() => (searchParams.get('tab') as Tab) || 'settlements');

  // Filters
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || '');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [createdByF, setCreatedByF] = useState(() => searchParams.get('createdBy') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [sortKey, setSortKey] = useState('createdAt');
  const [sortDesc, setSortDesc] = useState(true);

  // Selection & drawers
  const [viewSettlement, setViewSettlement] = useState<any>(null);
  const [viewWithdrawal, setViewWithdrawal] = useState<any>(null);
  const [batchWithdrawalIds, setBatchWithdrawalIds] = useState<string[]>([]);

  // Recalculation state
  const [recalcPreviews, setRecalcPreviews] = useState<RecalculationPreview[]>([]);
  const [recalcUseCurrentRules, setRecalcUseCurrentRules] = useState(true);
  const [showRecalcModal, setShowRecalcModal] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [batchAction, setBatchAction] = useState<'approve' | 'reject' | 'process' | 'pay' | 'cancel'>('approve');
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showSchedulerModal, setShowSchedulerModal] = useState(false);
  const [showExportHistory, setShowExportHistory] = useState(false);
  const [showSchedulerHistory, setShowSchedulerHistory] = useState(false);
  const [showRecalcMenu, setShowRecalcMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [schedulerSummary, setSchedulerSummary] = useState<{ lastRunAt?: string; totalRuns: number; totalSettledAmount: number } | null>(null);
  const [batchSummary, setBatchSummary] = useState<{ success: number; failed: number } | null>(null);

  // Load scheduler summary
  useEffect(() => {
    if (activeCompanyId) {
      loadSchedulerConfig().then(cfg => {
        setSchedulerSummary({ lastRunAt: cfg.lastRunAt, totalRuns: cfg.totalRuns, totalSettledAmount: cfg.totalSettledAmount });
      }).catch(() => {});
    }
  }, [activeCompanyId]);

  // Queries
  const { data: allTxns = [], isLoading, refetch } = useQuery({
    queryKey: companyKeys.settlementsRoot,
    queryFn: async () => {
      const fromSettlements = await getAll(COLLECTIONS.SETTLEMENTS);
      if (fromSettlements.length > 0) return fromSettlements;
      const legacyTxns = await getAll(COLLECTIONS.PARTNER_WALLET_TXNS);
      return legacyTxns.filter((t: any) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted);
    },
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: walletTxns = [] } = useQuery({
    queryKey: companyKeys.partnerWalletTxns,
    queryFn: () => getAll(COLLECTIONS.PARTNER_WALLET_TXNS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: allCommissionRecords = [] } = useQuery({
    queryKey: companyKeys.commissionRules,
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: partners = [] } = useQuery({
    queryKey: companyKeys.partnersAll,
    queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  // Partner lookup
  const partnerNames = useMemo(() => {
    const map: Record<string, string> = {};
    (partners as any[]).forEach((p: any) => { if (p.id) map[p.id] = p.firmName || p.contactPerson || p.id; });
    return map;
  }, [partners]);

  // Created by options
  const createdByOptions = useMemo(() => {
    const names = new Set<string>();
    [...allTxns, ...walletTxns].forEach((t: any) => {
      if (t.createdBy) names.add(t.createdBy);
      if (t.processedBy) names.add(t.processedBy);
    });
    const list = Array.from(names).filter(Boolean).sort();
    return [{ label: 'All Users', value: '' }, ...list.map((n) => ({ label: n, value: n }))];
  }, [allTxns, walletTxns]);

  // Derived data
  const settlements = useMemo(() => {
    const data = (allTxns as any[]).filter((t: any) => !t.type || t.commissionIds);
    if (data.length === 0) {
      return (walletTxns as any[])
        .filter((t: any) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted)
        .map((t: any) => ({ ...t, partnerName: t.partnerName || partnerNames[t.partnerId] || t.partnerId }))
        .sort((a: any, b: any) => (toDateValue(b.createdAt)?.getTime() || 0) - (toDateValue(a.createdAt)?.getTime() || 0));
    }
    return (data as any[])
      .map((t: any) => ({ ...t, partnerName: t.partnerName || partnerNames[t.partnerId] || t.partnerId }))
      .sort((a: any, b: any) => (toDateValue(b.createdAt)?.getTime() || 0) - (toDateValue(a.createdAt)?.getTime() || 0));
  }, [allTxns, walletTxns, partnerNames]);

  const withdrawals = useMemo(() => {
    return (walletTxns as any[])
      .filter((t: any) => t.type === 'withdrawal_request' && !t.isDeleted)
      .map((t: any) => ({ ...t, partnerName: t.partnerName || partnerNames[t.partnerId] || t.partnerId }))
      .sort((a: any, b: any) => (toDateValue(b.createdAt)?.getTime() || 0) - (toDateValue(a.createdAt)?.getTime() || 0));
  }, [walletTxns, partnerNames]);

  const pendingCommissionCount = useMemo(() => {
    return (allCommissionRecords as any[]).filter((r: any) => r.status === 'approved' && !r.isDeleted).length;
  }, [allCommissionRecords]);

  // KPIs - Settlements
  const kpis = useMemo(() => {
    const settled = settlements;
    const totalAmount = settled.reduce((sum: number, s: any) => sum + (s.totalAmount || 0), 0);
    const pendingSettlements = settled.filter((s: any) => s.status === 'pending').length;
    const processingCount = settled.filter((s: any) => s.status === 'processing').length;
    const completedCount = settled.filter((s: any) => s.status === 'completed').length;
    const failedCount = settled.filter((s: any) => s.status === 'failed').length;
    const pendingWithdrawals = withdrawals.filter((w: any) => w.withdrawalStatus === 'pending').length;
    const approvedWithdrawals = withdrawals.filter((w: any) => w.withdrawalStatus === 'approved').length;
    const paidWithdrawals = withdrawals.filter((w: any) => w.withdrawalStatus === 'paid').length;
    const totalWithdrawalAmount = withdrawals.reduce((sum: number, w: any) => sum + Math.abs(w.amount || 0), 0);
    const uniquePartners = new Set([...settled.map((s: any) => s.partnerId), ...withdrawals.map((w: any) => w.partnerId)]);
    return {
      total: settled.length, pendingSettlements, processingCount, completedCount, failedCount, totalAmount,
      pendingWithdrawals, approvedWithdrawals, paidWithdrawals, totalWithdrawalAmount,
      uniquePartnerCount: uniquePartners.size, pendingCommissionCount,
    };
  }, [settlements, withdrawals, pendingCommissionCount]);

  const isTotalDefault = !activeKpi && !search && !dateRange && !statusF && !createdByF;

  // Filtering
  const currentData = tab === 'settlements' ? settlements : withdrawals;

  const filtered = useMemo(() => {
    let list = [...currentData];
    const q = deferredSearch.toLowerCase().trim();
    if (q) list = list.filter((item: any) => [item.id, item.partnerName, item.partnerId, item.status, item.withdrawalStatus].some((v) => String(v || '').toLowerCase().includes(q)));
    if (activeKpi === 'pending' && tab === 'settlements') list = list.filter((s: any) => s.status === 'pending');
    else if (activeKpi === 'processing' && tab === 'settlements') list = list.filter((s: any) => s.status === 'processing');
    else if (activeKpi === 'completed' && tab === 'settlements') list = list.filter((s: any) => s.status === 'completed');
    else if (activeKpi === 'failed' && tab === 'settlements') list = list.filter((s: any) => s.status === 'failed');
    if (createdByF) list = list.filter((item: any) => item.createdBy === createdByF || item.processedBy === createdByF);
    if (statusF) {
      if (tab === 'settlements') list = list.filter((item: any) => item.status === statusF);
      else list = list.filter((item: any) => item.withdrawalStatus === statusF);
    }
    list.sort((a: any, b: any) => {
      const av = String(a[sortKey as keyof typeof a] || '');
      const bv = String(b[sortKey as keyof typeof b] || '');
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDesc ? -cmp : cmp;
    });
    if (dateRange) {
      list = list.filter((item: any) => {
        const d = toDateValue(item.createdAt);
        if (!d) return false;
        const now = new Date(); now.setHours(0, 0, 0, 0);
        if (dateRange === 'today') return d.getTime() >= now.getTime();
        if (dateRange === '7d') return (now.getTime() - d.getTime()) <= 7 * 86400000;
        if (dateRange === '30d') return (now.getTime() - d.getTime()) <= 30 * 86400000;
        if (dateRange === 'custom' && customFrom && customTo) {
          const from = new Date(customFrom), to = new Date(customTo);
          return d >= from && d <= to;
        }
        return true;
      });
    }
    return list;
  }, [currentData, deferredSearch, statusF, dateRange, customFrom, customTo, activeKpi, sortKey, sortDesc, tab, createdByF]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  useEffect(() => { const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE)); if (page > maxPage) setPage(maxPage); }, [filtered.length, page]);

  // Mutations
  const createBatch = useMutation({
    mutationFn: async () => {
      const approved = (allCommissionRecords as any[]).filter((r: any) => r.status === 'approved' && !r.isDeleted);
      if (approved.length === 0) throw new Error('No approved commissions to settle');
      return createSettlementBatch(approved.map((r: any) => r.id));
    },
    onSuccess: (result) => { if (result) { toast.success('Settlement batch created successfully'); queryClient.invalidateQueries({ queryKey: companyKeys.partnerWalletTxns }); queryClient.invalidateQueries({ queryKey: companyKeys.settlementsRoot }); } else toast.error('No eligible approved commissions found'); },
    onError: (err: any) => toast.error(err?.message || 'Failed to create settlement batch'),
  });

  const processSelectedBatch = useMutation({
    mutationFn: async (settlementId: string) => {
      const settlement = settlements.find((s: any) => s.id === settlementId);
      const prevStatus = settlement?.status || 'pending';
      const result = await processSettlementBatch(settlementId);
      await recordSettlementAudit(settlementId, 'settlement', 'processed', prevStatus, result.success === result.total ? 'completed' : 'failed', `${result.success} success, ${result.skipped} skipped, ${result.failed} failed`);
      return result;
    },
    onSuccess: (result) => { toast.success(`Settlement processed: ${result.success} success, ${result.skipped} skipped, ${result.failed} failed`); queryClient.invalidateQueries({ queryKey: companyKeys.partnerWalletTxns }); queryClient.invalidateQueries({ queryKey: companyKeys.settlementsRoot }); queryClient.invalidateQueries({ queryKey: companyKeys.commissionRules }); },
    onError: (err: any) => toast.error(err?.message || 'Failed to process settlement'),
  });

  // URL sync
  function syncQueueParams(nextState: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(searchParams);
    const keys = ['q', 'status', 'date', 'from', 'to', 'createdBy', 'kpi', 'page', 'tab'];
    keys.forEach((key) => {
      const val = nextState[key] ?? searchParams.get(key);
      if (val && val !== '' && val !== 1) next.set(key, String(val));
      else next.delete(key);
    });
    setSearchParams(next, { replace: true });
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setCreatedByF(''); setDateRange(''); setCustomFrom(''); setCustomTo('');
    setActiveKpi(''); setPage(1);
    syncQueueParams({ q: '', status: '', createdBy: '', date: '', from: '', to: '', kpi: '', page: 1 });
  }

  function handleTabChange(newTab: Tab) {
    setTab(newTab); setPage(1); setBatchWithdrawalIds([]); setStatusF(''); setSearch(''); setActiveKpi(''); setBatchSummary(null); setShowRecalcMenu(false);
    syncQueueParams({ tab: newTab, q: '', status: '', kpi: '', page: 1 });
  }

  function handleBatchAction(action: typeof batchAction) { setBatchAction(action); setShowBatchModal(true); }
  function toggleWithdrawalSelection(id: string) { setBatchWithdrawalIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); }
  function selectAllWithdrawals() { setBatchWithdrawalIds(prev => prev.length === filtered.length ? [] : filtered.map((w: any) => w.id)); }

  async function handleRecalculate(commissionIds: string[], useCurrentRules: boolean) {
    if (!commissionIds.length) { toast.error('No commissions selected'); return; }
    setRecalcLoading(true); setRecalcUseCurrentRules(useCurrentRules);
    try { const previews = await previewRecalculation(commissionIds, { useCurrentRules }); setRecalcPreviews(previews); setShowRecalcModal(true); }
    catch (err: any) { toast.error(err?.message || 'Failed to preview recalculation'); }
    finally { setRecalcLoading(false); setShowRecalcMenu(false); }
  }

  async function handleRecalculateBatch(settlementId: string, useCurrentRules: boolean) {
    setRecalcLoading(true); setRecalcUseCurrentRules(useCurrentRules);
    try { const previews = await previewBatchRecalculation(settlementId, { useCurrentRules }); setRecalcPreviews(previews); setShowRecalcModal(true); }
    catch (err: any) { toast.error(err?.message || 'Failed'); }
    finally { setRecalcLoading(false); setShowRecalcMenu(false); }
  }

  function handleRecalcApplied() { setShowRecalcModal(false); setRecalcPreviews([]); setRecalcUseCurrentRules(true); queryClient.invalidateQueries({ queryKey: companyKeys.commissionRules }); queryClient.invalidateQueries({ queryKey: companyKeys.partnerWalletTxns }); queryClient.invalidateQueries({ queryKey: companyKeys.settlementsRoot }); refetch(); }
  function handleBatchComplete(summary: { success: number; failed: number }) { setBatchSummary(summary); setBatchWithdrawalIds([]); setBatchAction('approve'); setShowBatchModal(false); }

  const hasActiveFilters = Boolean(search || statusF || dateRange || createdByF || activeKpi);
  const activeFilterCount = (activeKpi ? 1 : 0) + (search ? 1 : 0) + (dateRange ? 1 : 0) + (statusF ? 1 : 0) + (createdByF ? 1 : 0);

  const SETTLEMENT_KPI_CONFIGS = [
    { key: '', label: 'TOTAL SETTLEMENTS', value: kpis.total, icon: <DollarSign className="h-4 w-4" />, description: 'All settlement batches' },
    { key: 'pending', label: 'PENDING', value: kpis.pendingSettlements, icon: <Clock className="h-4 w-4" />, description: 'Awaiting processing' },
    { key: 'processing', label: 'PROCESSING', value: kpis.processingCount, icon: <RefreshCw className="h-4 w-4" />, description: 'In progress' },
    { key: 'completed', label: 'COMPLETED', value: kpis.completedCount, icon: <CheckCircle2 className="h-4 w-4" />, description: 'Successfully processed' },
    { key: 'failed', label: 'FAILED', value: kpis.failedCount, icon: <AlertTriangle className="h-4 w-4" />, description: 'Processing failed' },
    { key: 'totalValue', label: 'TOTAL VALUE', value: fmtCompactCurrency(kpis.totalAmount), icon: <TrendingUp className="h-4 w-4" />, description: 'Total settlement amount' },
  ];

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <WorkspaceHero
        title={tab === 'settlements' ? 'Settlements' : tab === 'withdrawals' ? 'Withdrawals' : 'Scheduler'}
        icon={<DollarSign className="h-6 w-6" />}
        breadcrumbs={['Home', 'Sales', tab === 'settlements' ? 'Settlements' : tab === 'withdrawals' ? 'Withdrawals' : 'Scheduler']}
        statusText={`${kpis.total} settlements`}
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {tab === 'settlements' && (
              <>
                <div className="relative">
                  <Button size="sm" variant="outline" icon={<TrendingUp className="h-3.5 w-3.5" />}
                    onClick={() => setShowRecalcMenu(!showRecalcMenu)} loading={recalcLoading}>
                    Recalculate <ChevronDown className="h-3 w-3 ml-0.5" />
                  </Button>
                  {showRecalcMenu && (
                    <><div className="fixed inset-0 z-40" onClick={() => setShowRecalcMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-lg overflow-hidden">
                        <div className="py-1">
                          <div className="px-3 py-1.5"><p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Using Current Rules</p></div>
                          {[
                            { label: `All Unpaid (${allCommissionRecords.filter((r: any) => r.status !== 'paid' && !r.isDeleted).length})`, onClick: () => handleRecalculate(allCommissionRecords.filter((r: any) => r.status !== 'paid' && !r.isDeleted).map((r: any) => r.id), true) },
                            { label: `Approved Only (${allCommissionRecords.filter((r: any) => r.status === 'approved' && !r.isDeleted).length})`, onClick: () => handleRecalculate(allCommissionRecords.filter((r: any) => r.status === 'approved' && !r.isDeleted).map((r: any) => r.id), true) },
                            { label: `Pending Only (${allCommissionRecords.filter((r: any) => r.status === 'pending' && !r.isDeleted).length})`, onClick: () => handleRecalculate(allCommissionRecords.filter((r: any) => r.status === 'pending' && !r.isDeleted).map((r: any) => r.id), true) },
                            { label: 'Selected Settlement Batch', onClick: () => { if (viewSettlement) handleRecalculateBatch(viewSettlement.id, true); else toast('Select a settlement batch first', { icon: 'ℹ️' }); } },
                          ].map((item, i) => (
                            <button key={i} onClick={item.onClick} className="w-full text-left px-4 py-2 text-xs font-medium hover:bg-[var(--color-bg-sunken)] text-[var(--color-text)]">{item.label}</button>
                          ))}
                          <div className="border-t border-[var(--color-border-subtle)] my-1" />
                          <div className="px-3 py-1.5"><p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Using Historical Snapshot</p></div>
                          {[
                            { label: `All with Snapshots (${allCommissionRecords.filter((r: any) => r.status !== 'paid' && !r.isDeleted && r.ruleSnapshot).length})`, onClick: () => handleRecalculate(allCommissionRecords.filter((r: any) => r.status !== 'paid' && !r.isDeleted && r.ruleSnapshot).map((r: any) => r.id), false) },
                            { label: `Approved with Snapshots (${allCommissionRecords.filter((r: any) => r.status === 'approved' && !r.isDeleted && r.ruleSnapshot).length})`, onClick: () => handleRecalculate(allCommissionRecords.filter((r: any) => r.status === 'approved' && !r.isDeleted && r.ruleSnapshot).map((r: any) => r.id), false) },
                            { label: 'Settlement Batch (Snapshot)', onClick: () => { if (viewSettlement) handleRecalculateBatch(viewSettlement.id, false); else toast('Select a batch', { icon: 'ℹ️' }); } },
                          ].map((item, i) => (
                            <button key={i+10} onClick={item.onClick} className="w-full text-left px-4 py-2 text-xs font-medium hover:bg-[var(--color-bg-sunken)] text-[var(--color-text)]">{item.label}</button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className="relative">
                  <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={() => setShowExportMenu(!showExportMenu)}>
                    Export <ChevronDown className="h-3 w-3 ml-0.5" />
                  </Button>
                  {showExportMenu && (
                    <><div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-lg overflow-hidden">
                        <div className="py-1">
                          {[
                            { label: 'CSV — Settlements', onClick: () => { downloadCsv(exportSettlementsToCsv(settlements, partnerNames), 'settlements-export.csv'); logExport('settlements', 'CSV', 'settlements-export.csv', settlements.length).catch(()=>{}); setShowExportMenu(false); } },
                            { label: 'CSV — Withdrawals', onClick: () => { downloadCsv(exportWithdrawalsToCsv(withdrawals, partnerNames), 'withdrawals-export.csv'); logExport('withdrawals', 'CSV', 'withdrawals-export.csv', withdrawals.length).catch(()=>{}); setShowExportMenu(false); } },
                            { label: 'CSV — Commission Records', onClick: () => { downloadCsv(exportCommissionRecordsToCsv(allCommissionRecords, partnerNames), 'commission-records-export.csv'); logExport('commission_records', 'CSV', 'commission-records-export.csv', allCommissionRecords.length).catch(()=>{}); setShowExportMenu(false); } },
                          ].map((item, i) => (<button key={i} onClick={item.onClick} className="w-full text-left px-4 py-2 text-xs font-medium hover:bg-[var(--color-bg-sunken)] text-[var(--color-text)]">{item.label}</button>))}
                          <div className="border-t border-[var(--color-border-subtle)] my-1" />
                          <button onClick={() => { setShowExportMenu(false); setShowExportHistory(true); }} className="w-full text-left px-4 py-2 text-xs font-medium hover:bg-[var(--color-bg-sunken)] text-[var(--color-text)]">📋 View Export History</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <Button size="sm" variant="outline" icon={<PlayCircle className="h-3.5 w-3.5" />} onClick={() => createBatch.mutate()} loading={createBatch.isPending} disabled={pendingCommissionCount === 0}>Create Batch</Button>
                <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>Refresh</Button>
              </>
            )}
            {tab === 'withdrawals' && (
              <>
                <Button size="sm" variant="outline" icon={<Calendar className="h-3.5 w-3.5" />} onClick={() => setShowSchedulerModal(true)}>Scheduler</Button>
                <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>Refresh</Button>
              </>
            )}
            {tab === 'scheduler' && (
              <>
                <Button size="sm" variant="ghost" icon={<History className="h-3.5 w-3.5" />} onClick={() => setShowSchedulerHistory(true)}>History</Button>
                <Button size="sm" variant="outline" icon={<Calendar className="h-3.5 w-3.5" />} onClick={() => setShowSchedulerModal(true)}>Configure</Button>
              </>
            )}
          </div>
        }
      />

      {/* Tab Switcher */}
      <div className="flex gap-1 rounded-xl bg-[var(--color-bg-sunken)] p-1 w-fit">
        {(['settlements', 'withdrawals', 'scheduler'] as Tab[]).map(t => (
          <button key={t} onClick={() => handleTabChange(t)}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all capitalize ${
              tab === t ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}>{t}</button>
        ))}
      </div>

      {/* KPI Grid — Settlements tab */}
      {tab === 'settlements' && (
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
          {SETTLEMENT_KPI_CONFIGS.map(k => (
            <PremiumKpi key={k.key} label={k.label} value={k.value} icon={k.icon} description={k.description}
              active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
              onClick={k.key === 'totalValue' ? undefined : () => { const next = activeKpi === k.key ? '' : k.key; setActiveKpi(next); setPage(1); syncQueueParams({ kpi: next, page: 1 }); }} />
          ))}
        </div>
      )}

      {/* Withdrawals tab — simple stat cards (non-filterable) */}
      {tab === 'withdrawals' && (
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'PENDING', value: kpis.pendingWithdrawals, icon: <Clock className="h-4 w-4" />, desc: 'Awaiting review' },
            { label: 'APPROVED', value: kpis.approvedWithdrawals, icon: <CheckCircle2 className="h-4 w-4" />, desc: 'Approved' },
            { label: 'PAID', value: kpis.paidWithdrawals, icon: <DollarSign className="h-4 w-4" />, desc: 'Paid out' },
            { label: 'TOTAL AMOUNT', value: fmtCompactCurrency(kpis.totalWithdrawalAmount), icon: <TrendingUp className="h-4 w-4" />, desc: 'Total amount' },
            { label: 'PARTNERS', value: kpis.uniquePartnerCount, icon: <Handshake className="h-4 w-4" />, desc: 'Unique partners' },
          ].map((k, i) => (
            <PremiumKpi key={String(i)} label={k.label} value={k.value} icon={k.icon} description={k.desc} active={false} />
          ))}
        </div>
      )}

      {/* Main content area */}
      {tab !== 'scheduler' && (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[var(--shadow-enterprise-surface)]">
          <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
              <input aria-label="Search" placeholder={tab === 'settlements' ? 'Search settlements...' : 'Search withdrawals...'}
                value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />

              <Select aria-label="Date" value={dateRange} onChange={e => { const v = e.target.value; setDateRange(v); setPage(1); if (v !== 'custom') { setCustomFrom(''); setCustomTo(''); } syncQueueParams({ date: v, page: 1 }); }}
                options={DATE_OPTIONS} className="w-[110px] h-8 py-1" />
              {dateRange === 'custom' && (
                <div className="flex items-center gap-1">
                  <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, page: 1 }); }}
                    className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-[130px]" />
                  <span className="text-xs text-[var(--color-text-muted)]">to</span>
                  <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, page: 1 }); }}
                    className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-[130px]" />
                </div>
              )}

              <Select aria-label="Status" value={activeKpi && tab === 'settlements' ? '' : statusF}
                onChange={e => { setStatusF(e.target.value); setPage(1); syncQueueParams({ status: e.target.value, page: 1 }); }}
                options={tab === 'settlements' ? STATUS_OPTIONS : WITHDRAWAL_STATUS_OPTIONS} className="w-[110px] h-8 py-1" />
              <Select aria-label="Created by" value={createdByF} onChange={e => { setCreatedByF(e.target.value); setPage(1); syncQueueParams({ createdBy: e.target.value, page: 1 }); }}
                options={createdByOptions} className="w-[120px] h-8 py-1" />
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" /></div>
            </div>

            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeKpi && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary-text)]">{SETTLEMENT_KPI_CONFIGS.find(k => k.key === activeKpi)?.label || activeKpi}<button onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
                {search && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">S: {search.length > 20 ? search.slice(0, 20) + '…' : search}<button onClick={() => { setSearch(''); setPage(1); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
                {dateRange && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">{DATE_OPTIONS.find(d => d.value === dateRange)?.label || dateRange}<button onClick={() => { setDateRange(''); setCustomFrom(''); setCustomTo(''); setPage(1); syncQueueParams({ date: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
                {statusF && !activeKpi && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">{statusF}<button onClick={() => { setStatusF(''); setPage(1); syncQueueParams({ status: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
                <button onClick={clearAll} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X className="h-3 w-3" /> Clear</button>
              </div>
            )}
          </CardHeader>

          {/* Batch withdrawal selection bar */}
          {tab === 'withdrawals' && batchWithdrawalIds.length > 0 && (
            <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
              <span className="text-sm font-semibold text-[var(--color-primary-text)]">{batchWithdrawalIds.length} selected</span>
              {batchSummary && <span className="text-[10px] text-emerald-600">Last: {batchSummary.success}S / {batchSummary.failed}F</span>}
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                {(['approve', 'reject', 'process', 'pay', 'cancel'] as const).map(action => (
                  <button key={action} onClick={() => handleBatchAction(action)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-semibold hover:bg-[var(--color-surface-hover)] transition-colors capitalize">
                    {action === 'approve' && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                    {action === 'reject' && <XCircle className="h-3 w-3 text-red-500" />}
                    {action === 'process' && <PlayCircle className="h-3 w-3 text-indigo-500" />}
                    {action === 'pay' && <DollarSign className="h-3 w-3 text-blue-500" />}
                    {action === 'cancel' && <Ban className="h-3 w-3 text-gray-500" />}
                    {action}
                  </button>
                ))}
                <button onClick={() => setBatchWithdrawalIds([])} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">✕ Clear</button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="px-6 flex-1 flex flex-col min-h-0">
            <div className="min-h-0 flex-1 overflow-auto scroll-pt-10">
              <Table>
                <Thead>
                  {tab === 'settlements' ? (
                    <>
                      <Th style={{ width: 44 }}><UniversalCheckbox checked={false} onChange={() => {}} /></Th>
                      <Th style={{ minWidth: 100 }}>ID</Th>
                      <Th sortable sorted={sortKey === 'partnerName'} desc={sortDesc} onSort={() => { if (sortKey === 'partnerName') setSortDesc(d => !d); else { setSortKey('partnerName'); setSortDesc(true); }}} style={{ minWidth: 140 }}>PARTNER</Th>
                      <Th style={{ width: 100 }}>COMMISSIONS</Th>
                      <Th style={{ width: 110 }}>AMOUNT</Th>
                      <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => { if (sortKey === 'status') setSortDesc(d => !d); else { setSortKey('status'); setSortDesc(true); }}} style={{ width: 110 }}>STATUS</Th>
                      <Th style={{ width: 110 }}>RESULT</Th>
                      <Th style={{ width: 100 }}>CREATED</Th>
                      <Th style={{ width: 130 }}>ACTIONS</Th>
                    </>
                  ) : (
                    <>
                      <Th style={{ width: 44 }}>
                        <input type="checkbox" checked={batchWithdrawalIds.length === filtered.length && filtered.length > 0} onChange={selectAllWithdrawals}
                          className="rounded border-[var(--color-border)] text-indigo-600 cursor-pointer" />
                      </Th>
                      <Th style={{ minWidth: 100 }}>ID</Th>
                      <Th style={{ minWidth: 140 }}>PARTNER</Th>
                      <Th style={{ width: 110 }}>AMOUNT</Th>
                      <Th style={{ width: 110 }}>STATUS</Th>
                      <Th style={{ width: 100 }}>METHOD</Th>
                      <Th style={{ width: 100 }}>REQUESTED</Th>
                      <Th style={{ width: 110 }}>REFERENCE</Th>
                      <Th style={{ width: 130 }}>ACTIONS</Th>
                    </>
                  )}
                </Thead>
                <Tbody>
                  {isLoading ? (<SkeletonRows cols={9} rows={6} />) : paginated.length === 0 ? (
                    <tr><td colSpan={9}>
                      <EmptyState icon={<DollarSign className="h-9 w-9" />}
                        title={hasActiveFilters ? 'No matching records' : tab === 'settlements' ? 'No settlements yet' : 'No withdrawals yet'}
                        description={hasActiveFilters ? 'Try adjusting your search or filters.' : tab === 'settlements' ? 'Create a settlement batch from approved commission records.' : 'Partner withdrawal requests will appear here.'}
                        action={!hasActiveFilters && tab === 'settlements' ? <Button size="sm" icon={<DollarSign className="h-3.5 w-3.5" />} onClick={() => createBatch.mutate()} loading={createBatch.isPending} disabled={pendingCommissionCount === 0}>Create Batch</Button> : undefined} />
                    </td></tr>
                  ) : (
                    paginated.map((item: any) => {
                      if (tab === 'settlements') {
                        return (
                          <Tr key={item.id} onClick={() => setViewSettlement(item)}
                            className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-table-row-hover)] focus-visible:bg-[var(--color-table-row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset">
                            <Td><span data-interactive onClick={(e) => e.stopPropagation()}><UniversalCheckbox checked={false} onChange={() => {}} /></span></Td>
                            <Td><code className="text-xs font-mono text-[var(--color-text-secondary)] bg-[var(--color-bg-sunken)] px-1.5 py-0.5 rounded">{item.id?.slice(0, 12)}…</code></Td>
                            <Td className="text-xs font-medium">{item.partnerName || item.partnerId || '—'}</Td>
                            <Td className="text-xs text-[var(--color-text-muted)]">{item.commissionCount || 0}</Td>
                            <Td className="text-xs font-semibold tabular-nums">{fmtCurrency(item.totalAmount || 0)}</Td>
                            <Td><StatusBadge status={item.status} /></Td>
                            <Td className="text-xs text-[var(--color-text-muted)]">{item.status === 'completed' ? `${item.successCount || 0}S / ${item.skippedCount || 0}K / ${item.failedCount || 0}F` : '—'}</Td>
                            <Td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDate(item.createdAt)}</Td>
                            <Td>
                              <div data-action onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex items-center justify-end gap-1">
                                <button type="button" onClick={(e) => { e.stopPropagation(); setViewSettlement(item); }}
                                  className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
                                  <Eye className="h-3.5 w-3.5" /> View
                                </button>
                              </div>
                            </Td>
                          </Tr>
                        );
                      }
                      return (
                        <Tr key={item.id} onClick={() => setViewWithdrawal(item)}
                          className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-table-row-hover)] focus-visible:bg-[var(--color-table-row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset">
                          <Td><input type="checkbox" checked={batchWithdrawalIds.includes(item.id)}
                            onChange={(e) => { e.stopPropagation(); toggleWithdrawalSelection(item.id); }} onClick={(e) => e.stopPropagation()}
                            className="rounded border-[var(--color-border)] text-indigo-600 cursor-pointer" data-interactive /></Td>
                          <Td><code className="text-xs font-mono text-[var(--color-text-secondary)] bg-[var(--color-bg-sunken)] px-1.5 py-0.5 rounded">{(item.id || '').slice(0, 12)}…</code></Td>
                          <Td className="text-xs font-medium">{item.partnerName || item.partnerId || '—'}</Td>
                          <Td className="text-xs font-semibold tabular-nums text-red-600 dark:text-red-400">{fmtCurrency(Math.abs(item.amount || 0))}</Td>
                          <Td><StatusBadge status={item.withdrawalStatus} /></Td>
                          <Td className="text-[10px] text-[var(--color-text-muted)] capitalize">{item.paymentMethod?.replace(/_/g, ' ') || '—'}</Td>
                          <Td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDate(item.createdAt)}</Td>
                          <Td className="text-[10px] text-[var(--color-text-muted)] font-mono">{item.paymentReference || '—'}</Td>
                          <Td>
                            <div data-action onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex items-center justify-end gap-1">
                              <button type="button" onClick={(e) => { e.stopPropagation(); setViewWithdrawal(item); }}
                                className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
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
              <Pagination page={page} total={filtered.length} perPage={PER_PAGE}
                onChange={(p) => { setPage(p); syncQueueParams({ page: p }); }} />
            </div>
          </div>
        </Card>
      )}

      {/* Scheduler Tab Content */}
      {tab === 'scheduler' && (
        <div className="flex flex-col gap-4 overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Status</p>
              <p className="text-lg font-bold mt-1 flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${schedulerSummary ? 'bg-emerald-500' : 'bg-gray-300'}`} />{schedulerSummary ? 'Configured' : 'Not Configured'}</p>
            </div>
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Total Runs</p>
              <p className="text-lg font-bold mt-1">{schedulerSummary?.totalRuns || 0}</p>
            </div>
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Total Settled</p>
              <p className="text-lg font-bold mt-1">{fmtCurrency(schedulerSummary?.totalSettledAmount || 0)}</p>
            </div>
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
              <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Last Run</p>
              <p className="text-lg font-bold mt-1 text-sm">{schedulerSummary?.lastRunAt ? fmtDate(schedulerSummary.lastRunAt) : '—'}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-4">
              <p className="text-[10px] font-semibold uppercase text-indigo-600">Pending Settlements</p>
              <p className="text-xl font-bold text-indigo-700 mt-1">{kpis.pendingSettlements}</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4">
              <p className="text-[10px] font-semibold uppercase text-emerald-600">Completed Batches</p>
              <p className="text-xl font-bold text-emerald-700 mt-1">{kpis.completedCount}</p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4">
              <p className="text-[10px] font-semibold uppercase text-amber-600">Pending Commission Approvals</p>
              <p className="text-xl font-bold text-amber-700 mt-1">{kpis.pendingCommissionCount}</p>
            </div>
          </div>
          {batchSummary && (
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
              <h4 className="text-xs font-bold text-[var(--color-text)] mb-2">Last Batch Processing Summary</h4>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /><span className="text-sm font-semibold text-emerald-600">{batchSummary.success} Success</span></div>
                {batchSummary.failed > 0 && <div className="flex items-center gap-2"><XCircle className="h-4 w-4 text-red-500" /><span className="text-sm font-semibold text-red-600">{batchSummary.failed} Failed</span></div>}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" icon={<Calendar className="h-3.5 w-3.5" />} onClick={() => setShowSchedulerModal(true)}>Configure Scheduler</Button>
            <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => { loadSchedulerConfig().then(cfg => setSchedulerSummary({ lastRunAt: cfg.lastRunAt, totalRuns: cfg.totalRuns, totalSettledAmount: cfg.totalSettledAmount })).catch(() => {}); }}>Refresh Status</Button>
          </div>
        </div>
      )}

      {/* Modals & Drawers */}
      <SettlementDetailDrawer settlement={viewSettlement} open={!!viewSettlement} onClose={() => setViewSettlement(null)}
        onProcess={(id) => processSelectedBatch.mutate(id)} onProcessLoading={processSelectedBatch.isPending} />
      <WithdrawalDetailDrawer withdrawal={viewWithdrawal} open={!!viewWithdrawal} onClose={() => setViewWithdrawal(null)} onRefresh={() => refetch()} />
      <BatchWithdrawalModal open={showBatchModal} onClose={() => { setShowBatchModal(false); setBatchAction('approve'); }}
        withdrawals={filtered.filter((w: any) => batchWithdrawalIds.includes(w.id))} action={batchAction} partnerNames={partnerNames} onComplete={handleBatchComplete} />
      <SchedulerConfigModal open={showSchedulerModal} onClose={() => { setShowSchedulerModal(false); loadSchedulerConfig().then(cfg => { setSchedulerSummary({ lastRunAt: cfg.lastRunAt, totalRuns: cfg.totalRuns, totalSettledAmount: cfg.totalSettledAmount }); }).catch(() => {}); }} />
      <ExportHistoryModal open={showExportHistory} onClose={() => setShowExportHistory(false)} />
      <SchedulerHistoryModal open={showSchedulerHistory} onClose={() => setShowSchedulerHistory(false)}
        onRetryComplete={() => { loadSchedulerConfig().then(cfg => { setSchedulerSummary({ lastRunAt: cfg.lastRunAt, totalRuns: cfg.totalRuns, totalSettledAmount: cfg.totalSettledAmount }); }).catch(() => {}); }} />
      <RecalculationPreviewModal open={showRecalcModal} onClose={() => { setShowRecalcModal(false); setRecalcPreviews([]); setRecalcUseCurrentRules(true); }}
        previews={recalcPreviews} useCurrentRules={recalcUseCurrentRules} onApplied={handleRecalcApplied} />
    </div>
  );
}
