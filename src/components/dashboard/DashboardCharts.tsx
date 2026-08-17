/**
 * DashboardCharts — Revenue trend bar chart, Lead pipeline donut, and
 * Revenue vs Orders trend line chart (for the homepage 40:30:30 charts row).
 * Phase P1: Full semantic token compliance on all themed surfaces/text.
 * VALID palette: COLORS array (viz pigments), Bar/Line fills, legend dots.
 * NOTE: recharts Tooltip contentStyle uses CSS var strings — correct approach
 * for 3rd-party components that accept style objects, not Tailwind classes.
 *
 * Redesign pass: presentation only — card layout, icon-badge header (matches
 * the same badge language used across every dashboard panel), padding,
 * spacing. Chart data, series, colors and tooltip logic for the two existing
 * charts are untouched. RevenueVsOrdersTrendChart is a NEW export added for
 * the homepage's 40:30:30 charts row — it reuses the exact same `data` shape
 * already fetched for RevenueTrendChart (no new data source), rendered as a
 * line chart instead of bars so it reads as a distinct "trend" view.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { ArrowRight, AlertTriangle, TrendingUp, Filter, LineChart as LineChartIcon } from 'lucide-react';
import { fmtCompactCurrency } from '../../lib/firestore';
import { resolvePalette } from '../../theme/palettes';
import { useSettingsSection } from '../../features/settings/hooks/useSettingsSection';

// Chart palette resolved from theme settings — replaces hardcoded COLORS array
function useChartColors(): string[] {
  const { data: themeSettings } = useSettingsSection('theme-ui');
  const [colors, setColors] = useState<string[]>([
    '#7c3aed', '#3b82f6', '#0ea5e9', '#10b981', '#ef4444', '#f59e0b',
  ]);

  useEffect(() => {
    const paletteId = (themeSettings as any)?.chartPaletteId || 'default';
    const customPalette = (themeSettings as any)?.customChartPalette;
    setColors(resolvePalette(paletteId, customPalette));
  }, [themeSettings]);

  return colors;
}

interface RevenueTrendChartProps {
  data: { month: string; orders: number; revenue: number }[];
  loading?: boolean;
  currencySymbol?: string;
  height?: number;
}

interface LeadPipelineChartProps {
  data: { status: string; count: number }[];
  loading?: boolean;
  height?: number;
}

// Same data shape as RevenueTrendChartProps — this chart reuses that exact
// already-fetched dataset (overview.revenueTrend), just visualized as lines.
type RevenueVsOrdersTrendChartProps = RevenueTrendChartProps;

// Skeleton: flat surface, no gradient — gradient used invalid gray palette classes.
function ChartSkeleton({ height = 230 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-xl bg-[var(--color-bg-sunken)]"
      style={{ height }}
    />
  );
}

// Shared header treatment — icon badge + title/subtitle + link — kept identical
// across every dashboard panel in this redesign so the page reads as one product.
function PanelHeader({
  icon, title, subtitle, onAction, actionLabel,
}: { icon: React.ReactNode; title: string; subtitle: React.ReactNode; onAction: () => void; actionLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-5">
      <div className="flex items-center gap-3 min-w-0">
        <div className="rounded-xl bg-[var(--color-primary-light)] p-2 text-[var(--color-primary-text)] shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-[var(--color-text)]">{title}</h3>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{subtitle}</p>
        </div>
      </div>
      {/* VALID: indigo-600 is primary brand link pigment */}
      <button
        onClick={onAction}
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 -mr-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-[var(--color-surface-hover)] hover:text-indigo-700 transition-colors"
      >
        {actionLabel} <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}

// Tooltip uses semantic token CSS vars in the style object — correct approach
// for recharts which accepts style objects, not Tailwind classes.
function RevenueTooltip({ active, payload, label, sym }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-bold text-[var(--color-text-secondary)] mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.fill ?? p.stroke }} className="font-semibold">
          {p.name === 'revenue'
            ? fmtCompactCurrency(Number(p.value), sym)
            : `${p.value} orders`}
        </p>
      ))}
    </div>
  );
}

