/**
 * caseAnalytics — Case Analytics utility (READ-ONLY)
 *
 * Phase 3G — Case Analytics
 * Exposes 7 analytics categories for the Case Analytics dashboard.
 *
 * Architecture:
 * - Pure aggregation: reads from Firestore via existing getAll/getOne
 * - NO Firestore writes
 * - NO schema changes
 * - Reuses CaseValidationEngine, analyticsCore, and existing helpers
 *
 * Functions:
 *   getCaseVolumeMetrics       — Total, Active, Completed, Failed, Cancelled, Created Today/Month, Growth
 *   getCaseLifecycleMetrics    — Duration averages per stage transition, fastest/slowest case
 *   getCaseStageDistribution   — 17-stage EPC funnel with counts and percentages
 *   getCaseHealthMetrics       — Healthy, Warning, Critical, Validation failures, Duplicates, Orphans, Broken chains
 *   getCaseBusinessMetrics     — B2C (PM Surya Ghar) + B2B metrics
 *   getCasePerformanceMetrics  — Cases by Month, Company, Lead Source, Employee
 *   getCaseOperationalMetrics  — Pending counts per operational stage
 */

import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { generateCaseHealthReport } from '../../../engines/CaseValidationEngine';
import { safeDate, daysBetween } from '../../../lib/analyticsCore';

// ── Types ──────────────────────────────────────────────────

export interface VolumeMetrics {
  totalCases: number;
  activeCases: number;
  completedCases: number;
  failedCases: number;
  cancelledCases: number;
  createdToday: number;
  createdThisMonth: number;
  growthPercent: number; // % change vs previous month
}

export interface LifecycleMetrics {
  avgLeadToCustomer: number;   // days
  avgCustomerToProject: number;
  avgProjectToInstallation: number;
  avgInstallationToCommissioning: number;
  avgEndToEnd: number;         // days
  fastestCaseDays: number;
  fastestCaseId: string | null;
  slowestCaseDays: number;
  slowestCaseId: string | null;
}

export interface StageDistributionItem {
  stage: string;
  count: number;
  percentage: number;
  color: string;
}

export interface StageDistribution {
  stages: StageDistributionItem[];
  total: number;
}

export interface HealthMetrics {
  healthyCases: number;
  brokenCases: number;
  totalChecked: number;
  validationFailures: number;
  duplicateCases: number;
  orphanRecords: number;
  brokenChains: number;
  lastChecked: string | null;
}

export interface BusinessMetrics {
  b2c: {
    totalCases: number;
    pmSuryaGharCases: number;
    subsidyCompletionRate: number; // %
    netMeteringCompletionRate: number;
  };
  b2b: {
    commercialCases: number;
    industrialCases: number;
    avgProjectSizeKw: number;
    revenuePerCase: number;
  };
}

export interface PerformanceMetrics {
  byMonth: Array<{ month: string; count: number }>;
  byCompany: Array<{ companyId: string; count: number }>;
  byLeadSource: Array<{ source: string; count: number }>;
  byEmployee: Array<{ employeeId: string; name: string; count: number }>;
}

export interface OperationalMetrics {
  pendingInstallations: number;
  pendingQC: number;
  pendingCommissioning: number;
  pendingSubsidy: number;
  pendingHandover: number;
  pendingServiceTickets: number;
}

// ── Stage colors for the funnel chart ──────────────────────

const STAGE_COLORS: Record<string, string> = {
  'Lead': '#6366f1',
  'Customer': '#8b5cf6',
  'Project': '#3b82f6',
  'Quotation': '#0ea5e9',
  'Order': '#06b6d4',
  'Invoice': '#10b981',
  'Payment': '#22c55e',
  'Dispatch': '#84cc16',
  'Installation': '#eab308',
  'QC': '#f59e0b',
  'Commissioning': '#f97316',
  'Net Metering': '#ef4444',
  'Subsidy': '#ec4899',
  'Handover': '#a855f7',
  'AMC': '#9333ea',
  'Service Tickets': '#14b8a6',
  'Monitoring': '#64748b',
};

const DEFAULT_STAGE_COLOR = '#6366f1';

// ── Date helpers ───────────────────────────────────────────

/** Days between two values (ISO strings or Date objects) */
function daysBetweenValues(a: unknown, b: unknown): number {
  const aDate = safeDate(a);
  const bDate = safeDate(b);
  if (!aDate || !bDate) return 0;
  return daysBetween(aDate, bDate);
}

