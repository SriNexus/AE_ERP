/**
 * Dashboards.tsx — Analytics & Business Intelligence
 * Phase P2: Full semantic token compliance.
 * VALID palette: COLORS viz pigments, chart fills, funnel bar pigments,
 *   warning/amber low-stock alert, B2B/B2C segment fills.
 */

import { useQuery } from '@tanstack/react-query';
import { getAll, fmtCompactCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody, PageHeader, StatCard } from '../components/ui/Card';
import { useAppStore } from '../store/useAppStore';
import {
  BarChart3, TrendingUp, Package, Truck, Users, CreditCard,
  Target, ShoppingCart, AlertTriangle,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend, Line,
} from 'recharts';

import { WorkspaceDashboard } from '../components/shared/WorkspaceDashboard';

const TABS = ['Sales', 'Inventory', 'HR', 'Accounts', 'Dispatch', 'Workspace'] as const;
type Tab = typeof TABS[number];

// VALID: Fixed data-visualization palette pigments — permanent chart series identity.
const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316'];

// Shared Tooltip style — uses CSS var strings for correct dark-mode surface rendering.
// This is the correct pattern for 3rd-party components that accept style objects.
const TOOLTIP_STYLE = {
  borderRadius: '10px',
  fontSize: 11,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
};

function fmtCompactNumber(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const trim = (next: number, max = 1) => next.toLocaleString('en-IN', {
    maximumFractionDigits: max,
  });
  if (abs >= 10000000) return `${sign}${trim(abs / 10000000, 2)}Cr`;
  if (abs >= 100000) return `${sign}${trim(abs / 100000, 1)}L`;
  if (abs >= 1000) return `${sign}${trim(abs / 1000, 1)}K`;
  return `${sign}${trim(abs, 0)}`;
}

