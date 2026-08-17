/**
 * PartnerComparisonView — Multi-partner performance comparison
 *
 * Allows selecting multiple partners and comparing their key metrics
 * side by side with dynamic charts.
 *
 * Reuses recharts components already used in Reports.
 * No duplicated business logic — all data is passed from parent.
 */

import { useState, useMemo } from 'react';
import { BarChart3, X } from 'lucide-react';
import { KPIStatCard } from '../dashboard/KPIStatCard';
import { Card, CardHeader, CardTitle, CardBody } from '../ui/Card';
import { fmtCurrency, fmtCompactCurrency } from '../../lib/firestore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend } from 'recharts';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];

interface Props {
  partners: any[];
  onSelect: (ids: string[]) => void;
  selectedIds: string[];
}

export function PartnerComparisonView({ partners, onSelect, selectedIds }: Props) {
  const [searchVal, setSearchVal] = useState('');

  const selectedPartners = useMemo(() =>
    partners.filter((p: any) => selectedIds.includes(p.id)),
    [partners, selectedIds]
  );

  const availablePartners = useMemo(() =>
    partners.filter((p: any) => !selectedIds.includes(p.id)),
    [partners, selectedIds]
  );

  const filteredAvailable = useMemo(() => {
    if (!searchVal.trim()) return availablePartners;
    const q = searchVal.toLowerCase();
    return availablePartners.filter((p: any) =>
      (p.firmName || '').toLowerCase().includes(q) ||
      (p.contactPerson || '').toLowerCase().includes(q)
    );
  }, [availablePartners, searchVal]);

  function togglePartner(id: string) {
    if (selectedIds.includes(id)) {
      onSelect(selectedIds.filter(i => i !== id));
    } else if (selectedIds.length < 6) {
      onSelect([...selectedIds, id]);
    }
  }

  // ── Comparison metrics ────────────────────────────────
  const compareMetrics = useMemo(() => {
    if (selectedPartners.length === 0) return [];

    const metrics = ['Revenue', 'Conversion %', 'Commission', 'Wallet', 'Avg Deal', 'Installations'];
    return metrics.map(metric => {
      const entry: any = { metric };
      selectedPartners.forEach((p: any, i: number) => {
        const val: Record<string, number> = {
          'Revenue': p.revenue || 0,
          'Conversion %': p.conversionRate || 0,
          'Commission': p.commissionEarned || p.commission || 0,
          'Wallet': p.walletBalance || 0,
          'Avg Deal': p.avgDeal || 0,
          'Installations': p.completedInstalls || p.installations || 0,
        };
        entry[p.id] = val[metric] || 0;
      });
      return entry;
    });
  }, [selectedPartners]);

  // ── Radar data (normalized to 0-100) ─────────────────
  const radarData = useMemo(() => {
    if (selectedPartners.length === 0) return [];

    const maxValues: Record<string, number> = {
      revenue: Math.max(...selectedPartners.map((p: any) => p.revenue || 0), 1),
      conversion: Math.max(...selectedPartners.map((p: any) => p.conversionRate || 0), 1),
      commission: Math.max(...selectedPartners.map((p: any) => p.commissionEarned || p.commission || 0), 1),
      wallet: Math.max(...selectedPartners.map((p: any) => p.walletBalance || 0), 1),
      installations: Math.max(...selectedPartners.map((p: any) => (p.completedInstalls || p.installations || 0)), 1),
    };

    const categories = ['Revenue', 'Conversion', 'Commission', 'Wallet', 'Installations'];
    return categories.map(cat => {
      const key = cat.toLowerCase() as keyof typeof maxValues;
      const entry: any = { category: cat };
      selectedPartners.forEach((p: any) => {
        const rawVal = {
          revenue: p.revenue || 0,
          conversion: p.conversionRate || 0,
          commission: p.commissionEarned || p.commission || 0,
          wallet: p.walletBalance || 0,
          installations: p.completedInstalls || p.installations || 0,
        }[key] || 0;
        entry[p.id] = Math.round((rawVal / maxValues[key]) * 100);
      });
      return entry;
    });
  }, [selectedPartners]);

  if (selectedPartners.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold text-[var(--color-text-muted)]">Select up to 6 partners to compare</p>

        {/* Partner search / selector */}
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
          <input
            type="text"
            value={searchVal}
            onChange={e => setSearchVal(e.target.value)}
            placeholder="Search partners..."
            className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text)] mb-3"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
            {filteredAvailable.slice(0, 30).map((p: any) => (
              <button
                key={p.id}
                onClick={() => togglePartner(p.id)}
                className="flex items-center gap-2 p-2 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)] transition-all text-left"
              >
                <div className="h-7 w-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                  {(p.firmName || '?')[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[var(--color-text)] truncate">{p.firmName || '—'}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">{p.firmName || ''}</p>
                </div>
              </button>
            ))}
            {filteredAvailable.length === 0 && (
              <p className="text-xs text-[var(--color-text-muted)] col-span-full text-center py-4">No partners found</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Selected partners chips */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold text-[var(--color-text-muted)]">Comparing ({selectedPartners.length}):</span>
        {selectedPartners.map((p: any, i: number) => (
          <span key={p.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style={{
            backgroundColor: COLORS[i % COLORS.length] + '20',
            color: COLORS[i % COLORS.length],
          }}>
            {p.firmName || '—'}
            <button onClick={() => togglePartner(p.id)} className="hover:opacity-70">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {selectedIds.length < 6 && (
          <button onClick={() => onSelect([])} className="text-xs text-[var(--color-primary)] hover:underline ml-1">
            + Add more
          </button>
        )}
        <button onClick={() => onSelect([])} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)] ml-auto">
          Clear all
        </button>
      </div>

      {/* Summary KPI Comparison */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {selectedPartners.slice(0, 6).map((p: any, i: number) => (
          <KPIStatCard
            key={p.id}
            label={p.firmName || '—'}
            value={fmtCompactCurrency(p.revenue || 0)}
            icon={<BarChart3 className="h-4 w-4" />}
            color={['indigo', 'emerald', 'amber', 'purple', 'teal', 'rose'][i % 6] as any}
            compact
          />
        ))}
      </div>

      {/* Comparison bar chart */}
      {compareMetrics.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Metric Comparison</CardTitle></CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={compareMetrics}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="metric" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 10 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                {selectedPartners.map((p: any, i: number) => (
                  <Bar key={p.id} dataKey={p.id} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} name={p.firmName || '—'} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* Radar Chart */}
      {radarData.length > 0 && selectedPartners.length >= 2 && (
        <Card>
          <CardHeader><CardTitle>Performance Radar (Normalized)</CardTitle></CardHeader>
          <CardBody className="flex justify-center">
            <ResponsiveContainer width="100%" height={350}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="category" tick={{ fontSize: 10 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Tooltip contentStyle={{ fontSize: 10 }} />
                {selectedPartners.map((p: any, i: number) => (
                  <Radar key={p.id} name={p.firmName || '—'} dataKey={p.id} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.1} strokeWidth={2} />
                ))}
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              </RadarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* Detail comparison table */}
      <Card>
        <CardHeader><CardTitle>Detailed Comparison</CardTitle></CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)]">
                  <th className="text-left py-2 pr-4 font-semibold text-[var(--color-text-muted)]">Metric</th>
                  {selectedPartners.map((p: any) => (
                    <th key={p.id} className="text-right py-2 px-3 font-semibold text-[var(--color-text-muted)]">{p.firmName || '—'}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Leads', key: 'leadsCount' },
                  { label: 'Won', key: 'won' },
                  { label: 'Conversion Rate', key: 'conversionRate', fmt: (v: any) => v + '%' },
                  { label: 'Revenue', key: 'revenue', fmt: (v: any) => fmtCurrency(v || 0) },
                  { label: 'Commission Earned', key: 'commissionEarned', fmt: (v: any) => fmtCurrency(v || 0) },
                  { label: 'Wallet Balance', key: 'walletBalance', fmt: (v: any) => fmtCurrency(v || 0) },
                  { label: 'Pending Settlement', key: 'pendingSettlement', fmt: (v: any) => fmtCurrency(v || 0) },
                  { label: 'Avg Deal Size', key: 'avgDeal', fmt: (v: any) => fmtCurrency(v || 0) },
                  { label: 'Installations', key: 'installations' },
                  { label: 'Active Rules', key: 'activeCommissionRules' },
                  { label: 'Performance Score', key: 'score', fmt: (v: any) => v?.score || '—' },
                ].map(row => (
                  <tr key={row.label} className="border-b border-[var(--color-border-subtle)] last:border-0">
                    <td className="py-2 pr-4 font-medium text-[var(--color-text)]">{row.label}</td>
                    {selectedPartners.map((p: any) => {
                      const val = row.key === 'score' ? p.score?.score :
                                  row.key === 'commissionEarned' ? (p.commissionEarned || p.commission || 0) :
                                  p[row.key];
                      return (
                        <td key={p.id} className="py-2 px-3 text-right font-semibold tabular-nums text-[var(--color-text)]">
                          {row.fmt ? row.fmt(val) : val ?? 0}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default PartnerComparisonView;