/** Check if a date value falls within today */
function isToday(value: unknown): boolean {
  const d = safeDate(value);
  if (!d) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

/** Check if a date value falls within the current month */
function isThisMonth(value: unknown): boolean {
  const d = safeDate(value);
  if (!d) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth();
}

/** Check if a date falls within the previous month */
function isLastMonth(value: unknown): boolean {
  const d = safeDate(value);
  if (!d) return false;
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return d.getFullYear() === prevMonth.getFullYear() &&
    d.getMonth() === prevMonth.getMonth();
}

/** Month key for grouping */
function monthKeyFromDate(value: unknown): string {
  const d = safeDate(value);
  if (!d) return 'Unknown';
  return d.toLocaleString('default', { month: 'short', year: '2-digit' });
}

/** Map case currentStage to EPC pipeline stage name */
function mapStageName(rawStage: string): string {
  const map: Record<string, string> = {
    'New': 'Lead',
    'Survey': 'Lead',
    'Engineering': 'Lead',
    'Quotation': 'Quotation',
    'Order': 'Order',
    'Procurement': 'Dispatch',
    'Dispatch': 'Dispatch',
    'Installation': 'Installation',
    'QC': 'QC',
    'Commissioning': 'Commissioning',
    'NetMetering': 'Net Metering',
    'Subsidy': 'Subsidy',
    'Handover': 'Handover',
    'AMC': 'AMC',
    'Service': 'Service Tickets',
    'Closure': 'Monitoring',
    'Monitoring': 'Monitoring',
  };
  return map[rawStage] || rawStage;
}

// ═════════════════════════════════════════════════════════╗
//  1. VOLUME METRICS                                      ║
// ═════════════════════════════════════════════════════════╝

export function getCaseVolumeMetrics(allCases: any[]): VolumeMetrics {
  const active = allCases.filter((c: any) => c.status === 'Active' && !c.isDeleted);
  const completed = allCases.filter((c: any) => c.status === 'Completed' && !c.isDeleted);
  const failed = allCases.filter((c: any) => (c.status === 'Failed' || c.status?.toLowerCase() === 'failed') && !c.isDeleted);
  const cancelled = allCases.filter((c: any) => (c.status === 'Cancelled' || c.status?.toLowerCase() === 'cancelled') && !c.isDeleted);
  const nonDeleted = allCases.filter((c: any) => !c.isDeleted);

  const createdToday = nonDeleted.filter((c: any) => isToday(c.createdAt)).length;
  const createdThisMonth = nonDeleted.filter((c: any) => isThisMonth(c.createdAt)).length;
  const createdLastMonth = nonDeleted.filter((c: any) => isLastMonth(c.createdAt)).length;

  const growthPercent = createdLastMonth > 0
    ? Math.round(((createdThisMonth - createdLastMonth) / createdLastMonth) * 100)
    : createdThisMonth > 0 ? 100 : 0;

  return {
    totalCases: nonDeleted.length,
    activeCases: active.length,
    completedCases: completed.length,
    failedCases: failed.length,
    cancelledCases: cancelled.length,
    createdToday,
    createdThisMonth,
    growthPercent,
  };
}

// ═════════════════════════════════════════════════════════╗
//  2. LIFECYCLE METRICS                                   ║
// ═════════════════════════════════════════════════════════╝

export function getCaseLifecycleMetrics(
  allCases: any[],
  allLeads: any[],
  allCustomers: any[],
  allProjects: any[],
  allInstallations: any[],
  allCommissioningRecords: any[],
): LifecycleMetrics {
  const nonDeleted = allCases.filter((c: any) => !c.isDeleted);

  let totalLeadToCustomer = 0;
  let leadToCustomerCount = 0;
  let totalCustomerToProject = 0;
  let customerToProjectCount = 0;
  let totalProjectToInstallation = 0;
  let projectToInstallationCount = 0;
  let totalInstallationToCommissioning = 0;
  let installationToCommissioningCount = 0;
  let totalEndToEnd = 0;
  let endToEndCount = 0;

  let fastestDays = Infinity;
  let fastestId: string | null = null;
  let slowestDays = 0;
  let slowestId: string | null = null;

  for (const c of nonDeleted) {
    const caseCreatedAt = c.createdAt;
    const caseCompletedAt = c.updatedAt;

    // Lead → Customer
    if (c.leadId && c.customerId) {
      const lead = allLeads.find((l: any) => l.id === c.leadId);
      const customer = allCustomers.find((cu: any) => cu.id === c.customerId);
      if (lead?.createdAt && customer?.createdAt) {
        const days = daysBetweenValues(lead.createdAt, customer.createdAt);
        if (days > 0) { totalLeadToCustomer += days; leadToCustomerCount++; }
      }
    }

    // Customer → Project
    if (c.customerId) {
      const customer = allCustomers.find((cu: any) => cu.id === c.customerId);
      const project = allProjects.find((p: any) => p.customerId === c.customerId || p.caseId === c.caseId || p.caseId === c.id);
      if (customer?.createdAt && project?.createdAt) {
        const days = daysBetweenValues(customer.createdAt, project.createdAt);
        if (days > 0) { totalCustomerToProject += days; customerToProjectCount++; }
      }
    }

    // Project → Installation
    if (c.leadId) {
      const project = allProjects.find((p: any) => p.leadId === c.leadId || p.caseId === c.caseId || p.caseId === c.id);
      const installation = allInstallations.find((i: any) => i.projectId === project?.id || i.caseId === c.caseId || i.caseId === c.id);
      if (project?.createdAt && installation?.createdAt) {
        const days = daysBetweenValues(project.createdAt, installation.createdAt);
        if (days > 0) { totalProjectToInstallation += days; projectToInstallationCount++; }
      }
    }

    // Installation → Commissioning
    if (c.leadId) {
      const project = allProjects.find((p: any) => p.leadId === c.leadId || p.caseId === c.caseId || p.caseId === c.id);
      const installation = allInstallations.find((i: any) => i.projectId === project?.id || i.caseId === c.caseId || i.caseId === c.id);
      const commissioning = allCommissioningRecords.find((cr: any) => cr.installationId === installation?.id || cr.caseId === c.caseId || cr.caseId === c.id);
      if (installation?.createdAt && commissioning?.createdAt) {
        const days = daysBetweenValues(installation.createdAt, commissioning.createdAt);
        if (days > 0) { totalInstallationToCommissioning += days; installationToCommissioningCount++; }
      }
    }

    // End-to-end duration
    if (caseCreatedAt && caseCompletedAt && c.status === 'Completed') {
      const totalDays = daysBetweenValues(caseCreatedAt, caseCompletedAt);
      if (totalDays > 0) {
        totalEndToEnd += totalDays;
        endToEndCount++;
        if (totalDays < fastestDays) { fastestDays = totalDays; fastestId = c.caseId || c.id; }
        if (totalDays > slowestDays) { slowestDays = totalDays; slowestId = c.caseId || c.id; }
      }
    }
  }

  return {
    avgLeadToCustomer: leadToCustomerCount > 0 ? Math.round(totalLeadToCustomer / leadToCustomerCount) : 0,
    avgCustomerToProject: customerToProjectCount > 0 ? Math.round(totalCustomerToProject / customerToProjectCount) : 0,
    avgProjectToInstallation: projectToInstallationCount > 0 ? Math.round(totalProjectToInstallation / projectToInstallationCount) : 0,
    avgInstallationToCommissioning: installationToCommissioningCount > 0 ? Math.round(totalInstallationToCommissioning / installationToCommissioningCount) : 0,
    avgEndToEnd: endToEndCount > 0 ? Math.round(totalEndToEnd / endToEndCount) : 0,
    fastestCaseDays: fastestDays === Infinity ? 0 : fastestDays,
    fastestCaseId: fastestId,
    slowestCaseDays: slowestDays,
    slowestCaseId: slowestId,
  };
}

// ═════════════════════════════════════════════════════════╗
//  3. STAGE DISTRIBUTION                                  ║
// ═════════════════════════════════════════════════════════╝

export function getCaseStageDistribution(allCases: any[]): StageDistribution {
  const nonDeleted = allCases.filter((c: any) => !c.isDeleted);
  const total = nonDeleted.length;

  // Build distribution from EPC stage mapping
  const stageCounts = new Map<string, number>();
  const stageOrder = [
    'Lead', 'Customer', 'Project', 'Quotation', 'Order', 'Invoice',
    'Payment', 'Dispatch', 'Installation', 'QC', 'Commissioning',
    'Net Metering', 'Subsidy', 'Handover', 'AMC', 'Service Tickets', 'Monitoring',
  ];

  stageOrder.forEach((s) => stageCounts.set(s, 0));

  for (const c of nonDeleted) {
    const stageName = mapStageName(String(c.currentStage || 'New'));
    stageCounts.set(stageName, (stageCounts.get(stageName) || 0) + 1);
  }

  // Customer: count cases with customerId
  const customerCount = nonDeleted.filter((c: any) => c.customerId).length;
  stageCounts.set('Customer', customerCount);

  const stages: StageDistributionItem[] = stageOrder.map((stage) => ({
    stage,
    count: stageCounts.get(stage) || 0,
    percentage: total > 0 ? Math.round(((stageCounts.get(stage) || 0) / total) * 100) : 0,
    color: STAGE_COLORS[stage] || DEFAULT_STAGE_COLOR,
  }));

  return { stages, total };
}

// ═════════════════════════════════════════════════════════╗
//  4. HEALTH METRICS                                      ║
// ═════════════════════════════════════════════════════════╝

export async function getCaseHealthMetrics(): Promise<HealthMetrics> {
  try {
    const report = await generateCaseHealthReport();
    return {
      healthyCases: report.healthyCases,
      brokenCases: report.brokenCases,
      totalChecked: report.healthyCases + report.brokenCases,
      validationFailures: report.brokenCases,
      duplicateCases: report.duplicateCases,
      orphanRecords: report.orphanEntities,
      brokenChains: report.circularReferences,
      lastChecked: report.validationTimestamp,
    };
  } catch {
    return {
      healthyCases: 0, brokenCases: 0, totalChecked: 0,
      validationFailures: 0, duplicateCases: 0, orphanRecords: 0,
      brokenChains: 0, lastChecked: null,
    };
  }
}

// ═════════════════════════════════════════════════════════╗
//  5. BUSINESS METRICS (B2B + B2C)                       ║
// ═════════════════════════════════════════════════════════╝

export function getCaseBusinessMetrics(
  allCases: any[],
  allCustomers: any[],
  allProjects: any[],
  allOrders: any[],
): BusinessMetrics {
  const nonDeletedCases = allCases.filter((c: any) => !c.isDeleted);

  // B2C: PM Surya Ghar — residential cases
  const b2cCustomers = allCustomers.filter((c: any) => {
    const type = String(c.type || c.customerType || '').toLowerCase();
    return type === 'b2c' || type === 'residential' || type === 'individual';
  });
  const b2cCustomerIds = new Set(b2cCustomers.map((c: any) => c.id));
  const b2cCases = nonDeletedCases.filter((c: any) => b2cCustomerIds.has(c.customerId));

  // Count B2C cases with subsidy
  const b2cWithSubsidy = b2cCases.filter((c: any) => {
    const stage = String(c.currentStage || '').toLowerCase();
    return stage.includes('subsidy') || stage === 'subsidy' || stage === 'handover' ||
           stage === 'amc' || stage === 'service' || stage === 'closure' || stage === 'monitoring';
  });
  const subsidyCompletionRate = b2cCases.length > 0
    ? Math.round((b2cWithSubsidy.length / b2cCases.length) * 100)
    : 0;

  // B2C with net metering
  const b2cWithNetMetering = b2cCases.filter((c: any) => {
    const stage = String(c.currentStage || '').toLowerCase();
    return stage.includes('netmetering') || stage === 'handover' || stage === 'amc' ||
           stage === 'service' || stage === 'closure' || stage === 'monitoring';
  });
  const netMeteringCompletionRate = b2cCases.length > 0
    ? Math.round((b2cWithNetMetering.length / b2cCases.length) * 100)
    : 0;

  // B2B: Commercial + Industrial
  const b2bCustomers = allCustomers.filter((c: any) => {
    const type = String(c.type || c.customerType || '').toLowerCase();
    return type === 'b2b' || type === 'commercial' || type === 'industrial' || type === 'business';
  });
  const b2bCustomerIds = new Set(b2bCustomers.map((c: any) => c.id));
  const b2bCases = nonDeletedCases.filter((c: any) => b2bCustomerIds.has(c.customerId));

  // Split B2B into commercial vs industrial
  const commercialCustomers = b2bCustomers.filter((c: any) => {
    const type = String(c.type || c.customerType || '').toLowerCase();
    return type === 'commercial' || type === 'b2b';
  });
  const industrialCustomers = b2bCustomers.filter((c: any) => {
    const type = String(c.type || c.customerType || '').toLowerCase();
    return type === 'industrial';
  });

  // Average project size
  const b2bProjectIds = new Set<string>();
  b2bCases.forEach((c: any) => {
    const project = allProjects.find((p: any) => p.customerId === c.customerId || p.caseId === c.caseId || p.caseId === c.id);
    if (project) b2bProjectIds.add(project.id);
  });
  const b2bProjects = allProjects.filter((p: any) => b2bProjectIds.has(p.id));
  const totalKw = b2bProjects.reduce((sum: number, p: any) => sum + (Number(p.systemCapacityKw || p.capacityKw || 0)), 0);
  const avgProjectSizeKw = b2bProjects.length > 0 ? Math.round(totalKw / b2bProjects.length) : 0;

  // Revenue per B2B case
  const b2bOrderIds = new Set<string>();
  nonDeletedCases.forEach((c: any) => {
    allOrders.forEach((o: any) => {
      if (String(o.caseId || '') === c.caseId || String(o.caseId || '') === c.id) {
        b2bOrderIds.add(o.id);
      }
    });
  });
  const b2bOrders = allOrders.filter((o: any) => b2bOrderIds.has(o.id));
  const totalRevenue = b2bOrders.reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);
  const revenuePerCase = b2bCases.length > 0 ? Math.round(totalRevenue / b2bCases.length) : 0;

  return {
    b2c: {
      totalCases: b2cCases.length,
      pmSuryaGharCases: b2cCases.length, // All B2C cases are PM Surya Ghar by default
      subsidyCompletionRate,
      netMeteringCompletionRate,
    },
    b2b: {
      commercialCases: commercialCustomers.length,
      industrialCases: industrialCustomers.length,
      avgProjectSizeKw,
      revenuePerCase,
    },
  };
}