export const RevenueTrendChart = React.memo(function RevenueTrendChart({
  data, loading, currencySymbol = '₹', height = 220,
}: RevenueTrendChartProps) {
  const navigate = useNavigate();
  const COLORS = useChartColors();

  return (
    <div className="h-full bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5">
      <PanelHeader
        icon={<TrendingUp className="h-4 w-4" />}
        title="Revenue & Orders"
        subtitle="Last 6 months"
        onAction={() => navigate('/reports')}
        actionLabel="Full Report"
      />

      {loading
        ? <ChartSkeleton height={height + 10} />
        : (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} barGap={2} barCategoryGap="30%">
              {/*
                CartesianGrid/Axis className props: pass Tailwind to SVG elements.
                Recharts may not apply them consistently, but they are non-breaking.
                Using token classes here is architecturally correct regardless.
              */}
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-[var(--color-border-subtle)]" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} className="text-[var(--color-text-muted)]" />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={36} className="text-[var(--color-text-muted)]" />
              <Tooltip content={<RevenueTooltip sym={currencySymbol} />} />
              {/* Chart fills from theme palette */}
              <Bar dataKey="orders"  fill={COLORS[0] || '#6366f1'} radius={[3, 3, 0, 0]} name="orders" />
              <Bar dataKey="revenue" fill={COLORS[1] || '#10b981'} radius={[3, 3, 0, 0]} name="revenue" />
            </BarChart>
          </ResponsiveContainer>
        )
      }

      {/* Legend dots from theme palette */}
      <div className="flex items-center gap-4 mt-4 justify-center">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm inline-block" style={{ backgroundColor: COLORS[0] || '#6366f1' }} />
          <span className="text-[10px] text-[var(--color-text-muted)] font-medium">Orders</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm inline-block" style={{ backgroundColor: COLORS[1] || '#10b981' }} />
          <span className="text-[10px] text-[var(--color-text-muted)] font-medium">Revenue</span>
        </div>
      </div>
    </div>
  );
});

// NEW — added for the homepage's 40:30:30 charts row. Same data source as
// RevenueTrendChart (overview.revenueTrend), rendered as a line trend instead
// of bars so the two panels read as complementary views, not duplicates.
export const RevenueVsOrdersTrendChart = React.memo(function RevenueVsOrdersTrendChart({
  data, loading, currencySymbol = '₹', height = 220,
}: RevenueVsOrdersTrendChartProps) {
  const navigate = useNavigate();
  const COLORS = useChartColors();

  return (
    <div className="h-full bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5">
      <PanelHeader
        icon={<LineChartIcon className="h-4 w-4" />}
        title="Revenue vs Orders Trend"
        subtitle="Last 6 months"
        onAction={() => navigate('/reports')}
        actionLabel="Full Report"
      />

      {loading
        ? <ChartSkeleton height={height + 10} />
        : (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-[var(--color-border-subtle)]" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} className="text-[var(--color-text-muted)]" />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={36} className="text-[var(--color-text-muted)]" />
              <Tooltip content={<RevenueTooltip sym={currencySymbol} />} />
              <Line
                type="monotone" dataKey="orders" name="orders"
                stroke={COLORS[0] || '#6366f1'} strokeWidth={2}
                dot={{ r: 3, fill: COLORS[0] || '#6366f1', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone" dataKey="revenue" name="revenue"
                stroke={COLORS[1] || '#10b981'} strokeWidth={2}
                dot={{ r: 3, fill: COLORS[1] || '#10b981', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )
      }

      {/* Legend dots from theme palette — matches RevenueTrendChart exactly */}
      <div className="flex items-center gap-4 mt-4 justify-center">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: COLORS[0] || '#6366f1' }} />
          <span className="text-[10px] text-[var(--color-text-muted)] font-medium">Orders</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: COLORS[1] || '#10b981' }} />
          <span className="text-[10px] text-[var(--color-text-muted)] font-medium">Revenue</span>
        </div>
      </div>
    </div>
  );
});

export const LeadPipelineChart = React.memo(function LeadPipelineChart({
  data, loading, height = 220,
}: LeadPipelineChartProps) {
  const navigate = useNavigate();
  const COLORS = useChartColors();
  const chartData = data.map(d => ({ name: d.status, value: d.count }));
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="h-full bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5">
      <PanelHeader
        icon={<Filter className="h-4 w-4" />}
        title="Lead Pipeline"
        subtitle={loading ? '—' : `${total} total leads`}
        onAction={() => navigate('/leads')}
        actionLabel="All leads"
      />

      {loading
        ? <ChartSkeleton height={height + 10} />
        : chartData.length === 0
        ? (
          <div className="flex flex-col items-center justify-center gap-2 text-[var(--color-text-disabled)]" style={{ height }}>
            <AlertTriangle className="h-8 w-8" />
            <p className="text-xs text-[var(--color-text-muted)]">No leads yet</p>
          </div>
        )
        : (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="45%"
                outerRadius={78}
                innerRadius={46}
                dataKey="value"
                paddingAngle={3}
                strokeWidth={0}
              >
                {/* VALID: COLORS are fixed viz pigments */}
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Legend
                iconType="circle"
                iconSize={7}
                wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
              />
              {/*
                Tooltip contentStyle: uses CSS var strings directly in style object.
                This is the correct pattern for 3rd-party components that only accept
                style objects — not Tailwind class strings.
              */}
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  fontSize: 11,
                  background: 'var(--color-surface)',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        )
      }
    </div>
  );
});
