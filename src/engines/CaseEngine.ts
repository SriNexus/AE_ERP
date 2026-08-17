/**
 * CaseEngine — Case Engine Architecture (Section 6)
 *
 * Phase 0B: Full Firestore-backed implementation.
 *
 * Architecture rules:
 * - Case stores canonical leadId and customerId only
 * - Entity graph queries delegate to entity_relationships collection
 * - LinkedRecordsEngine is the owner of all entity relationships
 * - Stage transitions are forward-only (with QC → Installation rollback)
 * - One Case = One Truth for every business entity
 */

import { collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { createDocWithId, fromDoc, getOne, updateDocById, resolveWriteCompanyId } from '../lib/firestore';
import { logActivity } from '../lib/workflow';
import { sanitizeFirestoreData } from '../lib/sanitizer';
import { useAppStore } from '../store/useAppStore';
import type { CaseRecord } from '../types';

// ── Types ──────────────────────────────────────────────────

export type CaseStage =
  | 'New'
  | 'Survey'
  | 'Engineering'
  | 'Quotation'
  | 'Order'
  | 'Procurement'
  | 'Dispatch'
  | 'Installation'
  | 'QC'
  | 'Commissioning'
  | 'NetMetering'
  | 'Subsidy'
  | 'Handover'
  | 'AMC'
  | 'Service'
  | 'Closure';

export type CaseStatus = 'Active' | 'Completed' | 'Archived';

export interface CaseLinkValidation {
  valid: boolean;
  error?: string;
}

export interface CaseGraph {
  caseId: string;
  lead?: { id: string; status: string };
  customer?: { id: string; name: string };
  project?: { id: string; currentStage: string };
  quotations: Array<{ id: string; status: string; total?: number }>;
  orders: Array<{ id: string; status: string; total?: number }>;
  invoices: Array<{ id: string; status: string }>;
  dispatches: Array<{ id: string; status: string }>;
  serviceTickets: Array<{ id: string; status: string }>;
}

// ── Case ID Generation ─────────────────────────────────────

export function generateCaseId(): string {
  const now = new Date();
  const y = now.getFullYear().toString();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  const rnd = Math.random().toString(16).substring(2, 8).toUpperCase();
  return `CASE-${y}${m}${d}-${rnd}`;
}

// ── Stage Progression ──────────────────────────────────────

export const CASE_STAGE_ORDER: CaseStage[] = [
  'New', 'Survey', 'Engineering', 'Quotation', 'Order', 'Procurement',
  'Dispatch', 'Installation', 'QC', 'Commissioning', 'NetMetering',
  'Subsidy', 'Handover', 'AMC', 'Service', 'Closure',
];

export function getStageIndex(stage: CaseStage): number {
  return CASE_STAGE_ORDER.indexOf(stage);
}

export function canAdvanceStage(
  currentStage: CaseStage,
  targetStage: CaseStage,
): boolean {
  const currentIndex = getStageIndex(currentStage);
  const targetIndex = getStageIndex(targetStage);
  // Allow QC → Installation (failed QC loop back)
  if (currentStage === 'QC' && targetStage === 'Installation') return true;
  return targetIndex > currentIndex;
}

// ── Internal Helpers ───────────────────────────────────────

function nowUserId(): string {
  return useAppStore.getState().user?.id || 'system';
}

function resolveCompanyId(inputCompanyId?: string): string {
  if (inputCompanyId) return inputCompanyId;
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  // (activeCompanyId is 'default' post-logout until useGlobalBoot resolves it;
  // the old `activeCompanyId !== 'all'` branch returned that placeholder and
  // emitted where('companyId','==','default') reads → Admin 403 storm.)
  return resolveWriteCompanyId();
}

function stageHistoryEntry(stage: CaseStage, userId: string, note?: string) {
  return {
    stage,
    changedAt: new Date().toISOString(),
    changedBy: userId,
    note: note || '',
  };
}

async function fetchCaseById(caseId: string): Promise<CaseRecord | null> {
  return getOne<CaseRecord>(COLLECTIONS.CASES, caseId);
}

/**
 * Look up an entity in its collection by ID to get display data.
 * Returns null if the entity is not found or deleted.
 */
async function enrichEntity<T extends Record<string, unknown>>(
  collectionName: string,
  entityId: string,
): Promise<T | null> {
  try {
    const doc = await getOne<T>(collectionName, entityId);
    return doc && !(doc as any).isDeleted ? doc : null;
  } catch {
    return null;
  }
}

/**
 * Query the entity_relationships collection for all records
 * linked to a given entity (where the entity appears as either source or target).
 */
async function getRelationshipsForEntity(
  entityType: string,
  entityId: string,
  companyId: string,
): Promise<Array<{
  relationshipId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relation: string;
}>> {
  const results: Array<any> = [];

  try {
    // Query where entity is the source
    const sourceSnap = await getDocs(query(
      collection(db, COLLECTIONS.ENTITY_RELATIONSHIPS),
      where('companyId', '==', companyId),
      where('sourceId', '==', entityId),
      where('sourceType', '==', entityType),
      where('isDeleted', '==', false),
    ));
    sourceSnap.docs.forEach((d) => {
      const data = fromDoc<any>(d as any);
      results.push({
        relationshipId: data.id,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        targetType: data.targetType,
        targetId: data.targetId,
        relation: data.relation || 'linked_to',
      });
    });

    // Query where entity is the target
    const targetSnap = await getDocs(query(
      collection(db, COLLECTIONS.ENTITY_RELATIONSHIPS),
      where('companyId', '==', companyId),
      where('targetId', '==', entityId),
      where('targetType', '==', entityType),
      where('isDeleted', '==', false),
    ));
    targetSnap.docs.forEach((d) => {
      const data = fromDoc<any>(d as any);
      results.push({
        relationshipId: data.id,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        targetType: data.targetType,
        targetId: data.targetId,
        relation: data.relation || 'linked_to',
      });
    });
  } catch {
    // entity_relationships collection may not exist yet — return empty results
  }

  return results;
}

/**
 * Query the entity_relationships collection for all records
 * linked to a given Case (by caseId).
 */
async function getRelationshipsForCase(
  caseId: string,
  companyId: string,
): Promise<Array<{
  relationshipId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relation: string;
}>> {
  return getRelationshipsForEntity('cases', caseId, companyId);
}

// ── Engine Interface ──────────────────────────────────────

export interface CaseEngineAPI {
  /** Create a new Case from a Lead — customerId is optional at lead stage */
  createCase(leadId: string, companyId: string, customerId?: string): Promise<CaseRecord>;

  /** Validate a record link against the Case graph */
  validateLink(
    sourceEntityId: string,
    targetEntityId: string,
    linkType: string,
    caseId: string,
  ): Promise<CaseLinkValidation>;

  /** Advance a Case stage */
  advanceStage(
    caseId: string,
    toStage: CaseStage,
    userId: string,
    note?: string,
  ): Promise<void>;

  /** Get full Case graph (all linked records via entity_relationships) */
  getCaseGraph(caseId: string, companyId: string): Promise<CaseGraph>;

  /** Validate that a Case can be closed */
  validateClosure(caseId: string, companyId: string): Promise<CaseLinkValidation>;

  /** Get Case history */
  getCaseHistory(caseId: string, companyId: string): Promise<CaseRecord['stageHistory']>;

  /** Check if a stage transition is allowed */
  canAdvance(currentStage: CaseStage, targetStage: CaseStage): boolean;
}

// ── Full Implementation ────────────────────────────────────

async function createCase(
  leadId: string,
  companyId: string,
  customerId?: string,
): Promise<CaseRecord> {
  const id = generateCaseId();
  const userId = nowUserId();
  const resolvedCompanyId = resolveCompanyId(companyId);

  // Validate no active Case already exists for this lead
  const existingCases = await getDocs(query(
    collection(db, COLLECTIONS.CASES),
    where('companyId', '==', resolvedCompanyId),
    where('leadId', '==', leadId),
    where('isDeleted', '==', false),
  ));
  const activeCase = existingCases.docs
    .map((d) => fromDoc<CaseRecord>(d as any))
    .find((c) => c.status === 'Active');
  if (activeCase) {
    throw new Error(`An active Case (${activeCase.caseId}) already exists for this lead.`);
  }

  const now = new Date().toISOString();
  const initialStage: CaseStage = 'New';
  const record: CaseRecord = {
    id,
    caseId: id,
    companyId: resolvedCompanyId,
    leadId,
    customerId: customerId || undefined,
    currentStage: initialStage,
    status: 'Active',
    stageHistory: [stageHistoryEntry(initialStage, userId, 'Case created')],
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.CASES, id, sanitizeFirestoreData({
    ...record,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  void logActivity('Cases', 'Case Created', id, {
    actionLabel: `Case ${id} created`,
    entityName: id,
    leadId,
    customerId: customerId || '',
  });

  return record;
}

async function validateLink(
  sourceEntityId: string,
  targetEntityId: string,
  linkType: string,
  caseId: string,
): Promise<CaseLinkValidation> {
  const caseRecord = await fetchCaseById(caseId);
  if (!caseRecord) {
    return { valid: false, error: `Case ${caseId} not found.` };
  }

  if (caseRecord.isDeleted) {
    return { valid: false, error: `Case ${caseId} has been deleted.` };
  }

  if (caseRecord.status === 'Completed' || caseRecord.status === 'Archived') {
    return { valid: false, error: `Case ${caseId} is ${caseRecord.status}. Cannot link new records to a closed Case.` };
  }

  // Check that lead/customer belongs to this Case
  if (linkType === 'lead' && caseRecord.leadId && sourceEntityId !== caseRecord.leadId) {
    return { valid: false, error: `Source lead does not belong to Case ${caseId}.` };
  }
  if (linkType === 'customer' && caseRecord.customerId && sourceEntityId !== caseRecord.customerId) {
    return { valid: false, error: `Source customer does not belong to Case ${caseId}.` };
  }

  // Prevent cross-case linking: check entity_relationships to see if targetEntityId
  // is already linked to another active Case.
  if (targetEntityId && linkType !== 'lead' && linkType !== 'customer') {
    const relationships = await getRelationshipsForEntity(
      linkType,
      targetEntityId,
      caseRecord.companyId,
    );

    // Look for relationships that point to a different Case
    const linkedToOtherCase = relationships.some((rel) => {
      const isCaseRelationship = rel.sourceType === 'cases' || rel.targetType === 'cases';
      const otherCaseId = rel.sourceType === 'cases' ? rel.sourceId :
                          rel.targetType === 'cases' ? rel.targetId : null;
      return isCaseRelationship && otherCaseId && otherCaseId !== caseId;
    });

    if (linkedToOtherCase) {
      return { valid: false, error: 'Cross-case linking detected. Entity is already linked to another active Case.' };
    }
  }

  return { valid: true };
}

async function advanceStage(
  caseId: string,
  toStage: CaseStage,
  userId: string,
  note?: string,
): Promise<void> {
  const caseRecord = await fetchCaseById(caseId);
  if (!caseRecord) {
    throw new Error(`Case ${caseId} not found.`);
  }

  if (caseRecord.status !== 'Active') {
    throw new Error(`Cannot advance stage: Case ${caseId} is ${caseRecord.status}.`);
  }

  const currentStage = caseRecord.currentStage as CaseStage;
  if (!canAdvanceStage(currentStage, toStage)) {
    throw new Error(
      `Invalid stage transition: ${currentStage} → ${toStage}. ` +
      `QC → Installation rollback is allowed. All other transitions must go forward.`,
    );
  }

  const entry = stageHistoryEntry(toStage, userId, note);

  await updateDocById(COLLECTIONS.CASES, caseId, {
    currentStage: toStage,
    stageHistory: [...(caseRecord.stageHistory || []), entry],
    updatedAt: serverTimestamp(),
    updatedBy: userId,
  });

  void logActivity('Cases', 'Stage Advanced', caseId, {
    actionLabel: `Stage advanced: ${currentStage} → ${toStage}`,
    entityName: caseId,
    fromStage: currentStage,
    toStage,
    note,
  });
}

async function getCaseGraph(caseId: string, companyId: string): Promise<CaseGraph> {
  const resolvedCompanyId = resolveCompanyId(companyId);

  const graph: CaseGraph = {
    caseId,
    quotations: [],
    orders: [],
    invoices: [],
    dispatches: [],
    serviceTickets: [],
  };

  // 1. Get the Case record for canonical fields
  const caseRecord = await fetchCaseById(caseId);
  if (!caseRecord) return graph;

  // 2. Enrich lead data from canonical leadId
  if (caseRecord.leadId) {
    const leadDoc = await enrichEntity<any>(COLLECTIONS.LEADS, caseRecord.leadId);
    if (leadDoc) {
      graph.lead = { id: leadDoc.id, status: leadDoc.status || leadDoc.leadStatus || 'Unknown' };
    }
  }

  // 3. Enrich customer data from canonical customerId
  if (caseRecord.customerId) {
    const customerDoc = await enrichEntity<any>(COLLECTIONS.CUSTOMERS, caseRecord.customerId);
    if (customerDoc) {
      graph.customer = { id: customerDoc.id, name: customerDoc.name || customerDoc.displayName || 'Unknown' };
    }
  }

  // 4. Get project via entity_relationships or direct FK
  if (caseRecord.leadId) {
    const projectDoc = await enrichEntity<any>(COLLECTIONS.PROJECTS, caseRecord.leadId);
    // If the leadId corresponds to a project's leadId field
    try {
      const projectSnap = await getDocs(query(
        collection(db, COLLECTIONS.PROJECTS),
        where('companyId', '==', resolvedCompanyId),
        where('isDeleted', '==', false),
        where('leadId', '==', caseRecord.leadId),
      ));
      if (projectSnap.docs.length > 0) {
        const p = fromDoc<any>(projectSnap.docs[0] as any);
        graph.project = { id: p.id, currentStage: p.currentStage || 'New' };
      }
    } catch {
      // Non-critical
    }
  }

  // 5. Use entity_relationships to find all linked entities for this Case
  const relationships = await getRelationshipsForCase(caseId, resolvedCompanyId);

  for (const rel of relationships) {
    // Determine which side of the relationship is not the Case itself
    const linkedType = rel.sourceType === 'cases' ? rel.targetType : rel.sourceType;
    const linkedId = rel.sourceType === 'cases' ? rel.targetId : rel.sourceId;

    // Enrich with display data from the relevant collection
    const collectionMap: Record<string, string> = {
      leads: COLLECTIONS.LEADS,
      quotations: COLLECTIONS.QUOTATIONS,
      orders: COLLECTIONS.ORDERS,
      proforma_invoices: COLLECTIONS.PROFORMA_INVOICES,
      invoices: COLLECTIONS.PROFORMA_INVOICES,
      dispatch: COLLECTIONS.DISPATCH,
      service_tickets: COLLECTIONS.SERVICE_TICKETS,
    };

    const col = collectionMap[linkedType];
    if (!col) continue;

    const doc = await enrichEntity<any>(col, linkedId);
    if (!doc) continue;

    const status = doc.status || 'Unknown';
    switch (linkedType) {
      case 'lead':
        if (!graph.lead) graph.lead = { id: linkedId, status };
        break;
      case 'quotations':
        graph.quotations.push({ id: linkedId, status, total: doc.total });
        break;
      case 'orders':
        graph.orders.push({ id: linkedId, status, total: doc.total });
        break;
      case 'proforma_invoices':
      case 'invoices':
        graph.invoices.push({ id: linkedId, status });
        break;
      case 'dispatch':
        graph.dispatches.push({ id: linkedId, status });
        break;
      case 'service_tickets':
        graph.serviceTickets.push({ id: linkedId, status });
        break;
    }
  }

  return graph;
}

async function validateClosure(caseId: string, companyId: string): Promise<CaseLinkValidation> {
  const resolvedCompanyId = resolveCompanyId(companyId);
  const caseRecord = await fetchCaseById(caseId);
  if (!caseRecord) {
    return { valid: false, error: `Case ${caseId} not found.` };
  }

  if (caseRecord.status !== 'Active') {
    return { valid: false, error: `Case is already ${caseRecord.status}.` };
  }

  if (!caseRecord.customerId) {
    return { valid: false, error: 'Case must have a customer before closure.' };
  }

  const currentStageIdx = getStageIndex(caseRecord.currentStage as CaseStage);
  const handoverIdx = getStageIndex('Handover');

  // Must be at or past Handover to close
  if (currentStageIdx < handoverIdx) {
    return { valid: false, error: `Case must be at Handover stage or later to close. Current stage: ${caseRecord.currentStage}.` };
  }

  // Use entity_relationships-based graph for validation
  const graph = await getCaseGraph(caseId, resolvedCompanyId);

  // Check for unpaid orders
  const unpaidOrders = graph.orders.filter((o) => o.status !== 'Paid' && o.status !== 'Cancelled');
  if (unpaidOrders.length > 0) {
    return { valid: false, error: `${unpaidOrders.length} order(s) have unpaid balances. Resolve before closure.` };
  }

  // Check for open dispatches
  const openDispatches = graph.dispatches.filter(
    (d) => d.status !== 'Delivered' && d.status !== 'Closed' && d.status !== 'Cancelled',
  );
  if (openDispatches.length > 0) {
    return { valid: false, error: `${openDispatches.length} dispatch(s) are not yet delivered. Resolve before closure.` };
  }

  return { valid: true };
}

async function getCaseHistory(caseId: string, _companyId: string): Promise<CaseRecord['stageHistory']> {
  const caseRecord = await fetchCaseById(caseId);
  if (!caseRecord) return [];
  return caseRecord.stageHistory || [];
}

// ── Engine Export ────────────────────────────────────────────

export const caseEngine: CaseEngineAPI = {
  createCase,
  validateLink,
  advanceStage,
  getCaseGraph,
  validateClosure,
  getCaseHistory,
  canAdvance: canAdvanceStage,
};

export default caseEngine;