export default function Dashboards() {
  const [tab, setTab] = useState<Tab>('Sales');
  const { company } = useAppStore();
  const sym = company.currencySymbol;

  const { data: leads=[]      } = useQuery({ queryKey:['leads'],      queryFn:()=>getAll(COLLECTIONS.LEADS),            staleTime:60000 });
  const { data: orders=[]     } = useQuery({ queryKey:['orders'],     queryFn:()=>getAll(COLLECTIONS.ORDERS),           staleTime:60000 });
  const { data: customers=[]  } = useQuery({ queryKey:['customers'],  queryFn:()=>getAll(COLLECTIONS.CUSTOMERS),        staleTime:60000 });
  const { data: invoices=[]   } = useQuery({ queryKey:['invoices'],   queryFn:()=>getAll(COLLECTIONS.PROFORMA_INVOICES),staleTime:60000 });
  const { data: payments=[]   } = useQuery({ queryKey:['payments'],   queryFn:()=>getAll(COLLECTIONS.PAYMENTS),         staleTime:60000 });
  const { data: products=[]   } = useQuery({ queryKey:['products'],   queryFn:()=>getAll(COLLECTIONS.PRODUCTS),         staleTime:60000 });
  const { data: stock=[]      } = useQuery({ queryKey:['stock'],      queryFn:()=>getAll(COLLECTIONS.STOCK),            staleTime:60000 });
  const { data: dispatches=[] } = useQuery({ queryKey:['dispatch'],   queryFn:()=>getAll(COLLECTIONS.DISPATCH),         staleTime:60000 });
  const { data: employees=[]  } = useQuery({ queryKey:['employees'],  queryFn:()=>getAll(COLLECTIONS.EMPLOYEES),        staleTime:60000 });
  const { data: attendance=[] } = useQuery({ queryKey:['attendance'], queryFn:()=>getAll(COLLECTIONS.ATTENDANCE),       staleTime:60000 });
  const { data: payroll=[]    } = useQuery({ queryKey:['payroll'],    queryFn:()=>getAll(COLLECTIONS.PAYROLL),          staleTime:60000 });

  // 12-month trend
  const months12 = (() => {
    const m:Record<string,{orders:number;revenue:number;leads:number}> = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const k = d.toLocaleString('default', {month:'short', year:'2-digit'});
      m[k] = {orders:0, revenue:0, leads:0};
    }
    orders.forEach((o:any)=>{if(!o.createdAt)return;const k=new Date(o.createdAt).toLocaleString('default',{month:'short',year:'2-digit'});if(m[k]){m[k].orders++;m[k].revenue+=Number(o.total)||0;}});
    leads.forEach((l:any)=>{if(!l.createdAt)return;const k=new Date(l.createdAt).toLocaleString('default',{month:'short',year:'2-digit'});if(m[k])m[k].leads++;});
    return Object.entries(m).map(([month,v])=>({month,...v}));
  })();

  const srcData = Object.entries(leads.reduce((a:Record<string,number>,l:any)=>{const s=l.source||'Other';a[s]=(a[s]||0)+1;return a;},{})).map(([name,value])=>({name,value}));
  const ordStatus = Object.entries(orders.reduce((a:Record<string,number>,o:any)=>{const s=o.status||'Pending';a[s]=(a[s]||0)+1;return a;},{})).map(([name,value])=>({name,value}));
  const payModes = Object.entries(payments.reduce((a:Record<string,number>,p:any)=>{const m=p.mode||'Other';a[m]=(a[m]||0)+(Number(p.amount)||0);return a;},{})).map(([name,value])=>({name,value}));

  const today = new Date().toISOString().split('T')[0];
  const todayAtt = attendance.filter((a:any)=>a.date===today);
  const deptAtt = employees.reduce((a:Record<string,{present:number;total:number}>,e:any)=>{
    const dept = e.department||'Others';
    if (!a[dept]) a[dept] = {present:0, total:0};
    a[dept].total++;
    if (todayAtt.find((t:any)=>t.employeeId===e.id&&t.status==='Present')) a[dept].present++;
    return a;
  },{});
  const deptAttData = Object.entries(deptAtt).map(([dept,v])=>({dept,present:v.present,absent:v.total-v.present}));

  const lowStock = stock.filter((s:any)=>(s.available||0)<=(s.min_stock||5));

  // Funnel bar data — VALID: bar class values are fixed funnel-stage identity pigments
  const funnelData = [
    {label:'Total Leads', val:leads.length,                                                   bar:'bg-indigo-500'},
    {label:'Follow-up',   val:leads.filter((l:any)=>l.status==='Follow-up').length,            bar:'bg-amber-500'},
    {label:'Qualified',   val:leads.filter((l:any)=>l.status==='Qualified').length,            bar:'bg-purple-500'},
    {label:'Converted',   val:leads.filter((l:any)=>l.status==='Converted').length,            bar:'bg-emerald-500'},
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Dashboards" subtitle="Analytics & Business Intelligence" icon={<BarChart3 className="h-5 w-5"/>}
        breadcrumbs={['Home','Dashboards']}/>

      {/*
        Tab strip:
        - Container is a sunken tray that the active tab floats above — bg-sunken.
        - Active tab is an elevated surface popping above the tray — bg-surface.
        - Inactive text: muted (de-emphasised). Active text: primary brand pigment (VALID).
        - Hover inactive: text-secondary (one step above muted, still below active).
      */}
      <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[var(--color-bg-sunken)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`shrink-0 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              tab === t
                ? 'bg-[var(--color-surface)] text-[var(--color-primary-text)] shadow-sm'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {/* SALES DASHBOARD */}
      {tab === 'Sales' && (
        <div className="space-y-5 animate-fadeIn">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Leads"   value={fmtCompactNumber(leads.length)}     icon={<Target className="h-5 w-5"/>}       color="indigo"/>
            <StatCard label="Converted"     value={fmtCompactNumber(leads.filter((l:any)=>l.status==='Converted').length)} icon={<TrendingUp className="h-5 w-5"/>} color="emerald" sub={`${leads.length?Math.round((leads.filter((l:any)=>l.status==='Converted').length/leads.length)*100):0}% rate`}/>
            <StatCard label="Total Orders"  value={fmtCompactNumber(orders.length)}    icon={<ShoppingCart className="h-5 w-5"/>} color="blue"/>
            <StatCard label="Total Revenue" value={fmtCompactCurrency(orders.reduce((s:number,o:any)=>s+(Number(o.total)||0),0),sym)} icon={<CreditCard className="h-5 w-5"/>} color="purple"/>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Revenue & Orders Trend (12M)</CardTitle></CardHeader>
              <CardBody>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={months12}>
                    <defs>
                      {/* VALID: #6366f1 is fixed primary brand gradient fill */}
                      <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    {/*
                      CartesianGrid: stroke="currentColor" + token class is correct pattern.
                      Removes hardcoded #f0f0f0 and the opacity-20 opacity hack.
                    */}
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-[var(--color-border-subtle)]"/>
                    <XAxis dataKey="month" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fontSize:10}} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={TOOLTIP_STYLE}/>
                    {/* VALID: chart series pigments */}
                    <Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="url(#gr)" strokeWidth={2} name="Revenue"/>
                    <Line type="monotone" dataKey="leads" stroke="#f59e0b" strokeWidth={2} dot={false} name="Leads"/>
                  </AreaChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
            <Card>
              <CardHeader><CardTitle>Lead Sources</CardTitle></CardHeader>
              <CardBody className="flex justify-center">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={srcData} cx="50%" cy="44%" outerRadius={75} innerRadius={38} dataKey="value" paddingAngle={3}>
                      {srcData.map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                    </Pie>
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}}/>
                    <Tooltip contentStyle={TOOLTIP_STYLE}/>
                  </PieChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          </div>

          {/* Lead funnel */}
          <Card>
            <CardHeader><CardTitle>Lead Conversion Funnel</CardTitle></CardHeader>
            <CardBody>
              <div className="space-y-3">
                {funnelData.map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    {/* Label: muted — subordinate to the bar value */}
                    <span className="text-sm text-[var(--color-text-muted)] w-28 shrink-0 font-medium">{item.label}</span>
                    {/*
                      Track: bg-sunken — sunken tray holding the active fill.
                      Correct dark-mode elevation: inactive region sits at lowest surface.
                    */}
                    <div className="flex-1 bg-[var(--color-bg-sunken)] rounded-full h-7 overflow-hidden">
                      {/* VALID: item.bar is a fixed funnel-stage identity pigment */}
                      <div className={`h-full rounded-full flex items-center px-3 transition-all duration-700 ${item.bar}`}
                        style={{width: leads.length ? `${Math.max(4,(item.val/leads.length)*100)}%` : '4%'}}>
                        <span className="text-xs font-bold text-white">{item.val}</span>
                      </div>
                    </div>
                    {/* Percentage: secondary — readable but subordinate to bar number */}
                    <span className="text-sm font-bold text-[var(--color-text-secondary)] w-12 text-right tabular-nums">
                      {leads.length ? Math.round((item.val/leads.length)*100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader><CardTitle>Order Status Breakdown</CardTitle></CardHeader>
              <CardBody className="flex justify-center">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={ordStatus} cx="50%" cy="44%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                      {ordStatus.map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                    </Pie>
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}}/>
                    <Tooltip contentStyle={TOOLTIP_STYLE}/>
                  </PieChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
            <Card>
              <CardHeader><CardTitle>Customer Types</CardTitle></CardHeader>
              <CardBody className="flex justify-center">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={[{name:'B2B',value:customers.filter((c:any)=>c.type==='B2B').length},{name:'B2C',value:customers.filter((c:any)=>c.type==='B2C').length}]}
                      cx="50%" cy="44%" outerRadius={70} innerRadius={35} dataKey="value" paddingAngle={3}>
                      {/* VALID: fixed B2B/B2C segment identity pigments */}
                      <Cell fill="#6366f1"/><Cell fill="#10b981"/>
                    </Pie>
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}}/>
                    <Tooltip contentStyle={TOOLTIP_STYLE}/>
                  </PieChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* INVENTORY DASHBOARD */}
      {tab === 'Inventory' && (
        <div className="space-y-5 animate-fadeIn">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Products"    value={fmtCompactNumber(products.length)}   icon={<Package className="h-5 w-5"/>}       color="purple"/>
            <StatCard label="Stock Items" value={fmtCompactNumber(stock.length)}      icon={<Package className="h-5 w-5"/>}       color="blue"/>
            <StatCard label="Low Stock"   value={fmtCompactNumber(lowStock.length)}   icon={<AlertTriangle className="h-5 w-5"/>} color="red" sub="needs reorder"/>
            <StatCard label="Dispatches"  value={fmtCompactNumber(dispatches.length)} icon={<Truck className="h-5 w-5"/>}         color="amber"/>
          </div>
          {/* VALID: amber palette is fixed warning status pigment for low-stock alert */}
          {lowStock.length > 0 && (
            <div className="bg-[var(--color-warning-light)] border border-[var(--color-warning)] rounded-xl px-4 py-3">
              <p className="text-sm font-semibold text-[var(--color-warning-text)] mb-1">
                ⚠️ Low Stock Alert — {lowStock.length} items need reorder
              </p>
              <div className="flex flex-wrap gap-2">
                {lowStock.slice(0,8).map((s:any) => (
                  <span key={s.id} className="text-xs bg-[var(--color-warning-light)] text-[var(--color-warning-text)] px-2 py-1 rounded-full">
                    {s.product}: {s.available} left
                  </span>
                ))}
              </div>
            </div>
          )}
          <Card>
            <CardHeader><CardTitle>Stock Levels</CardTitle></CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stock.slice(0,10).map((s:any)=>({name:(s.product||'?').slice(0,12),available:s.available||0,reserved:s.reserved||0}))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-[var(--color-border-subtle)]"/>
                  <XAxis dataKey="name" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:10}} axisLine={false} tickLine={false}/>
                  <Tooltip contentStyle={TOOLTIP_STYLE}/>
                  {/* VALID: chart series pigments */}
                  <Bar dataKey="available" fill="#6366f1" radius={[4,4,0,0]} name="Available"/>
                  <Bar dataKey="reserved"  fill="#f59e0b" radius={[4,4,0,0]} name="Reserved"/>
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </div>
      )}

      {/* HR DASHBOARD */}
      {tab === 'HR' && (
        <div className="space-y-5 animate-fadeIn">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Employees"     value={fmtCompactNumber(employees.length)}                                                           icon={<Users className="h-5 w-5"/>}       color="blue"/>
            <StatCard label="Active"        value={fmtCompactNumber(employees.filter((e:any)=>e.status==='Active').length)}                     icon={<Users className="h-5 w-5"/>}       color="emerald"/>
            <StatCard label="Today Present" value={fmtCompactNumber(todayAtt.filter((a:any)=>a.status==='Present').length)}                     icon={<Users className="h-5 w-5"/>}       color="indigo"/>
            <StatCard label="Payroll Cost"  value={fmtCompactCurrency(payroll.filter((p:any)=>p.month===new Date().toLocaleString('default',{month:'long'})).reduce((s:number,p:any)=>s+(Number(p.netSalary)||0),0),sym)} icon={<CreditCard className="h-5 w-5"/>} color="purple" sub="this month"/>
          </div>
          <Card>
            <CardHeader><CardTitle>Department Attendance (Today)</CardTitle></CardHeader>
            <CardBody>
              {deptAttData.length === 0
                ? <p className="text-center text-[var(--color-text-muted)] py-8 text-sm">No attendance data for today</p>
                : <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={deptAttData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-[var(--color-border-subtle)]"/>
                      <XAxis dataKey="dept" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:10}} axisLine={false} tickLine={false}/>
                      <Tooltip contentStyle={TOOLTIP_STYLE}/>
                      {/* VALID: emerald/red are fixed present/absent status pigments */}
                      <Bar dataKey="present" fill="#10b981" radius={[4,4,0,0]} name="Present"/>
                      <Bar dataKey="absent"  fill="#ef4444" radius={[4,4,0,0]} name="Absent"/>
                    </BarChart>
                  </ResponsiveContainer>
              }
            </CardBody>
          </Card>
        </div>
      )}

      {/* ACCOUNTS DASHBOARD */}
      {tab === 'Accounts' && (
        <div className="space-y-5 animate-fadeIn">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Revenue"   value={fmtCompactCurrency(orders.reduce((s:number,o:any)=>s+(Number(o.total)||0),0),sym)}   icon={<TrendingUp className="h-5 w-5"/>}    color="purple"/>
            <StatCard label="Collected" value={fmtCompactCurrency(payments.reduce((s:number,p:any)=>s+(Number(p.amount)||0),0),sym)} icon={<CreditCard className="h-5 w-5"/>}    color="emerald"/>
            <StatCard label="Invoices"  value={fmtCompactNumber(invoices.length)}                                                                icon={<Target className="h-5 w-5"/>}        color="blue"/>
            <StatCard label="Overdue"   value={fmtCompactNumber(invoices.filter((i:any)=>i.paymentStatus==='Overdue').length)}                   icon={<AlertTriangle className="h-5 w-5"/>} color="red"/>
          </div>
          <Card>
            <CardHeader><CardTitle>Payment Modes Distribution</CardTitle></CardHeader>
            <CardBody className="flex justify-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={payModes} cx="50%" cy="44%" outerRadius={80} innerRadius={40} dataKey="value" paddingAngle={3}>
                    {payModes.map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                  </Pie>
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}}/>
                  <Tooltip contentStyle={TOOLTIP_STYLE}/>
                </PieChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </div>
      )}

      {/* WORKSPACE DASHBOARD */}
      {tab === 'Workspace' && (
        <div className="animate-fadeIn">
          <WorkspaceDashboard />
        </div>
      )}

      {/* DISPATCH DASHBOARD */}
      {tab === 'Dispatch' && (
        <div className="space-y-5 animate-fadeIn">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total"      value={fmtCompactNumber(dispatches.length)}                                          icon={<Truck className="h-5 w-5"/>} color="blue"/>
            <StatCard label="Pending"    value={fmtCompactNumber(dispatches.filter((d:any)=>d.status==='Pending').length)}    icon={<Truck className="h-5 w-5"/>} color="amber"/>
            <StatCard label="In Transit" value={fmtCompactNumber(dispatches.filter((d:any)=>d.status==='In Transit').length)} icon={<Truck className="h-5 w-5"/>} color="orange"/>
            <StatCard label="Delivered"  value={fmtCompactNumber(dispatches.filter((d:any)=>d.status==='Delivered').length)}  icon={<Truck className="h-5 w-5"/>} color="emerald"/>
          </div>
          <Card>
            <CardHeader><CardTitle>Dispatch Status Breakdown</CardTitle></CardHeader>
            <CardBody className="flex justify-center">
              {dispatches.length === 0
                ? <p className="text-center text-[var(--color-text-muted)] py-8 text-sm">No dispatch data yet</p>
                : <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={Object.entries(dispatches.reduce((a:Record<string,number>,d:any)=>{a[d.status||'Pending']=(a[d.status||'Pending']||0)+1;return a;},{})).map(([name,value])=>({name,value}))}
                        cx="50%" cy="44%" outerRadius={80} innerRadius={40} dataKey="value" paddingAngle={3}>
                        {dispatches.map((_:any,i:number) => <Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                      </Pie>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:10}}/>
                      <Tooltip contentStyle={TOOLTIP_STYLE}/>
                    </PieChart>
                  </ResponsiveContainer>
              }
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
