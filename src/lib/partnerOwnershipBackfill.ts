/**
 * partnerOwnershipBackfill — Phase 3 data-migration logic for the Channel
 * Partner ownership chain (spec §9.2 / Phase 3 Migration:
 * `scripts/backfill-partner-ownership.ts`).
 *
 * Pre-Phase-3 records created before partner ownership propagation existed may
 * lack `partnerId`/`partnerName` even though their parent entity carries it:
 *   - customers: derive from their source lead (customer.sourceLeadId →
 *     lead.partnerId / lead.partnerName)
 *   - projects:  derive from their customer (project.customerId →
 *     customer.partnerId / customer.partnerName, plus project.leadId from
 *     customer.sourceLeadId when absent)
 *
 * Pure planning logic only — mirrors `partnerUserLinkBackfill.ts` /
 * `scripts/backfill-partner-user-links.ts`. Never guesses: an existing value
 * is never overwritten, cross-references that cannot be resolved are skipped
 * (reported as SKIPPED, not fabricated), and a genuinely conflicting existing
 * value is reported as CONFLICT. The plan is idempotent — already-owned
 * records are reported and require no write.
 */

export const PARTNER_OWNERSHIP_BACKFILL_COLLECTIONS = {
  CUSTOMERS: 'customers',
  LEADS: 'leads',
  PROJECTS: 'projects',
} as const;

export type PartnerOwnershipLeadRecord = {
  id: string;
  companyId?: string;
  partnerId?: string;
  partnerName?: string;
  isDeleted?: boolean;
};

export type PartnerOwnershipCustomerRecord = {
  id: string;
  companyId?: string;
  sourceLeadId?: string;
  partnerId?: string;
  partnerName?: string;
  isDeleted?: boolean;
};

export type PartnerOwnershipProjectRecord = {
  id: string;
  companyId?: string;
  customerId?: string;
  leadId?: string;
  partnerId?: string;
  partnerName?: string;
  isDeleted?: boolean;
};

export type PartnerOwnershipBackfillInput = {
  leads: PartnerOwnershipLeadRecord[];
  customers: PartnerOwnershipCustomerRecord[];
  projects: PartnerOwnershipProjectRecord[];
};

export type PartnerOwnershipBackfillOptions = {
  /** Restrict the plan to a single company. Omit to scan every company. */
  companyId?: string;
};

export type CustomerOwnershipCandidate = {
  customerId: string;
  leadId: string;
  companyId: string;
  partnerId: string;
  partnerName?: string;
  /** True when the customer already carries the SAME partnerId (no write). */
  alreadyOwned: boolean;
};

export type ProjectOwnershipCandidate = {
  projectId: string;
  customerId: string;
  companyId: string;
  partnerId: string;
  partnerName?: string;
  /** leadId derived from the customer's sourceLeadId (applied when absent). */
  leadId?: string;
  /** True when the project already carries the SAME partnerId (no write). */
  alreadyOwned: boolean;
};

export type OwnershipConflictReason =
  | 'customer_partner_mismatch'
  | 'project_partner_mismatch'
  | 'cross_company';

export type OwnershipConflictRecord = {
  entity: string;
  entityId: string;
  sourceId: string;
  companyId: string;
  existingPartnerId: string;
  sourcePartnerId: string;
  reason: OwnershipConflictReason;
};

