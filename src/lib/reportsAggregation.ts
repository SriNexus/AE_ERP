/**
 * P10-01 — Reporting Engine: Project-Pipeline Aggregation
 *
 * Pure calculation functions for project pipeline analytics.
 * Read-only — never writes to Firestore.
 * Reuses existing dashboardAggregation types where applicable.
 */

import type { ProjectRecord } from '../features/projects/types';
import type {
  StageDistributionItem,
  RevenuePipelineItem,
  CycleTimeItem,
  StuckProjectInfo,
  ProjectKpiSummary,
  ProjectPipelineReport,
  CsvExportRow,
} from '../features/reports/types';
import {
  safeDate,
  daysBetween,
  safeNumber,
  getStageColor,
  countProjectsByStage,
} from './analyticsCore';

// ── Constants ─────────────────────────────────────────────

const STUCK_THRESHOLD_DAYS: Record<string, number> = {
  Survey: 7,
  Engineering: 14,
  Quotation: 14,
  Order: 7,
  Procurement: 21,
  Dispatch: 7,
  Installation: 30,
  QC: 7,
  Commissioning: 14,
  NetMetering: 21,
  Subsidy: 30,
  Handover: 14,
  AMC: 365,
  Service: 14,
  Monitoring: 90,
  New: 14,
};

// ── Helpers imported from analyticsCore ───────────────────

// ── Core Aggregation Functions ────────────────────────────

/**
 * Build project stage distribution with percentages.
 */