// ═════════════════════════════════════════════════════════╗
//  6. PERFORMANCE METRICS                                 ║
// ═════════════════════════════════════════════════════════╝

export function getCasePerformanceMetrics(
  allCases: any[],
  allLeads: any[],
): PerformanceMetrics {
  const nonDeleted = allCases.filter((c: any) => !c.isDeleted);

  // By month
  const monthMap = new Map<string, number>();
  nonDeleted.forEach((c: any) => {
    const key = monthKeyFromDate(c.createdAt);
    monthMap.set(key, (monthMap.get(key) || 0) + 1);
  });
  const byMonth = Array.from(monthMap.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // By lead source
  const sourceMap = new Map<string, number>();
  nonDeleted.forEach((c: any) => {
    const lead = allLeads.find((l: any) => l.id === c.leadId);
    const source = lead?.source || lead?.leadSource || 'Unknown';
    sourceMap.set(source, (sourceMap.get(source) || 0) + 1);
  });
  const byLeadSource = Array.from(sourceMap.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  // By company (multi-tenant)
  const companyMap = new Map<string, number>();
  nonDeleted.forEach((c: any) => {
    const cid = c.companyId || '';
    companyMap.set(cid, (companyMap.get(cid) || 0) + 1);
  });
  const byCompany = Array.from(companyMap.entries())
    .map(([companyId, count]) => ({ companyId, count }))
    .sort((a, b) => b.count - a.count);

  // By employee (createdBy)
  const employeeMap = new Map<string, { name: string; count: number }>();
  nonDeleted.forEach((c: any) => {
    const empId = c.createdBy || 'system';
    const existing = employeeMap.get(empId) || { name: empId, count: 0 };
    existing.count++;
    employeeMap.set(empId, existing);
  });
  const byEmployee = Array.from(employeeMap.entries())
    .map(([employeeId, v]) => ({ employeeId, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { byMonth, byCompany, byLeadSource, byEmployee };
}

// ═════════════════════════════════════════════════════════╗
//  7. OPERATIONAL METRICS                                 ║
// ═════════════════════════════════════════════════════════╝

export function getCaseOperationalMetrics(allCases: any[]): OperationalMetrics {
  const active = allCases.filter((c: any) => c.status === 'Active' && !c.isDeleted);

  const inStage = (stageKey: string) => {
    return active.filter((c: any) => {
      const s = String(c.currentStage || '').toLowerCase();
      return s.includes(stageKey.toLowerCase());
    }).length;
  };

  return {
    pendingInstallations: inStage('installation') + active.filter((c: any) => {
      const s = String(c.currentStage || '').toLowerCase();
      return s === 'dispatch' || s === 'procurement';
    }).length,
    pendingQC: inStage('qc') + inStage('installation'),
    pendingCommissioning: inStage('commissioning') + inStage('qc'),
    pendingSubsidy: inStage('subsidy') + inStage('netmetering'),
    pendingHandover: inStage('handover') + inStage('subsidy'),
    pendingServiceTickets: inStage('service'),
  };
}
