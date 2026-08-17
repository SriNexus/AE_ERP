/**
 * SchedulerHistoryModal — View scheduler execution history and retry failed runs
 *
 * Admin can:
 *   - View execution history (date, type, results, errors)
 *   - Retry failed runs
 *   - See retry relationships
 */

import { useState, useMemo, useEffect } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  Calendar,
  PlayCircle,
  Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { fmtDateTime, fmtCompactCurrency, resolveWriteCompanyId } from '../../lib/firestore';
import {
  loadSchedulerHistory,
  retrySchedulerExecution,
  type SchedulerExecution,
} from '../../lib/schedulerHistory';
import { useAppStore } from '../../store/useAppStore';

interface SchedulerHistoryModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after successful retry so parent can refresh */
  onRetryComplete?: () => void;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function SchedulerHistoryModal({ open, onClose, onRetryComplete }: SchedulerHistoryModalProps) {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  const [history, setHistory] = useState<SchedulerExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open || !companyId) return;
    loadHistory();
  }, [open, companyId]);

  function loadHistory() {
    if (!companyId) return;
    setLoading(true);
    loadSchedulerHistory(companyId)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }

  async function handleRetry(executionId: string) {
    setRetryingId(executionId);
    try {
      const result = await retrySchedulerExecution(executionId);
      if (result.success) {
        toast.success('Retry completed successfully');
        if (onRetryComplete) onRetryComplete();
      } else {
        toast.error(`Retry failed: ${result.errors[0] || 'Unknown error'}`);
      }
      loadHistory();
    } catch (err: any) {
      toast.error(err?.message || 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return history;
    const q = search.toLowerCase();
    return history.filter(
      (h) =>
        h.id.toLowerCase().includes(q) ||
        h.runType.toLowerCase().includes(q) ||
        h.errors?.some((e) => e.toLowerCase().includes(q)),
    );
  }, [history, search]);

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="space-y-4 text-sm">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-[var(--color-primary)]" />
            <span className="font-semibold text-[var(--color-text)]">Scheduler History</span>
            <span className="text-xs text-[var(--color-text-muted)]">({history.length} runs)</span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={loadHistory} loading={loading}>
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Search ──────────────────────────────────────── */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search executions..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* ── Summary Stats ───────────────────────────────── */}
        {history.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-2 text-center">
              <p className="text-base font-bold text-emerald-600">{history.filter((h) => h.success).length}</p>
              <p className="text-[10px] text-emerald-700">Successful</p>
            </div>
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-2 text-center">
              <p className="text-base font-bold text-red-600">{history.filter((h) => !h.success).length}</p>
              <p className="text-[10px] text-red-700">Failed</p>
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-2 text-center">
              <p className="text-base font-bold text-amber-600">{history.filter((h) => h.runType === 'scheduled').length}</p>
              <p className="text-[10px] text-amber-700">Scheduled</p>
            </div>
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2 text-center">
              <p className="text-base font-bold text-blue-600">{history.filter((h) => h.runType === 'manual').length}</p>
              <p className="text-[10px] text-blue-700">Manual</p>
            </div>
          </div>
        )}

        {/* ── List ────────────────────────────────────────── */}
        <div className="max-h-[400px] overflow-y-auto space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse bg-[var(--color-bg-sunken)] rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center">
              <Calendar className="h-8 w-8 mx-auto text-[var(--color-text-muted)] mb-2" />
              <p className="text-xs text-[var(--color-text-muted)]">No scheduler runs recorded yet.</p>
            </div>
          ) : (
            filtered.map((exec) => {
              const isFailed = !exec.success;
              const isExpanded = expandedId === exec.id;

              return (
                <div
                  key={exec.id}
                  className={`bg-[var(--color-surface)] rounded-xl border ${
                    isFailed ? 'border-red-200 dark:border-red-800' : 'border-[var(--color-border)]'
                  } overflow-hidden transition-all`}
                >
                  {/* ── Summary Row ────────────────────────── */}
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[var(--color-bg-sunken)] transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : exec.id)}
                  >
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                      isFailed
                        ? 'bg-red-100 dark:bg-red-900/30'
                        : 'bg-emerald-100 dark:bg-emerald-900/30'
                    }`}>
                      {isFailed ? (
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--color-text)]">
                          {exec.runType === 'scheduled' ? 'Scheduled Run' : 'Manual Run'}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          exec.runType === 'scheduled'
                            ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}>
                          {exec.runType}
                        </span>
                        {exec.retryOf && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">
                            Retry
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Clock className="h-3 w-3 text-[var(--color-text-muted)]" />
                        <span className="text-[10px] text-[var(--color-text-muted)]">{fmtDateTime(exec.executionDate)}</span>
                        <span className="text-[10px] text-[var(--color-text-muted)]">·</span>
                        <span className="text-[10px] text-[var(--color-text-muted)]">{formatDuration(exec.duration)}</span>
                        <span className="text-[10px] text-[var(--color-text-muted)]">·</span>
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          {exec.processedCount} processed · {exec.eligibleCommissions} eligible · ₹{exec.totalSettledAmount.toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isFailed && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRetry(exec.id); }}
                          disabled={retryingId === exec.id}
                          className="h-7 px-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[10px] font-semibold flex items-center gap-1 transition-colors"
                        >
                          <PlayCircle className="h-3 w-3" />
                          Retry
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Expanded Details ───────────────────── */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 border-t border-[var(--color-border-subtle)] space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-[var(--color-bg-sunken)] rounded-lg p-2 text-center">
                          <p className="text-[10px] text-[var(--color-text-muted)]">Eligible</p>
                          <p className="text-sm font-bold">{exec.eligibleCommissions}</p>
                        </div>
                        <div className="bg-[var(--color-bg-sunken)] rounded-lg p-2 text-center">
                          <p className="text-[10px] text-[var(--color-text-muted)]">Processed</p>
                          <p className="text-sm font-bold text-emerald-600">{exec.processedCount}</p>
                        </div>
                        <div className="bg-[var(--color-bg-sunken)] rounded-lg p-2 text-center">
                          <p className="text-[10px] text-[var(--color-text-muted)]">Settled</p>
                          <p className="text-sm font-bold">{fmtCompactCurrency(exec.totalSettledAmount)}</p>
                        </div>
                      </div>

                      {exec.errors && exec.errors.length > 0 && (
                        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2 space-y-1">
                          <p className="text-[10px] font-bold text-red-700 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> Errors ({exec.errors.length})
                          </p>
                          {exec.errors.map((err, i) => (
                            <p key={i} className="text-[10px] text-red-600 font-mono">{err}</p>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                        <span>ID: <code className="font-mono">{exec.id}</code></span>
                        {exec.retryOf && (
                          <span>· Retry of: <code className="font-mono">{exec.retryOf}</code></span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border-subtle)]">
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Showing {filtered.length} of {history.length} runs
          </p>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}



export default SchedulerHistoryModal;