export function buildStageDistribution(projects: ProjectRecord[]): StageDistributionItem[] {
  const total = projects.filter((p) => !p.isDeleted).length;
  if (total === 0) return [];

  const counts = countProjectsByStage(projects);

  return Array.from(counts.entries())
    .filter(([_, count]) => count > 0)
    .map(([stage, count]) => ({
      stage,
      count,
      percentage: Math.round((count / total) * 100),
      color: getStageColor(stage),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Build revenue pipeline by project stage.
 * Requires orders with totals linked to projects.
 */
export function buildRevenuePipeline(
  projects: ProjectRecord[],
  orders: Array<{ id: string; total?: unknown; projectId?: string; customerId?: string; isDeleted?: boolean }>,
): RevenuePipelineItem[] {
  const activeProjects = projects.filter((p) => !p.isDeleted && p.currentStage !== 'Archived');

  // Map order totals to projects via linkedOrderIds or projectId
  const projectRevenue = new Map<string, { revenue: number; count: number }>();
  activeProjects.forEach((p) => {
    let revenue = 0;
    let count = 0;

    // Sum orders linked via linkedOrderIds
    const linkedIds = new Set(p.linkedOrderIds || []);
    orders.forEach((o) => {
      if (o.isDeleted) return;
      if (linkedIds.has(o.id) || o.projectId === p.id) {
        revenue += safeNumber(o.total);
        count++;
      }
    });

    projectRevenue.set(p.id, { revenue, count });
  });

  // Aggregate by stage
  const stageMap = new Map<string, { revenue: number; count: number; projectCount: number }>();
  activeProjects.forEach((p) => {
    const pr = projectRevenue.get(p.id) || { revenue: 0, count: 0 };
    const stage = p.currentStage || 'New';
    if (!stageMap.has(stage)) {
      stageMap.set(stage, { revenue: 0, count: 0, projectCount: 0 });
    }
    const entry = stageMap.get(stage)!;
    entry.revenue += pr.revenue;
    entry.count += pr.count;
    entry.projectCount++;
  });

  return Array.from(stageMap.entries())
    .map(([stage, data]) => ({
      stage,
      revenue: data.revenue,
      projectCount: data.projectCount,
      averageValue: data.projectCount > 0 ? Math.round(data.revenue / data.projectCount) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Compute average cycle time per project stage from stage history.
 */
export function buildCycleTimes(projects: ProjectRecord[]): CycleTimeItem[] {
  const stageDurations = new Map<string, number[]>();

  projects.forEach((p) => {
    if (p.isDeleted || !p.stageHistory?.length) return;

    const history = [...p.stageHistory].sort(
      (a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime(),
    );

    for (let i = 0; i < history.length - 1; i++) {
      const current = history[i];
      const next = history[i + 1];
      const startDate = safeDate(current.changedAt);
      const endDate = safeDate(next.changedAt);
      if (startDate && endDate) {
        const days = daysBetween(startDate, endDate);
        if (days >= 0) {
          const stage = current.stage;
          if (!stageDurations.has(stage)) stageDurations.set(stage, []);
          stageDurations.get(stage)!.push(days);
        }
      }
    }

    // For the current stage (still in progress), if project not archived
    if (p.currentStage !== 'Archived' && history.length > 0) {
      const last = history[history.length - 1];
      const startDate = safeDate(last.changedAt);
      if (startDate && last.stage === (p.currentStage as string)) {
        // No end date — this is the current active stage; exclude from cycle time
        // but we may want to track it differently
      }
    }
  });

  return Array.from(stageDurations.entries())
    .map(([stage, durations]) => {
      const total = durations.reduce((s, d) => s + d, 0);
      return {
        stage,
        avgDays: durations.length > 0 ? Math.round(total / durations.length) : 0,
        minDays: durations.length > 0 ? Math.min(...durations) : 0,
        maxDays: durations.length > 0 ? Math.max(...durations) : 0,
        projectCount: durations.length,
      };
    })
    .sort((a, b) => b.avgDays - a.avgDays);
}

/**
 * Detect projects stuck in the same stage beyond threshold.
 */
export function findStuckProjects(
  projects: ProjectRecord[],
  lifecycleRecords?: Array<{ projectId?: string; status?: string; createdAt?: unknown }>,
): StuckProjectInfo[] {
  const now = new Date();
  const stuck: StuckProjectInfo[] = [];

  projects.forEach((p) => {
    if (p.isDeleted || p.currentStage === 'Archived') return;
    const stage = p.currentStage || 'New';

    // Find when project entered this stage
    const history = p.stageHistory || [];
    const stageEntry = [...history]
      .reverse()
      .find((h) => h.stage === stage);

    const enteredDate = stageEntry
      ? safeDate(stageEntry.changedAt)
      : safeDate(p.createdAt);

    if (!enteredDate) return;

    const stuckDays = daysBetween(enteredDate, now);
    const threshold = STUCK_THRESHOLD_DAYS[stage] ?? 14;

    if (stuckDays >= threshold) {
      stuck.push({
        projectId: p.projectId || p.id,
        projectName: p.projectId || p.id,
        customerName: p.customerId || 'Unknown',
        currentStage: stage,
        stuckDays,
        stageEnteredAt: stageEntry?.changedAt || p.createdAt || '',
        assignedTo: p.assignedSurveyor || p.assignedInstaller || undefined,
      });
    }
  });

  return stuck.sort((a, b) => b.stuckDays - a.stuckDays);
}

/**
 * Build project KPI summary.
 */
export function buildProjectKpis(projects: ProjectRecord[]): ProjectKpiSummary {
  const active = projects.filter((p) => !p.isDeleted && p.currentStage !== 'Archived');
  const archived = projects.filter((p) => !p.isDeleted && p.currentStage === 'Archived');

  const totalCapacity = active.reduce((sum, p) => sum + safeNumber(p.capacityKw), 0);

  return {
    totalProjects: projects.filter((p) => !p.isDeleted).length,
    activeProjects: active.length,
    archivedProjects: archived.length,
    totalCapacityKw: Math.round(totalCapacity * 100) / 100,
    averageCapacityKw: active.length > 0 ? Math.round((totalCapacity / active.length) * 100) / 100 : 0,
    projectsByStageCount: new Set(active.map((p) => p.currentStage)).size,
  };
}

/**
 * Generate complete project pipeline report.
 */
export function generateProjectPipelineReport(
  projects: ProjectRecord[],
  orders: Array<{ id: string; total?: unknown; projectId?: string; customerId?: string; isDeleted?: boolean }>,
  lifecycleRecords?: Array<{ projectId?: string; status?: string; createdAt?: unknown }>,
): ProjectPipelineReport {
  return {
    stageDistribution: buildStageDistribution(projects),
    revenuePipeline: buildRevenuePipeline(projects, orders),
    cycleTimes: buildCycleTimes(projects),
    stuckProjects: findStuckProjects(projects, lifecycleRecords),
    kpis: buildProjectKpis(projects),
    generatedAt: new Date().toISOString(),
  };
}

// ── CSV Export ────────────────────────────────────────────

/**
 * Convert pipeline report to CSV rows.
 */
export function reportToCsvRows(report: ProjectPipelineReport): CsvExportRow[] {
  const rows: CsvExportRow[] = [];

  // Stage Distribution
  rows.push({ _section: '--- Stage Distribution ---' });
  rows.push({ Stage: 'Stage', Count: 'Count', Percentage: 'Percentage' });
  report.stageDistribution.forEach((s) => {
    rows.push({ Stage: s.stage, Count: s.count, Percentage: `${s.percentage}%` });
  });

  rows.push({ _section: '--- Revenue Pipeline ---' });
  rows.push({ Stage: 'Stage', Revenue: 'Revenue', Projects: 'Projects', Average: 'Avg Value' });
  report.revenuePipeline.forEach((r) => {
    rows.push({ Stage: r.stage, Revenue: r.revenue, Projects: r.projectCount, Average: r.averageValue });
  });

  rows.push({ _section: '--- Cycle Times (Days) ---' });
  rows.push({ Stage: 'Stage', AverageDays: 'Avg', MinDays: 'Min', MaxDays: 'Max', Projects: 'Projects' });
  report.cycleTimes.forEach((c) => {
    rows.push({ Stage: c.stage, AverageDays: c.avgDays, MinDays: c.minDays, MaxDays: c.maxDays, Projects: c.projectCount });
  });

  rows.push({ _section: '--- Stuck Projects ---' });
  rows.push({ ProjectId: 'Project ID', Stage: 'Stage', StuckDays: 'Days Stuck', Entered: 'Entered At' });
  report.stuckProjects.forEach((s) => {
    rows.push({ ProjectId: s.projectId, Stage: s.currentStage, StuckDays: s.stuckDays, Entered: s.stageEnteredAt });
  });

  rows.push({ _section: '--- KPI Summary ---' });
  rows.push({ Metric: 'Total Projects', Value: report.kpis.totalProjects });
  rows.push({ Metric: 'Active Projects', Value: report.kpis.activeProjects });
  rows.push({ Metric: 'Archived Projects', Value: report.kpis.archivedProjects });
  rows.push({ Metric: 'Total Capacity (kW)', Value: report.kpis.totalCapacityKw });
  rows.push({ Metric: 'Avg Capacity (kW)', Value: report.kpis.averageCapacityKw });
  rows.push({ Metric: 'Stages with Projects', Value: report.kpis.projectsByStageCount });

  return rows;
}

/**
 * Convert report rows to CSV string.
 */
export function csvRowsToString(rows: CsvExportRow[], delimiter = ','): string {
  if (rows.length === 0) return '';

  // Get all unique keys
  const keys = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((k) => keys.add(k)));

  // Filter out _section keys for columns
  const columns = Array.from(keys).filter((k) => k !== '_section');
  const header = columns.join(delimiter);

  const lines = rows.map((row) => {
    if (row._section) {
      return ''; // blank line for section headers (or could add comment line)
    }
    return columns
      .map((col) => {
        const val = row[col];
        if (val === undefined || val === null) return '';
        const str = String(val);
        // Escape quotes and wrap in quotes if contains delimiter or quotes
        if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(delimiter);
  });

  // Prepend header, then process rows — section rows become comments
  const processed = [header, ...lines].map((line, i) => {
    if (i === 0) return line; // header stays as-is
    const rowIndex = i - 1;
    const row = rows[rowIndex];
    if (row?._section && line === '') {
      return `# ${String(row._section).replace(/^--- | ---$/g, '')}`;
    }
    return line;
  });
  return processed.join('\n');
}

/**
 * Download CSV file in the browser.
 */
export function downloadReportCsv(report: ProjectPipelineReport, filename = 'project-pipeline-report.csv'): void {
  const rows = reportToCsvRows(report);
  const csv = csvRowsToString(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Generate printable HTML report for PDF/print.
 */
export function generateReportHtml(report: ProjectPipelineReport, companyName = 'Neozy'): string {
  const rows = (items: Array<{ stage: string; count?: number; percentage?: string | number }>) =>
    items.map((i) =>
      `<tr><td>${i.stage}</td><td style="text-align:right">${i.count ?? '-'}</td><td style="text-align:right">${i.percentage ?? ''}</td></tr>`
    ).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Project Pipeline Report - ${companyName}</title>
<style>
  body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #1a1a2e; padding: 40px; max-width: 900px; margin: auto; }
  h1 { font-size: 22px; border-bottom: 2px solid #6366f1; padding-bottom: 8px; }
  h2 { font-size: 16px; margin-top: 28px; color: #6366f1; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  th { background: #f0f0f0; text-align: left; padding: 8px 10px; font-weight: 600; }
  td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
  .kpi-card { background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e5e7eb; text-align: center; }
  .kpi-value { font-size: 20px; font-weight: 700; color: #6366f1; }
  .kpi-label { font-size: 10px; color: #6b7280; text-transform: uppercase; margin-top: 4px; }
  .stuck-high { color: #ef4444; font-weight: 600; }
  .stuck-med { color: #f59e0b; font-weight: 600; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }
</style></head>
<body>
<h1>📊 Project Pipeline Report</h1>
<p style="color:#6b7280;font-size:13px">${companyName} — Generated ${new Date(report.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>

<div class="kpi-grid">
  <div class="kpi-card"><div class="kpi-value">${report.kpis.totalProjects}</div><div class="kpi-label">Total Projects</div></div>
  <div class="kpi-card"><div class="kpi-value">${report.kpis.activeProjects}</div><div class="kpi-label">Active Projects</div></div>
  <div class="kpi-card"><div class="kpi-value">${report.kpis.totalCapacityKw}</div><div class="kpi-label">Total Capacity (kW)</div></div>
</div>

<h2>Stage Distribution</h2>
<table><thead><tr><th>Stage</th><th style="text-align:right">Count</th><th style="text-align:right">%</th></tr></thead>
<tbody>${rows(report.stageDistribution)}</tbody></table>

<h2>Revenue Pipeline</h2>
<table><thead><tr><th>Stage</th><th style="text-align:right">Revenue</th><th style="text-align:right">Projects</th><th style="text-align:right">Avg Value</th></tr></thead>
<tbody>${report.revenuePipeline.map((r) =>
  `<tr><td>${r.stage}</td><td style="text-align:right">₹${r.revenue.toLocaleString('en-IN')}</td><td style="text-align:right">${r.projectCount}</td><td style="text-align:right">₹${r.averageValue.toLocaleString('en-IN')}</td></tr>`
).join('')}</tbody></table>

<h2>Cycle Times (Days)</h2>
<table><thead><tr><th>Stage</th><th style="text-align:right">Avg</th><th style="text-align:right">Min</th><th style="text-align:right">Max</th><th style="text-align:right">Projects</th></tr></thead>
<tbody>${report.cycleTimes.map((c) =>
  `<tr><td>${c.stage}</td><td style="text-align:right">${c.avgDays}</td><td style="text-align:right">${c.minDays}</td><td style="text-align:right">${c.maxDays}</td><td style="text-align:right">${c.projectCount}</td></tr>`
).join('')}</tbody></table>

<h2>Stuck Projects</h2>
${report.stuckProjects.length === 0 ? '<p style="color:#10b981">✅ No stuck projects detected.</p>' : `
<table><thead><tr><th>Project</th><th>Stage</th><th style="text-align:right">Days Stuck</th><th>Entered</th></tr></thead>
<tbody>${report.stuckProjects.map((s) =>
  `<tr><td>${s.projectId}</td><td>${s.currentStage}</td><td style="text-align:right" class="${s.stuckDays > 30 ? 'stuck-high' : s.stuckDays > 14 ? 'stuck-med' : ''}">${s.stuckDays}d</td><td>${new Date(s.stageEnteredAt).toLocaleDateString('en-IN')}</td></tr>`
).join('')}</tbody></table>`}

<div class="footer">
  <p>Report generated by Neozy ERP — Project Pipeline Analytics</p>
  <p>${report.stuckProjects.length} stuck project(s) · ${report.cycleTimes.length} stages tracked · ${report.stageDistribution.length} stages active</p>
</div>
</body></html>`;
}

/**
 * Open printable report in new window for PDF/print.
 */
export function printReport(report: ProjectPipelineReport, companyName?: string): void {
  const html = generateReportHtml(report, companyName);
  const win = window.open('', '_blank');
  if (!win) {
    // Fallback: create a blob URL
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    return;
  }
  win.document.write(html);
  win.document.close();
}
