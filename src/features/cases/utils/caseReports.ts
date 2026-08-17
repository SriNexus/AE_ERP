/**
 * caseReports — Case Reports utility (READ-ONLY)
 *
 * Phase 3I — Case Reports
 * Provides report generation and export functions for the Case Reporting module.
 *
 * Architecture:
 * - READ-ONLY: no Firestore writes, no schema changes
 * - Reuses caseAnalytics functions for data aggregation
 * - Reuses existing csv/print helpers from settlementExport
 * - Pure data transformation + export — no side effects
 */

import { downloadCsv, printReport } from '../../../lib/settlementExport';
import { fmtDate, fmtCurrency } from '../../../lib/firestore';
import {
  getCaseVolumeMetrics,
  getCaseLifecycleMetrics,
  getCaseStageDistribution,
  getCaseHealthMetrics,
  getCaseBusinessMetrics,
  getCasePerformanceMetrics,
  getCaseOperationalMetrics,
} from './caseAnalytics';
import type {
  VolumeMetrics,
  LifecycleMetrics,
  StageDistribution,
  HealthMetrics,
  BusinessMetrics,
  PerformanceMetrics,
  OperationalMetrics,
} from './caseAnalytics';

// ── Types ──────────────────────────────────────────────────

export interface CaseReportData {
  volume: VolumeMetrics;
  lifecycle: LifecycleMetrics;
  stageDistribution: StageDistribution;
  health: HealthMetrics;
  business: BusinessMetrics;
  performance: PerformanceMetrics;
  operational: OperationalMetrics;
  generatedAt: string;
}

export type ReportSection =
  | 'executive'
  | 'operational'
  | 'financial'
  | 'lifecycle'
  | 'stage'
  | 'health'
  | 'business';

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  company?: string;
  branch?: string;
}

// ── CSV escape helper ──────────────────────────────────────

