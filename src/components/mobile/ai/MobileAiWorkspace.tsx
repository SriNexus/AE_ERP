/**
 * MobileAiWorkspace — Mobile AI Intelligence Workspace (Phase 9D)
 *
 * Uses the same Desktop services (aiService.ts, useAiAssistant).
 * ZERO business logic — only UI layout.
 * Mobile parity maintained.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Sparkles, Target, Package, AlertTriangle, BarChart3, ChevronRight, Bot, Lock } from 'lucide-react';
import { useLeadScores, useDemandForecasts, useProjectAnomalies, useAiIntelligenceSummary } from '../../../features/ai/hooks/useAiIntelligence';
import { cn } from '../../../utils/cn';
import { AiAssistantChat } from '../../../features/ai/components/AiAssistantChat';
import { useAppStore } from '../../../store/useAppStore';
import { isOwnerEmail } from '../../../lib/ownerAccess';

type MobileTab = 'overview' | 'chat';

export function MobileAiWorkspace() {
  const currentUser = useAppStore((s) => s.user);
  const isSuperAdmin = isOwnerEmail(currentUser?.email);
  const [tab, setTab] = useState<MobileTab>('overview');

  // Phase 9D-A: Only Super Admin can access AI
  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <Lock className="h-12 w-12 text-[var(--color-text-muted)] mb-4 opacity-50" />
        <p className="text-sm font-medium text-[var(--color-text-muted)]">AI Intelligence is restricted</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-60">Contact your system administrator</p>
      </div>
    );
  }
  const navigate = useNavigate();
  const { stats } = useLeadScores();
  const { stockoutRisks } = useDemandForecasts();
  const { anomalies } = useProjectAnomalies();
  const { summary } = useAiIntelligenceSummary();

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)]">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
        <Brain className="h-5 w-5 text-[var(--color-primary)]" />
        <span className="text-base font-bold text-[var(--color-text)]">AI Intelligence</span>
        <button
          onClick={() => navigate(-1)}
          className="ml-auto text-sm text-[var(--color-primary)]"
        >
          Close
        </button>
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 mx-3 my-2 p-0.5 rounded-xl bg-[var(--color-bg-sunken)]">
        <button
          onClick={() => setTab('overview')}
          className={cn(
            'flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all text-center',
            tab === 'overview'
              ? 'bg-[var(--color-surface)] text-[var(--color-primary-text)] shadow-sm'
              : 'text-[var(--color-text-muted)]',
          )}
        >
          📊 Insights
        </button>
        <button
          onClick={() => setTab('chat')}
          className={cn(
            'flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all text-center',
            tab === 'chat'
              ? 'bg-[var(--color-surface)] text-[var(--color-primary-text)] shadow-sm'
              : 'text-[var(--color-text-muted)]',
          )}
        >
          💬 AI Chat
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {tab === 'overview' ? (
          <div className="space-y-3 pt-1">
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-2">
              <KpiCard
                icon={<Target className="h-4 w-4 text-indigo-500" />}
                label="Leads Scored"
                value={stats.totalScored}
                sub={`${stats.hotLeads} hot · ${stats.warmLeads} warm`}
                color="indigo"
              />
              <KpiCard
                icon={<Package className="h-4 w-4 text-amber-500" />}
                label="Stockout Risks"
                value={stockoutRisks.length}
                sub={stockoutRisks[0]?.productName?.slice(0, 20) || 'None'}
                color="amber"
              />
              <KpiCard
                icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
                label="Anomalies"
                value={anomalies.length}
                sub={summary?.anomalies.bySeverity.critical ? `${summary.anomalies.bySeverity.critical} critical` : ''}
                color="red"
              />
              <KpiCard
                icon={<BarChart3 className="h-4 w-4 text-emerald-500" />}
                label="Avg Lead Score"
                value={stats.avgScore}
                sub="/100"
                color="emerald"
              />
            </div>

            {/* Lead Scoring section */}
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-3">
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-4 w-4 text-indigo-500" />
                <span className="text-sm font-semibold text-[var(--color-text)]">Lead Scoring</span>
              </div>
              <div className="flex gap-2 mb-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {stats.hotLeads} Hot
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  {stats.warmLeads} Warm
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  {stats.coldLeads} Cold
                </span>
              </div>
            </div>

            {/* AI Chat button */}
            <button
              onClick={() => setTab('chat')}
              className="w-full flex items-center gap-3 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-3"
            >
              <Sparkles className="h-5 w-5 text-white shrink-0" />
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-white">AI Command Center</p>
                <p className="text-xs text-white/80">Ask questions about your ERP data</p>
              </div>
              <ChevronRight className="h-5 w-5 text-white" />
            </button>

            {/* Stockout Risks */}
            {stockoutRisks.length > 0 && (
              <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Package className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-semibold text-[var(--color-text)]">Stock Alerts</span>
                </div>
                {stockoutRisks.slice(0, 5).map((risk) => (
                  <div key={risk.productId} className="flex items-center justify-between py-1.5 border-b border-[var(--color-border-subtle)] last:border-0">
                    <span className="text-xs text-[var(--color-text-secondary)]">{risk.productName}</span>
                    <span className={cn(
                      'text-xs font-bold',
                      risk.stockoutRisk >= 70 ? 'text-red-500' : 'text-amber-500',
                    )}>
                      {risk.stockoutRisk}% risk
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden" style={{ height: 'calc(100vh - 200px)' }}>
            <AiAssistantChat />
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon, label, value, sub, color,
}: {
  icon: React.ReactNode; label: string; value: number | string; sub: string; color: string;
}) {
  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      </div>
      <p className="text-xl font-bold text-[var(--color-text)] tabular-nums">{value}</p>
      <p className="text-[10px] text-[var(--color-text-muted)] truncate">{sub}</p>
    </div>
  );
}

export default MobileAiWorkspace;
