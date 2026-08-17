/**
 * caseSearch — Universal Case Search utility (READ-ONLY)
 *
 * Phase 3H — Case Search
 * Provides 11 search functions for comprehensive case search across all linked entities.
 *
 * Architecture:
 * - READ-ONLY: no Firestore writes, no schema changes
 * - Case-insensitive search throughout
 * - Supports exact match, partial match, multi-field search
 * - Works across all 17 EPC stages
 * - Reuses existing data via getAll/getOne
 */

import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';

// ── Types ──────────────────────────────────────────────────

export interface CaseSearchResult {
  case: any;
  lead?: any | null;
  customer?: any | null;
  project?: any | null;
  quotation?: any | null;
  order?: any | null;
  invoice?: any | null;
  payment?: any | null;
  dispatch?: any | null;
  installation?: any | null;
  qc?: any | null;
  commissioning?: any | null;
  netMetering?: any | null;
  subsidy?: any | null;
  handover?: any | null;
  amc?: any | null;
  serviceTicket?: any | null;
  monitoring?: any | null;
  health: 'healthy' | 'warning' | 'critical' | 'unknown';
  matchFields: string[];
}

export interface CaseSearchOptions {
  caseId?: string;
  status?: string;
  currentStage?: string;
  health?: string;
  leadId?: string;
  leadName?: string;
  leadSource?: string;
  leadMobile?: string;
  customerId?: string;
  customerName?: string;
  customerType?: string;
  projectId?: string;
  projectName?: string;
  systemSizeMin?: number;
  systemSizeMax?: number;
  quotationNumber?: string;
  orderNumber?: string;
  invoiceNumber?: string;
  paymentReference?: string;
  installationId?: string;
  qcId?: string;
  commissioningId?: string;
  netMeteringId?: string;
  subsidyId?: string;
  assignedEmployee?: string;
  company?: string;
  branch?: string;
  createdBy?: string;
  dateFrom?: string;
  dateTo?: string;
  query?: string; // free-text search across multiple fields
  exactMatch?: boolean;
}

export interface CaseSearchSummary {
  totalResults: number;
  healthyCount: number;
  warningCount: number;
  criticalCount: number;
  completedCount: number;
}

// ── Stage mapping for health determination ─────────────────

function determineHealth(c: any): 'healthy' | 'warning' | 'critical' | 'unknown' {
  if (!c || c.isDeleted) return 'unknown';
  if (c.status === 'Failed') return 'critical';
  if (c.status === 'Warning') return 'warning';
  if (c.status === 'Completed') return 'healthy';
  if (c.status === 'Active') {
    // Active with both leadId and customerId = healthy
    if (c.leadId && c.customerId) return 'healthy';
    // Active but missing references = warning
    return 'warning';
  }
  return 'unknown';
}

function normalize(val: unknown): string {
  return String(val ?? '').toLowerCase().trim();
}

function isMatch(value: unknown, query: string, exact?: boolean): boolean {
  const nv = normalize(value);
  const nq = normalize(query);
  if (!nv || !nq) return false;
  if (exact) return nv === nq;
  return nv.includes(nq);
}

function isInRange(value: unknown, min?: number, max?: number): boolean {
  const num = Number(value);
  if (isNaN(num)) return false;
  if (min !== undefined && num < min) return false;
  if (max !== undefined && num > max) return false;
  return true;
}