export type PartnerOwnershipBackfillPlan = {
  customers: CustomerOwnershipCandidate[];
  projects: ProjectOwnershipCandidate[];
  conflicts: OwnershipConflictRecord[];
  summary: {
    leadsScanned: number;
    customersScanned: number;
    projectsScanned: number;
    customersAlreadyOwned: number;
    customersToBackfill: number;
    projectsAlreadyOwned: number;
    projectsToBackfill: number;
    conflicts: number;
    skipped: number;
  };
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Deterministically builds the safe ownership backfill plan.
 * - Customers: only when customer.sourceLeadId resolves to an existing lead
 *   that carries partnerId; an existing customer partnerId that DIFFERS from
 *   the lead's is a conflict (never overwritten).
 * - Projects: only when project.customerId resolves to an existing customer
 *   that carries partnerId; same conflict rule.
 * - Tenants must match at every hop (company boundary respected).
 * - Unresolvable references are counted as skipped — never guessed.
 */
export function buildPartnerOwnershipBackfillPlan(
  input: PartnerOwnershipBackfillInput,
  options: PartnerOwnershipBackfillOptions = {},
): PartnerOwnershipBackfillPlan {
  const companyFilter = String(options.companyId || '').trim();

  const activeLeads = input.leads.filter((l) => !l.isDeleted && (!companyFilter || l.companyId === companyFilter));
  const activeCustomers = input.customers.filter((c) => !c.isDeleted && (!companyFilter || c.companyId === companyFilter));
  const activeProjects = input.projects.filter((p) => !p.isDeleted && (!companyFilter || p.companyId === companyFilter));

  const leadById = new Map(activeLeads.map((lead) => [lead.id, lead]));
  const customerById = new Map(activeCustomers.map((customer) => [customer.id, customer]));

  const customers: CustomerOwnershipCandidate[] = [];
  const projects: ProjectOwnershipCandidate[] = [];
  const conflicts: OwnershipConflictRecord[] = [];
  let skipped = 0;

  // ── Customers ← sourceLeadId ───────────────────────────────
  for (const customer of activeCustomers) {
    const leadId = text(customer.sourceLeadId);
    if (!leadId) continue; // no chain to follow
    const lead = leadById.get(leadId);
    if (!lead) {
      skipped += 1; // unresolvable lead — nothing to fabricate
      continue;
    }
    if (lead.companyId && customer.companyId && lead.companyId !== customer.companyId) {
      conflicts.push({
        entity: 'customers', entityId: customer.id, sourceId: leadId,
        companyId: customer.companyId || lead.companyId || '',
        existingPartnerId: text(customer.partnerId), sourcePartnerId: text(lead.partnerId),
        reason: 'cross_company',
      });
      continue;
    }
    const sourcePartnerId = text(lead.partnerId);
    if (!sourcePartnerId) {
      skipped += 1; // lead carries no partner attribution — nothing to copy
      continue;
    }
    const existing = text(customer.partnerId);
    if (existing && existing !== sourcePartnerId) {
      conflicts.push({
        entity: 'customers', entityId: customer.id, sourceId: leadId,
        companyId: customer.companyId || lead.companyId || '',
        existingPartnerId: existing, sourcePartnerId,
        reason: 'customer_partner_mismatch',
      });
      continue;
    }
    customers.push({
      customerId: customer.id,
      leadId,
      companyId: customer.companyId || lead.companyId || '',
      partnerId: sourcePartnerId,
      partnerName: text(lead.partnerName) || undefined,
      alreadyOwned: existing === sourcePartnerId,
    });
  }

  // ── Projects ← customerId ──────────────────────────────────
  for (const project of activeProjects) {
    const customerId = text(project.customerId);
    if (!customerId) continue;
    const customer = customerById.get(customerId);
    if (!customer) {
      skipped += 1;
      continue;
    }
    if (customer.companyId && project.companyId && customer.companyId !== project.companyId) {
      conflicts.push({
        entity: 'projects', entityId: project.id, sourceId: customerId,
        companyId: project.companyId || customer.companyId || '',
        existingPartnerId: text(project.partnerId), sourcePartnerId: text(customer.partnerId),
        reason: 'cross_company',
      });
      continue;
    }
    const sourcePartnerId = text(customer.partnerId);
    if (!sourcePartnerId) {
      skipped += 1;
      continue;
    }
    const existing = text(project.partnerId);
    if (existing && existing !== sourcePartnerId) {
      conflicts.push({
        entity: 'projects', entityId: project.id, sourceId: customerId,
        companyId: project.companyId || customer.companyId || '',
        existingPartnerId: existing, sourcePartnerId,
        reason: 'project_partner_mismatch',
      });
      continue;
    }
    projects.push({
      projectId: project.id,
      customerId,
      companyId: project.companyId || customer.companyId || '',
      partnerId: sourcePartnerId,
      partnerName: text(customer.partnerName) || undefined,
      leadId: text(customer.sourceLeadId) || undefined,
      alreadyOwned: existing === sourcePartnerId,
    });
  }

  return {
    customers,
    projects,
    conflicts,
    summary: {
      leadsScanned: activeLeads.length,
      customersScanned: activeCustomers.length,
      projectsScanned: activeProjects.length,
      customersAlreadyOwned: customers.filter((c) => c.alreadyOwned).length,
      customersToBackfill: customers.filter((c) => !c.alreadyOwned).length,
      projectsAlreadyOwned: projects.filter((p) => p.alreadyOwned).length,
      projectsToBackfill: projects.filter((p) => !p.alreadyOwned).length,
      conflicts: conflicts.length,
      skipped,
    },
  };
}

/** Human-readable plan report (used by the CLI script). */
export function formatPartnerOwnershipBackfillSummary(plan: PartnerOwnershipBackfillPlan): string {
  const lines: string[] = [];
  lines.push('─ Partner ownership backfill plan ─');
  lines.push(`Leads scanned:      ${plan.summary.leadsScanned}`);
  lines.push(`Customers scanned:  ${plan.summary.customersScanned}`);
  lines.push(`Projects scanned:   ${plan.summary.projectsScanned}`);
  lines.push(`Customers already owned: ${plan.summary.customersAlreadyOwned}`);
  lines.push(`Customers to backfill:   ${plan.summary.customersToBackfill}`);
  lines.push(`Projects already owned:  ${plan.summary.projectsAlreadyOwned}`);
  lines.push(`Projects to backfill:    ${plan.summary.projectsToBackfill}`);
  lines.push(`Conflicts:           ${plan.summary.conflicts}`);
  lines.push(`Skipped (unresolvable): ${plan.summary.skipped}`);
  if (plan.conflicts.length > 0) {
    lines.push('Conflicts (never auto-written):');
    for (const c of plan.conflicts) {
      lines.push(`  - ${c.entity}/${c.entityId}: existing=${c.existingPartnerId} source=${c.sourcePartnerId} (${c.reason})`);
    }
  }
  if (plan.customers.length > 0) {
    lines.push('Customer candidates:');
    for (const c of plan.customers) {
      lines.push(`  ${c.alreadyOwned ? '[ok]' : '[!!]'} ${c.customerId} ← lead ${c.leadId} → ${c.partnerId} (${c.companyId})`);
    }
  }
  if (plan.projects.length > 0) {
    lines.push('Project candidates:');
    for (const p of plan.projects) {
      lines.push(`  ${p.alreadyOwned ? '[ok]' : '[!!]'} ${p.projectId} ← customer ${p.customerId} → ${p.partnerId} (${p.companyId})`);
    }
  }
  return lines.join('\n');
}