function esc(value: unknown): string {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(values: unknown[]): string {
  return values.map(esc).join(',') + '\n';
}

// ═══════════════════════════════════════════════════════════
//  1. generateExecutiveSummary — Executive report
// ═══════════════════════════════════════════════════════════

export function generateExecutiveSummary(data: CaseReportData): { csv: string; html: string; summary: string } {
  // CSV
  let csv = csvRow(['Metric', 'Value']);
  csv += csvRow(['Total Cases', data.volume.totalCases]);
  csv += csvRow(['Active Cases', data.volume.activeCases]);
  csv += csvRow(['Completed Cases', data.volume.completedCases]);
  csv += csvRow(['Failed Cases', data.volume.failedCases]);
  csv += csvRow(['Created This Month', data.volume.createdThisMonth]);
  csv += csvRow(['Growth %', `${data.volume.growthPercent}%`]);
  csv += csvRow(['Avg Lifecycle (days)', data.lifecycle.avgEndToEnd]);
  csv += csvRow(['Healthy Cases', data.health.healthyCases]);
  csv += csvRow(['Broken Cases', data.health.brokenCases]);
  csv += csvRow(['Orphan Records', data.health.orphanRecords]);
  csv += csvRow(['Duplicate Cases', data.health.duplicateCases]);

  // Summary string
  const summary = [
    `${data.volume.totalCases} total cases`,
    `${data.volume.activeCases} active`,
    `${data.volume.completedCases} completed`,
    `${data.volume.failedCases} failed`,
    `${data.volume.growthPercent >= 0 ? '+' : ''}${data.volume.growthPercent}% growth`,
    `${data.lifecycle.avgEndToEnd}d avg lifecycle`,
    `${data.health.healthyCases} healthy, ${data.health.brokenCases} broken`,
    `${data.health.orphanRecords} orphans, ${data.health.duplicateCases} duplicates`,
  ].join(' · ');

  // HTML
  const html = generateReportHtml('Executive Summary', `
    <div class="summary">
      <div class="summary-item"><div class="label">Total Cases</div><div class="value">${data.volume.totalCases}</div></div>
      <div class="summary-item"><div class="label">Active</div><div class="value">${data.volume.activeCases}</div></div>
      <div class="summary-item"><div class="label">Completed</div><div class="value">${data.volume.completedCases}</div></div>
      <div class="summary-item"><div class="label">Failed</div><div class="value">${data.volume.failedCases}</div></div>
      <div class="summary-item"><div class="label">Growth</div><div class="value">${data.volume.growthPercent}%</div></div>
      <div class="summary-item"><div class="label">Avg Lifecycle</div><div class="value">${data.lifecycle.avgEndToEnd}d</div></div>
    </div>
    <h3>Health Summary</h3>
    <table>
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Healthy Cases</td><td>${data.health.healthyCases}</td></tr>
        <tr><td>Broken Cases</td><td>${data.health.brokenCases}</td></tr>
        <tr><td>Orphan Records</td><td>${data.health.orphanRecords}</td></tr>
        <tr><td>Duplicate Cases</td><td>${data.health.duplicateCases}</td></tr>
        <tr><td>Broken Chains</td><td>${data.health.brokenChains}</td></tr>
      </tbody>
    </table>
    <h3>Lifecycle</h3>
    <table>
      <thead><tr><th>Transition</th><th>Avg Days</th></tr></thead>
      <tbody>
        <tr><td>Lead → Customer</td><td>${data.lifecycle.avgLeadToCustomer}</td></tr>
        <tr><td>Customer → Project</td><td>${data.lifecycle.avgCustomerToProject}</td></tr>
        <tr><td>Project → Installation</td><td>${data.lifecycle.avgProjectToInstallation}</td></tr>
        <tr><td>Install → Commissioning</td><td>${data.lifecycle.avgInstallationToCommissioning}</td></tr>
      </tbody>
    </table>
  `);

  return { csv, html, summary };
}

// ═══════════════════════════════════════════════════════════
//  2. generateOperationalReport — Operational report
// ═══════════════════════════════════════════════════════════

export function generateOperationalReport(data: CaseReportData): { csv: string; html: string } {
  let csv = csvRow(['Pending Operation', 'Count']);
  csv += csvRow(['Installations', data.operational.pendingInstallations]);
  csv += csvRow(['QC', data.operational.pendingQC]);
  csv += csvRow(['Commissioning', data.operational.pendingCommissioning]);
  csv += csvRow(['Subsidy', data.operational.pendingSubsidy]);
  csv += csvRow(['Handover', data.operational.pendingHandover]);
  csv += csvRow(['Service Tickets', data.operational.pendingServiceTickets]);

  const html = generateReportHtml('Operational Report', `
    <div class="summary">
      <div class="summary-item"><div class="label">Installations</div><div class="value">${data.operational.pendingInstallations}</div></div>
      <div class="summary-item"><div class="label">QC</div><div class="value">${data.operational.pendingQC}</div></div>
      <div class="summary-item"><div class="label">Commissioning</div><div class="value">${data.operational.pendingCommissioning}</div></div>
      <div class="summary-item"><div class="label">Subsidy</div><div class="value">${data.operational.pendingSubsidy}</div></div>
      <div class="summary-item"><div class="label">Handover</div><div class="value">${data.operational.pendingHandover}</div></div>
      <div class="summary-item"><div class="label">Service</div><div class="value">${data.operational.pendingServiceTickets}</div></div>
    </div>
  `);

  return { csv, html };
}

// ═══════════════════════════════════════════════════════════
//  3. generateFinancialReport — Financial report
// ═══════════════════════════════════════════════════════════

export function generateFinancialReport(data: CaseReportData): { csv: string; html: string } {
  let csv = csvRow(['Financial Metric', 'Value']);
  csv += csvRow(['Revenue per Case (B2B)', `₹${data.business.b2b.revenuePerCase}`]);
  csv += csvRow(['Avg Project Size (B2B)', `${data.business.b2b.avgProjectSizeKw} kW`]);
  csv += csvRow(['B2C Subsidy Rate', `${data.business.b2c.subsidyCompletionRate}%`]);
  csv += csvRow(['B2C Net Metering Rate', `${data.business.b2c.netMeteringCompletionRate}%`]);
  csv += csvRow(['Fastest Case', `${data.lifecycle.fastestCaseDays}d`]);
  csv += csvRow(['Slowest Case', `${data.lifecycle.slowestCaseDays}d`]);

  // Revenue by month
  csv += csvRow([]);
  csv += csvRow(['--- Revenue by Month ---']);
  csv += csvRow(['Month', 'Cases']);
  data.performance.byMonth.forEach((m) => {
    csv += csvRow([m.month, m.count]);
  });

  // Revenue by source
  csv += csvRow([]);
  csv += csvRow(['--- Revenue by Lead Source ---']);
  csv += csvRow(['Source', 'Cases']);
  data.performance.byLeadSource.forEach((s) => {
    csv += csvRow([s.source, s.count]);
  });

  const html = generateReportHtml('Financial Report', `
    <div class="summary">
      <div class="summary-item"><div class="label">B2B Rev/Case</div><div class="value">${fmtCurrency(data.business.b2b.revenuePerCase)}</div></div>
      <div class="summary-item"><div class="label">Avg System Size</div><div class="value">${data.business.b2b.avgProjectSizeKw} kW</div></div>
      <div class="summary-item"><div class="label">Subsidy Rate</div><div class="value">${data.business.b2c.subsidyCompletionRate}%</div></div>
      <div class="summary-item"><div class="label">Net Metering</div><div class="value">${data.business.b2c.netMeteringCompletionRate}%</div></div>
    </div>
    <h3>B2B Business</h3>
    <table><thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Commercial Cases</td><td>${data.business.b2b.commercialCases}</td></tr>
      <tr><td>Industrial Cases</td><td>${data.business.b2b.industrialCases}</td></tr>
      <tr><td>Avg Project Size</td><td>${data.business.b2b.avgProjectSizeKw} kW</td></tr>
      <tr><td>Revenue per Case</td><td>${fmtCurrency(data.business.b2b.revenuePerCase)}</td></tr>
    </tbody></table>
    <h3>B2C Business</h3>
    <table><thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Total Cases</td><td>${data.business.b2c.totalCases}</td></tr>
      <tr><td>Subsidy Completion</td><td>${data.business.b2c.subsidyCompletionRate}%</td></tr>
      <tr><td>Net Metering Completion</td><td>${data.business.b2c.netMeteringCompletionRate}%</td></tr>
    </tbody></table>
  `);

  return { csv, html };
}

// ═══════════════════════════════════════════════════════════
//  4. generateLifecycleReport — Lifecycle report
// ═══════════════════════════════════════════════════════════

export function generateLifecycleReport(data: CaseReportData): { csv: string; html: string } {
  let csv = csvRow(['Lifecycle Transition', 'Avg Days', 'Fastest', 'Slowest']);
  csv += csvRow(['Lead → Customer', data.lifecycle.avgLeadToCustomer, '-', '-']);
  csv += csvRow(['Customer → Project', data.lifecycle.avgCustomerToProject, '-', '-']);
  csv += csvRow(['Project → Installation', data.lifecycle.avgProjectToInstallation, '-', '-']);
  csv += csvRow(['Installation → Commissioning', data.lifecycle.avgInstallationToCommissioning, '-', '-']);
  csv += csvRow(['End-to-End', data.lifecycle.avgEndToEnd, data.lifecycle.fastestCaseDays, data.lifecycle.slowestCaseDays]);

  const html = generateReportHtml('Lifecycle Report', `
    <div class="summary">
      <div class="summary-item"><div class="label">Avg Lead→Customer</div><div class="value">${data.lifecycle.avgLeadToCustomer}d</div></div>
      <div class="summary-item"><div class="label">Avg Customer→Project</div><div class="value">${data.lifecycle.avgCustomerToProject}d</div></div>
      <div class="summary-item"><div class="label">Avg Project→Install</div><div class="value">${data.lifecycle.avgProjectToInstallation}d</div></div>
      <div class="summary-item"><div class="label">Avg Install→Commission</div><div class="value">${data.lifecycle.avgInstallationToCommissioning}d</div></div>
      <div class="summary-item"><div class="label">Avg End-to-End</div><div class="value">${data.lifecycle.avgEndToEnd}d</div></div>
    </div>
    <h3>Transition Details</h3>
    <table>
      <thead><tr><th>Transition</th><th>Avg Days</th><th>Fastest</th><th>Slowest</th></tr></thead>
      <tbody>
        <tr><td>Lead → Customer</td><td>${data.lifecycle.avgLeadToCustomer}</td><td>-</td><td>-</td></tr>
        <tr><td>Customer → Project</td><td>${data.lifecycle.avgCustomerToProject}</td><td>-</td><td>-</td></tr>
        <tr><td>Project → Installation</td><td>${data.lifecycle.avgProjectToInstallation}</td><td>-</td><td>-</td></tr>
        <tr><td>Installation → Commissioning</td><td>${data.lifecycle.avgInstallationToCommissioning}</td><td>-</td><td>-</td></tr>
        <tr><td><strong>End-to-End</strong></td><td><strong>${data.lifecycle.avgEndToEnd}d</strong></td><td>${data.lifecycle.fastestCaseDays}d</td><td>${data.lifecycle.slowestCaseDays}d</td></tr>
      </tbody>
    </table>
  `);

  return { csv, html };
}

// ═══════════════════════════════════════════════════════════
//  5. generateStageReport — Stage distribution report
// ═══════════════════════════════════════════════════════════

export function generateStageReport(data: CaseReportData): { csv: string; html: string } {
  let csv = csvRow(['EPC Stage', 'Case Count', 'Percentage']);
  data.stageDistribution.stages.forEach((s) => {
    csv += csvRow([s.stage, s.count, `${s.percentage}%`]);
  });

  const stageRows = data.stageDistribution.stages.map((s) =>
    `<tr><td>${s.stage}</td><td style="text-align:right">${s.count}</td><td style="text-align:right">${s.percentage}%</td></tr>`
  ).join('');

  const html = generateReportHtml('Stage Distribution Report', `
    <div class="summary">
      <div class="summary-item"><div class="label">Total Stages</div><div class="value">17</div></div>
      <div class="summary-item"><div class="label">Active Stages</div><div class="value">${data.stageDistribution.stages.filter(s => s.count > 0).length}</div></div>
      <div class="summary-item"><div class="label">Total Cases</div><div class="value">${data.stageDistribution.total}</div></div>
    </div>
    <table>
      <thead><tr><th>EPC Stage</th><th style="text-align:right">Cases</th><th style="text-align:right">%</th></tr></thead>
      <tbody>${stageRows}</tbody>
    </table>
  `);

  return { csv, html };
}

// ═══════════════════════════════════════════════════════════
//  6. generateHealthReport — Health report
// ═══════════════════════════════════════════════════════════

export function generateHealthReportDoc(data: CaseReportData): { csv: string; html: string } {
  let csv = csvRow(['Health Metric', 'Value']);
  csv += csvRow(['Healthy Cases', data.health.healthyCases]);
  csv += csvRow(['Broken Cases', data.health.brokenCases]);
  csv += csvRow(['Total Checked', data.health.totalChecked]);
  csv += csvRow(['Validation Failures', data.health.validationFailures]);
  csv += csvRow(['Duplicate Cases', data.health.duplicateCases]);
  csv += csvRow(['Orphan Records', data.health.orphanRecords]);
  csv += csvRow(['Broken Chains', data.health.brokenChains]);

  const html = generateReportHtml('Health Report', `
    <div class="summary">
      <div class="summary-item"><div class="label">Healthy</div><div class="value">${data.health.healthyCases}</div></div>
      <div class="summary-item"><div class="label">Broken</div><div class="value">${data.health.brokenCases}</div></div>
      <div class="summary-item"><div class="label">Checked</div><div class="value">${data.health.totalChecked}</div></div>
      <div class="summary-item"><div class="label">Duplicates</div><div class="value">${data.health.duplicateCases}</div></div>
      <div class="summary-item"><div class="label">Orphans</div><div class="value">${data.health.orphanRecords}</div></div>
      <div class="summary-item"><div class="label">Broken Chains</div><div class="value">${data.health.brokenChains}</div></div>
    </div>
  `);

  return { csv, html };
}

// ═══════════════════════════════════════════════════════════
//  HTML Report generator (reuses patterns from settlementExport)
// ═══════════════════════════════════════════════════════════

function generateReportHtml(title: string, contentHtml: string): string {
  return `
    <div class="header">
      <h1>Case Report: ${title}</h1>
      <p>Generated on ${fmtDate(new Date().toISOString())}</p>
    </div>
    ${contentHtml}
    <div class="footer">
      <p>Generated by Neozy ERP — Case Reports Module</p>
      <p class="page-number">Page 1</p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
//  generateCaseReportData — Aggregate all report data
// ═══════════════════════════════════════════════════════════

export async function generateCaseReportData(
  allCases: any[],
  allLeads: any[],
  allCustomers: any[],
  allProjects: any[],
  allOrders: any[],
  allInstallations: any[],
  allCommissioningRecords: any[],
  _filters?: ReportFilters,
): Promise<CaseReportData> {
  const nonDeleted = allCases.filter((c: any) => !c.isDeleted);

  // Apply filters
  let filtered = nonDeleted;
  if (_filters?.dateFrom) {
    const from = new Date(_filters.dateFrom);
    filtered = filtered.filter((c: any) => {
      const d = new Date(String(c.createdAt || ''));
      return !isNaN(d.getTime()) && d >= from;
    });
  }
  if (_filters?.dateTo) {
    const to = new Date(_filters.dateTo);
    to.setHours(23, 59, 59, 999);
    filtered = filtered.filter((c: any) => {
      const d = new Date(String(c.createdAt || ''));
      return !isNaN(d.getTime()) && d <= to;
    });
  }

  const [volume, lifecycle, stageDistribution, health, business, performance, operational] = await Promise.all([
    Promise.resolve(getCaseVolumeMetrics(filtered)),
    Promise.resolve(getCaseLifecycleMetrics(filtered, allLeads, allCustomers, allProjects, allInstallations, allCommissioningRecords)),
    Promise.resolve(getCaseStageDistribution(filtered)),
    getCaseHealthMetrics(),
    Promise.resolve(getCaseBusinessMetrics(filtered, allCustomers, allProjects, allOrders)),
    Promise.resolve(getCasePerformanceMetrics(filtered, allLeads)),
    Promise.resolve(getCaseOperationalMetrics(filtered)),
  ]);

  return {
    volume, lifecycle, stageDistribution, health, business, performance, operational,
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════
//  Export actions
// ═══════════════════════════════════════════════════════════

export function exportCaseReportToCsv(
  section: ReportSection,
  data: CaseReportData,
  filename: string,
): void {
  let csv = '';

  switch (section) {
    case 'executive':    ({ csv } = generateExecutiveSummary(data)); break;
    case 'operational':  ({ csv } = generateOperationalReport(data)); break;
    case 'financial':    ({ csv } = generateFinancialReport(data)); break;
    case 'lifecycle':    ({ csv } = generateLifecycleReport(data)); break;
    case 'stage':        ({ csv } = generateStageReport(data)); break;
    case 'health':       ({ csv } = generateHealthReportDoc(data)); break;
    case 'business':     ({ csv } = generateFinancialReport(data)); break;
  }

  downloadCsv(csv, filename);
}

export function exportCaseReportToPdf(
  section: ReportSection,
  data: CaseReportData,
): void {
  let html = '';

  switch (section) {
    case 'executive':    ({ html } = generateExecutiveSummary(data)); break;
    case 'operational':  ({ html } = generateOperationalReport(data)); break;
    case 'financial':    ({ html } = generateFinancialReport(data)); break;
    case 'lifecycle':    ({ html } = generateLifecycleReport(data)); break;
    case 'stage':        ({ html } = generateStageReport(data)); break;
    case 'health':       ({ html } = generateHealthReportDoc(data)); break;
    case 'business':     ({ html } = generateFinancialReport(data)); break;
  }

  const title = `Case Report - ${section.charAt(0).toUpperCase() + section.slice(1)}`;
  printReport(title, html);
}
