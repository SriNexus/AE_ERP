/**
 * PartnerMobileCommissionRulesWorkspace — Mobile commission rules view for admins
 *
 * Card-based layout suitable for mobile viewports.
 * Read-only view of commission rules with detail drawer.
 * No creating/editing on mobile — delegates to desktop for rule management.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import type { CommissionRule } from '../../../features/channel-partner/types';
import { CommissionRuleDetailDrawer } from '../../partner/CommissionRuleDetailDrawer';

const TYPE_LABELS: Record<string, string> = {
  percentage: '%',
  fixed: '₹',
  per_kw: '₹/kW',
  per_deal: '₹/deal',
  slab: 'slabs',
};

export function PartnerMobileCommissionRulesWorkspace() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);

  const { data: allRules = [], isLoading, refetch } = useQuery({
    queryKey: companyKeys.commissionRules,
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RULES),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const rules = useMemo(
    () => (allRules as CommissionRule[]).filter((r) => !r.isDeleted),
    [allRules],
  );

  const [viewRule, setViewRule] = useState<CommissionRule | null>(null);

  const kpis = useMemo(() => ({
    total: rules.length,
    active: rules.filter((r) => r.isActive).length,
  }), [rules]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)]">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-[var(--color-bg)] px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <FileText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[var(--color-text)]">Comm. Rules</h1>
              <p className="text-xs text-[var(--color-text-muted)]">{kpis.total} rules · {kpis.active} active</p>
            </div>
          </div>
          <button onClick={() => refetch()} className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* ── Summary pills ────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{kpis.total}</p>
            <p className="text-[10px] font-medium text-indigo-700 dark:text-indigo-300">Total Rules</p>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{kpis.active}</p>
            <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">Active</p>
          </div>
        </div>
      </div>

      {/* ── List ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse bg-[var(--color-surface)] rounded-xl" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-12 text-center">
            <div className="h-12 w-12 rounded-2xl bg-[var(--color-surface-hover)] flex items-center justify-center mb-3">
              <FileText className="h-6 w-6 text-[var(--color-text-muted)]" />
            </div>
            <p className="text-sm font-semibold text-[var(--color-text)]">No commission rules</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">Configure rules on the desktop app.</p>
          </div>
        ) : (
          rules.sort((a, b) => (b.priority || 0) - (a.priority || 0)).map((rule) => (
            <div
              key={rule.id}
              onClick={() => setViewRule(rule)}
              className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-3.5 cursor-pointer hover:bg-[var(--color-surface-hover)] transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text)] truncate">{rule.name}</p>
                  {rule.description && (
                    <p className="text-[10px] text-[var(--color-text-muted)] truncate mt-0.5">{rule.description}</p>
                  )}
                </div>
                {rule.isActive ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 shrink-0">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-semibold bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 shrink-0">
                    <XCircle className="h-2.5 w-2.5" /> Inactive
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                <span className="capitalize bg-[var(--color-bg-sunken)] px-1.5 py-0.5 rounded font-medium">{rule.applicableTo === 'all' ? 'Default' : rule.applicableTo?.replace(/_/g, ' ')}</span>
                <span className="bg-[var(--color-bg-sunken)] px-1.5 py-0.5 rounded font-medium">{rule.type.replace(/_/g, ' ')}</span>
                <span className="bg-[var(--color-bg-sunken)] px-1.5 py-0.5 rounded font-medium">
                  {rule.type === 'percentage' ? `${rule.value}%` : rule.type === 'slab' ? `${rule.slabs?.length || 0} ${TYPE_LABELS[rule.type]}` : `₹${rule.value?.toLocaleString('en-IN')}`}
                </span>
                <span className="ml-auto">P{rule.priority}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Detail Drawer ──────────────────────────────────── */}
      <CommissionRuleDetailDrawer
        rule={viewRule}
        open={!!viewRule}
        onClose={() => setViewRule(null)}
      />
    </div>
  );
}

export default PartnerMobileCommissionRulesWorkspace;
