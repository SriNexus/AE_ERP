/**
 * ExportHistoryModal — View and manage export history
 *
 * Admin: see all exports, search, filter by type/format, re-download, delete.
 * Partner: see only their own exports (filtered via partnerId).
 */

import { useState, useMemo, useEffect } from 'react';
import {
  Download,
  FileText,
  Search,
  X,
  Trash2,
  RefreshCw,
  Filter,
  Clock,
  FileSpreadsheet,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { fmtDateTime, getAll, resolveWriteCompanyId } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import {
  loadExportHistory,
  deleteExportHistory,
  logExport,
  type ExportHistoryEntry,
  type ExportEntityType,
  type ExportFormat,
} from '../../lib/exportHistory';
import {
  downloadCsv,
  printReport,
  exportSettlementsToCsv,
  exportWithdrawalsToCsv,
  exportCommissionRecordsToCsv,
  generatePartnerStatementHtml,
} from '../../lib/settlementExport';
import { NotificationType } from '../../types';
import { notifyRoleUsers } from '../../lib/notifications';
import { useAppStore } from '../../store/useAppStore';
import toast from 'react-hot-toast';

interface ExportHistoryModalProps {
  open: boolean;
  onClose: () => void;
  /** If set, only shows exports for this partner */
  partnerId?: string;
}

const TYPE_LABELS: Record<ExportEntityType, string> = {
  settlements: 'Settlements',
  withdrawals: 'Withdrawals',
  commission_records: 'Commission Records',
  partner_statement: 'Partner Statement',
};

const TYPE_FILTER_OPTIONS: { label: string; value: ExportEntityType | 'all' }[] = [
  { label: 'All Types', value: 'all' },
  { label: 'Settlements', value: 'settlements' },
  { label: 'Withdrawals', value: 'withdrawals' },
  { label: 'Commission Records', value: 'commission_records' },
  { label: 'Partner Statement', value: 'partner_statement' },
];

const FORMAT_OPTIONS: { label: string; value: ExportFormat | 'all' }[] = [
  { label: 'All Formats', value: 'all' },
  { label: 'CSV', value: 'CSV' },
  { label: 'PDF', value: 'PDF' },
];

export function ExportHistoryModal({ open, onClose, partnerId }: ExportHistoryModalProps) {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  const [entries, setEntries] = useState<ExportHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ExportEntityType | 'all'>('all');
  const [formatFilter, setFormatFilter] = useState<ExportFormat | 'all'>('all');

  useEffect(() => {
    if (!open || !companyId) return;
    setLoading(true);
    loadExportHistory(companyId, { partnerId })
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [open, companyId, partnerId]);

  function handleRefresh() {
    if (!companyId) return;
    setLoading(true);
    loadExportHistory(companyId, { partnerId })
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }

  async function handleRedownload(entry: ExportHistoryEntry) {
    if (!companyId) return;
    try {
      // Load fresh data from Firestore
      const allSettlements = await getAll(COLLECTIONS.PARTNER_WALLET_TXNS);
      const settlements = (allSettlements as any[]).filter(
        (t: any) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted,
      );
      const withdrawals = (allSettlements as any[]).filter(
        (t: any) => t.type === 'withdrawal_request' && !t.isDeleted,
      );
      const commissionRecords = await getAll(COLLECTIONS.COMMISSION_RECORDS);
      const partnerNames: Record<string, string> = {};
      const partners = await getAll(COLLECTIONS.CHANNEL_PARTNERS);
      (partners as any[]).forEach((p: any) => {
        partnerNames[p.id] = p.firmName || p.contactPerson || p.id;
      });

      const { exportType, format, filtersUsed } = entry;
      const timestamp = Date.now();

      switch (exportType) {
        case 'settlements': {
          const csv = exportSettlementsToCsv(settlements, partnerNames);
          downloadCsv(csv, `settlements-regen-${timestamp}.csv`);
          break;
        }
        case 'withdrawals': {
          const csv = exportWithdrawalsToCsv(withdrawals, partnerNames);
          downloadCsv(csv, `withdrawals-regen-${timestamp}.csv`);
          break;
        }
        case 'commission_records': {
          const csv = exportCommissionRecordsToCsv(commissionRecords, partnerNames);
          downloadCsv(csv, `commission-records-regen-${timestamp}.csv`);
          break;
        }
        case 'partner_statement': {
          const partnerId = filtersUsed?.partnerId;
          const partner = (partners as any[]).find((p: any) => p.id === partnerId);
          const partnerSettlements = partnerId
            ? settlements.filter((s: any) => s.partnerId === partnerId)
            : settlements;
          const partnerCommissions = partnerId
            ? (commissionRecords as any[]).filter((r: any) => r.partnerId === partnerId)
            : (commissionRecords as any[]);
          const statementHtml = generatePartnerStatementHtml(
            partner || { firmName: 'All Partners' },
            partnerSettlements,
            partnerCommissions,
            withdrawals,
          );
          printReport('Partner Settlement Statement', statementHtml);
          break;
        }
      }

      // Log the re-generated export
      await logExport(
        exportType,
        format,
        exportType === 'partner_statement'
          ? `partner-statement-regen-${timestamp}.${format.toLowerCase()}`
          : `${exportType}-regen-${timestamp}.${format.toLowerCase()}`,
        format === 'CSV'
          ? exportType === 'settlements' ? settlements.length
            : exportType === 'withdrawals' ? withdrawals.length
            : exportType === 'commission_records' ? (commissionRecords as any[]).length
            : 0
          : 0,
        filtersUsed,
      );

      // Refresh the list
      handleRefresh();
    } catch (err) {
      toast.error('Failed to re-download export. The data may have changed.');
    }
  }

  async function handleDelete(entry: ExportHistoryEntry) {
    await deleteExportHistory(entry.id);
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));

    // Notify admins about the deletion
    void notifyRoleUsers(
      ['Admin'],
      NotificationType.SETTLEMENT_COMPLETED,
      'Export deleted',
      `${entry.format} export "${entry.filename}" (${entry.exportType}) was deleted by ${entry.generatedByName}.`,
      'settlement',
      entry.id,
      companyId,
    ).catch(() => {});
  }

  const filtered = useMemo(() => {
    let list = [...entries];
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter(
        (e) =>
          e.filename.toLowerCase().includes(q) ||
          e.exportType.toLowerCase().includes(q) ||
          e.generatedByName.toLowerCase().includes(q),
      );
    }
    if (typeFilter !== 'all') {
      list = list.filter((e) => e.exportType === typeFilter);
    }
    if (formatFilter !== 'all') {
      list = list.filter((e) => e.format === formatFilter);
    }
    return list;
  }, [entries, search, typeFilter, formatFilter]);

  const hasActiveFilters = search || typeFilter !== 'all' || formatFilter !== 'all';

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="space-y-4 text-sm">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[var(--color-primary)]" />
            <span className="font-semibold text-[var(--color-text)]">Export History</span>
            <span className="text-xs text-[var(--color-text-muted)]">({entries.length} total)</span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={handleRefresh} loading={loading}>
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Filters ─────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search exports..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ExportEntityType | 'all')}
            className="text-xs border border-[var(--color-border)] rounded-lg px-2 py-1.5 bg-[var(--color-surface)]"
          >
            {TYPE_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={formatFilter}
            onChange={(e) => setFormatFilter(e.target.value as ExportFormat | 'all')}
            className="text-xs border border-[var(--color-border)] rounded-lg px-2 py-1.5 bg-[var(--color-surface)]"
          >
            {FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(''); setTypeFilter('all'); setFormatFilter('all'); }}
              className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Clear
            </button>
          )}
        </div>

        {/* ── List ────────────────────────────────────────── */}
        <div className="max-h-[400px] overflow-y-auto space-y-1">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse bg-[var(--color-bg-sunken)] rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center">
              <FileText className="h-8 w-8 mx-auto text-[var(--color-text-muted)] mb-2" />
              <p className="text-xs text-[var(--color-text-muted)]">
                {hasActiveFilters ? 'No exports match your filters.' : 'No exports generated yet.'}
              </p>
            </div>
          ) : (
            filtered.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-bg-sunken)] transition-colors group"
              >
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                  entry.format === 'CSV' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-indigo-100 dark:bg-indigo-900/30'
                }`}>
                  {entry.format === 'CSV' ? (
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--color-text)]">{entry.filename}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      entry.format === 'CSV' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'
                    }`}>
                      {entry.format}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {TYPE_LABELS[entry.exportType] || entry.exportType}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {entry.rowCount} rows · by {entry.generatedByName}
                    </span>
                    <Clock className="h-3 w-3 text-[var(--color-text-muted)]" />
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {fmtDateTime(entry.generatedAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleRedownload(entry)}
                    className="h-7 w-7 rounded-lg flex items-center justify-center text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                    title="Re-download"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(entry)}
                    className="h-7 w-7 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border-subtle)]">
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Showing {filtered.length} of {entries.length} exports
          </p>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

export default ExportHistoryModal;