function isInDateRange(value: unknown, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const d = new Date(String(value ?? ''));
  if (isNaN(d.getTime())) return true; // can't determine, include it
  if (from && d < new Date(from)) return false;
  if (to && d > new Date(to)) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════
//  1. searchCases — Master search with all options
// ═══════════════════════════════════════════════════════════

export async function searchCases(
  allCases: any[],
  allLeads: any[],
  allCustomers: any[],
  allProjects: any[],
  allQuotations: any[],
  allOrders: any[],
  allInvoices: any[],
  allPayments: any[],
  allDispatches: any[],
  allInstallations: any[],
  allQcChecks: any[],
  allCommissioning: any[],
  allNetMetering: any[],
  allSubsidy: any[],
  allHandovers: any[],
  allAmc: any[],
  allServiceTickets: any[],
  allMonitoring: any[],
  opts: CaseSearchOptions,
): Promise<{ results: CaseSearchResult[]; summary: CaseSearchSummary }> {
  const nonDeleted = allCases.filter((c: any) => !c.isDeleted);

  const results: CaseSearchResult[] = [];

  for (const c of nonDeleted) {
    const lead = allLeads.find((l: any) => l.id === c.leadId) || null;
    const customer = allCustomers.find((cu: any) => cu.id === c.customerId) || null;
    const project = allProjects.find((p: any) => p.caseId === c.caseId || p.caseId === c.id || p.leadId === c.leadId) || null;
    const quotation = allQuotations.find((q: any) => q.caseId === c.caseId || q.caseId === c.id) || null;
    const order = allOrders.find((o: any) => o.caseId === c.caseId || o.caseId === c.id) || null;
    const invoice = allInvoices.find((i: any) => i.caseId === c.caseId || i.caseId === c.id) || null;
    const payment = allPayments.find((p: any) => p.caseId === c.caseId || p.caseId === c.id) || null;
    const dispatch = allDispatches.find((d: any) => d.caseId === c.caseId || d.caseId === c.id) || null;
    const installation = allInstallations.find((i: any) => i.caseId === c.caseId || i.caseId === c.id || i.projectId === project?.id) || null;
    const qc = allQcChecks.find((q: any) => q.caseId === c.caseId || q.caseId === c.id) || null;
    const commissioning = allCommissioning.find((cr: any) => cr.caseId === c.caseId || cr.caseId === c.id) || null;
    const netMetering = allNetMetering.find((nm: any) => nm.caseId === c.caseId || nm.caseId === c.id) || null;
    const subsidy = allSubsidy.find((s: any) => s.caseId === c.caseId || s.caseId === c.id) || null;
    const handover = allHandovers.find((h: any) => h.caseId === c.caseId || h.caseId === c.id) || null;
    const amc = allAmc.find((a: any) => a.caseId === c.caseId || a.caseId === c.id) || null;
    const serviceTicket = allServiceTickets.find((st: any) => st.caseId === c.caseId || st.caseId === c.id) || null;
    const monitor = allMonitoring.find((m: any) => m.caseId === c.caseId || m.caseId === c.id) || null;

    const matchFields: string[] = [];
    const exact = opts.exactMatch;

    // Check each search criterion
    const checks = [
      // Case Information
      { check: opts.caseId && isMatch(c.caseId || c.id, opts.caseId, exact), field: 'Case ID' },
      { check: opts.status && isMatch(c.status, opts.status, exact), field: 'Status' },
      { check: opts.currentStage && isMatch(c.currentStage, opts.currentStage, exact), field: 'Current Stage' },
      { check: opts.health && isMatch(determineHealth(c), opts.health, exact), field: 'Health' },

      // Lead Information
      { check: opts.leadId && lead && isMatch(lead.id, opts.leadId, exact), field: 'Lead ID' },
      { check: opts.leadName && lead && isMatch(lead.name, opts.leadName), field: 'Lead Name' },
      { check: opts.leadSource && lead && isMatch(lead.source || lead.leadSource, opts.leadSource), field: 'Lead Source' },
      { check: opts.leadMobile && lead && isMatch(lead.phone || lead.mobile, opts.leadMobile), field: 'Lead Mobile' },

      // Customer Information
      { check: opts.customerId && customer && isMatch(customer.id, opts.customerId, exact), field: 'Customer ID' },
      { check: opts.customerName && customer && isMatch(customer.name, opts.customerName), field: 'Customer Name' },
      { check: opts.customerType && customer && isMatch(customer.type || customer.customerType, opts.customerType, exact), field: 'Customer Type' },

      // Project Information
      { check: opts.projectId && project && isMatch(project.id, opts.projectId, exact), field: 'Project ID' },
      { check: opts.projectName && project && isMatch(project.projectName, opts.projectName), field: 'Project Name' },
      { check: opts.systemSizeMin !== undefined || opts.systemSizeMax !== undefined, fn: () => project && isInRange(project.systemCapacityKw || project.capacityKw, opts.systemSizeMin, opts.systemSizeMax), field: 'System Size' },

      // Financial Information
      { check: opts.quotationNumber && quotation && isMatch(quotation.quotationNumber || quotation.id, opts.quotationNumber, exact), field: 'Quotation' },
      { check: opts.orderNumber && order && isMatch(order.orderNumber || order.id, opts.orderNumber, exact), field: 'Order' },
      { check: opts.invoiceNumber && invoice && isMatch(invoice.invoiceNumber || invoice.piNumber || invoice.id, opts.invoiceNumber, exact), field: 'Invoice' },
      { check: opts.paymentReference && payment && isMatch(payment.reference || payment.id, opts.paymentReference, exact), field: 'Payment' },

      // EPC Information
      { check: opts.installationId && installation && isMatch(installation.id, opts.installationId, exact), field: 'Installation' },
      { check: opts.qcId && qc && isMatch(qc.id, opts.qcId, exact), field: 'QC' },
      { check: opts.commissioningId && commissioning && isMatch(commissioning.id, opts.commissioningId, exact), field: 'Commissioning' },
      { check: opts.netMeteringId && netMetering && isMatch(netMetering.id, opts.netMeteringId, exact), field: 'Net Metering' },
      { check: opts.subsidyId && subsidy && isMatch(subsidy.id, opts.subsidyId, exact), field: 'Subsidy' },

      // Operational Information
      { check: opts.assignedEmployee && isMatch(c.createdBy || c.assignedTo, opts.assignedEmployee), field: 'Employee' },
      { check: opts.company && isMatch(c.companyId, opts.company, exact), field: 'Company' },
      { check: opts.createdBy && isMatch(c.createdBy, opts.createdBy), field: 'Created By' },

      // Date range
      { check: !isInDateRange(c.createdAt, opts.dateFrom, opts.dateTo) === false, field: 'Date Range' },

      // Free-text query
      { check: opts.query, fn: () => freeTextMatch(c, opts.query!, lead, customer, project, quotation, order, invoice), field: 'Free Text' },
    ];

    let matched = true;
    for (const ch of checks) {
      // Evaluate the check condition
      let conditionMet: boolean;
      if (ch.check !== undefined) {
        conditionMet = ch.check;
      } else if (ch.fn) {
        conditionMet = ch.fn();
      } else {
        continue;
      }

      if (!conditionMet) {
        matched = false;
        break;
      }

      if (ch.field) matchFields.push(ch.field);
    }

    // For free-text query, always try to match
    if (opts.query && matchFields.length === 0) {
      const freeTextFields = freeTextMatchFields(c, opts.query, lead, customer, project);
      if (freeTextFields.length > 0) {
        matched = true;
        matchFields.push(...freeTextFields);
      }
    }

    if (matched && matchFields.length > 0) {
      results.push({
        case: c,
        lead,
        customer,
        project,
        quotation,
        order,
        invoice,
        payment,
        dispatch,
        installation,
        qc,
        commissioning,
        netMetering,
        subsidy,
        handover,
        amc,
        serviceTicket,
        monitoring: monitor,
        health: determineHealth(c),
        matchFields: [...new Set(matchFields)],
      });
    }
  }

  // Sort by most match fields first, then by recency
  results.sort((a, b) => {
    if (b.matchFields.length !== a.matchFields.length) return b.matchFields.length - a.matchFields.length;
    const aDate = new Date(String(a.case.updatedAt || a.case.createdAt || '')).getTime();
    const bDate = new Date(String(b.case.updatedAt || b.case.createdAt || '')).getTime();
    return bDate - aDate;
  });

  const summary: CaseSearchSummary = {
    totalResults: results.length,
    healthyCount: results.filter((r) => r.health === 'healthy').length,
    warningCount: results.filter((r) => r.health === 'warning').length,
    criticalCount: results.filter((r) => r.health === 'critical').length,
    completedCount: results.filter((r) => r.case.status === 'Completed').length,
  };

  return { results, summary };
}

// ── Free-text search helpers ─────────────────────────────

function freeTextMatch(
  c: any, query: string,
  lead: any, customer: any, project: any,
  quotation?: any, order?: any, invoice?: any,
): boolean {
  return freeTextMatchFields(c, query, lead, customer, project, quotation, order, invoice).length > 0;
}

function freeTextMatchFields(
  c: any, query: string,
  lead?: any, customer?: any, project?: any,
  quotation?: any, order?: any, invoice?: any,
): string[] {
  const q = normalize(query);
  if (!q || q.length < 2) return [];

  const fields: Array<{ value: string; label: string }> = [
    { value: c.caseId || c.id, label: 'Case ID' },
    { value: c.currentStage, label: 'Stage' },
    { value: c.status, label: 'Status' },
    { value: lead?.name || lead?.companyName, label: 'Lead Name' },
    { value: lead?.source || lead?.leadSource, label: 'Lead Source' },
    { value: lead?.phone || lead?.mobile, label: 'Lead Phone' },
    { value: customer?.name, label: 'Customer Name' },
    { value: customer?.type || customer?.customerType, label: 'Customer Type' },
    { value: customer?.phone || customer?.mobile, label: 'Customer Phone' },
    { value: project?.projectName, label: 'Project Name' },
    { value: project?.systemCapacityKw || project?.capacityKw, label: 'System Size' },
    { value: quotation?.quotationNumber || quotation?.id, label: 'Quotation' },
    { value: order?.orderNumber || order?.id, label: 'Order' },
    { value: invoice?.invoiceNumber || invoice?.piNumber || invoice?.id, label: 'Invoice' },
    { value: c.createdBy, label: 'Created By' },
    { value: c.companyId, label: 'Company' },
  ];

  const matched: string[] = [];
  for (const field of fields) {
    if (field.value !== undefined && field.value !== null) {
      const nv = String(field.value).toLowerCase();
      if (nv.includes(q)) matched.push(field.label);
    }
  }
  return matched;
}

// ═══════════════════════════════════════════════════════════
//  2-11. Specialized search functions
// ═══════════════════════════════════════════════════════════

export async function searchByCaseId(
  allCases: any[],
  caseId: string,
): Promise<CaseSearchResult | null> {
  const c = allCases.find((c: any) => normalize(c.caseId || c.id) === normalize(caseId));
  if (!c) return null;
  return {
    case: c, health: determineHealth(c), matchFields: ['Case ID'],
  };
}

export async function searchByLead(
  allCases: any[],
  allLeads: any[],
  leadQuery: string,
): Promise<CaseSearchResult[]> {
  const q = normalize(leadQuery);
  const matchingLeads = allLeads.filter((l: any) =>
    normalize(l.id).includes(q) ||
    normalize(l.name).includes(q) ||
    normalize(l.source || l.leadSource || '').includes(q) ||
    normalize(l.phone || l.mobile || '').includes(q)
  );
  const leadIds = new Set(matchingLeads.map((l: any) => l.id));

  return allCases
    .filter((c: any) => !c.isDeleted && leadIds.has(c.leadId))
    .map((c: any) => {
      const lead = matchingLeads.find((l: any) => l.id === c.leadId);
      return {
        case: c, lead: lead || null,
        health: determineHealth(c), matchFields: ['Lead'],
      };
    });
}

export async function searchByCustomer(
  allCases: any[],
  allCustomers: any[],
  customerQuery: string,
): Promise<CaseSearchResult[]> {
  const q = normalize(customerQuery);
  const matchingCustomers = allCustomers.filter((cu: any) =>
    normalize(cu.id).includes(q) ||
    normalize(cu.name).includes(q) ||
    normalize(cu.type || cu.customerType || '').includes(q)
  );
  const customerIds = new Set(matchingCustomers.map((cu: any) => cu.id));

  return allCases
    .filter((c: any) => !c.isDeleted && customerIds.has(c.customerId))
    .map((c: any) => {
      const customer = matchingCustomers.find((cu: any) => cu.id === c.customerId);
      return {
        case: c, customer: customer || null,
        health: determineHealth(c), matchFields: ['Customer'],
      };
    });
}

export async function searchByProject(
  allCases: any[],
  allProjects: any[],
  projectQuery: string,
): Promise<CaseSearchResult[]> {
  const q = normalize(projectQuery);
  const matchingProjects = allProjects.filter((p: any) =>
    normalize(p.id).includes(q) ||
    normalize(p.projectName || '').includes(q)
  );
  const projectIds = new Set(matchingProjects.map((p: any) => p.id));

  return allCases
    .filter((c: any) => !c.isDeleted && projectIds.has(c.caseId || c.id))
    .map((c: any) => {
      const project = matchingProjects.find((p: any) => p.id === c.caseId || p.id === c.caseId);
      return {
        case: c, project: project || null,
        health: determineHealth(c), matchFields: ['Project'],
      };
    });
}

export async function searchByStage(
  allCases: any[],
  stage: string,
): Promise<CaseSearchResult[]> {
  const q = normalize(stage);
  return allCases
    .filter((c: any) => !c.isDeleted && normalize(c.currentStage).includes(q))
    .map((c: any) => ({
      case: c, health: determineHealth(c), matchFields: ['Stage'],
    }));
}

export async function searchByHealth(
  allCases: any[],
  health: string,
): Promise<CaseSearchResult[]> {
  return allCases
    .filter((c: any) => !c.isDeleted && determineHealth(c) === normalize(health))
    .map((c: any) => ({
      case: c, health: determineHealth(c), matchFields: ['Health'],
    }));
}

export async function searchByEmployee(
  allCases: any[],
  employeeQuery: string,
): Promise<CaseSearchResult[]> {
  const q = normalize(employeeQuery);
  return allCases
    .filter((c: any) => {
      if (c.isDeleted) return false;
      return normalize(c.createdBy).includes(q) || normalize(c.assignedTo || '').includes(q);
    })
    .map((c: any) => ({
      case: c, health: determineHealth(c), matchFields: ['Employee'],
    }));
}

export async function searchByCompany(
  allCases: any[],
  companyId: string,
): Promise<CaseSearchResult[]> {
  return allCases
    .filter((c: any) => !c.isDeleted && normalize(c.companyId) === normalize(companyId))
    .map((c: any) => ({
      case: c, health: determineHealth(c), matchFields: ['Company'],
    }));
}

export async function searchByDateRange(
  allCases: any[],
  from?: string,
  to?: string,
): Promise<CaseSearchResult[]> {
  return allCases
    .filter((c: any) => !c.isDeleted && isInDateRange(c.createdAt, from, to))
    .map((c: any) => ({
      case: c, health: determineHealth(c), matchFields: ['Date Range'],
    }));
}

export async function searchAcrossEntities(
  allCases: any[],
  allLeads: any[],
  allCustomers: any[],
  allProjects: any[],
  allQuotations: any[],
  allOrders: any[],
  allInvoices: any[],
  query: string,
): Promise<CaseSearchResult[]> {
  const q = normalize(query);
  if (!q || q.length < 2) return [];

  // Find matching entities
  const matchingLeadIds = new Set(
    allLeads.filter((l: any) =>
      normalize(l.id).includes(q) || normalize(l.name || '').includes(q) ||
      normalize(l.phone || l.mobile || '').includes(q)
    ).map((l: any) => l.id)
  );

  const matchingCustomerIds = new Set(
    allCustomers.filter((cu: any) =>
      normalize(cu.id).includes(q) || normalize(cu.name || '').includes(q) ||
      normalize(cu.phone || cu.mobile || '').includes(q)
    ).map((cu: any) => cu.id)
  );

  const matchingProjectIds = new Set(
    allProjects.filter((p: any) =>
      normalize(p.id).includes(q) || normalize(p.projectName || '').includes(q)
    ).map((p: any) => p.id)
  );

  const matchingQuotationIds = new Set(
    allQuotations.filter((qt: any) =>
      normalize(qt.id).includes(q) || normalize(qt.quotationNumber || '').includes(q)
    ).map((qt: any) => qt.id)
  );

  const matchingOrderIds = new Set(
    allOrders.filter((o: any) =>
      normalize(o.id).includes(q) || normalize(o.orderNumber || '').includes(q)
    ).map((o: any) => o.id)
  );

  const matchingInvoiceIds = new Set(
    allInvoices.filter((inv: any) =>
      normalize(inv.id).includes(q) || normalize(inv.invoiceNumber || inv.piNumber || '').includes(q)
    ).map((inv: any) => inv.id)
  );

  return allCases
    .filter((c: any) => {
      if (c.isDeleted) return false;
      const cid = c.caseId || c.id;
      return matchingLeadIds.has(c.leadId) ||
        matchingCustomerIds.has(c.customerId) ||
        matchingProjectIds.has(cid) ||
        matchingQuotationIds.has(cid) ||
        matchingOrderIds.has(cid) ||
        matchingInvoiceIds.has(cid) ||
        normalize(c.caseId || c.id).includes(q) ||
        normalize(c.currentStage || '').includes(q) ||
        normalize(c.status || '').includes(q);
    })
    .map((c: any) => ({
      case: c, health: determineHealth(c), matchFields: ['Cross-Entity'],
    }));
}
