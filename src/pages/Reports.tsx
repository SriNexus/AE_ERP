import React, { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAll, fmtCurrency, fmtDate, fmtDateTime } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { Card, CardHeader, CardTitle, CardBody, PageHeader } from '../components/ui/Card';
import { useAppStore } from '../store/useAppStore';
import { BarChart3, TrendingUp, Users, Package, CreditCard, Handshake, Clock, DollarSign, AlertTriangle, CheckCircle2, Target, Award, RefreshCw, FileText, Download, History, Activity, HeartPulse, ArrowUpCircle, ArrowDownCircle, ShieldAlert, HardHat, Building2, UserCheck } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area } from 'recharts';
import { COMMISSION_STATUS_LABELS, INSTALLATION_STATUS_LABELS } from '../features/channel-partner/types/leadIntegration';
import { computePartnerScore, buildPartnerScoreInput, gradePartner, scoreDistribution } from '../features/channel-partner/utils/analytics';
import { loadExportHistory, type ExportHistoryEntry } from '../lib/exportHistory';
import { loadSchedulerHistory, type SchedulerExecution } from '../lib/schedulerHistory';
import { TIER_LABELS, TIER_COLORS } from '../lib/tierRules';
import type { PartnerTier } from '../features/channel-partner/types';
import ProjectPipelineSection from '../components/reports/ProjectPipelineSection';

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

