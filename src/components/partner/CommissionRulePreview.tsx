/**
 * CommissionRulePreview — Preview panel using the Commission Engine
 *
 * Consumes the existing Phase 8.1 engine for calculation.
 * No duplicated calculation logic.
 * Shows: matched rule, formula, breakdown, adjustments, final amount.
 */

import { useMemo } from 'react';
import { DollarSign, AlertTriangle } from 'lucide-react';
import { calculateCommissionPreview } from '../../lib/channelPartnerCommissionEngine';
import type { CommissionRule, CommissionRuleType } from '../../features/channel-partner/types';

interface CommissionRulePreviewProps {
  rule: CommissionRule;
  dealValue: number;
  systemSizeKW: number;
}

const TYPE_LABELS: Record<CommissionRuleType, string> = {
  percentage: 'Percentage (%)',
  fixed: 'Fixed (₹)',
  per_kw: 'Per kW (₹/kW)',
  per_deal: 'Per Deal (₹)',
  slab: 'Slab (Tiered)',
};

export function CommissionRulePreview({ rule, dealValue, systemSizeKW }: CommissionRulePreviewProps) {
  const result = useMemo(() => {
    if (!rule || dealValue <= 0 || systemSizeKW <= 0) return null;
    try {
      const r = calculateCommissionPreview(rule, dealValue, systemSizeKW);
      // Re-run without cap validation for cleaner display in the preview
      return r;
    } catch {
      return null;
    }
  }, [rule, dealValue, systemSizeKW]);

  if (!result) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4 text-center">
        <DollarSign className="h-5 w-5 mx-auto text-[var(--color-text-muted)] mb-1" />
        <p className="text-xs text-[var(--color-text-muted)]">Enter deal value and system size to preview commission.</p>
      </div>
    );
  }

  const hasCaps = result.cappedAmount !== null;
  const hasAdjustments = result.adjustments.length > 0;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] divide-y divide-[var(--color-border-subtle)]">
      {/* Result header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)]">Calculated Commission</p>
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
            ₹{result.finalAmount.toLocaleString('en-IN')}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
          {TYPE_LABELS[result.commissionType] || result.commissionType}
        </span>
      </div>

      {/* Formula */}
      <div className="px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Formula</p>
        <p className="text-xs font-mono text-[var(--color-text-secondary)] bg-[var(--color-surface)] px-2 py-1 rounded">{result.formula}</p>
      </div>

      {/* Breakdown */}
      <div className="px-4 py-2.5 space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Breakdown</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--color-text-muted)]">Deal Value</span>
          <span className="text-xs font-medium">₹{result.dealValue.toLocaleString('en-IN')}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--color-text-muted)]">System Size</span>
          <span className="text-xs font-medium">{result.systemSizeKW} kW</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--color-text-muted)]">Base Value</span>
          <span className="text-xs font-medium">{result.baseValue} {result.commissionType === 'percentage' ? '%' : '₹'}</span>
        </div>
        {result.cappedAmount !== null && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-text-muted)]">Before Cap</span>
            <span className="text-xs font-medium text-amber-600">₹{result.cappedAmount.toLocaleString('en-IN')}</span>
          </div>
        )}
      </div>

      {/* Adjustments */}
      {hasAdjustments && (
        <div className="px-4 py-2.5 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Adjustments</p>
          {result.adjustments.map((adj, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span className="text-xs font-medium">{adj.label}</span>
              <span className={`text-xs font-semibold ${adj.amount > 0 ? 'text-emerald-600' : adj.amount < 0 ? 'text-red-600' : ''}`}>
                {adj.amount > 0 ? '+' : ''}{adj.amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1 border-t border-[var(--color-border-subtle)]">
            <span className="text-xs font-bold">Final Amount</span>
            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
              ₹{result.finalAmount.toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="px-4 py-2 space-y-1">
          {result.warnings.map((w, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
              <span className="text-[10px] text-amber-600">{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Explanation */}
      {result.explanation.length > 0 && (
        <div className="px-4 py-2.5 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Explanation</p>
          {result.explanation.map((exp, idx) => (
            <p key={idx} className="text-[11px] text-[var(--color-text-secondary)]">{exp}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default CommissionRulePreview;
