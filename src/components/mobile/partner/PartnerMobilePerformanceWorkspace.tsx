/**
 * PartnerMobilePerformanceWorkspace — Mobile analytics workspace
 *
 * Collapsible sections with summary KPIs and card-based partner list.
 * Reuses existing mobile patterns. No duplicated business logic.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  BarChart3,
  TrendingUp,
  Users,
  Award,
  Wallet,
  Target,
  MapPin,
  Star,
  ChevronDown,
  ChevronRight,
  Eye,
} from 'lucide-react';
import { getAll, fmtCompactCurrency } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import { computePartnerScore, buildPartnerScoreInput, scoreDistribution } from '../../../features/channel-partner/utils/analytics';

function fmtCompact(n: number): string {
  if (n >= 10000000) return (n / 10000000).toFixed(1) + 'Cr';
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({ title, icon, count, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2.5 px-4 py-3 bg-[var(--color-bg-sunken)]">
        <span className="text-[var(--color-text-muted)]">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        <span className="text-[var(--color-primary)]">{icon}</span>
        <span className="text-sm font-semibold text-[var(--color-text)] flex-1 text-left">{title}</span>
        {count !== undefined && (
          <span className="text-xs font-bold text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] px-2 py-0.5 rounded-full">{count}</span>
        )}
      </button>
      {open && <div className="px-4 py-3 space-y-3">{children}</div>}
    </div>
  );
}

function PartnerCard({ p, rank, onView }: { p: any; rank: number; onView: (p: any) => void }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2.5">
        <span className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0 ${
          rank === 1 ? 'bg-yellow-100 text-yellow-700' :
          rank === 2 ? 'bg-gray-100 text-gray-600' :
          rank === 3 ? 'bg-orange-100 text-orange-700' :
          'bg-indigo-100 text-indigo-700'
        }`}>{rank}</span>
        <div className="h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center text-xs font-bold shrink-0">
          {(p.firmName || '?')[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text)] truncate">{p.firmName || '—'}</p>
          <p className="text-[10px] text-[var(--color-text-muted)]">{p.firmName || ''}</p>
        </div>
        <span className={`inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-bold ${
          p.score?.score === 'A+' ? 'bg-emerald-100 text-emerald-700' :
          p.score?.score === 'A' ? 'bg-green-100 text-green-700' :
          p.score?.score === 'B' ? 'bg-blue-100 text-blue-700' :
          p.score?.score === 'C' ? 'bg-amber-100 text-amber-700' :
          'bg-red-100 text-red-700'
        }`}>{p.score?.score || '—'}</span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        <div><p className="text-[10px] text-[var(--color-text-muted)]">Leads</p><p className="text-xs font-bold">{p.leadsCount || 0}</p></div>
        <div><p className="text-[10px] text-[var(--color-text-muted)]">Won</p><p className="text-xs font-bold">{p.won || 0}</p></div>
        <div><p className="text-[10px] text-[var(--color-text-muted)]">Conv%</p><p className="text-xs font-bold">{p.conversionRate || 0}%</p></div>
        <div><p className="text-[10px] text-[var(--color-text-muted)]">Revenue</p><p className="text-xs font-bold">{fmtCompactCurrency(p.revenue || 0)}</p></div>
      </div>
      <button onClick={() => onView(p)} className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary-text)] text-xs font-semibold">
        <Eye className="h-3 w-3" /> View Details
      </button>
    </div>
  );
}

export function PartnerMobilePerformanceWorkspace() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const [viewPartner, setViewPartner] = useState<any>(null);

  const { data: partners = [] } = useQuery({
    queryKey: ['channel_partners', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 30000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads_mobile', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 30000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: allCommissionRecords = [] } = useQuery({
    queryKey: ['commission_records_mobile', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 30000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: allWalletTxns = [] } = useQuery({
    queryKey: ['wallet_txns_mobile', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.PARTNER_WALLET_TXNS),
    staleTime: 30000,
    enabled: Boolean(activeCompanyId),
  });

  const activePartners = useMemo(() => partners.filter((p: any) => p.status === 'active' && !p.isDeleted), [partners]);
  const partnerLeads = useMemo(() => allLeads.filter((l: any) => l.partnerId && !l.isDeleted), [allLeads]);
  const settlements = useMemo(() => allWalletTxns.filter((t: any) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted), [allWalletTxns]);

  const partnerPerformance = useMemo(() => {
    return (activePartners as any[]).map((p: any) => {
      const leads = partnerLeads.filter((l: any) => l.partnerId === p.id);
      const won = leads.filter((l: any) => l.status === 'Converted' || l.status === 'Won').length;
      const conversionRate = leads.length > 0 ? Math.round((won / leads.length) * 100) : 0;
      const revenue = leads.reduce((sum: number, l: any) => sum + (Number(l.value) || 0), 0);
      const commission = allCommissionRecords.filter((r: any) => r.partnerId === p.id).reduce((sum: number, r: any) => sum + (r.approvedAmount || r.amount || 0), 0);

      const partnerScore = computePartnerScore(buildPartnerScoreInput(p.id, partnerLeads, settlements, allCommissionRecords));
      const score = partnerScore.score;

      return {
        ...p,
        leadsCount: leads.length,
        won,
        conversionRate,
        revenue,
        commission,
        score: { score, numeric: partnerScore.numeric },
      };
    }).sort((a: any, b: any) => b.score.numeric - a.score.numeric);
  }, [activePartners, partnerLeads, allCommissionRecords, settlements]);

  const totalRevenue = partnerPerformance.reduce((s: number, p: any) => s + p.revenue, 0);
  const totalCommission = partnerPerformance.reduce((s: number, p: any) => s + p.commission, 0);
  const totalLeads = partnerPerformance.reduce((s: number, p: any) => s + p.leadsCount, 0);
  const totalWon = partnerPerformance.reduce((s: number, p: any) => s + p.won, 0);
  const avgConv = totalLeads > 0 ? Math.round((totalWon / totalLeads) * 100) : 0;

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-xl bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[var(--color-text)]">Partner Performance</h1>
          <p className="text-xs text-[var(--color-text-muted)]">Partner analytics dashboard</p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Active Partners', value: activePartners.length, icon: <Users className="h-4 w-4" />, color: 'indigo' },
          { label: 'Total Revenue', value: fmtCompact(totalRevenue), icon: <TrendingUp className="h-4 w-4" />, color: 'emerald' },
          { label: 'Avg Conversion', value: avgConv + '%', icon: <Target className="h-4 w-4" />, color: 'purple' },
          { label: 'Commission', value: fmtCompact(totalCommission), icon: <Wallet className="h-4 w-4" />, color: 'amber' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-3">
            <div className="flex items-start justify-between mb-1">
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">{kpi.label}</p>
              <span className={`p-1 rounded-lg bg-${kpi.color}-50 text-${kpi.color}-600`}>{kpi.icon}</span>
            </div>
            <p className="text-lg font-bold text-[var(--color-text)] tabular-nums">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Leaderboard */}
      <CollapsibleSection title="Partner Leaderboard" icon={<Award className="h-4 w-4" />} count={partnerPerformance.length} defaultOpen>
        <div className="space-y-3">
          {partnerPerformance.slice(0, 10).map((p: any, idx: number) => (
            <PartnerCard key={p.id} p={p} rank={idx + 1} onView={setViewPartner} />
          ))}
          {partnerPerformance.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-4">No partners found</p>
          )}
        </div>
      </CollapsibleSection>

      {/* Regional Summary */}
      <CollapsibleSection title="Regional Overview" icon={<MapPin className="h-4 w-4" />} count={new Set(partners.filter((p: any) => p.address?.state).map((p: any) => p.address.state)).size}>
        {(() => {
          const byState: Record<string, number> = {};
          activePartners.forEach((p: any) => {
            const s = p.address?.state || 'Unknown';
            byState[s] = (byState[s] || 0) + 1;
          });
          return Object.entries(byState).sort(([, a], [, b]) => (b as number) - (a as number)).map(([state, count]) => (
            <div key={state} className="flex items-center justify-between py-1.5">
              <span className="text-xs text-[var(--color-text)]">{state}</span>
              <span className="text-xs font-bold text-[var(--color-text-muted)]">{count} partners</span>
            </div>
          ));
        })()}
      </CollapsibleSection>

      {/* Score Distribution */}
      <CollapsibleSection title="Score Distribution" icon={<Star className="h-4 w-4" />}>
        {(() => {
          const dist = scoreDistribution(partnerPerformance.map((p: any) => p.score));
          return dist.map(({ grade, count, pct }) => (
            <div key={grade} className="flex items-center gap-3 py-1">
              <span className={`w-7 h-5 rounded text-[10px] font-bold flex items-center justify-center ${
                grade === 'A+' ? 'bg-emerald-100 text-emerald-700' :
                grade === 'A' ? 'bg-green-100 text-green-700' :
                grade === 'B' ? 'bg-blue-100 text-blue-700' :
                grade === 'C' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>{grade}</span>
              <div className="flex-1 h-2 bg-[var(--color-bg-sunken)] rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs font-semibold text-[var(--color-text-muted)]">{String(count)}</span>
            </div>
          ));
        })()}
      </CollapsibleSection>

      {/* Detail drawer */}
      {viewPartner && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface)]">
          <div className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border-subtle)] px-4 py-3 flex items-center gap-3">
            <button onClick={() => setViewPartner(null)} className="text-[var(--color-text-muted)]" aria-label="Back to partner list"><ChevronRight className="h-5 w-5 rotate-180" /></button>
            <div className="h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center text-xs font-bold shrink-0">
              {(viewPartner.firmName || '?')[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[var(--color-text)] truncate">{viewPartner.firmName || '—'}</p>
              <p className="text-[10px] text-[var(--color-text-muted)]">{viewPartner.contactPerson || ''}</p>
            </div>
            <span className={`w-7 h-5 rounded text-[10px] font-bold flex items-center justify-center ${
              viewPartner.score?.score === 'A+' ? 'bg-emerald-100 text-emerald-700' :
              viewPartner.score?.score === 'A' ? 'bg-green-100 text-green-700' :
              viewPartner.score?.score === 'B' ? 'bg-blue-100 text-blue-700' :
              viewPartner.score?.score === 'C' ? 'bg-amber-100 text-amber-700' :
              'bg-red-100 text-red-700'
            }`}>{viewPartner.score?.score || '—'}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Leads', value: viewPartner.leadsCount || 0 },
                { label: 'Won', value: viewPartner.won || 0 },
                { label: 'Conversion', value: (viewPartner.conversionRate || 0) + '%' },
                { label: 'Revenue', value: fmtCompactCurrency(viewPartner.revenue || 0) },
                { label: 'Commission', value: fmtCompactCurrency(viewPartner.commission || 0) },
                { label: 'Wallet', value: fmtCompactCurrency(viewPartner.walletBalance || 0) },
              ].map(kpi => (
                <div key={kpi.label} className="bg-[var(--color-bg-sunken)] rounded-xl p-3">
                  <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">{kpi.label}</p>
                  <p className="text-base font-bold text-[var(--color-text)] tabular-nums">{kpi.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PartnerMobilePerformanceWorkspace;
