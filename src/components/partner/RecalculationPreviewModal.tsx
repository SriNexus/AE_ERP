/**
 * RecalculationPreviewModal — Preview commission recalculation results
 *
 * Shows:
 *   - Summary bar (total old, new, diff)
 *   - Per-commission diff table (old → new → diff → reason)
 *   - Confirm / Cancel actions
 *   - Progress bar during batch application
 *
 * Parent must pass preview data (from previewRecalculation).
 * Modal calls applyRecalculation on confirm.
 */

import { useState } from 'react';
import {
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { fmtCurrency } from '../../lib/firestore';
import { applyRecalculation } from '../../lib/commissionRecalculation';
import type { RecalculationPreview } from '../../features/channel-partner/types';
import toast from 'react-hot-toast';

interface RecalculationPreviewModalProps {
  open: boolean;
  onClose: () => void;
  previews: RecalculationPreview[];
  /** Whether the preview used current rules (true) or historical snapshot (false) */
  useCurrentRules?: boolean;
  /** Refetch data on successful apply */
  onApplied: () => void;
}

export function RecalculationPreviewModal({
  open,
  onClose,
  previews,
  useCurrentRules = true,
  onApplied,
}: RecalculationPreviewModalProps) {
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ success: number; skipped: number; failed: number } | null>(null);

  const changed = previews.filter((p) => p.changed);
  const unchanged = previews.filter((p) => !p.changed);

  const totalOld = changed.reduce((s, p) => s + p.oldAmount, 0);
  const totalNew = changed.reduce((s, p) => s + p.newAmount, 0);
  const totalDiff = totalNew - totalOld;

  async function handleApply() {
    setApplying(true);
    setProgress(10);

    try {
      // Simulate progress steps
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + 15, 80));
      }, 300);

      const result = await applyRecalculation(previews, { useCurrentRules: useCurrentRules ?? true });

      clearInterval(progressInterval);
      setProgress(100);
      setResult(result);

      if (result.success > 0) {
        toast.success(`${result.success} commission(s) recalculated`);
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} commission(s) failed`);
      }

      onApplied();
    } catch (err: any) {
      toast.error(err?.message || 'Recalculation failed');
      setProgress(0);
    } finally {
      setApplying(false);
    }
  }

  const hasChanges = changed.length > 0;

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="space-y-4 text-sm">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-indigo-500" />
            <span className="font-semibold text-[var(--color-text)]">Commission Recalculation Preview</span>
            <span className="text-xs text-[var(--color-text-muted)]">
              ({previews.length} records · {changed.length} changes)
            </span>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ✕
          </button>
        </div>

        {/* ── Summary Bar ─────────────────────────────────── */}
        {hasChanges && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[var(--color-bg-sunken)] rounded-xl p-3 text-center">
              <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Current Total</p>
              <p className="text-lg font-bold text-[var(--color-text)] mt-1">{fmtCurrency(totalOld)}</p>
            </div>
            <div className="bg-[var(--color-bg-sunken)] rounded-xl p-3 text-center">
              <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">New Total</p>
              <p className="text-lg font-bold text-indigo-600 mt-1">{fmtCurrency(totalNew)}</p>
            </div>
            <div className={`rounded-xl p-3 text-center ${
              totalDiff >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-red-50 dark:bg-red-900/20'
            }`}>
              <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Difference</p>
              <p className={`text-lg font-bold mt-1 ${totalDiff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {totalDiff >= 0 ? '+' : ''}{fmtCurrency(totalDiff)}
              </p>
            </div>
          </div>
        )}

        {/* ── Progress Bar ────────────────────────────────── */}
        {applying && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--color-text-muted)]">Applying recalculation...</span>
              <span className="font-semibold">{progress}%</span>
            </div>
            <div className="h-2 bg-[var(--color-bg-sunken)] rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Result Summary ──────────────────────────────── */}
        {result && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {result.success} updated · {result.skipped} skipped · {result.failed} failed
            </span>
          </div>
        )}

        {/* ── Unchanged notice ────────────────────────────── */}
        {unchanged.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="text-[10px] font-medium">
              {unchanged.length} commission(s) unchanged (already match current rules or no applicable rule found)
            </span>
          </div>
        )}

        {/* ── Diff Table ──────────────────────────────────── */}
        <div className="max-h-[360px] overflow-y-auto space-y-1 border border-[var(--color-border)] rounded-xl">
          {previews.map((p) => (
            <div
              key={p.commissionId}
              className={`px-3 py-2.5 border-b border-[var(--color-border-subtle)] last:border-0 ${
                p.changed ? '' : 'opacity-50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--color-text)]">
                      {p.partnerName}
                    </span>
                    <code className="text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-bg-sunken)] px-1 py-0.5 rounded">
                      {p.commissionId.slice(0, 10)}…
                    </code>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      Lead: {p.leadId.slice(0, 10)}…
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs">
                    {p.changed ? (
                      <>
                        <span className="text-[var(--color-text-muted)] line-through">{fmtCurrency(p.oldAmount)}</span>
                        <ArrowRight className="h-3 w-3 text-indigo-500" />
                        <span className={`font-bold ${p.difference >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {fmtCurrency(p.newAmount)}
                        </span>
                        <span className={`text-[10px] font-medium ${p.difference >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          ({p.difference >= 0 ? '+' : ''}{fmtCurrency(p.difference)})
                        </span>
                      </>
                    ) : (
                      <span className="text-[var(--color-text-muted)]">No change</span>
                    )}
                  </div>
                  {p.changed && (
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                      {p.reason} · Rule: {p.ruleUsed}
                    </p>
                  )}
                </div>
                {p.changed && (
                  <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    p.difference >= 0
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-red-50 text-red-600'
                  }`}>
                    {p.difference >= 0 ? 'Increase' : 'Decrease'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── Footer ──────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border-subtle)]">
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {hasChanges
              ? `${changed.length} commission(s) will be updated`
              : 'No commissions will change'}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={applying}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={!hasChanges || applying || !!result}
              loading={applying}
              icon={applying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            >
              {result ? 'Applied' : applying ? 'Applying...' : `Apply Recalculation (${changed.length})`}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default RecalculationPreviewModal;
