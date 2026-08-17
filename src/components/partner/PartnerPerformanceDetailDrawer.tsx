/**
 * PartnerPerformanceDetailDrawer — Read-only partner detail drawer
 *
 * Displays comprehensive partner performance data for admin view.
 * No editing. Read-only analytics only.
 *
 * Reuses: Modal pattern, StatCard, PieChart/BarChart, existing formatters
 * No duplicated business logic.
 */

import { useMemo } from 'react';
import {
  X,
  Mail,
  Phone,
  MapPin,
  Star,
  TrendingUp,
  DollarSign,
  Wallet,
  Target,
  Clock,
  Activity,
  Package,
  Award,
  Shield,
} from 'lucide-react';
import { fmtCurrency, fmtCompactCurrency, fmtDateTime } from '../../lib/firestore';
import { Card, CardHeader, CardTitle, CardBody } from '../ui/Card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

interface Props {
  partner: any;
  open: boolean;
  onClose: () => void;
  allLeads: any[];
  allCommissionRecords: any[];
  allWalletTxns: any[];
  allSettlements: any[];
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

export function PartnerPerformanceDetailDrawer({ partner, open, onClose, allLeads, allCommissionRecords, allWalletTxns, allSettlements }: Props) {
  const partnerData = useMemo(() => {
    if (!partner) return null;

    const leads = allLeads.filter((l: any) => l.partnerId === partner.id);
    const commissionRecords = allCommissionRecords.filter((r: any) => r.partnerId === partner.id);
    const walletTxns = allWalletTxns.filter((t: any) => t.partnerId === partner.id);
    const settlements = allSettlements.filter((s: any) => s.partnerId === partner.id);

    const won = leads.filter((l: any) => l.status === 'Converted' || l.status === 'Won').length;
    const conversionRate = leads.length > 0 ? Math.round((won / leads.length) * 100) : 0;
    const revenue = leads.reduce((sum: number, l: any) => sum + (Number(l.value) || 0), 0);
    const totalCommission = commissionRecords.reduce((s: number, r: any) => s + (r.approvedAmount || r.amount || 0), 0);
    const totalPaid = commissionRecords.filter((r: any) => r.status === 'paid').reduce((s: number, r: any) => s + (r.approvedAmount || r.amount || 0), 0);
    const pendingCommission = commissionRecords.filter((r: any) => r.status === 'pending').length;
    const completedInstalls = leads.filter((l: any) => l.installationStatus === 'installation_complete' || l.installationStatus === 'closed').length;

    // Monthly commission trend
    const monthlyCommission: Record<string, number> = {};
    commissionRecords.forEach((r: any) => {
      const d = toDateValue(r.generatedDate);
      if (d) {
        const k = d.toLocaleString('default', { month: 'short', year: '2-digit' });
        monthlyCommission[k] = (monthlyCommission[k] || 0) + (r.approvedAmount || r.amount || 0);
      }
    });

    // Lead pipeline by status
    const leadPipeline = Object.entries(leads.reduce((a: Record<string, number>, l: any) => {
      const s = l.status || 'Unknown';
      a[s] = (a[s] || 0) + 1;
      return a;
    }, {})).map(([name, value]) => ({ name, value }));

    // Recent activity (combine commission and settlement events)
    const recentActivity = [
      ...settlements.filter((s: any) => s.updatedAt || s.createdAt).map((s: any) => ({
        id: s.id,
        type: 'settlement',
        action: `Settlement ${s.status}`,
        date: s.updatedAt || s.createdAt,
        amount: s.totalAmount,
        status: s.status,
      })),
      ...commissionRecords.filter((r: any) => r.updatedAt || r.generatedDate).map((r: any) => ({
        id: r.id,
        type: 'commission',
        action: `Commission ${r.status}`,
        date: r.updatedAt || r.generatedDate,
        amount: r.approvedAmount || r.amount,
        status: r.status,
      })),
      ...walletTxns.filter((t: any) => t.createdAt).map((t: any) => ({
        id: t.id,
        type: 'wallet',
        action: t.type === 'commission_credit' ? 'Wallet Credit' : t.type === 'withdrawal_request' ? 'Withdrawal Req.' : t.type,
        date: t.createdAt,
        amount: Math.abs(t.amount || 0),
        status: t.withdrawalStatus || 'completed',
      })),
    ].sort((a: any, b: any) => {
      const da = toDateValue(a.date)?.getTime() || 0;
      const db = toDateValue(b.date)?.getTime() || 0;
      return db - da;
    }).slice(0, 10);

    return {
      ...partner,
      leads,
      commissionRecords,
      walletTxns,
      settlements,
      won,
      conversionRate,
      revenue,
      totalCommission,
      totalPaid,
      pendingCommission,
      completedInstalls,
      avgDeal: won > 0 ? Math.round(revenue / won) : 0,
      monthlyCommission: Object.entries(monthlyCommission).map(([month, amount]) => ({ month, amount })),
      leadPipeline,
      recentActivity,
    };
  }, [partner, allLeads, allCommissionRecords, allWalletTxns, allSettlements]);

  if (!open || !partnerData) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border-subtle)] px-5 py-4 flex items-center gap-4">
          <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center text-sm font-bold shrink-0">
            {(partnerData.firmName || '?')[0]}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-[var(--color-text)] text-base truncate">{partnerData.firmName || '—'}</h2>
            <p className="text-xs text-[var(--color-text-muted)]">{partnerData.contactPerson || ''}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Business Information */}
          <div className="grid grid-cols-2 gap-3 p-4 bg-[var(--color-bg-sunken)] rounded-xl">
            {[
              { label: 'Email', value: partnerData.email || '—', icon: <Mail className="h-3.5 w-3.5" /> },
              { label: 'Phone', value: partnerData.phone || '—', icon: <Phone className="h-3.5 w-3.5" /> },
              { label: 'Location', value: [partnerData.address?.city, partnerData.address?.state].filter(Boolean).join(', ') || '—', icon: <MapPin className="h-3.5 w-3.5" /> },
              { label: 'KYC', value: partnerData.kycStatus || '—', icon: <Shield className="h-3.5 w-3.5" /> },
            ].map(d => (
              <div key={d.label} className="flex items-center gap-2">
                <span className="text-[var(--color-text-muted)] shrink-0">{d.icon}</span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">{d.label}</p>
                  <p className="text-xs font-medium text-[var(--color-text)] truncate">{d.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'Total Revenue', value: fmtCompactCurrency(partnerData.revenue), icon: <TrendingUp className="h-4 w-4" />, color: 'indigo' },
              { label: 'Commission Earned', value: fmtCompactCurrency(partnerData.totalCommission), icon: <Wallet className="h-4 w-4" />, color: 'emerald' },
              { label: 'Wallet Balance', value: fmtCompactCurrency(partnerData.walletBalance || 0), icon: <DollarSign className="h-4 w-4" />, color: 'blue' },
              { label: 'Conversion Rate', value: partnerData.conversionRate + '%', icon: <Target className="h-4 w-4" />, color: 'purple' },
              { label: 'Avg Deal Size', value: fmtCompactCurrency(partnerData.avgDeal), icon: <Activity className="h-4 w-4" />, color: 'amber' },
              { label: 'Deals Won', value: partnerData.won, icon: <Award className="h-4 w-4" />, color: 'teal' },
              { label: 'Leads', value: partnerData.leads.length, icon: <Target className="h-4 w-4" />, color: 'indigo' },
              { label: 'Installations', value: partnerData.completedInstalls, icon: <Package className="h-4 w-4" />, color: 'emerald' },
              { label: 'Pending Comm.', value: partnerData.pendingCommission, icon: <Clock className="h-4 w-4" />, color: 'amber' },
            ].map(kpi => (
              <div key={kpi.label} className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-3 flex items-center gap-2.5">
                <div className={`p-1.5 rounded-lg bg-${kpi.color}-50 dark:bg-${kpi.color}-900/30 text-${kpi.color}-600 dark:text-${kpi.color}-400`} style={{
                  backgroundColor: kpi.color === 'indigo' ? 'var(--color-primary-light)' : undefined,
                  color: kpi.color === 'indigo' ? 'var(--color-primary-text)' : undefined,
                }}>{kpi.icon}</div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase truncate">{kpi.label}</p>
                  <p className="text-sm font-bold text-[var(--color-text)] tabular-nums">{kpi.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Monthly Commission Trend */}
          {partnerData.monthlyCommission.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Monthly Commission Trend</CardTitle></CardHeader>
              <CardBody>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={partnerData.monthlyCommission}>
                    <defs>
                      <linearGradient id="pdComm" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 10 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Commission']} />
                    <Area type="monotone" dataKey="amount" stroke="#6366f1" fill="url(#pdComm)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          )}

          {/* Lead Pipeline */}
          {partnerData.leadPipeline.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Lead Pipeline</CardTitle></CardHeader>
              <CardBody>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={partnerData.leadPipeline} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip contentStyle={{ fontSize: 10 }} />
                    <Bar dataKey="value" fill="#6366f1" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          )}

          {/* Commission & Settlement Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Commission Summary</CardTitle></CardHeader>
              <CardBody className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Total Earned</span><span className="font-semibold">{fmtCurrency(partnerData.totalCommission)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Total Paid</span><span className="font-semibold">{fmtCurrency(partnerData.totalPaid)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Pending</span><span className="font-semibold">{partnerData.pendingCommission} records</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Avg Commission</span><span className="font-semibold">{partnerData.leads.length > 0 ? fmtCurrency(partnerData.totalCommission / partnerData.leads.length) : '—'}</span></div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader><CardTitle>Wallet Summary</CardTitle></CardHeader>
              <CardBody className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Balance</span><span className="font-semibold">{fmtCurrency(partnerData.walletBalance || 0)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Pending Balance</span><span className="font-semibold">{fmtCurrency(partnerData.pendingBalance || 0)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Total Earned</span><span className="font-semibold">{fmtCurrency(partnerData.totalCommissionEarned || partnerData.totalCommission)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Total Paid Out</span><span className="font-semibold">{fmtCurrency(partnerData.totalCommissionPaid || 0)}</span></div>
              </CardBody>
            </Card>
          </div>

          {/* Recent Activity */}
          {partnerData.recentActivity.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Recent Activity</CardTitle></CardHeader>
              <CardBody>
                <div className="space-y-2">
                  {partnerData.recentActivity.map((act: any) => (
                    <div key={act.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--color-bg-sunken)] transition-colors">
                      <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${
                        act.type === 'settlement' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' :
                        act.type === 'commission' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' :
                        'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                      }`}>
                        {act.type === 'settlement' ? 'S' : act.type === 'commission' ? 'C' : 'W'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[var(--color-text)]">{act.action}</p>
                        <p className="text-[10px] text-[var(--color-text-muted)]">{fmtDateTime(act.date)}</p>
                      </div>
                      {act.amount > 0 && (
                        <span className="text-xs font-semibold tabular-nums text-[var(--color-text)]">{fmtCurrency(act.amount)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Score Badge */}
          {partnerData.score && (
            <div className="flex items-center justify-center gap-3 p-4 bg-[var(--color-bg-sunken)] rounded-xl">
              <Star className="h-5 w-5 text-yellow-500" />
              <span className="text-sm font-semibold text-[var(--color-text-muted)]">Performance Score</span>
              <span className={`inline-flex items-center justify-center w-10 h-8 rounded-md text-sm font-bold ${
                partnerData.score.score === 'A+' ? 'bg-emerald-100 text-emerald-700' :
                partnerData.score.score === 'A' ? 'bg-green-100 text-green-700' :
                partnerData.score.score === 'B' ? 'bg-blue-100 text-blue-700' :
                partnerData.score.score === 'C' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>
                {partnerData.score.score}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">({Math.round(partnerData.score.numeric)}/100)</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PartnerPerformanceDetailDrawer;
