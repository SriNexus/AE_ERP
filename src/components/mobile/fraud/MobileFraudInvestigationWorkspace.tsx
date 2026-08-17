/**
 * MobileFraudInvestigationWorkspace — Mobile investigation queue view
 *
 * Displays:
 *   - Summary KPI bar (critical, high, open investigations)
 *   - Investigation list with partner name, risk score, risk level, status
 *   - Click to open detail in FraudInvestigationDrawer
 *
 * Reuses existing mobile patterns and the shared FraudInvestigationDrawer.
 * All fraud logic lives in fraudDetection.ts — no duplicate fraud calculations.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ShieldAlert,
  Eye,
  RefreshCw,
} from 'lucide-react';
import { loadInvestigations, runFraudEvaluation } from '../../../lib/fraudDetection';
import { getFraudSummary } from '../../../lib/fraudDetection';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { FraudInvestigationDrawer } from '../../partner/FraudInvestigationDrawer';
import { fmtDate } from '../../../lib/firestore';
import type { FraudInvestigation } from '../../../features/channel-partner/types/fraud';

export function MobileFraudInvestigationWorkspace() {
  const [selectedInvestigation, setSelectedInvestigation] = useState<FraudInvestigation | null>(null);

  const { data: investigations = [], isLoading, refetch } = useQuery({
    queryKey: ['fraud_investigations', 'mobile'],
    queryFn: () => loadInvestigations(),
    staleTime: 15_000,
  });

  const { data: summary } = useQuery({
    queryKey: ['fraud_summary', 'mobile'],
    queryFn: () => getFraudSummary(),
    staleTime: 30_000,
  });

  const sortedInvestigations = useMemo(() => {
    return [...investigations].sort((a, b) => {
      // Sort by risk score descending, then by newest first
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    });
  }, [investigations]);

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3 px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">
            Fraud Investigation
          </h1>
          <Button
            size="xs"
            variant="outline"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => refetch()}
            loading={isLoading}
          >
            Refresh
          </Button>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap items-center gap-2">
          {([
            { label: 'Open', count: summary?.openInvestigations ?? 0, color: 'bg-amber-100 text-amber-700' },
            { label: 'Critical', count: summary?.criticalCount ?? 0, color: 'bg-red-100 text-red-700' },
            { label: 'High', count: summary?.highCount ?? 0, color: 'bg-orange-100 text-orange-700' },
            { label: 'Resolved', count: summary?.resolvedInvestigations ?? 0, color: 'bg-emerald-100 text-emerald-700' },
          ] as const).map((item) => (
            <span key={item.label} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.color}`}>
              {item.label}
              <span className="opacity-70">{item.count}</span>
            </span>
          ))}
        </div>

        {/* Investigation list */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="rounded-xl p-4 animate-pulse">
                <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)] mb-2" />
                <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
              </Card>
            ))}
          </div>
        ) : sortedInvestigations.length === 0 ? (
          <Card className="rounded-xl p-6 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
            <p className="mt-3 text-sm font-bold text-[var(--color-text)]">
              No investigations
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Run fraud evaluation from the admin dashboard.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {sortedInvestigations.map((inv) => (
              <button
                key={inv.id}
                type="button"
                className="w-full text-left"
                onClick={() => setSelectedInvestigation(inv)}
              >
                <Card className="rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      inv.riskScore >= 70 ? 'bg-red-100 text-red-700' :
                      inv.riskScore >= 45 ? 'bg-orange-100 text-orange-700' :
                      inv.riskScore >= 20 ? 'bg-yellow-100 text-yellow-700' :
                      'bg-emerald-100 text-emerald-700'
                    }`}>
                      {inv.riskScore}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{inv.partnerName || inv.partnerId}</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        {inv.riskLevel.charAt(0).toUpperCase() + inv.riskLevel.slice(1)} risk
                        {' · '}
                        {(inv.triggeredRules?.length || 0)} rule(s)
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge variant={
                          inv.status === 'new' ? 'info' :
                          inv.status === 'under_review' ? 'warning' :
                          inv.status === 'escalated' ? 'danger' :
                          inv.status === 'cleared' ? 'success' : 'info'
                        }>
                          {inv.status.replace('_', ' ')}
                        </Badge>
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          {inv.createdAt ? fmtDate(inv.createdAt) : ''}
                        </span>
                      </div>
                    </div>
                    <Eye className="h-4 w-4 text-[var(--color-text-muted)] mt-1 shrink-0" />
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>

      <FraudInvestigationDrawer
        investigation={selectedInvestigation}
        onClose={() => setSelectedInvestigation(null)}
        onUpdated={() => refetch()}
      />
    </div>
  );
}

export default MobileFraudInvestigationWorkspace;
