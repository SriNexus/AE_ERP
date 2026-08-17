/**
 * casePropagation — Case creation and caseId propagation utilities
 *
 * Phase 3B — Auto Case Creation
 * Ensures: ONE CUSTOMER LIFECYCLE = ONE CASE
 *
 * Architecture:
 *   - Lead creation triggers automatic Case creation
 *   - Lead→Customer conversion propagates existing caseId
 *   - Customer→Project inherits caseId
 *   - All downstream entities inherit caseId via direct propagation
 *
 * Rules:
 *   - No duplicate Cases per lead (enforced by createCase validation)
 *   - No orphan entities (caseId always set when parent has it)
 *   - Immutable Case ownership (Case owns leadId + customerId)
 */

import { updateDocById, getOne } from './firestore';
import { COLLECTIONS } from './firebase';
import { caseEngine } from '../engines/CaseEngine';

// ── Collection name → entity type FK for chain traversal ───

type EntityCollection =
  | 'leads' | 'customers' | 'projects' | 'quotations' | 'orders'
  | 'proforma_invoices' | 'payments' | 'dispatch' | 'qc_checks'
  | 'commissioning_records' | 'net_metering_applications' | 'subsidy_applications'
  | 'project_handovers' | 'amc_contracts' | 'service_tickets' | 'generation_readings'
  | 'installations' | 'surveys' | 'engineering_designs'
  | 'purchase_orders' | 'goods_receipts' | 'tax_invoices' | 'registrations'
  | 'scheme_registrations';

/**
 * For each entity type, defines which parent entity type to check for caseId,
 * and the FK field on the entity itself that references the parent.
 */
const PARENT_CHAIN: Record<string, { parentCollection: string; parentFk: string } | null> = {
  leads:                  null, // Lead is the root — createCase from lead
  customers:              { parentCollection: 'leads',                parentFk: 'sourceLeadId' },
  projects:               { parentCollection: 'customers',            parentFk: 'customerId' },
  // Phase 16: loanApplicationWorkflow.ts's onLoanApplicationStatusChange() has
  // always called propagateCaseIdFromChain('registrations', registrationId)
  // on approval, but 'registrations' was never a key in this map — the
  // lookup silently returned null (propagateCaseIdFromChain's entityType
  // param is a plain `string`, so this compiled without error) and
  // The loan application's caseId was never actually populated. Its real
  // schema (loanApplicationWorkflow.ts) always carries customerId.
  registrations:          { parentCollection: 'customers',            parentFk: 'customerId' },
  // Phase 6: Channel Partner Vendor Lock / Scheme Registration — chains to
  // the Project (projectId), so it inherits the Project's existing caseId
  // exactly like project_handovers / amc_contracts / service_tickets.
  scheme_registrations:   { parentCollection: 'projects',             parentFk: 'projectId' },
  surveys:                { parentCollection: 'projects',             parentFk: 'projectId' },
  engineering_designs:    { parentCollection: 'projects',             parentFk: 'projectId' },
  quotations:             { parentCollection: 'customers',            parentFk: 'customerId' },
  orders:                 { parentCollection: 'quotations',           parentFk: 'quotationId' },
  proforma_invoices:      { parentCollection: 'orders',               parentFk: 'orderId' },
  payments:               { parentCollection: 'orders',               parentFk: 'orderId' },
  dispatch:               { parentCollection: 'orders',               parentFk: 'orderId' },
  installations:          { parentCollection: 'projects',             parentFk: 'projectId' },
  qc_checks:              { parentCollection: 'installations',        parentFk: 'installationId' },
  commissioning_records:  { parentCollection: 'qc_checks',            parentFk: 'qcId' },
  // Phase 11: NetMetering and Subsidy are independent, parallel tracks that
  // run off the Project directly once it reaches the NetMetering/Subsidy
  // stage (see netMeteringWorkflow.ts's own doc comment) — neither
  // createNetMeteringApplication() nor createSubsidyApplication() has ever
  // written a commissioningId/netMeteringId field (no such field exists on
  // either record's schema), so the previous two-hop chain entries below
  // could never resolve a parent, permanently breaking caseId propagation
  // for both. Fixed to chain directly to the Project via projectId, which
  // both records always have — matching project_handovers/amc_contracts/
  // service_tickets' already-correct pattern.
  net_metering_applications: { parentCollection: 'projects',           parentFk: 'projectId' },
  subsidy_applications:   { parentCollection: 'projects',              parentFk: 'projectId' },
  project_handovers:      { parentCollection: 'projects',             parentFk: 'projectId' },
  amc_contracts:          { parentCollection: 'projects',             parentFk: 'projectId' },
  service_tickets:        { parentCollection: 'projects',             parentFk: 'projectId' },
  generation_readings:    { parentCollection: 'projects',             parentFk: 'projectId' },
  purchase_orders:        { parentCollection: 'projects',             parentFk: 'projectId' },
  goods_receipts:         { parentCollection: 'purchase_orders',      parentFk: 'purchaseOrderId' },
  tax_invoices:           { parentCollection: 'proforma_invoices',    parentFk: 'sourcePiId' },
};

// ── Collection name → Firestore collection constant ────────

