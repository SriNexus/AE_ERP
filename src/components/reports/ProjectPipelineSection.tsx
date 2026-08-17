/**
 * P10-01 — Project Pipeline Analytics Section
 *
 * Standalone component that renders the full project pipeline report UI.
 * Imported by Reports.tsx to avoid further bloating that 1700+ line file.
 */

import { useMemo } from 'react';
import { FolderKanban, BarChart3, TrendingUp, Clock, Target, DownloadCloud, Printer, AlertOctagon, CheckCircle2, Zap, GitCompareArrows, Archive } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardHeader, CardTitle, CardBody } from '../ui/Card';
import { useProjectsForReport, useOrdersForReport } from '../../features/reports/hooks/useReports';
import { generateProjectPipelineReport, downloadReportCsv, printReport } from '../../lib/reportsAggregation';
import type { ProjectRecord } from '../../features/projects/types';
import type { ProjectPipelineReport } from '../../features/reports/types';
import { useAppStore } from '../../store/useAppStore';
import { fmtDate, fmtCurrency } from '../../lib/firestore';

export default function ProjectPipelineSection() {
  const { company } = useAppStore();
  const { data: projects = [], isLoading } = useProjectsForReport();
  const { data: projectOrders = [] } = useOrdersForReport();

  const report = useMemo<ProjectPipelineReport | null>(() => {
    if (projects.length === 0) return null;
    return generateProjectPipelineReport(projects as ProjectRecord[], projectOrders);
  }, [projects, projectOrders]);

  if (isLoading) {
    return (
      <Card>
        <CardBody className="p-6 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">Loading project data...</p>
        </CardBody>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card>
        <CardBody className="p-6 text-center">
          <FolderKanban className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
          <p className="mt-2 text-sm font-semibold text-[var(--color-text)]">No project data yet</p>
          <p className="text-xs text-[var(--color-text-muted)]">Create a project to see pipeline analytics.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      {/* Header with export buttons */}
      <div className="flex items-center gap-2 mt-6 mb-3">
        <FolderKanban className="h-4 w-4 text-indigo-500" />
        <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project Pipeline Analytics</span>
        <button
          onClick={() => downloadReportCsv(report)}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-bg-sunken)] hover:bg-[var(--color-surface-hover)] text-[10px] font-medium transition-colors"
        >
          <DownloadCloud className="h-3 w-3" />
          CSV
        </button>
        <button
          onClick={() => printReport(report, company.name || 'Neozy')}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-bg-sunken)] hover:bg-[var(--color-surface-hover)] text-[10px] font-medium transition-colors"
        >
          <Printer className="h-3 w-3" />
          PDF
        </button>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { l: 'Total Projects', v: report.kpis.totalProjects, icon: <FolderKanban className="h-4 w-4" />, c: 'text-indigo-600 bg-indigo-50' },
          { l: 'Active', v: report.kpis.activeProjects, icon: <GitCompareArrows className="h-4 w-4" />, c: 'text-emerald-600 bg-emerald-50' },
          { l: 'Archived', v: report.kpis.archivedProjects, icon: <Archive className="h-4 w-4" />, c: 'text-gray-600 bg-gray-50' },
          { l: 'Total Capacity', v: `${report.kpis.totalCapacityKw} kW`, icon: <Zap className="h-4 w-4" />, c: 'text-amber-600 bg-amber-50' },
          { l: 'Avg Capacity', v: `${report.kpis.averageCapacityKw} kW`, icon: <BarChart3 className="h-4 w-4" />, c: 'text-blue-600 bg-blue-50' },
          { l: 'Stages Active', v: report.kpis.projectsByStageCount, icon: <Target className="h-4 w-4" />, c: 'text-purple-600 bg-purple-50' },
        ].map(s => (
          <Card key={s.l} className="p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg ${s.c}`}>{s.icon}</div>
            <div><p className="text-xs text-muted">{s.l}</p><p className="font-bold text-gray-800">{s.v}</p></div>
          </Card>
        ))}
      </div>

      {/* Stage Distribution Chart */}
      {report.stageDistribution.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-500" />
              <CardTitle>Stage Distribution</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={report.stageDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="stage" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: '8px' }} formatter={(val: any, _: any, props: any) => [`${val} (${props.payload.percentage}%)`, 'Projects']} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Projects">
                  {report.stageDistribution.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* Revenue Pipeline + Cycle Times */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Revenue Pipeline */}
        {report.revenuePipeline.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                <CardTitle>Revenue Pipeline by Stage</CardTitle>
              </div>
            </CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={report.revenuePipeline} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="stage" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={100} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [fmtCurrency(Number(val) || 0, company.currencySymbol), 'Revenue']} />
                  <Bar dataKey="revenue" fill="#10b981" radius={[0, 4, 4, 0]} name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        )}

        {/* Cycle Times */}
        {report.cycleTimes.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-purple-500" />
                <CardTitle>Avg Cycle Time (Days)</CardTitle>
              </div>
            </CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={report.cycleTimes} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} unit="d" />
                  <YAxis type="category" dataKey="stage" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={100} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val: any) => [`${val} days`, 'Avg']} />
                  <Bar dataKey="avgDays" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Avg Days" />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Cycle Times Table */}
      {report.cycleTimes.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Stage Cycle Time Details</CardTitle></CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-left py-2.5 px-4 font-semibold text-[var(--color-text-muted)]">Stage</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Avg (Days)</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Min</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Max</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Projects</th>
                  </tr>
                </thead>
                <tbody>
                  {report.cycleTimes.map((c) => (
                    <tr key={c.stage} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-sunken)] transition-colors">
                      <td className="py-2.5 px-4 font-semibold text-[var(--color-text)]">{c.stage}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{c.avgDays}d</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-[var(--color-text-muted)]">{c.minDays}d</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-[var(--color-text-muted)]">{c.maxDays}d</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{c.projectCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Stuck Projects */}
      {report.stuckProjects.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-red-500" />
              <CardTitle>
                Stuck Projects
                <span className="ml-2 inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                  {report.stuckProjects.length}
                </span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-left py-2.5 px-4 font-semibold text-[var(--color-text-muted)]">Project</th>
                    <th className="text-left py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Stage</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Days Stuck</th>
                    <th className="text-left py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Entered</th>
                    <th className="text-left py-2.5 px-3 font-semibold text-[var(--color-text-muted)]">Assigned To</th>
                  </tr>
                </thead>
                <tbody>
                  {report.stuckProjects.slice(0, 20).map((s) => (
                    <tr key={s.projectId} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-sunken)] transition-colors">
                      <td className="py-2.5 px-4 font-semibold text-[var(--color-text)]">{s.projectId}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          s.stuckDays > 30 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                          s.stuckDays > 14 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                          'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                        }`}>{s.currentStage}</span>
                      </td>
                      <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${
                        s.stuckDays > 30 ? 'text-red-600' : s.stuckDays > 14 ? 'text-amber-600' : 'text-yellow-600'
                      }`}>{s.stuckDays}d</td>
                      <td className="py-2.5 px-3 text-[var(--color-text-muted)]">{fmtDate(s.stageEnteredAt)}</td>
                      <td className="py-2.5 px-3 text-[var(--color-text-muted)]">{s.assignedTo || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* No Stuck Projects */}
      {report.stuckProjects.length === 0 && (
        <Card>
          <CardBody className="p-6 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
            <p className="mt-2 text-sm font-semibold text-[var(--color-text)]">No stuck projects detected</p>
            <p className="text-xs text-[var(--color-text-muted)]">All projects are progressing within expected timeframes.</p>
          </CardBody>
        </Card>
      )}
    </>
  );
}
