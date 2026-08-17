/**
 * FraudInvestigation — Admin Investigation Queue Workspace
 *
 * Provides:
 *   - KPI summary cards (open, critical, high, avg risk)
 *   - FilterBar for status / risk level / rule type / search
 *   - DataTable with partner, risk score, risk level, triggered rules, status, dates
 *   - Click to open FraudInvestigationDrawer for detail view & actions
 *   - "Evaluate All Partners" button to run fraud evaluation and create investigations
 *
 * Reuses: Card, Button, FilterBar, DataTable, Pagination, Badge, Modal
 * Uses React Query for data fetching (loadInvestigations, getFraudSummary)
 * No duplicate fraud logic — all evaluation lives in fraudDetection.ts
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  Users,
  Eye,
  Filter,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle, CardBody } from '../components/ui/Card';
import { Badge, statusBadge } from '../components/ui/Badge';
import { FilterBar } from '../components/ui/FilterBar';
import { Pagination } from '../components/ui/Pagination';
import { useAppStore } from '../store/useAppStore';
import { runFraudEvaluation, loadInvestigations, createInvestigation } from '../lib/fraudDetection';
import { getFraudSummary } from '../lib/fraudDetection';
import { fmtDate, resolveWriteCompanyId } from '../lib/firestore';
import { FraudInvestigationDrawer } from '../components/partner/FraudInvestigationDrawer';
import type {
  FraudInvestigation,
  FraudRiskLevel,
  InvestigationStatus,
  FraudRuleType,
  FraudEvaluation,
  FraudSummary,
} from '../features/channel-partner/types/fraud';
import { FRAUD_RULE_LABELS } from '../features/channel-partner/types/fraud';

const PER_PAGE = 20;

const STATUS_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'New', value: 'new' },
  { label: 'Under Review', value: 'under_review' },
  { label: 'Escalated', value: 'escalated' },
  { label: 'Cleared', value: 'cleared' },
  { label: 'Confirmed', value: 'confirmed' },
];

const RISK_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
];

const RULE_OPTIONS = [
  { label: 'All', value: '' },
  ...Object.entries(FRAUD_RULE_LABELS).map(([value, label]) => ({ label, value })),
];

function riskBadgeVariant(level: FraudRiskLevel): 'danger' | 'warning' | 'info' | 'success' {
  switch (level) {
    case 'critical': return 'danger';
    case 'high': return 'warning';
    case 'medium': return 'info';
    case 'low': return 'success';
  }
}

export default function FraudInvestigation() {
  const qc = useQueryClient();
  const company = useAppStore((s) => s.company);
  const userRole = useAppStore((s) => s.user?.role || '');
  const isAdmin = userRole === 'Admin' || userRole === 'Director';

  const [statusFilter, setStatusFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [ruleFilter, setRuleFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedInvestigation, setSelectedInvestigation] = useState<FraudInvestigation | null>(null);

  // Load investigations
  const { data: investigations = [], isLoading, refetch } = useQuery({
    queryKey: ['fraud_investigations', statusFilter, riskFilter, ruleFilter, searchQuery],
    queryFn: () => loadInvestigations({
      status: (statusFilter || undefined) as InvestigationStatus | undefined,
      riskLevel: (riskFilter || undefined) as FraudRiskLevel | undefined,
      ruleType: (ruleFilter || undefined) as FraudRuleType | undefined,
      search: searchQuery || undefined,
    }),
    staleTime: 15_000,
  });

  // Load fraud summary
  const { data: summary } = useQuery({
    queryKey: ['fraud_summary'],
    queryFn: () => getFraudSummary(),
    staleTime: 30_000,
  });

  // Evaluate all partners mutation
  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const result = await runFraudEvaluation();
      // Auto-create investigations for critical/high risk
      let created = 0;
      for (const ev of result.evaluations) {
        if (ev.riskLevel === 'critical' || ev.riskLevel === 'high') {
          try {
            await createInvestigation(ev, company.id || resolveWriteCompanyId());
            created++;
          } catch { /* best effort */ }
        }
      }
      return { ...result, investigationsCreated: created };
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['fraud_investigations'] });
      void qc.invalidateQueries({ queryKey: ['fraud_summary'] });
      toast.success(
        `Evaluated ${result.evaluations.length} partners — ${result.alertsCreated} alerts, ${result.investigationsCreated} investigations created`,
      );
    },
    onError: (err: any) => toast.error(err?.message || 'Evaluation failed'),
  });

  const filteredInvestigations = useMemo(() => {
    return investigations as FraudInvestigation[];
  }, [investigations]);

  const paginated = useMemo(() => {
    const start = (page - 1) * PER_PAGE;
    return filteredInvestigations.slice(start, start + PER_PAGE);
  }, [filteredInvestigations, page]);

  const handleRowClick = useCallback((inv: FraudInvestigation) => {
    setSelectedInvestigation(inv);
  }, []);

  const handleInvestigationUpdated = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['fraud_investigations'] });
    void qc.invalidateQueries({ queryKey: ['fraud_summary'] });
  }, [qc]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fraud Investigation"
        subtitle="Risk analytics and case management"
        icon={<ShieldAlert className="h-5 w-5" />}
        actions={
          isAdmin ? (
            <Button
              size="sm"
              icon={evaluateMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
              onClick={() => evaluateMutation.mutate()}
              loading={evaluateMutation.isPending}
            >
              {evaluateMutation.isPending ? 'Evaluating...' : 'Evaluate All Partners'}
            </Button>
          ) : undefined
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Open Investigations', value: summary?.openInvestigations ?? 0, icon: <ShieldAlert className="h-4 w-4" />, c: 'text-amber-600 bg-amber-50' },
          { label: 'Critical Risk', value: summary?.criticalCount ?? 0, icon: <AlertTriangle className="h-4 w-4" />, c: 'text-red-600 bg-red-50' },
          { label: 'High Risk', value: summary?.highCount ?? 0, icon: <TrendingUp className="h-4 w-4" />, c: 'text-orange-600 bg-orange-50' },
          { label: 'Avg Risk Score', value: summary?.averageRiskScore ?? 0, icon: <BarChart3 className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
          { label: 'Total Evaluated', value: summary?.totalEvaluated ?? 0, icon: <Users className="h-4 w-4" />, c: 'text-blue-600 bg-blue-50' },
          { label: 'Resolved', value: summary?.resolvedInvestigations ?? 0, icon: <UserCheck className="h-4 w-4" />, c: 'text-emerald-600 bg-emerald-50' },
        ].map((s) => (
          <Card key={s.label} className="p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
            <div>
              <p className="text-xs text-muted">{s.label}</p>
              <p className="font-bold text-gray-800">{s.value}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-[var(--color-text-muted)]" />
            <select
              className="text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              className="text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5"
              value={riskFilter}
              onChange={(e) => { setRiskFilter(e.target.value); setPage(1); }}
            >
              {RISK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              className="text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5"
              value={ruleFilter}
              onChange={(e) => { setRuleFilter(e.target.value); setPage(1); }}
            >
              {RULE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div className="relative flex-1 max-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              <input
                className="w-full text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-7 pr-2.5 py-1.5"
                placeholder="Search partner..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              />
            </div>
            <button
              className="text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] ml-auto"
              onClick={() => { setStatusFilter(''); setRiskFilter(''); setRuleFilter(''); setSearchQuery(''); setPage(1); }}
            >
              Clear filters
            </button>
          </div>
        </CardBody>
      </Card>

      {/* Investigation Table */}
      <Card>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading investigations...</div>
          ) : paginated.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
              No investigations found. Click "Evaluate All Partners" to run fraud analysis.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-left py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Partner</th>
                    <th className="text-center py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Risk Score</th>
                    <th className="text-center py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Risk Level</th>
                    <th className="text-left py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Triggered Rules</th>
                    <th className="text-center py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Status</th>
                    <th className="text-center py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Assigned To</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Created</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Updated</th>
                    <th className="text-center py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((inv) => {
                    const triggeredRuleLabels = (inv.triggeredRules || []).map((r) =>
                      FRAUD_RULE_LABELS[r.ruleType] || r.ruleType,
                    );
                    return (
                      <tr
                        key={inv.id}
                        className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-sunken)] transition-colors cursor-pointer"
                        onClick={() => handleRowClick(inv)}
                      >
                        <td className="py-2.5 px-3 font-semibold">{inv.partnerName || inv.partnerId}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-[11px] font-bold ${
                            inv.riskScore >= 70 ? 'bg-red-100 text-red-700' :
                            inv.riskScore >= 45 ? 'bg-orange-100 text-orange-700' :
                            inv.riskScore >= 20 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-emerald-100 text-emerald-700'
                          }`}>
                            {inv.riskScore}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <Badge variant={riskBadgeVariant(inv.riskLevel)}>
                            {inv.riskLevel.charAt(0).toUpperCase() + inv.riskLevel.slice(1)}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 max-w-[200px]">
                          <div className="flex flex-wrap gap-1">
                            {triggeredRuleLabels.slice(0, 2).map((label, i) => (
                              <span key={i} className="inline-flex items-center rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 px-2 py-0.5 text-[9px] font-medium">
                                {label}
                              </span>
                            ))}
                            {triggeredRuleLabels.length > 2 && (
                              <span className="text-[9px] text-[var(--color-text-muted)]">+{triggeredRuleLabels.length - 2}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center">{statusBadge(inv.status.replace('_', ' '))}</td>
                        <td className="py-2.5 px-3 text-center text-[var(--color-text-muted)]">
                          {inv.assignedToName || 'Unassigned'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-[var(--color-text-muted)] tabular-nums">
                          {inv.createdAt ? fmtDate(inv.createdAt) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-[var(--color-text-muted)] tabular-nums">
                          {inv.updatedAt ? fmtDate(inv.updatedAt) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            className="p-1 rounded-md hover:bg-[var(--color-bg-sunken)] transition-colors"
                            onClick={(e) => { e.stopPropagation(); handleRowClick(inv); }}
                            title="View details"
                          >
                            <Eye className="h-4 w-4 text-[var(--color-text-muted)]" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Pagination */}
      <Pagination
        page={page}
        total={filteredInvestigations.length}
        perPage={PER_PAGE}
        onChange={setPage}
      />

      {/* Detail Drawer */}
      <FraudInvestigationDrawer
        investigation={selectedInvestigation}
        onClose={() => setSelectedInvestigation(null)}
        onUpdated={handleInvestigationUpdated}
      />
    </div>
  );
}