const COLLECTION_MAP: Record<string, string> = {
  leads:                  COLLECTIONS.LEADS,
  customers:              COLLECTIONS.CUSTOMERS,
  projects:               COLLECTIONS.PROJECTS,
  surveys:                COLLECTIONS.SURVEYS,
  engineering_designs:    COLLECTIONS.ENGINEERING_DESIGNS,
  quotations:             COLLECTIONS.QUOTATIONS,
  orders:                 COLLECTIONS.ORDERS,
  proforma_invoices:      COLLECTIONS.PROFORMA_INVOICES,
  payments:               COLLECTIONS.PAYMENTS,
  dispatch:               COLLECTIONS.DISPATCH,
  installations:          COLLECTIONS.INSTALLATIONS,
  qc_checks:              COLLECTIONS.QC_CHECKS,
  commissioning_records:  COLLECTIONS.COMMISSIONING_RECORDS,
  net_metering_applications: COLLECTIONS.NET_METERING_APPLICATIONS,
  subsidy_applications:   COLLECTIONS.SUBSIDY_APPLICATIONS,
  project_handovers:      COLLECTIONS.PROJECT_HANDOVERS,
  amc_contracts:          COLLECTIONS.AMC_CONTRACTS,
  service_tickets:        COLLECTIONS.SERVICE_TICKETS,
  generation_readings:    COLLECTIONS.GENERATION_READINGS,
  purchase_orders:        COLLECTIONS.PURCHASE_ORDERS,
  goods_receipts:         COLLECTIONS.GOODS_RECEIPTS,
  tax_invoices:           COLLECTIONS.TAX_INVOICES,
  registrations:          COLLECTIONS.LOAN_APPLICATIONS,
  scheme_registrations:   COLLECTIONS.SCHEME_REGISTRATIONS,
};

// ═════════════════════════════════════════════════════════════
//  CASE CREATION
// ═════════════════════════════════════════════════════════════

/**
 * Creates a Case for a newly created Lead and updates the lead with caseId.
 * Safe to call multiple times — skips if a Case already exists for this lead.
 */
export async function createCaseForLead(
  leadId: string,
  companyId: string,
): Promise<string | null> {
  try {
    const caseRecord = await caseEngine.createCase(leadId, companyId);
    // Update the lead with the new caseId
    await updateDocById(COLLECTIONS.LEADS, leadId, { caseId: caseRecord.caseId });
    return caseRecord.caseId;
  } catch (err: any) {
    // If an active Case already exists, propagate the existing caseId
    if (err?.message?.includes('already exists')) {
      const existingCase = await getExistingCaseForLead(leadId);
      if (existingCase) return existingCase;
    }
    console.warn(`[CasePropagation] Failed to create Case for lead ${leadId}:`, err?.message);
    return null;
  }
}

/**
 * Resolve an existing active Case for a lead.
 */
async function getExistingCaseForLead(leadId: string): Promise<string | null> {
  try {
    const { getOne } = await import('./firestore');
    const lead = await getOne<any>(COLLECTIONS.LEADS, leadId);
    if (lead?.caseId) return String(lead.caseId);
    return null;
  } catch {
    return null;
  }
}

// ═════════════════════════════════════════════════════════════
//  CASE ID PROPAGATION
// ═════════════════════════════════════════════════════════════

/**
 * Propagates caseId from a parent entity to a child entity.
 *
 * Example:
 *   propagateCaseId('customers', customerId, 'leads', sourceLeadId)
 *   → reads lead.caseId → writes customer.caseId
 *
 * Returns the propagated caseId, or null if no caseId found.
 */
export async function propagateCaseId(
  childEntityType: string,
  childEntityId: string,
  parentEntityType: string,
  parentEntityId: string,
): Promise<string | null> {
  if (!parentEntityId) return null;

  const parentCollection = COLLECTION_MAP[parentEntityType];
  const childCollection = COLLECTION_MAP[childEntityType];
  if (!parentCollection || !childCollection) return null;

  try {
    const parent = await getOne<any>(parentCollection, parentEntityId);
    // Check both caseId and linkedCaseId (for backward compatibility with existing data)
    const resolvedCaseId = parent?.caseId || parent?.linkedCaseId;
    if (resolvedCaseId) {
      await updateDocById(childCollection, childEntityId, { caseId: resolvedCaseId });
      return String(resolvedCaseId);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Propagates caseId by traversing the parent chain automatically.
 *
 * Given an entity type and ID, this walks up the PARENT_CHAIN to find
 * the nearest ancestor that has a caseId, then writes it to the entity.
 *
 * Example for a quotation:
 *   propagateCaseIdFromChain('quotations', quoteId)
 *   → quot.customerId → finds customer.caseId → writes quotation.caseId
 *
 * Returns the propagated caseId, or null if no caseId found in the chain.
 */
export async function propagateCaseIdFromChain(
  entityType: string,
  entityId: string,
): Promise<string | null> {
  const chainEntry = PARENT_CHAIN[entityType];
  if (!chainEntry) return null;

  const { parentCollection, parentFk } = chainEntry;

  try {
    const entity = await getOne<any>(COLLECTION_MAP[entityType], entityId);
    if (!entity) return null;

    const parentId = entity[parentFk];
    if (!parentId) return null;

    return propagateCaseId(entityType, entityId, parentCollection, String(parentId));
  } catch {
    return null;
  }
}

/**
 * Directly sets a caseId on an entity without doing a parent lookup.
 * Used when the caseId is already known (e.g., during lead conversion).
 */
export async function setCaseIdOnEntity(
  entityType: string,
  entityId: string,
  caseId: string,
): Promise<void> {
  const collection = COLLECTION_MAP[entityType];
  if (!collection) return;
  await updateDocById(collection, entityId, { caseId });
}

export default {
  createCaseForLead,
  propagateCaseId,
  propagateCaseIdFromChain,
  setCaseIdOnEntity,
};