export default function Reports() {
  const { company } = useAppStore();
  const { data: leads=[] }     = useQuery({ queryKey:['leads'],     queryFn:()=>getAll(COLLECTIONS.LEADS),     staleTime:60000 });
  const { data: orders=[] }    = useQuery({ queryKey:['orders'],    queryFn:()=>getAll(COLLECTIONS.ORDERS),    staleTime:60000 });
  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>getAll(COLLECTIONS.CUSTOMERS), staleTime:60000 });
  const { data: payments=[] }  = useQuery({ queryKey:['payments'],  queryFn:()=>getAll(COLLECTIONS.PAYMENTS),  staleTime:60000 });
  const { data: products=[] }  = useQuery({ queryKey:['products'],  queryFn:()=>getAll(COLLECTIONS.PRODUCTS),  staleTime:60000 });
  const { data: employees=[] } = useQuery({ queryKey:['employees'], queryFn:()=>getAll(COLLECTIONS.EMPLOYEES), staleTime:60000 });
  const { data: dispatch=[] }  = useQuery({ queryKey:['dispatch'],  queryFn:()=>getAll(COLLECTIONS.DISPATCH),  staleTime:60000 });
  const { data: partners=[] }  = useQuery({ queryKey:['channel_partners'], queryFn:()=>getAll(COLLECTIONS.CHANNEL_PARTNERS), staleTime:60000 });
  const { data: commissionRecords=[] } = useQuery({ queryKey:['commission_records'], queryFn:()=>getAll(COLLECTIONS.COMMISSION_RECORDS), staleTime:60000 });
  const { data: walletTxns=[] } = useQuery({ queryKey:['partner_wallet_transactions'], queryFn:()=>getAll(COLLECTIONS.PARTNER_WALLET_TXNS), staleTime:60000 });
  const { data: commissionRules=[] } = useQuery({ queryKey:['commission_rules'], queryFn:()=>getAll(COLLECTIONS.COMMISSION_RULES), staleTime:60000 });

  // Commission rules stats
  const rulesByType = Object.entries((commissionRules as any[]).reduce((a: Record<string,number>, r: any) => {
    const t = r.type || 'unknown';
    a[t] = (a[t] || 0) + 1;
    return a;
  }, {})).map(([name, value]) => ({ name, value }));
  const rulesByScope = Object.entries((commissionRules as any[]).reduce((a: Record<string,number>, r: any) => {
    const s = r.scope || 'default';
    a[s] = (a[s] || 0) + 1;
    return a;
  }, {})).map(([name, value]) => ({ name, value }));
  const activeRules = (commissionRules as any[]).filter((r: any) => r.isActive && !r.isArchived).length;
  const inactiveRules = (commissionRules as any[]).filter((r: any) => !r.isActive && !r.isArchived).length;
  const avgCommissionPct = (() => {
    const pctRules = (commissionRules as any[]).filter((r: any) => r.type === 'percentage' && r.defaultValue > 0);
    if (!pctRules.length) return 0;
    return pctRules.reduce((s: number, r: any) => s + (r.defaultValue || 0), 0) / pctRules.length;
  })();
  const rulesByTier = Object.entries((commissionRules as any[]).reduce((a: Record<string,number>, r: any) => {
    if (r.tier) { a[r.tier] = (a[r.tier] || 0) + 1; }
    return a;
  }, {})).map(([name, value]) => ({ name, value }));
  const statusData = [
    { name: 'Active', value: activeRules },
    { name: 'Inactive', value: inactiveRules },
    { name: 'Archived', value: (commissionRules as any[]).filter((r: any) => r.isArchived).length },
  ];

  // Partner lead stats
  const partnerLeads = (leads as any[]).filter((l: any) => l.partnerId && !l.isDeleted);
  const partnerLeadByStatus = Object.entries(partnerLeads.reduce((a: Record<string,number>, l: any) => {
    const s = l.commissionStatus || 'pending';
    a[s] = (a[s] || 0) + 1;
    return a;
  }, {})).map(([name, value]) => ({ name: COMMISSION_STATUS_LABELS[name as keyof typeof COMMISSION_STATUS_LABELS] || name, value }));

  const installByStatus = Object.entries(partnerLeads.reduce((a: Record<string,number>, l: any) => {
    const s = l.installationStatus || 'pending';
    a[s] = (a[s] || 0) + 1;
    return a;
  }, {})).map(([name, value]) => ({ name: INSTALLATION_STATUS_LABELS[name as keyof typeof INSTALLATION_STATUS_LABELS] || name, value }));

  const commissionValue = commissionRecords.reduce((s: number, r: any) => s + (r.approvedAmount || r.amount || 0), 0);
  const pendingCommissions = commissionRecords.filter((r: any) => r.status === 'pending').length;
  const approvedCommissions = commissionRecords.filter((r: any) => r.status === 'approved').length;
  const totalPartnerLeads = partnerLeads.length;
  const convertedPartnerLeads = partnerLeads.filter((l: any) => l.status === 'Converted').length;
  const completedInstallations = partnerLeads.filter((l: any) => l.installationStatus === 'installation_complete' || l.installationStatus === 'closed').length;

  // Settlement stats
  const settlements = (walletTxns as any[]).filter((t: any) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted);
  const totalSettled = settlements.reduce((s: number, t: any) => t.status === 'completed' ? s + (t.totalAmount || 0) : s, 0);
  const pendingSettlementAmount = settlements.reduce((s: number, t: any) => t.status === 'pending' ? s + (t.totalAmount || 0) : s, 0);
  const allWithdrawals = (walletTxns as any[]).filter((t: any) => t.type === 'withdrawal_request' && !t.isDeleted);
  const totalWithdrawn = allWithdrawals.reduce((s: number, t: any) => t.withdrawalStatus === 'paid' ? s + Math.abs(t.amount || 0) : s, 0);
  const pendingWithdrawalAmount = allWithdrawals.reduce((s: number, t: any) => t.withdrawalStatus === 'pending' ? s + Math.abs(t.amount || 0) : s, 0);
  const settlementByMonth = (() => {
    const m: Record<string, number> = {};
    settlements.filter((t: any) => t.status === 'completed').forEach((t: any) => {
      if (!t.completedAt) return;
      const k = new Date(t.completedAt).toLocaleString('default', { month: 'short', year: '2-digit' });
      m[k] = (m[k] || 0) + (t.totalAmount || 0);
    });
    return Object.entries(m).map(([month, amount]) => ({ month, amount }));
  })();

  // Partner performance stats (after settlements is defined)
  const activePartnersReport = (partners as any[]).filter((p: any) => p.status === 'active' && !p.isDeleted);
  const partnerLeadsReport = (leads as any[]).filter((l: any) => l.partnerId && !l.isDeleted);
  const partnerPerformanceReport = useMemo(() => {
    return activePartnersReport.map((p: any) => {
      const pleads = partnerLeadsReport.filter((l: any) => l.partnerId === p.id);
      const won = pleads.filter((l: any) => l.status === 'Converted' || l.status === 'Won').length;
      const convRate = pleads.length > 0 ? won / pleads.length : 0;
      const revenue = pleads.reduce((sum: number, l: any) => sum + (Number(l.value) || 0), 0);
      const completedInstalls = pleads.filter((l: any) => l.installationStatus === 'installation_complete' || l.installationStatus === 'closed').length;
      const scoreResult = computePartnerScore(buildPartnerScoreInput(p.id, partnerLeadsReport, settlements, commissionRecords));
      return { ...p, leads: pleads.length, won, convRate: Math.round(convRate * 100), revenue, completedInstalls, score: scoreResult.numeric };
    }).sort((a: any, b: any) => b.score - a.score);
  }, [activePartnersReport, partnerLeadsReport, settlements, commissionRecords]);
  const partnerScoreDist = useMemo(() => {
    const scores = partnerPerformanceReport.map((p: any) => ({ grade: gradePartner(p.score) }));
    const dist = scoreDistribution(scores.map(s => ({ numeric: 0, score: s.grade })));
    return dist.map(d => ({ name: d.grade, value: d.count }));
  }, [partnerPerformanceReport]);

  // Monthly revenue (12 months)
  const monthly12 = (() => {
    const m: Record<string,{revenue:number;orders:number}> = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const k = d.toLocaleString('default',{month:'short',year:'2-digit'});
      m[k] = {revenue:0,orders:0};
    }
    orders.forEach((o:any)=>{if(!o.createdAt)return;const k=new Date(o.createdAt).toLocaleString('default',{month:'short',year:'2-digit'});if(m[k]){m[k].orders++;m[k].revenue+=Number(o.total)||0;}});
    return Object.entries(m).map(([month,v])=>({month,...v}));
  })();

  // Lead source breakdown
  const sourceData = Object.entries(leads.reduce((a:Record<string,number>,l:any)=>{const s=l.source||'Other';a[s]=(a[s]||0)+1;return a;},{})).map(([name,value])=>({name,value}));

  // Customer type
  const custType = [{name:'B2B',value:customers.filter((c:any)=>c.type==='B2B').length},{name:'B2C',value:customers.filter((c:any)=>c.type==='B2C').length}];

  // Top products by order
  const productOrders: Record<string,number> = {};
  orders.forEach((o:any)=>(o.items||[]).forEach((it:any)=>{if(it.product)productOrders[it.product]=(productOrders[it.product]||0)+(Number(it.qty)||0);}));
  const topProducts = Object.entries(productOrders).sort(([,a],[,b])=>(b as number)-(a as number)).slice(0,8).map(([name,qty])=>({name,qty}));

  // Payment mode breakdown
  const paymentModes = Object.entries(payments.reduce((a:Record<string,number>,p:any)=>{const m=p.mode||'Other';a[m]=(a[m]||0)+(Number(p.amount)||0);return a;},{})).map(([name,value])=>({name,value}));

  // ── Export History (Feature 4) ────────────────────────────
  const [exportHistoryEntries, setExportHistoryEntries] = useState<ExportHistoryEntry[]>([]);
  const [schedulerHistoryEntries, setSchedulerHistoryEntries] = useState<SchedulerExecution[]>([]);

  useEffect(() => {
    loadExportHistory(company.id || 'default').then(setExportHistoryEntries).catch(() => {});
    loadSchedulerHistory(company.id || 'default', 50).then(setSchedulerHistoryEntries).catch(() => {});
  }, [company.id]);

  // Advanced analytics derived data
  const exportStats = useMemo(() => {
    const byType: Record<string, number> = {};
    const byFormat: Record<string, number> = {};
    exportHistoryEntries.forEach((e) => {
      byType[e.exportType] = (byType[e.exportType] || 0) + 1;
      byFormat[e.format] = (byFormat[e.format] || 0) + 1;
    });
    return {
      totalExports: exportHistoryEntries.length,
      byType: Object.entries(byType).map(([name, value]) => ({ name, value })),
      byFormat: Object.entries(byFormat).map(([name, value]) => ({ name, value })),
    };
  }, [exportHistoryEntries]);

  const schedulerStats = useMemo(() => {
    const total = schedulerHistoryEntries.length;
    const successful = schedulerHistoryEntries.filter((h) => h.success).length;
    const failed = schedulerHistoryEntries.filter((h) => !h.success).length;
    const avgDuration = total > 0
      ? Math.round(schedulerHistoryEntries.reduce((s, h) => s + h.duration, 0) / total)
      : 0;
    const totalProcessed = schedulerHistoryEntries.reduce((s, h) => s + h.processedCount, 0);
    const totalEligible = schedulerHistoryEntries.reduce((s, h) => s + h.eligibleCommissions, 0);
    const totalSettledAmt = schedulerHistoryEntries.reduce((s, h) => s + h.totalSettledAmount, 0);
    return { total, successful, failed, avgDuration, totalProcessed, totalEligible, totalSettledAmt };
  }, [schedulerHistoryEntries]);

  // Settlement success rate by month
  const settlementSuccessRate = useMemo(() => {
    const m: Record<string, { total: number; success: number; failed: number }> = {};
    settlements.forEach((s: any) => {
      if (!s.completedAt && !s.createdAt) return;
      const k = new Date(s.completedAt || s.createdAt).toLocaleString('default', { month: 'short', year: '2-digit' });
      if (!m[k]) m[k] = { total: 0, success: 0, failed: 0 };
      m[k].total++;
      if (s.status === 'completed') m[k].success++;
      if (s.status === 'failed' || (s.failedCount || 0) > 0) m[k].failed++;
    });
    return Object.entries(m).map(([month, data]) => ({
      month,
      rate: data.total > 0 ? Math.round((data.success / data.total) * 100) : 0,
      total: data.total,
    }));
  }, [settlements]);

  // Withdrawal processing time (days between created and paid)
  const withdrawalProcessingTime = useMemo(() => {
    const paid = allWithdrawals.filter((w: any) => w.withdrawalStatus === 'paid' && w.withdrawalPaidAt && w.createdAt);
    const times = paid.map((w: any) => {
      const created = new Date(w.createdAt).getTime();
      const paidAt = new Date(w.withdrawalPaidAt).getTime();
      return Math.round((paidAt - created) / 86400000); // days
    });
    return times.length > 0
      ? { avg: Math.round(times.reduce((s, t) => s + t, 0) / times.length), min: Math.min(...times), max: Math.max(...times), count: times.length }
      : { avg: 0, min: 0, max: 0, count: 0 };
  }, [allWithdrawals]);

  // Commission processing duration
  const commissionProcessingDuration = useMemo(() => {
    const paid = (commissionRecords as any[]).filter((r: any) => r.status === 'paid' && r.paidAt && r.generatedDate);
    const durations = paid.map((r: any) => {
      const gen = new Date(r.generatedDate).getTime();
      const paidDate = new Date(r.paidAt).getTime();
      return Math.round((paidDate - gen) / 86400000);
    });
    return durations.length > 0
      ? { avg: Math.round(durations.reduce((s, d) => s + d, 0) / durations.length), count: durations.length }
      : { avg: 0, count: 0 };
  }, [commissionRecords]);

  // ── Partner Tier Progress Scores (memoized) ───────────────
  // Pre-compute scores so the table doesn't recalculate on every render
  const tierProgressScores = useMemo(() => {
    const allPartners = (partners as any[]).filter((p: any) => !p.isDeleted);
    const scores: Record<string, number> = {};
    for (const p of allPartners) {
      const pLeads = (leads as any[]).filter((l: any) => l.partnerId === p.id);
      const s = computePartnerScore(buildPartnerScoreInput(p.id, pLeads, settlements, commissionRecords));
      scores[p.id] = Math.round(s.numeric);
    }
    return scores;
  }, [partners, leads, settlements, commissionRecords]);

  return (
    <div className="space-y-5">
      <PageHeader title="Reports & Analytics" subtitle="Home / Accounts / Reports" icon={<BarChart3 className="h-5 w-5"/>}/>      {/* Summary KPIs */}
      <div data-tour="reports-kpi" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {
          [{l:'Total Revenue',v:fmtCurrency(orders.reduce((s:number,o:any)=>s+(Number(o.total)||0),0),company.currencySymbol),icon:<TrendingUp className="h-4 w-4"/>,c:'text-purple-600 bg-purple-50'},
          {l:'Payments Rcvd',v:fmtCurrency(payments.reduce((s:number,p:any)=>s+(Number(p.amount)||0),0),company.currencySymbol),icon:<CreditCard className="h-4 w-4"/>,c:'text-emerald-600 bg-emerald-50'},
          {l:'Total Leads',v:leads.length,icon:<TrendingUp className="h-4 w-4"/>,c:'text-indigo-600 bg-indigo-50'},
          {l:'Customers',v:customers.length,icon:<Users className="h-4 w-4"/>,c:'text-blue-600 bg-blue-50'},
          {l:'Orders',v:orders.length,icon:<Package className="h-4 w-4"/>,c:'text-amber-600 bg-amber-50'},
          {l:'Employees',v:employees.length,icon:<Users className="h-4 w-4"/>,c:'text-teal-600 bg-teal-50'},
        ].map(s=>(
          <Card key={s.l} className="p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
            <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
          </Card>
        ))}
      </div>

      {/* Revenue Chart */}
      <Card data-tour="reports-revenue">
        <CardHeader><CardTitle>12-Month Revenue & Orders Trend</CardTitle></CardHeader>
        <CardBody>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={monthly12}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="month" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:10}} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{borderRadius:'8px',border:'1px solid #e5e7eb',fontSize:11}}/>
              <Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="url(#rev)" strokeWidth={2} name="Revenue"/>
            </AreaChart>
          </ResponsiveContainer>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Lead Sources */}
        <Card data-tour="reports-lead-sources">
          <CardHeader><CardTitle>Lead Sources</CardTitle></CardHeader>
          <CardBody className="flex justify-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart><Pie data={sourceData} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>{sourceData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}}/><Tooltip contentStyle={{fontSize:11}}/></PieChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Customer Types */}
        <Card>
          <CardHeader><CardTitle>Customer Types</CardTitle></CardHeader>
          <CardBody className="flex justify-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart><Pie data={custType} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>{custType.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}}/><Tooltip contentStyle={{fontSize:11}}/></PieChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Payment Modes */}
        <Card>
          <CardHeader><CardTitle>Payment Modes</CardTitle></CardHeader>
          <CardBody className="flex justify-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart><Pie data={paymentModes} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>{paymentModes.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}}/><Tooltip contentStyle={{fontSize:11}}/></PieChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>

      {/* Top Products */}
      {topProducts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Top Products by Units Sold</CardTitle></CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis type="number" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
                <YAxis type="category" dataKey="name" tick={{fontSize:10}} axisLine={false} tickLine={false} width={120}/>
                <Tooltip contentStyle={{fontSize:11}}/>
                <Bar dataKey="qty" fill="#6366f1" radius={[0,4,4,0]} name="Units Sold"/>
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* Commission Rules Section */}
      {commissionRules.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { l: 'Total Rules', v: commissionRules.length, icon: <BarChart3 className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
              { l: 'Active Rules', v: activeRules, icon: <CheckCircle2 className="h-4 w-4" />, c: 'text-emerald-600 bg-emerald-50' },
              { l: 'Inactive Rules', v: inactiveRules, icon: <AlertTriangle className="h-4 w-4" />, c: 'text-amber-600 bg-amber-50' },
              { l: 'Avg Commission %', v: avgCommissionPct.toFixed(1) + '%', icon: <TrendingUp className="h-4 w-4" />, c: 'text-purple-600 bg-purple-50' },
              { l: 'Types Used', v: rulesByType.length, icon: <BarChart3 className="h-4 w-4" />, c: 'text-teal-600 bg-teal-50' },
              { l: 'Scopes Used', v: rulesByScope.length, icon: <Target className="h-4 w-4" />, c: 'text-blue-600 bg-blue-50' },
            ].map(s => (
              <Card key={s.l} className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
                <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Rules by Type */}
            {rulesByType.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Commission Rules — By Type</CardTitle></CardHeader>
                <CardBody className="flex justify-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={rulesByType} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                        {rulesByType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}} />
                      <Tooltip contentStyle={{fontSize:11}} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            )}
            {/* Rules by Scope */}
            {rulesByScope.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Commission Rules — By Scope</CardTitle></CardHeader>
                <CardBody className="flex justify-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={rulesByScope} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                        {rulesByScope.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}} />
                      <Tooltip contentStyle={{fontSize:11}} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            )}
            {/* Rules by Tier */}
            {rulesByTier.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Commission Rules — By Partner Tier</CardTitle></CardHeader>
                <CardBody className="flex justify-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={rulesByTier} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                        {rulesByTier.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}} />
                      <Tooltip contentStyle={{fontSize:11}} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            )}
            {/* Active vs Inactive */}
            {commissionRules.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Rule Status Breakdown</CardTitle></CardHeader>
                <CardBody className="flex justify-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={statusData} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                        {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}} />
                      <Tooltip contentStyle={{fontSize:11}} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            )}
          </div>
        </>
      )}

      {/* Partner Performance Report Section */}
      {partnerPerformanceReport.length > 0 && (
        <>
          {/* Leaderboard KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { l: 'Partners', v: partnerPerformanceReport.length, icon: <Users className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
              { l: 'Top Score', v: partnerPerformanceReport[0]?.firmName || '—', icon: <Award className="h-4 w-4" />, c: 'text-amber-600 bg-amber-50' },
              { l: 'Avg Revenue', v: fmtCurrency(partnerPerformanceReport.reduce((s: number, p: any) => s + p.revenue, 0) / partnerPerformanceReport.length, '₹'), icon: <TrendingUp className="h-4 w-4" />, c: 'text-emerald-600 bg-emerald-50' },
              { l: 'Avg Conversion', v: Math.round(partnerPerformanceReport.reduce((s: number, p: any) => s + p.convRate, 0) / partnerPerformanceReport.length) + '%', icon: <Target className="h-4 w-4" />, c: 'text-purple-600 bg-purple-50' },
              { l: 'Score Distribution', v: partnerPerformanceReport.filter((p: any) => p.score >= 75).length + ' high', icon: <BarChart3 className="h-4 w-4" />, c: 'text-teal-600 bg-teal-50' },
              { l: 'Leader', v: Math.round(partnerPerformanceReport[0]?.score || 0) + ' pts', icon: <Award className="h-4 w-4" />, c: 'text-blue-600 bg-blue-50' },
            ].map(s => (
              <Card key={s.l} className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
                <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
              </Card>
            ))}
          </div>

          {/* Leaderboard Table (Top 8) */}
          <Card>
            <CardHeader><CardTitle>Partner Leaderboard</CardTitle></CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)]">
                      <th className="text-left py-2.5 px-4 font-semibold text-[var(--color-text-muted)]">Rank</th>
                      <th className="text-left py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Partner</th>
                      <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Leads</th>
                      <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Won</th>
                      <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Conv%</th>
                      <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Revenue</th>
                      <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partnerPerformanceReport.slice(0, 8).map((p: any, i: number) => (
                      <tr key={p.id} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-sunken)] transition-colors">
                        <td className="py-2.5 px-4">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
                            i === 0 ? 'bg-yellow-100 text-yellow-700' :
                            i === 1 ? 'bg-gray-100 text-gray-600' :
                            i === 2 ? 'bg-orange-100 text-orange-700' :
                            'bg-indigo-100 text-indigo-700'
                          }`}>{i + 1}</span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-[var(--color-text)]">{p.firmName || '—'}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{p.leads || 0}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{p.won || 0}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{p.convRate || 0}%</td>
                        <td className="py-2.5 px-3 text-right font-semibold tabular-nums">{fmtCurrency(p.revenue || 0)}</td>
                        <td className="py-2.5 px-3 text-right">{Math.round(p.score || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          {/* Regional & Trends Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Revenue by State */}
            <Card>
              <CardHeader><CardTitle>Revenue by State</CardTitle></CardHeader>
              <CardBody>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={(() => {
                    const byState: Record<string, number> = {};
                    partnerPerformanceReport.forEach((p: any) => {
                      const s = p.address?.state || 'Unknown';
                      byState[s] = (byState[s] || 0) + (p.revenue || 0);
                    });
                    return Object.entries(byState).sort(([, a], [, b]) => (b as number) - (a as number)).map(([name, revenue]) => ({ name, revenue }));
                  })()} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
                    <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Revenue']} />
                    <Bar dataKey="revenue" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>

            {/* Score Distribution */}
            <Card>
              <CardHeader><CardTitle>Performance Score Distribution</CardTitle></CardHeader>
              <CardBody className="flex justify-center">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={partnerScoreDist} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                      {partnerScoreDist.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {/* Settlement & Wallet Section */}
      {settlements.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { l: 'Total Settled', v: fmtCurrency(totalSettled, '₹'), icon: <CreditCard className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
            { l: 'Pending Settlement', v: fmtCurrency(pendingSettlementAmount, '₹'), icon: <Clock className="h-4 w-4" />, c: 'text-amber-600 bg-amber-50' },
            { l: 'Total Withdrawn', v: fmtCurrency(totalWithdrawn, '₹'), icon: <DollarSign className="h-4 w-4" />, c: 'text-emerald-600 bg-emerald-50' },
            { l: 'Pending Withdrawals', v: fmtCurrency(pendingWithdrawalAmount, '₹'), icon: <AlertTriangle className="h-4 w-4" />, c: 'text-rose-600 bg-rose-50' },
            { l: 'Settlements', v: settlements.length, icon: <BarChart3 className="h-4 w-4" />, c: 'text-purple-600 bg-purple-50' },
            { l: 'Avg Settlement', v: settlements.length > 0 ? fmtCurrency(totalSettled / settlements.length, '₹') : '₹0', icon: <TrendingUp className="h-4 w-4" />, c: 'text-teal-600 bg-teal-50' },
          ].map(s => (
            <Card key={s.l} className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
              <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
            </Card>
          ))}
        </div>
      )}

      {/* Scheduler & Export Status Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Export History */}
        <Card>
          <CardHeader><CardTitle>Export History</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)] mb-3">Download settlement and withdrawal reports</p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  import('../lib/settlementExport').then(m => {
                    m.downloadCsv(m.exportSettlementsToCsv(settlements, {}), 'settlements-export.csv');
                  });
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-bg-sunken)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-left transition-colors"
              >
                <BarChart3 className="h-3.5 w-3.5 text-indigo-500" />
                <span>Export Settlements as CSV</span>
              </button>
              <button
                onClick={() => {
                  import('../lib/settlementExport').then(m => {
                    const withdrawals = (walletTxns as any[]).filter((t: any) => t.type === 'withdrawal_request' && !t.isDeleted);
                    m.downloadCsv(m.exportWithdrawalsToCsv(withdrawals, {}), 'withdrawals-export.csv');
                  });
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-bg-sunken)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-left transition-colors"
              >
                <DollarSign className="h-3.5 w-3.5 text-red-500" />
                <span>Export Withdrawals as CSV</span>
              </button>
              <button
                onClick={() => {
                  import('../lib/settlementExport').then(m => {
                    m.printReport('Settlement Report', m.generatePartnerStatementHtml({ firmName: 'All Partners' }, settlements, commissionRecords, walletTxns));
                  });
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-bg-sunken)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-left transition-colors"
              >
                <FileText className="h-3.5 w-3.5 text-purple-500" />
                <span>Generate Printable Report</span>
              </button>
            </div>
          </CardBody>
        </Card>

        {/* Scheduler Status */}
        <Card>
          <CardHeader><CardTitle>Scheduler Status</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)] mb-3">Auto-settlement scheduler information</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Status</span>
                <span className="text-xs font-semibold text-amber-600">Configurable</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Settlements Created</span>
                <span className="text-xs font-semibold">{settlements.length}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Pending</span>
                <span className="text-xs font-semibold">{settlements.filter((s: any) => s.status === 'pending').length}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Completed</span>
                <span className="text-xs font-semibold">{settlements.filter((s: any) => s.status === 'completed').length}</span>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Batch Processing Summary */}
        <Card>
          <CardHeader><CardTitle>Batch Processing Summary</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)] mb-3">Overall settlement and withdrawal batch metrics</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Total Settled</span>
                <span className="text-xs font-semibold">{fmtCurrency(totalSettled)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Total Withdrawn</span>
                <span className="text-xs font-semibold">{fmtCurrency(totalWithdrawn)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Pending Settlement Value</span>
                <span className="text-xs font-semibold text-amber-600">{fmtCurrency(pendingSettlementAmount)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Pending Withdrawal Value</span>
                <span className="text-xs font-semibold text-amber-600">{fmtCurrency(pendingWithdrawalAmount)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Avg Settlement</span>
                <span className="text-xs font-semibold">{settlements.length > 0 ? fmtCurrency(totalSettled / settlements.length) : '₹0'}</span>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Settlement Monthly Chart */}
      {settlementByMonth.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Settlement Trend (Monthly)</CardTitle></CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={settlementByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: '8px' }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, '₹'), 'Amount']} />
                <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} name="Settled Amount" />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* Partner Performance Section */}
      {(partnerLeads.length > 0 || commissionRecords.length > 0) && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              {l:'Partner Leads',v:totalPartnerLeads,icon:<Handshake className="h-4 w-4"/>,c:'text-amber-600 bg-amber-50'},
              {l:'Partner Lead Conv.',v:convertedPartnerLeads,icon:<TrendingUp className="h-4 w-4"/>,c:'text-indigo-600 bg-indigo-50'},
              {l:'Completed Installs',v:completedInstallations,icon:<Package className="h-4 w-4"/>,c:'text-emerald-600 bg-emerald-50'},
              {l:'Pending Commissions',v:pendingCommissions,icon:<CreditCard className="h-4 w-4"/>,c:'text-amber-600 bg-amber-50'},
              {l:'Approved Comms.',v:approvedCommissions,icon:<CreditCard className="h-4 w-4"/>,c:'text-emerald-600 bg-emerald-50'},
              {l:'Commission Value',v:fmtCurrency(commissionValue,'₹'),icon:<BarChart3 className="h-4 w-4"/>,c:'text-purple-600 bg-purple-50'},
            ].map(s=>(
              <Card key={s.l} className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
                <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Commission Status Breakdown */}
            {partnerLeadByStatus.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Partner Leads — Commission Status</CardTitle></CardHeader>
                <CardBody className="flex justify-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={partnerLeadByStatus} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                        {partnerLeadByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}} />
                      <Tooltip contentStyle={{fontSize:11}} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            )}

            {/* Installation Status Breakdown */}
            {installByStatus.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Partner Leads — Installation Status</CardTitle></CardHeader>
                <CardBody className="flex justify-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={installByStatus} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                        {installByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}} />
                      <Tooltip contentStyle={{fontSize:11}} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            )}
          </div>
        </>
      )}

      {/* ── Export History Summary ───────────────────────── */}
      {exportStats.totalExports > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { l: 'Total Exports', v: exportStats.totalExports, icon: <Download className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
            { l: 'CSV', v: exportStats.byFormat.find((f: any) => f.name === 'CSV')?.value || 0, icon: <FileText className="h-4 w-4" />, c: 'text-emerald-600 bg-emerald-50' },
            { l: 'PDF', v: exportStats.byFormat.find((f: any) => f.name === 'PDF')?.value || 0, icon: <FileText className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
            { l: 'Avg Rows/Export', v: exportHistoryEntries.length > 0 ? Math.round(exportHistoryEntries.reduce((s, e) => s + e.rowCount, 0) / exportHistoryEntries.length) : 0, icon: <Activity className="h-4 w-4" />, c: 'text-purple-600 bg-purple-50' },
          ].map(s => (
            <Card key={s.l} className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
              <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Scheduler History Stats ──────────────────────── */}
      {schedulerStats.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { l: 'Total Runs', v: schedulerStats.total, icon: <History className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
            { l: 'Successful', v: schedulerStats.successful, icon: <CheckCircle2 className="h-4 w-4" />, c: 'text-emerald-600 bg-emerald-50' },
            { l: 'Failed', v: schedulerStats.failed, icon: <AlertTriangle className="h-4 w-4" />, c: 'text-red-600 bg-red-50' },
            { l: 'Avg Duration', v: `${schedulerStats.avgDuration}s`, icon: <Clock className="h-4 w-4" />, c: 'text-blue-600 bg-blue-50' },
            { l: 'Total Processed', v: schedulerStats.totalProcessed, icon: <Package className="h-4 w-4" />, c: 'text-teal-600 bg-teal-50' },
            { l: 'Total Settled', v: fmtCurrency(schedulerStats.totalSettledAmt), icon: <TrendingUp className="h-4 w-4" />, c: 'text-purple-600 bg-purple-50' },
          ].map(s => (
            <Card key={s.l} className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
              <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Settlement Success Rate Chart ────────────────── */}
      {settlementSuccessRate.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Settlement Success Rate (Monthly)</CardTitle></CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={settlementSuccessRate}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: '8px' }} formatter={(val: any) => [`${val}%`, 'Success Rate']} />
                <Line type="monotone" dataKey="rate" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} name="Success Rate" />
              </LineChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* ── Processing Metrics ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card>
          <CardHeader><CardTitle>Withdrawal Processing Time</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)] mb-2">Average time from request to payment</p>
            <p className="text-2xl font-bold text-[var(--color-text)]">{withdrawalProcessingTime.avg}d</p>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[var(--color-text-muted)]">Min:</span>
                <span className="text-xs font-semibold">{withdrawalProcessingTime.min}d</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[var(--color-text-muted)]">Max:</span>
                <span className="text-xs font-semibold">{withdrawalProcessingTime.max}d</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[var(--color-text-muted)]">Processed:</span>
                <span className="text-xs font-semibold">{withdrawalProcessingTime.count}</span>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Commission Processing Duration</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)] mb-2">Average time from generation to payment</p>
            <p className="text-2xl font-bold text-[var(--color-text)]">{commissionProcessingDuration.avg}d</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-2">Based on {commissionProcessingDuration.count} paid records</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Monthly Automation Report</CardTitle></CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)] mb-2">Auto-settlement execution summary</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Avg Run Duration</span>
                <span className="text-xs font-semibold">{schedulerStats.avgDuration}s</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Success Rate</span>
                <span className={`text-xs font-semibold ${schedulerStats.total > 0 ? (schedulerStats.successful / schedulerStats.total * 100) >= 80 ? 'text-emerald-600' : 'text-amber-600' : ''}`}>
                  {schedulerStats.total > 0 ? Math.round((schedulerStats.successful / schedulerStats.total) * 100) : 0}%
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--color-text-muted)]">Avg Commissions/Run</span>
                <span className="text-xs font-semibold">{schedulerStats.total > 0 ? Math.round(schedulerStats.totalProcessed / schedulerStats.total) : 0}</span>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ── Export Activity Timeline ───────────────────────── */}
      {exportHistoryEntries.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Export Activity Timeline</CardTitle></CardHeader>
          <CardBody>
            <div className="space-y-1 max-h-[240px] overflow-y-auto">
              {exportHistoryEntries.slice(0, 10).map((entry, i) => (
                <div key={entry.id} className="flex items-center gap-3 py-2 border-b border-[var(--color-border-subtle)] last:border-0">
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center ${
                    entry.format === 'CSV' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-indigo-100 dark:bg-indigo-900/30'
                  }`}>
                    <FileText className={`h-3.5 w-3.5 ${
                      entry.format === 'CSV' ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{entry.filename}</p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {entry.exportType.replace('_', ' ')} · {entry.rowCount} rows · {entry.generatedByName}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] text-[var(--color-text-muted)]">{fmtDate(entry.generatedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Scheduler Success % & Retry Stats ─────────────── */}
      {schedulerStats.total > 0 && (
        <Card>
          <CardHeader><CardTitle>Scheduler Success & Retry Statistics</CardTitle></CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              {[
                { l: 'Success Rate', v: `${Math.round((schedulerStats.successful / schedulerStats.total) * 100)}%`, c: schedulerStats.successful / schedulerStats.total >= 0.8 ? 'text-emerald-600' : 'text-amber-600' },
                { l: 'Successful Runs', v: schedulerStats.successful, c: 'text-emerald-600' },
                { l: 'Failed Runs', v: schedulerStats.failed, c: schedulerStats.failed > 0 ? 'text-red-600' : 'text-muted' },
                { l: 'Retries Available', v: schedulerStats.failed > 0 ? schedulerStats.failed : 0, c: schedulerStats.failed > 0 ? 'text-amber-600' : 'text-muted' },
              ].map((s) => (
                <div key={s.l} className="text-center p-3 bg-[var(--color-bg-sunken)] rounded-lg">
                  <p className={`text-lg font-bold ${s.c}`}>{s.v}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">{s.l}</p>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={schedulerHistoryEntries.slice(0, 10).reverse()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey={(d: any) => fmtDate(d.executionDate)} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: '8px' }} />
                <Bar dataKey="processedCount" fill="#6366f1" radius={[3, 3, 0, 0]} name="Processed" />
                <Bar dataKey="failedCount" fill="#ef4444" radius={[3, 3, 0, 0]} name="Failed" />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* ── Withdrawal Processing Trend ───────────────────── */}
      {withdrawalProcessingTime.count > 0 && (
        <Card>
          <CardHeader><CardTitle>Withdrawal Processing Trend</CardTitle></CardHeader>
          <CardBody>
            <div className="grid grid-cols-3 gap-4 mb-3">
              {[
                { l: 'Avg Time', v: `${withdrawalProcessingTime.avg}d`, c: 'text-indigo-600' },
                { l: 'Min', v: `${withdrawalProcessingTime.min}d`, c: 'text-emerald-600' },
                { l: 'Max', v: `${withdrawalProcessingTime.max}d`, c: withdrawalProcessingTime.max > 14 ? 'text-red-600' : 'text-amber-600' },
              ].map((s) => (
                <div key={s.l} className="text-center p-3 bg-[var(--color-bg-sunken)] rounded-lg">
                  <p className={`text-lg font-bold ${s.c}`}>{s.v}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">{s.l}</p>
                </div>
              ))}
            </div>
            {allWithdrawals.filter((w: any) => w.withdrawalStatus === 'paid' && w.withdrawalPaidAt).length > 0 && (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={(() => {
                  const paidWds = allWithdrawals
                    .filter((w: any) => w.withdrawalStatus === 'paid' && w.withdrawalPaidAt && w.createdAt)
                    .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                    .slice(-12)
                    .map((w: any) => ({
                      date: fmtDate(w.createdAt),
                      days: Math.round((new Date(w.withdrawalPaidAt).getTime() - new Date(w.createdAt).getTime()) / 86400000),
                    }));
                  return paidWds;
                })()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} unit="d" />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: '8px' }} formatter={(val: any) => [`${val} days`, 'Processing Time']} />
                  <Line type="monotone" dataKey="days" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: '#6366f1' }} name="Processing Time" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
      )}

      {/* ── Automation Health Score ────────────────────────── */}
      {schedulerStats.total > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-rose-500" />
              <CardTitle>Automation Health Score</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { l: 'Health Score', v: `${Math.round((schedulerStats.successful / Math.max(schedulerStats.total, 1)) * 100)}%`, c: (schedulerStats.successful / Math.max(schedulerStats.total, 1)) >= 0.9 ? 'text-emerald-600' : (schedulerStats.successful / Math.max(schedulerStats.total, 1)) >= 0.7 ? 'text-amber-600' : 'text-red-600' },
                { l: 'Total Executions', v: schedulerStats.total, c: 'text-indigo-600' },
                { l: 'Settlements Processed', v: schedulerStats.totalProcessed, c: 'text-blue-600' },
                { l: 'Amount Settled', v: fmtCurrency(schedulerStats.totalSettledAmt), c: 'text-purple-600' },
              ].map((s) => (
                <div key={s.l} className="text-center p-3 bg-[var(--color-bg-sunken)] rounded-lg">
                  <p className={`text-lg font-bold ${s.c}`}>{s.v}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">{s.l}</p>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Partner Tier Distribution ───────────────────────── */}
      {partners.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-500" />
                <CardTitle>Partner Tier Distribution</CardTitle>
              </div>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                {(['bronze', 'silver', 'gold', 'platinum'] as PartnerTier[]).map((tier) => {
                  const count = (partners as any[]).filter((p: any) => (p.tier || 'bronze') === tier).length;
                  const pct = partners.length > 0 ? Math.round((count / partners.length) * 100) : 0;
                  const colorMap: Record<string, string> = { bronze: 'text-amber-600', silver: 'text-gray-600', gold: 'text-yellow-600', platinum: 'text-indigo-600' };
                  return (
                    <div key={tier} className="text-center p-3 bg-[var(--color-bg-sunken)] rounded-lg border border-[var(--color-border-subtle)]">
                      <p className={`text-lg font-bold ${colorMap[tier] || 'text-gray-600'}`}>
                        {TIER_LABELS[tier]}
                      </p>
                      <p className="text-2xl font-bold mt-1">{count}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">{pct}% of partners</p>
                    </div>
                  );
                })}
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={(['bronze', 'silver', 'gold', 'platinum'] as PartnerTier[]).map((tier) => ({
                  name: TIER_LABELS[tier],
                  count: (partners as any[]).filter((p: any) => (p.tier || 'bronze') === tier).length,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: '8px' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {(['bronze', 'silver', 'gold', 'platinum'] as PartnerTier[]).map((tier, i) => {
                      const barColors: Record<string, string> = { bronze: '#d97706', silver: '#6b7280', gold: '#eab308', platinum: '#6366f1' };
                      return <Cell key={i} fill={barColors[tier] || '#6366f1'} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          {/* Tier Change KPIs */}
          {(() => {
            const allChanges: any[] = [];
            (partners as any[]).forEach((p: any) => {
              if (p.tierHistory && Array.isArray(p.tierHistory)) {
                p.tierHistory.forEach((entry: any) => {
                  allChanges.push({ ...entry, partnerName: p.firmName || p.contactPerson || p.id });
                });
              }
            });
            if (allChanges.length === 0) return null;

            const upgrades = allChanges.filter((c: any) => {
              const levels: Record<string, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };
              return (levels[c.newTier] || 0) > (levels[c.oldTier] || 0);
            });
            const downgrades = allChanges.filter((c: any) => {
              const levels: Record<string, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };
              return (levels[c.newTier] || 0) < (levels[c.oldTier] || 0);
            });
            const autoChanges = allChanges.filter((c: any) => c.changeType === 'automatic');
            const manualChanges = allChanges.filter((c: any) => c.changeType === 'manual');

            // Monthly tier changes
            const byMonth: Record<string, { upgrades: number; downgrades: number }> = {};
            allChanges.forEach((c: any) => {
              if (!c.changedAt) return;
              const month = new Date(c.changedAt).toLocaleString('default', { month: 'short', year: '2-digit' });
              if (!byMonth[month]) byMonth[month] = { upgrades: 0, downgrades: 0 };
              const levels: Record<string, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };
              if ((levels[c.newTier] || 0) > (levels[c.oldTier] || 0)) byMonth[month].upgrades++;
              else if ((levels[c.newTier] || 0) < (levels[c.oldTier] || 0)) byMonth[month].downgrades++;
            });
            const monthlyData = Object.entries(byMonth).map(([month, data]) => ({ month, ...data }));

            // Average time in tier
            let totalDays = 0;
            let changeCount = 0;
            allChanges.sort((a: any, b: any) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
            for (let i = 1; i < allChanges.length; i++) {
              const days = (new Date(allChanges[i].changedAt).getTime() - new Date(allChanges[i - 1].changedAt).getTime()) / 86400000;
              if (days > 0) { totalDays += days; changeCount++; }
            }
            const avgDaysInTier = changeCount > 0 ? Math.round(totalDays / changeCount) : 0;

            return (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { l: 'Total Changes', v: allChanges.length, icon: <RefreshCw className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
                    { l: 'Upgrades', v: upgrades.length, icon: <ArrowUpCircle className="h-4 w-4" />, c: 'text-emerald-600 bg-emerald-50' },
                    { l: 'Downgrades', v: downgrades.length, icon: <ArrowDownCircle className="h-4 w-4" />, c: 'text-red-600 bg-red-50' },
                    { l: 'Auto Changes', v: autoChanges.length, icon: <RefreshCw className="h-4 w-4" />, c: 'text-blue-600 bg-blue-50' },
                    { l: 'Manual Overrides', v: manualChanges.length, icon: <Users className="h-4 w-4" />, c: 'text-amber-600 bg-amber-50' },
                    { l: 'Avg Time in Tier', v: avgDaysInTier > 0 ? `${avgDaysInTier}d` : '—', icon: <Clock className="h-4 w-4" />, c: 'text-purple-600 bg-purple-50' },
                  ].map(s => (
                    <Card key={s.l} className="p-4 flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
                      <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
                    </Card>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Monthly Tier Changes */}
                  {monthlyData.length > 0 && (
                    <Card>
                      <CardHeader><CardTitle>Monthly Tier Changes</CardTitle></CardHeader>
                      <CardBody>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={monthlyData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ fontSize: 11, borderRadius: '8px' }} />
                            <Bar dataKey="upgrades" fill="#10b981" radius={[3, 3, 0, 0]} name="Upgrades" />
                            <Bar dataKey="downgrades" fill="#ef4444" radius={[3, 3, 0, 0]} name="Downgrades" />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardBody>
                    </Card>
                  )}

                  {/* Automatic vs Manual */}
                  <Card>
                    <CardHeader><CardTitle>Automatic vs Manual Changes</CardTitle></CardHeader>
                    <CardBody className="flex justify-center">
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie data={[
                            { name: 'Automatic', value: Math.max(autoChanges.length, 1) },
                            { name: 'Manual', value: Math.max(manualChanges.length, 1) },
                          ]} cx="50%" cy="45%" outerRadius={60} innerRadius={30} dataKey="value" paddingAngle={3}>
                            <Cell fill="#6366f1" /><Cell fill="#f59e0b" />
                          </Pie>
                          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardBody>
                  </Card>
                </div>

                {/* Tier Progress Trend */}
                {monthlyData.length > 1 && (
                  <Card>
                    <CardHeader><CardTitle>Tier Progress Trend</CardTitle></CardHeader>
                    <CardBody>
                      <ResponsiveContainer width="100%" height={150}>
                        <LineChart data={monthlyData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ fontSize: 11, borderRadius: '8px' }} />
                          <Line type="monotone" dataKey="upgrades" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} name="Upgrades" />
                          <Line type="monotone" dataKey="downgrades" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} name="Downgrades" />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardBody>
                  </Card>
                )}

                {/* Tier Change Timeline */}
                <Card>
                  <CardHeader><CardTitle>Tier Change History</CardTitle></CardHeader>
                  <CardBody className="max-h-[240px] overflow-y-auto">
                    {allChanges.sort((a: any, b: any) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()).slice(0, 10).map((c: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 py-2 border-b border-[var(--color-border-subtle)] last:border-0">
                        <div className={`h-7 w-7 rounded-full flex items-center justify-center ${
                          c.changeType === 'manual' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-indigo-100 dark:bg-indigo-900/30'
                        }`}>
                          {c.changeType === 'manual' ? (
                            <Users className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{c.partnerName}</p>
                          <p className="text-[10px] text-[var(--color-text-muted)]">
                            {TIER_LABELS[c.oldTier as PartnerTier] || c.oldTier} → {TIER_LABELS[c.newTier as PartnerTier] || c.newTier}
                            {c.changeType === 'manual' ? ' (Manual)' : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-[var(--color-text-muted)]">
                            {c.changedAt ? fmtDate(c.changedAt) : '—'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </CardBody>
                </Card>
              </>
            );
          })()}
        </>
      )}

      {/* Partner Tier Progress */}
      {partners.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Partner Tier Progress</CardTitle></CardHeader>
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-left py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Partner</th>
                    <th className="text-left py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Current Tier</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Revenue</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Leads</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Conv%</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Score</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {(partners as any[]).filter((p: any) => !p.isDeleted).sort((a: any, b: any) => (b.tierHistory?.length || 0) - (a.tierHistory?.length || 0)).slice(0, 10).map((p: any) => (
                    <tr key={p.id} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-sunken)] transition-colors">
                      <td className="py-2.5 px-3 font-semibold">{p.firmName || p.contactPerson || '—'}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${({
                          bronze: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                          silver: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
                          gold: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
                          platinum: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
                        })[(p.tier || 'bronze') as string] || 'bg-gray-100 text-gray-600'}`}>
                          {TIER_LABELS[(p.tier || 'bronze') as PartnerTier]}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{fmtCurrency(p.totalCommissionEarned || 0)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{p.totalLeadsCreated || 0}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{p.conversionRate || 0}%</td>
                      <td className="py-2.5 px-3 text-right"><span className="font-semibold">{tierProgressScores[p.id] ?? '—'}</span></td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-[var(--color-text-muted)]">{p.tierHistory?.length || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Fraud & Risk Analytics Section ────────────────────── */}
      {/* Only show fraud section if there are fraud alerts */}
      {(() => {
        // Compute fraud metrics inline from all partners + evaluations
        const fraudAlerts = (partners as any[]).filter((p: any) => !p.isDeleted && p.status === 'active');
        if (fraudAlerts.length === 0 && walletTxns.length === 0 && commissionRecords.length === 0) return null;

        const partnersForFraud = (partners as any[]).filter((p: any) => !p.isDeleted);
        const totalPartners = partnersForFraud.length;
        if (totalPartners === 0) return null;

        // Tier history length as a proxy for exceptional changes
        const partnersWithManyChanges = partnersForFraud.filter((p: any) => (p.tierHistory?.length || 0) > 2);
        const totalChanges = partnersForFraud.reduce((s: number, p: any) => s + (p.tierHistory?.length || 0), 0);
        const avgChanges = totalPartners > 0 ? (totalChanges / totalPartners).toFixed(1) : '0.0';

        // Commission growth anomalies (records with sudden jumps)
        const commRecords = (commissionRecords as any[]).filter((r: any) => !r.isDeleted);
        const largeCommissions = commRecords.filter((r: any) => (r.approvedAmount || r.amount || 0) > 50000);
        const avgCommission = commRecords.length > 0
          ? Math.round(commRecords.reduce((s: number, r: any) => s + (r.approvedAmount || r.amount || 0), 0) / commRecords.length)
          : 0;

        // Settlement failures
        const settlementTxns = (walletTxns as any[]).filter((t: any) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted);
        const failedSettlements = settlementTxns.filter((t: any) => t.status === 'failed');
        const failureRate = settlementTxns.length > 0
          ? Math.round((failedSettlements.length / settlementTxns.length) * 100)
          : 0;

        // Withdrawal frequency anomalies
        const withdrawals = (walletTxns as any[]).filter((t: any) => t.type === 'withdrawal_request' && !t.isDeleted);
        const recentWithdrawals = withdrawals.filter((w: any) => {
          return w.createdAt && (Date.now() - new Date(w.createdAt).getTime()) < 30 * 86400000;
        });

        // Monthly fraud trend (using tier changes as a proxy)
        const monthlyFraudData: Record<string, number> = {};
        partnersForFraud.forEach((p: any) => {
          if (p.tierHistory && Array.isArray(p.tierHistory)) {
            p.tierHistory.forEach((entry: any) => {
              if (!entry.changedAt) return;
              const month = new Date(entry.changedAt).toLocaleString('default', { month: 'short', year: '2-digit' });
              monthlyFraudData[month] = (monthlyFraudData[month] || 0) + 1;
            });
          }
        });
        const monthlyFraud = Object.entries(monthlyFraudData).map(([month, value]) => ({ month, value }));

        return (
          <>
            {/* Risk & Anomaly Indicators */}
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-500" />
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Fraud & Risk Analytics</span>
              {failureRate > 30 && (
                <span className="text-[10px] text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">
                  High failure rate: {failureRate}%
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { l: 'Partners Monitored', v: totalPartners, icon: <Users className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
                { l: 'Settlement Failure Rate', v: `${failureRate}%`, icon: <AlertTriangle className="h-4 w-4" />, c: failureRate > 30 ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50' },
                { l: 'Large Commissions (>₹50K)', v: largeCommissions.length, icon: <TrendingUp className="h-4 w-4" />, c: 'text-amber-600 bg-amber-50' },
                { l: 'Avg Commission', v: fmtCurrency(avgCommission), icon: <BarChart3 className="h-4 w-4" />, c: 'text-purple-600 bg-purple-50' },
                { l: 'Recent Withdrawals (30d)', v: recentWithdrawals.length, icon: <Activity className="h-4 w-4" />, c: recentWithdrawals.length > 10 ? 'text-amber-600 bg-amber-50' : 'text-blue-600 bg-blue-50' },
                { l: 'Manual Overrides', v: partnersWithManyChanges.length, icon: <Users className="h-4 w-4" />, c: 'text-rose-600 bg-rose-50' },
              ].map(s => (
                <Card key={s.l} className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
                  <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Monthly Tier Change Trend (Proxy for Risk) */}
              {monthlyFraud.length > 1 && (
                <Card>
                  <CardHeader><CardTitle>Monthly Tier Changes (Risk Proxy)</CardTitle></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={monthlyFraud}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: '8px' }} />
                        <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Tier Changes" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}

              {/* Settlement Failure vs Success */}
              {settlementTxns.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Settlement Health</CardTitle></CardHeader>
                  <CardBody className="flex justify-center">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={[
                          { name: 'Completed', value: Math.max(settlementTxns.filter((t: any) => t.status === 'completed').length, 1) },
                          { name: 'Failed', value: Math.max(failedSettlements.length, 1) },
                          { name: 'Pending', value: Math.max(settlementTxns.filter((t: any) => t.status === 'pending').length, 1) },
                        ]} cx="50%" cy="45%" outerRadius={60} innerRadius={30} dataKey="value" paddingAngle={3}>
                          <Cell fill="#10b981" /><Cell fill="#ef4444" /><Cell fill="#f59e0b" />
                        </Pie>
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}
            </div>
          </>
        );
      })()}

      {/* ── Customer CRM Analytics ────────────────────────── */}
      {(() => {
        const companyCustomers = (customers as any[]).filter((c: any) => !c.isDeleted);
        const now = new Date();
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        if (companyCustomers.length === 0) return null;

        const activeCustomers = companyCustomers.filter((c: any) => (c.status || 'Active') === 'Active').length;
        const newThisMonth = companyCustomers.filter((c: any) => c.createdAt && new Date(c.createdAt) >= firstOfMonth).length;

        // City-wise distribution
        const byCity: Record<string, number> = {};
        companyCustomers.forEach((c: any) => {
          const city = c.city || 'Unknown';
          byCity[city] = (byCity[city] || 0) + 1;
        });
        const cityData = Object.entries(byCity)
          .map(([city, count]) => ({ name: city, value: count }))
          .sort((a, b) => b.value - a.value);

        // Type breakdown
        const b2bCount = companyCustomers.filter((c: any) => c.type === 'B2B').length;
        const b2cCount = companyCustomers.filter((c: any) => c.type === 'B2C' || !c.type).length;

        // Customers with activity (have leads or orders)
        const customerIds = new Set(companyCustomers.map((c: any) => c.id));
        const customerLeads = (leads as any[]).filter((l: any) => customerIds.has(l.convertedCustomerId || l.customerId || ''));
        const customersWithLeads = new Set(customerLeads.map((l: any) => l.convertedCustomerId || l.customerId));
        const conversionRate = companyCustomers.length > 0
          ? Math.round((customersWithLeads.size / companyCustomers.length) * 100)
          : 0;

        // Follow-up analytics
        const followups = (customers as any[]).filter((c: any) => c.nextFollowupDate || c.lastFollowupNote);
        const followupCompleted = followups.filter((c: any) => !c.nextFollowupDate || new Date(c.nextFollowupDate) < now).length;
        const followupMissed = followups.filter((c: any) => c.nextFollowupDate && new Date(c.nextFollowupDate) < now).length;
        const followupsDue = followups.filter((c: any) => c.nextFollowupDate && new Date(c.nextFollowupDate) >= now).length;

        return (
          <>
            <div className="flex items-center gap-2 mt-6 mb-3">
              <Users className="h-4 w-4 text-blue-500" />
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Customer CRM Analytics</span>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { l: 'Total Customers', v: companyCustomers.length, icon: <Users className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
                { l: 'Active', v: activeCustomers, icon: <UserCheck className="h-4 w-4" />, c: 'text-emerald-600 bg-emerald-50' },
                { l: 'New This Month', v: newThisMonth, icon: <TrendingUp className="h-4 w-4" />, c: 'text-blue-600 bg-blue-50' },
                { l: 'Customer Conv.', v: `${conversionRate}%`, icon: <Target className="h-4 w-4" />, c: 'text-purple-600 bg-purple-50' },
                { l: 'B2B', v: b2bCount, icon: <Building2 className="h-4 w-4" />, c: 'text-amber-600 bg-amber-50' },
                { l: 'B2C', v: b2cCount, icon: <UserCheck className="h-4 w-4" />, c: 'text-teal-600 bg-teal-50' },
              ].map(s => (
                <Card key={s.l} className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
                  <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* City-wise Distribution */}
              {cityData.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>City-wise Customer Distribution</CardTitle></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={cityData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{fontSize:10}} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{fontSize:10}} axisLine={false} tickLine={false} width={90} />
                        <Tooltip contentStyle={{fontSize:11}} />
                        <Bar dataKey="value" fill="#6366f1" radius={[0,4,4,0]} name="Customers" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}

              {/* Customer Types */}
              <Card>
                <CardHeader><CardTitle>Customer Type Split</CardTitle></CardHeader>
                <CardBody className="flex justify-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={[
                        { name: 'B2B', value: Math.max(b2bCount, 1) },
                        { name: 'B2C', value: Math.max(b2cCount, 1) },
                      ]} cx="50%" cy="45%" outerRadius={60} innerRadius={30} dataKey="value" paddingAngle={3}>
                        <Cell fill="#f59e0b" /><Cell fill="#6366f1" />
                      </Pie>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}} />
                      <Tooltip contentStyle={{fontSize:11}} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </div>

            {/* Follow-up Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Card>
                <CardHeader><CardTitle>Follow-up Performance</CardTitle></CardHeader>
                <CardBody>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                      <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{Math.max(followupCompleted, 1)}</p>
                      <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold">Completed</p>
                    </div>
                    <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                      <p className="text-lg font-bold text-red-600 dark:text-red-400">{Math.max(followupMissed, 1)}</p>
                      <p className="text-[10px] text-red-700 dark:text-red-300 font-semibold">Missed</p>
                    </div>
                    <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                      <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{Math.max(followupsDue, 1)}</p>
                      <p className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold">Due</p>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Based on follow-up data from {followups.length} customer{followups.length !== 1 ? 's' : ''} with scheduled activities.
                  </p>
                </CardBody>
              </Card>
              <Card>
                <CardHeader><CardTitle>Communication Summary</CardTitle></CardHeader>
                <CardBody>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                      <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{companyCustomers.length}</p>
                      <p className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold">Total Customers</p>
                    </div>
                    <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                      <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{activeCustomers}</p>
                      <p className="text-[10px] text-purple-700 dark:text-purple-300 font-semibold">Active</p>
                    </div>
                    <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                      <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{newThisMonth}</p>
                      <p className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold">New/Month</p>
                    </div>
                    <div className="text-center p-3 bg-teal-50 dark:bg-teal-900/20 rounded-lg">
                      <p className="text-lg font-bold text-teal-600 dark:text-teal-400">{`${conversionRate}%`}</p>
                      <p className="text-[10px] text-teal-700 dark:text-teal-300 font-semibold">Conv. Rate</p>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          </>
        );
      })()}

      {/* ── Installation Analytics ────────────────────────── */}
      {(() => {
        const installLeads = (leads as any[]).filter((l: any) => l.installationStatus && l.installationStatus !== 'pending' && !l.isDeleted);
        if (installLeads.length === 0) return null;

        // Stage distribution
        const byStage: Record<string, number> = {};
        installLeads.forEach((l: any) => {
          const s = l.installationStatus || 'unknown';
          byStage[s] = (byStage[s] || 0) + 1;
        });
        const stageDistribution = Object.entries(byStage).map(([stage, count]) => ({
          name: INSTALLATION_STATUS_LABELS[stage as keyof typeof INSTALLATION_STATUS_LABELS] || stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          value: count,
        }));

        // Engineer performance
        const engineerStats: Record<string, { total: number; completed: number }> = {};
        installLeads.forEach((l: any) => {
          const eng = l.assignedEngineerName || 'Unassigned';
          if (!engineerStats[eng]) engineerStats[eng] = { total: 0, completed: 0 };
          engineerStats[eng].total++;
          if (l.installationStatus === 'installation_complete' || l.installationStatus === 'closed') engineerStats[eng].completed++;
        });
        const engineerData = Object.entries(engineerStats)
          .map(([name, data]) => ({
            name,
            total: data.total,
            completed: data.completed,
            rate: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
          }))
          .sort((a, b) => b.total - a.total);

        // Delay analysis
        const delayedCount = installLeads.filter((l: any) => {
          const d = l.expectedCompletionDate || l.scheduledDate;
          return d && new Date(d) < new Date() && l.installationStatus !== 'installation_complete' && l.installationStatus !== 'closed';
        }).length;
        const delayRate = installLeads.length > 0 ? Math.round((delayedCount / installLeads.length) * 100) : 0;

        // Completion time (days from lead creation to completion/completion stage)
        const completionTimes: number[] = [];
        installLeads.filter((l: any) => l.installationStatus === 'installation_complete' || l.installationStatus === 'closed').forEach((l: any) => {
          if (l.updatedAt && l.createdAt) {
            const days = Math.round((new Date(l.updatedAt).getTime() - new Date(l.createdAt).getTime()) / 86400000);
            if (days > 0) completionTimes.push(days);
          }
        });
        const avgCompletionTime = completionTimes.length > 0
          ? Math.round(completionTimes.reduce((s, d) => s + d, 0) / completionTimes.length)
          : 0;

        // Monthly installations
        const byMonth: Record<string, number> = {};
        installLeads.forEach((l: any) => {
          if (!l.createdAt) return;
          const m = new Date(l.createdAt).toLocaleString('default', { month: 'short', year: '2-digit' });
          byMonth[m] = (byMonth[m] || 0) + 1;
        });
        const monthlyData = Object.entries(byMonth).map(([month, count]) => ({ month, count }));

        // Material readiness
        const materialReady = installLeads.filter((l: any) =>
          l.installationStatus === 'material_delivered' || l.installationStatus === 'installation_started' || l.installationStatus === 'installation_in_progress'
        ).length;

        return (
          <>
            <div className="flex items-center gap-2 mt-6 mb-3">
              <HardHat className="h-4 w-4 text-indigo-500" />
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Installation Analytics</span>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { l: 'Total Projects', v: installLeads.length, icon: <HardHat className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
                { l: 'Completed', v: installLeads.filter((l: any) => l.installationStatus === 'installation_complete' || l.installationStatus === 'closed').length, icon: <CheckCircle2 className="h-4 w-4" />, c: 'text-emerald-600 bg-emerald-50' },
                { l: 'Delayed', v: delayedCount, icon: <AlertTriangle className="h-4 w-4" />, c: delayedCount > 0 ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50' },
                { l: 'Delay Rate', v: `${delayRate}%`, icon: <AlertTriangle className="h-4 w-4" />, c: delayRate > 30 ? 'text-red-600 bg-red-50' : 'text-amber-600 bg-amber-50' },
                { l: 'Avg Completion', v: avgCompletionTime > 0 ? `${avgCompletionTime}d` : '—', icon: <Clock className="h-4 w-4" />, c: 'text-purple-600 bg-purple-50' },
                { l: 'Engineers', v: engineerData.filter((e) => e.name !== 'Unassigned').length, icon: <Users className="h-4 w-4" />, c: 'text-teal-600 bg-teal-50' },
              ].map(s => (
                <Card key={s.l} className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
                  <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Stage Distribution */}
              {stageDistribution.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Stage Distribution</CardTitle></CardHeader>
                  <CardBody className="flex justify-center">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={stageDistribution} cx="50%" cy="45%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                          {stageDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}} />
                        <Tooltip contentStyle={{fontSize:11}} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}

              {/* Monthly Installations */}
              {monthlyData.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Monthly Installations</CardTitle></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={monthlyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tick={{fontSize:10}} axisLine={false} tickLine={false} />
                        <YAxis tick={{fontSize:10}} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{fontSize:11, borderRadius:'8px'}} />
                        <Bar dataKey="count" fill="#6366f1" radius={[4,4,0,0]} name="Installations" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              )}
            </div>

            {/* Engineer Performance */}
            {engineerData.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Engineer Performance</CardTitle></CardHeader>
                <CardBody>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--color-border-subtle)]">
                          <th className="text-left py-2 px-3 font-semibold text-[var(--color-text-muted)]">Engineer</th>
                          <th className="text-right py-2 px-3 font-semibold text-[var(--color-text-muted)]">Total Assignments</th>
                          <th className="text-right py-2 px-3 font-semibold text-[var(--color-text-muted)]">Completed</th>
                          <th className="text-right py-2 px-3 font-semibold text-[var(--color-text-muted)]">Completion Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {engineerData.map((eng) => (
                          <tr key={eng.name} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-sunken)] transition-colors">
                            <td className="py-2 px-3 font-semibold">{eng.name}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{eng.total}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{eng.completed}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{eng.rate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Material Readiness */}
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardHeader><CardTitle>Material Readiness</CardTitle></CardHeader>
                <CardBody>
                  <p className="text-2xl font-bold text-[var(--color-text)]">{materialReady}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Projects with material delivered or installation in progress</p>
                </CardBody>
              </Card>
              <Card>
                <CardHeader><CardTitle>Completion Trends</CardTitle></CardHeader>
                <CardBody>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {installLeads.filter((l: any) => l.installationStatus === 'installation_complete' || l.installationStatus === 'closed').length}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {installLeads.length > 0
                      ? `${Math.round((installLeads.filter((l: any) => l.installationStatus === 'installation_complete' || l.installationStatus === 'closed').length / installLeads.length) * 100)}% of all installation projects`
                      : 'No projects'}
                  </p>
                </CardBody>
              </Card>
            </div>
          </>
        );
      })()}

      {/* Lead Conversion Funnel */}
      <Card>
        <CardHeader><CardTitle>Lead Conversion Funnel</CardTitle></CardHeader>
        <CardBody>
          <div className="space-y-3">
            {[
              {label:'Total Leads',val:leads.length,color:'bg-indigo-100 text-indigo-700'},
              {label:'Follow-up',val:leads.filter((l:any)=>l.status==='Follow-up').length,color:'bg-amber-100 text-amber-700'},
              {label:'Qualified',val:leads.filter((l:any)=>l.status==='Qualified').length,color:'bg-purple-100 text-purple-700'},
              {label:'Converted',val:leads.filter((l:any)=>l.status==='Converted').length,color:'bg-emerald-100 text-emerald-700'},
            ].map((item,i)=>(
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-muted w-24 shrink-0">{item.label}</span>
                <div className="flex-1 bg-background rounded-full h-6 overflow-hidden">
                  <div className={`h-full rounded-full flex items-center px-3 transition-all duration-500 ${item.color}`} style={{width:leads.length?`${Math.max(5,(item.val/leads.length)*100)}%`:'5%'}}>
                    <span className="text-xs font-bold">{item.val}</span>
                  </div>
                </div>
                <span className="text-sm font-bold text-gray-600 w-12 text-right">{leads.length?Math.round((item.val/leads.length)*100):0}%</span>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
      <ProjectPipelineSection />
    </div>
  );
}
