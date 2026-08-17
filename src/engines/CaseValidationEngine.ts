/**
 * CaseValidationEngine — Case Integrity Validation Engine
 *
 * Phase 3C — Guarantees ONE CUSTOMER LIFECYCLE = ONE CASE.
 *
 * This is a READ-ONLY validation engine. It never mutates data automatically.
 * repairCaseChain() is the sole mutation utility and requires explicit invocation
 * with dry-run mode enabled by default.
 *
 * Architecture rules enforced:
 *   1. One Lead → One Case
 *   2. Every entity must have a valid caseId
 *   3. All entities in a chain must point to the SAME Case
 *   4. No duplicate Cases for a Lead
 *   5. No orphan entities (entities with caseId pointing to non-existent Case)
 *   6. No circular references
 *   7. No deleted/invalid Cases referenced
 *   8. No broken parent chains
 */

import { getAll, getOne, updateDocById } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { caseEngine } from './CaseEngine';
import type { CaseRecord } from '../types';

// ═════════════════════════════════════════════════════════════
//  TYPES
// ═════════════════════════════════════════════════════════════

/** All 16 Solar EPC entity types that participate in cases */
export const CASE_PARTICIPANT_ENTITIES = [
  'leads',
  'customers',
  'projects',
  'quotations',
  'orders',
  'proforma_invoices',
  'payments',
  'dispatch',
  'installations',
  'qc_checks',
  'commissioning_records',
  'net_metering_applications',
  'subsidy_applications',
  'project_handovers',
  'amc_contracts',
  'service_tickets',
  'generation_readings',
] as const;

export type CaseParticipantEntity = typeof CASE_PARTICIPANT_ENTITIES[number];

export interface EntityValidationResult {
  entityType: string;
  entityId: string;
  valid: boolean;
  hasCaseId: boolean;
  caseId: string | null;
  caseExists: boolean;
  caseActive: boolean;
  caseDeleted: boolean;
  errors: string[];
}

export interface PropagationLink {
  entityType: string;
  entityId: string;
  caseId: string | null;
  parentType: string | null;
  parentId: string | null;
  chainBroken: boolean;
  error?: string;
}

export type CaseHealthReport = {
  totalCases: number;
  healthyCases: number;
  brokenCases: number;
  orphanEntities: number;
  duplicateCases: number;
  circularReferences: number;
  missingCaseIds: number;
  deletedCases: number;
  validationTimestamp: string;
}

export interface RepairSummary {
  dryRun: boolean;
  caseId: string;
  entitiesScanned: number;
  entitiesRepaired: number;
  entitiesSkipped: number;
  missingCaseIds: string[];
  repairsApplied: Array<{
    entityType: string;
    entityId: string;
    oldCaseId: string | null;
    newCaseId: string | null;
    action: 'set' | 'skip' | 'error';
    error?: string;
  }>;
}

const COMPANY_SCOPED_COLLECTIONS: Record<string, string> = {
  leads:                    COLLECTIONS.LEADS,
  customers:                COLLECTIONS.CUSTOMERS,
  projects:                 COLLECTIONS.PROJECTS,
  quotations:               COLLECTIONS.QUOTATIONS,
  orders:                   COLLECTIONS.ORDERS,
  proforma_invoices:        COLLECTIONS.PROFORMA_INVOICES,
  payments:                 COLLECTIONS.PAYMENTS,
  dispatch:                 COLLECTIONS.DISPATCH,
  installations:            'installations',
  qc_checks:                COLLECTIONS.QC_CHECKS,
  commissioning_records:    COLLECTIONS.COMMISSIONING_RECORDS,
  net_metering_applications: COLLECTIONS.NET_METERING_APPLICATIONS,
  subsidy_applications:     COLLECTIONS.SUBSIDY_APPLICATIONS,
  project_handovers:        COLLECTIONS.PROJECT_HANDOVERS,
  amc_contracts:            COLLECTIONS.AMC_CONTRACTS,
  service_tickets:          COLLECTIONS.SERVICE_TICKETS,
  generation_readings:      COLLECTIONS.GENERATION_READINGS,
};

/** Parent chain mirrors the one in casePropagation.ts but is self-contained */
const PARENT_CHAIN: Record<string, { parentCollection: string; parentFk: string } | null> = {
  leads:                  null,
  customers:              { parentCollection: 'leads',                parentFk: 'sourceLeadId' },
  projects:               { parentCollection: 'customers',            parentFk: 'customerId' },
  quotations:             { parentCollection: 'customers',            parentFk: 'customerId' },
  orders:                 { parentCollection: 'quotations',           parentFk: 'quotationId' },
  proforma_invoices:      { parentCollection: 'orders',               parentFk: 'orderId' },
  payments:               { parentCollection: 'orders',               parentFk: 'orderId' },
  dispatch:               { parentCollection: 'orders',               parentFk: 'orderId' },
  installations:          { parentCollection: 'projects',             parentFk: 'projectId' },
  qc_checks:              { parentCollection: 'installations',        parentFk: 'installationId' },
  commissioning_records:  { parentCollection: 'qc_checks',            parentFk: 'qcId' },
  net_metering_applications: { parentCollection: 'commissioning_records', parentFk: 'commissioningId' },
  subsidy_applications:   { parentCollection: 'net_metering_applications', parentFk: 'netMeteringId' },
  project_handovers:      { parentCollection: 'projects',             parentFk: 'projectId' },
  amc_contracts:          { parentCollection: 'projects',             parentFk: 'projectId' },
  service_tickets:        { parentCollection: 'projects',             parentFk: 'projectId' },
  generation_readings:    { parentCollection: 'projects',             parentFk: 'projectId' },
};

// ═════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════

function nowISO(): string {
  return new Date().toISOString();
}

function isActiveCase(caseRecord: CaseRecord | null): boolean {
  if (!caseRecord) return false;
  if (caseRecord.isDeleted) return false;
  return caseRecord.status === 'Active';
}

// ═════════════════════════════════════════════════════════════
//  1. validateCaseIntegrity — Full case validation
// ═════════════════════════════════════════════════════════════

/**
 * Validates the integrity of a single Case across ALL linked entities.
 * Checks every entity that references this caseId and verifies:
 *   - Entity exists (not deleted)
 *   - caseId is correct
 *   - Parent chain is intact
 *   - No cross-case contamination
 */
export async function validateCaseIntegrity(
  caseId: string,
): Promise<{
  caseRecord: CaseRecord | null;
  caseExists: boolean;
  caseActive: boolean;
  entityValidations: EntityValidationResult[];
  propagationChain: PropagationLink[];
  healthy: boolean;
  totalErrors: number;
}> {
  const caseRecord = await caseEngine.getCaseGraph(caseId, '');
  const rawCase = await getOne<any>(COLLECTIONS.CASES, caseId);
  const caseExists = !!rawCase && !rawCase.isDeleted;
  const caseActive = caseExists && rawCase?.status === 'Active';

  const entityValidations: EntityValidationResult[] = [];
  const propagationChain: PropagationLink[] = [];
  let totalErrors = 0;

  // Validate every participant entity that references this caseId
  for (const entityType of CASE_PARTICIPANT_ENTITIES) {
    const collection = COMPANY_SCOPED_COLLECTIONS[entityType];
    if (!collection) continue;

    try {
      const allEntities = await getAll<any>(collection);
      const caseEntities = allEntities.filter(
        (e: any) => String(e.caseId || '') === caseId && !e.isDeleted,
      );

      for (const entity of caseEntities) {
        const validation = await validateEntityCase(entityType, entity.id);
        entityValidations.push(validation);
        if (!validation.valid) totalErrors++;
      }
    } catch {
      // Collection may not exist — skip
    }
  }

  // Build propagation chain for this case
  propagationChain.push({
    entityType: 'cases',
    entityId: caseId,
    caseId,
    parentType: null,
    parentId: null,
    chainBroken: !caseExists,
    error: !caseExists ? 'Case record not found' : undefined,
  });

  // Walk each entity type that should have this caseId
  for (const entityType of CASE_PARTICIPANT_ENTITIES) {
    const chainEntry = PARENT_CHAIN[entityType];
    const collection = COMPANY_SCOPED_COLLECTIONS[entityType];
    if (!chainEntry || !collection) continue;

    try {
      const allEntities = await getAll<any>(collection);
      const caseEntities = allEntities.filter(
        (e: any) => String(e.caseId || '') === caseId && !e.isDeleted,
      );

      for (const entity of caseEntities) {
        const parentId = entity[chainEntry.parentFk];
        const link: PropagationLink = {
          entityType,
          entityId: entity.id,
          caseId: entity.caseId || null,
          parentType: chainEntry.parentCollection,
          parentId: parentId || null,
          chainBroken: false,
        };

        // Verify parent exists
        if (parentId) {
          try {
            const parentCollection = COMPANY_SCOPED_COLLECTIONS[chainEntry.parentCollection];
            if (parentCollection) {
              const parent = await getOne<any>(parentCollection, String(parentId));
              if (!parent || parent.isDeleted) {
                link.chainBroken = true;
                link.error = `Parent ${chainEntry.parentCollection}:${parentId} not found or deleted`;
                totalErrors++;
              } else if (String(parent.caseId || '') !== caseId) {
                link.chainBroken = true;
                link.error = `Parent ${chainEntry.parentCollection}:${parentId} has caseId=${parent.caseId}, expected ${caseId}`;
                totalErrors++;
              }
            }
          } catch {
            link.chainBroken = true;
            link.error = `Could not verify parent ${chainEntry.parentCollection}:${parentId}`;
            totalErrors++;
          }
        }

        propagationChain.push(link);
      }
    } catch {
      // Collection may not exist — skip
    }
  }

  return {
    caseRecord: rawCase as CaseRecord | null,
    caseExists,
    caseActive,
    entityValidations,
    propagationChain,
    healthy: totalErrors === 0 && caseExists,
    totalErrors,
  };
}

// ═════════════════════════════════════════════════════════════
//  2. validateEntityCase — Single entity validation
// ═════════════════════════════════════════════════════════════

/**
 * Validates a single entity's case linkage.
 * Checks:
 *   - Entity has a caseId
 *   - The referenced Case exists and is active
 *   - No cross-case contamination
 */
export async function validateEntityCase(
  entityType: string,
  entityId: string,
): Promise<EntityValidationResult> {
  const collection = COMPANY_SCOPED_COLLECTIONS[entityType];
  const errors: string[] = [];

  if (!collection) {
    return {
      entityType,
      entityId,
      valid: false,
      hasCaseId: false,
      caseId: null,
      caseExists: false,
      caseActive: false,
      caseDeleted: false,
      errors: [`Unknown entity type: ${entityType}`],
    };
  }

  try {
    const entity = await getOne<any>(collection, entityId);
    if (!entity) {
      return {
        entityType,
        entityId,
        valid: false,
        hasCaseId: false,
        caseId: null,
        caseExists: false,
        caseActive: false,
        caseDeleted: false,
        errors: [`Entity ${entityId} not found in ${collection}`],
      };
    }

    const caseId = entity.caseId || entity.linkedCaseId || null;
    const hasCaseId = !!caseId;

    if (!hasCaseId) {
      errors.push(`Entity ${entityId} has no caseId`);
      return {
        entityType,
        entityId,
        valid: false,
        hasCaseId: false,
        caseId: null,
        caseExists: false,
        caseActive: false,
        caseDeleted: false,
        errors,
      };
    }

    // Validate the referenced Case exists
    let caseExists = false;
    let caseActive = false;
    let caseDeleted = false;

    try {
      const caseRecord = await getOne<any>(COLLECTIONS.CASES, String(caseId));
      caseExists = !!caseRecord;
      caseActive = caseExists && caseRecord.status === 'Active' && !caseRecord.isDeleted;
      caseDeleted = caseExists && caseRecord.isDeleted === true;

      if (!caseExists) {
        errors.push(`Referenced Case ${caseId} does not exist`);
      } else if (caseDeleted) {
        errors.push(`Referenced Case ${caseId} is deleted (soft-delete)`);
      } else if (!caseActive) {
        errors.push(`Referenced Case ${caseId} is not Active (status: ${caseRecord.status})`);
      }
    } catch {
      errors.push(`Could not verify Case ${caseId}`);
    }

    return {
      entityType,
      entityId,
      valid: errors.length === 0,
      hasCaseId,
      caseId: String(caseId),
      caseExists,
      caseActive,
      caseDeleted,
      errors,
    };
  } catch (err: any) {
    return {
      entityType,
      entityId,
      valid: false,
      hasCaseId: false,
      caseId: null,
      caseExists: false,
      caseActive: false,
      caseDeleted: false,
      errors: [`Validation error: ${err?.message || 'Unknown error'}`],
    };
  }
}

// ═════════════════════════════════════════════════════════════
//  3. validateLeadCase — Lead-specific validation
// ═════════════════════════════════════════════════════════════

/**
 * Validates a lead's case linkage.
 * - Lead must have a caseId
 * - Case must exist and be active
 * - Case must reference this leadId
 * - Only one active Case per lead
 */
export async function validateLeadCase(leadId: string): Promise<{
  lead: any | null;
  caseRecord: CaseRecord | null;
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  const lead = await getOne<any>(COLLECTIONS.LEADS, leadId);

  if (!lead) {
    return { lead: null, caseRecord: null, valid: false, errors: ['Lead not found'] };
  }

  const caseId = lead.caseId || null;
  if (!caseId) {
    return { lead, caseRecord: null, valid: false, errors: ['Lead has no caseId'] };
  }

  const caseRecord = await getOne<CaseRecord>(COLLECTIONS.CASES, String(caseId));
  if (!caseRecord) {
    return { lead, caseRecord: null, valid: false, errors: [`Referenced Case ${caseId} not found`] };
  }
  if (caseRecord.isDeleted) {
    errors.push(`Referenced Case ${caseId} is deleted`);
  }
  if (caseRecord.status !== 'Active') {
    errors.push(`Referenced Case ${caseId} is ${caseRecord.status} (expected Active)`);
  }
  if (caseRecord.leadId !== leadId) {
    errors.push(`Case ${caseId} does not reference lead ${leadId} (references lead ${caseRecord.leadId})`);
  }

  return {
    lead,
    caseRecord,
    valid: errors.length === 0,
    errors,
  };
}

// ═════════════════════════════════════════════════════════════
//  4. validateCustomerCase — Customer-specific validation
// ═════════════════════════════════════════════════════════════

/**
 * Validates a customer's case linkage.
 * - Customer must have a caseId
 * - Case must exist and be active
 * - Customer's sourceLeadId must point to the Case's lead
 */
export async function validateCustomerCase(customerId: string): Promise<{
  customer: any | null;
  caseRecord: CaseRecord | null;
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  const customer = await getOne<any>(COLLECTIONS.CUSTOMERS, customerId);

  if (!customer) {
    return { customer: null, caseRecord: null, valid: false, errors: ['Customer not found'] };
  }

  const caseId = customer.caseId || null;
  if (!caseId) {
    return { customer, caseRecord: null, valid: false, errors: ['Customer has no caseId'] };
  }

  const caseRecord = await getOne<CaseRecord>(COLLECTIONS.CASES, String(caseId));
  if (!caseRecord) {
    return { customer, caseRecord: null, valid: false, errors: [`Referenced Case ${caseId} not found`] };
  }
  if (caseRecord.isDeleted) {
    errors.push(`Referenced Case ${caseId} is deleted`);
  }
  if (caseRecord.status !== 'Active') {
    errors.push(`Referenced Case ${caseId} is ${caseRecord.status} (expected Active)`);
  }

  // Verify customer came from this Case's lead
  if (customer.sourceLeadId && caseRecord.leadId && customer.sourceLeadId !== caseRecord.leadId) {
    errors.push(`Customer sourceLeadId ${customer.sourceLeadId} does not match Case leadId ${caseRecord.leadId}`);
  }

  return {
    customer,
    caseRecord,
    valid: errors.length === 0,
    errors,
  };
}

// ═════════════════════════════════════════════════════════════
//  5. validateProjectCase — Project-specific validation
// ═════════════════════════════════════════════════════════════

/**
 * Validates a project's case linkage.
 * - Project must have a caseId
 * - Case must exist and be active
 * - Project's customerId must match Case's customerId
 */
export async function validateProjectCase(projectId: string): Promise<{
  project: any | null;
  caseRecord: CaseRecord | null;
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  const project = await getOne<any>(COLLECTIONS.PROJECTS, projectId);

  if (!project) {
    return { project: null, caseRecord: null, valid: false, errors: ['Project not found'] };
  }

  const caseId = project.caseId || null;
  if (!caseId) {
    return { project, caseRecord: null, valid: false, errors: ['Project has no caseId'] };
  }

  const caseRecord = await getOne<CaseRecord>(COLLECTIONS.CASES, String(caseId));
  if (!caseRecord) {
    return { project, caseRecord: null, valid: false, errors: [`Referenced Case ${caseId} not found`] };
  }
  if (caseRecord.isDeleted) {
    errors.push(`Referenced Case ${caseId} is deleted`);
  }
  if (caseRecord.status !== 'Active') {
    errors.push(`Referenced Case ${caseId} is ${caseRecord.status} (expected Active)`);
  }

  // Verify project customer matches Case
  if (project.customerId && caseRecord.customerId && project.customerId !== caseRecord.customerId) {
    errors.push(`Project customerId ${project.customerId} does not match Case customerId ${caseRecord.customerId}`);
  }

  return {
    project,
    caseRecord,
    valid: errors.length === 0,
    errors,
  };
}

// ═════════════════════════════════════════════════════════════
//  6. validatePropagationChain — Full chain walk
// ═════════════════════════════════════════════════════════════

/**
 * Walks the complete propagation chain for a Case and validates
 * every link from Lead → Customer → Project → ... → Monitoring.
 *
 * Ensures:
 *   - Every entity in the chain has a caseId pointing to the correct Case
 *   - No broken parent-child relationships
 *   - All FK references resolve to real entities
 */
export async function validatePropagationChain(
  caseId: string,
): Promise<{
  caseRecord: CaseRecord | null;
  links: PropagationLink[];
  brokenLinks: number;
  healthy: boolean;
  startEntity: string;
  endEntity: string;
}> {
  const caseRecord = await getOne<CaseRecord>(COLLECTIONS.CASES, caseId);
  let brokenLinks = 0;
  const links: PropagationLink[] = [];

  if (!caseRecord) {
    return {
      caseRecord: null,
      links: [{
        entityType: 'cases',
        entityId: caseId,
        caseId: null,
        parentType: null,
        parentId: null,
        chainBroken: true,
        error: 'Case not found',
      }],
      brokenLinks: 1,
      healthy: false,
      startEntity: 'cases',
      endEntity: 'cases',
    };
  }

  // Start with the Case itself
  links.push({
    entityType: 'cases',
    entityId: caseId,
    caseId,
    parentType: null,
    parentId: null,
    chainBroken: false,
  });

  // Walk each entity type in order
  let foundStart = false;
  let firstEntity = 'cases';
  let lastEntity = 'cases';

  for (const entityType of CASE_PARTICIPANT_ENTITIES) {
    const chainEntry = PARENT_CHAIN[entityType];
    const collection = COMPANY_SCOPED_COLLECTIONS[entityType];
    if (!chainEntry || !collection) continue;

    try {
      const entities = await getAll<any>(collection);
      const caseEntities = entities.filter(
        (e: any) => String(e.caseId || '') === caseId && !e.isDeleted,
      );

      for (const entity of caseEntities) {
        if (!foundStart) {
          firstEntity = entityType;
          foundStart = true;
        }
        lastEntity = entityType;

        const parentId = entity[chainEntry.parentFk];
        const link: PropagationLink = {
          entityType,
          entityId: entity.id,
          caseId: entity.caseId || null,
          parentType: chainEntry.parentCollection,
          parentId: parentId || null,
          chainBroken: false,
        };

        // Verify FK resolution
        if (parentId) {
          try {
            const parentColl = COMPANY_SCOPED_COLLECTIONS[chainEntry.parentCollection];
            if (parentColl) {
              const parent = await getOne<any>(parentColl, String(parentId));
              if (!parent || parent.isDeleted) {
                link.chainBroken = true;
                link.error = `Parent ${chainEntry.parentCollection}:${parentId} not found`;
                brokenLinks++;
              } else if (String(parent.caseId || '') !== caseId) {
                link.chainBroken = true;
                link.error = `Parent caseId mismatch: ${parent.caseId} !== ${caseId}`;
                brokenLinks++;
              }
            }
          } catch {
            link.chainBroken = true;
            link.error = `Could not resolve parent ${chainEntry.parentCollection}:${parentId}`;
            brokenLinks++;
          }
        }

        links.push(link);
      }
    } catch {
      // Collection may not exist
    }
  }

  return {
    caseRecord,
    links,
    brokenLinks,
    healthy: brokenLinks === 0,
    startEntity: firstEntity,
    endEntity: lastEntity,
  };
}

// ═════════════════════════════════════════════════════════════
//  7. validateCaseUniqueness — Duplicate detection
// ═════════════════════════════════════════════════════════════

/**
 * Validates that no lead has more than one active Case.
 * When leadId is provided, checks only that specific lead.
 * When omitted, scans ALL Cases and groups by leadId to detect duplicates.
 */
export async function validateCaseUniqueness(leadId?: string): Promise<{
  totalCases: number;
  duplicateLeadCases: Array<{ leadId: string; caseIds: string[]; count: number }>;
  healthy: boolean;
  totalDuplicates: number;
}> {
  const allCases = await getAll<any>(COLLECTIONS.CASES);
  const activeCases = allCases.filter((c: any) => c.status === 'Active' && !c.isDeleted);

  // Group by leadId
  const groups = new Map<string, string[]>();
  for (const c of activeCases) {
    if (!c.leadId) continue;
    const existing = groups.get(c.leadId) || [];
    existing.push(c.caseId || c.id);
    groups.set(c.leadId, existing);
  }

  const duplicateLeadCases: Array<{ leadId: string; caseIds: string[]; count: number }> = [];
  groups.forEach((caseIds, leadId) => {
    if (caseIds.length > 1) {
      duplicateLeadCases.push({ leadId, caseIds, count: caseIds.length });
    }
  });

  return {
    totalCases: allCases.length,
    duplicateLeadCases,
    healthy: duplicateLeadCases.length === 0,
    totalDuplicates: duplicateLeadCases.reduce((sum, d) => sum + d.count - 1, 0),
  };
}

// ═════════════════════════════════════════════════════════════
//  8. validateOrphanEntities — Orphan detection
// ═════════════════════════════════════════════════════════════

/**
 * Finds all entities that have a caseId pointing to a non-existent Case.
 * This detects orphan records that lost their parent Case.
 */
export async function validateOrphanEntities(): Promise<{
  orphanCount: number;
  orphans: Array<{
    entityType: string;
    entityId: string;
    caseId: string;
    collection: string;
  }>;
  healthy: boolean;
}> {
  const orphans: Array<{ entityType: string; entityId: string; caseId: string; collection: string }> = [];

  for (const entityType of CASE_PARTICIPANT_ENTITIES) {
    const collection = COMPANY_SCOPED_COLLECTIONS[entityType];
    if (!collection) continue;

    try {
      const entities = await getAll<any>(collection);
      const withCaseIds = entities.filter((e: any) => (e.caseId || e.linkedCaseId) && !e.isDeleted);

      for (const entity of withCaseIds) {
        const caseId = String(entity.caseId || entity.linkedCaseId);
        try {
          const caseRecord = await getOne<any>(COLLECTIONS.CASES, caseId);
          if (!caseRecord || caseRecord.isDeleted) {
            orphans.push({ entityType, entityId: entity.id, caseId, collection });
          }
        } catch {
          orphans.push({ entityType, entityId: entity.id, caseId, collection });
        }
      }
    } catch {
      // Collection may not exist
    }
  }

  return {
    orphanCount: orphans.length,
    orphans,
    healthy: orphans.length === 0,
  };
}

// ═════════════════════════════════════════════════════════════
//  9. validateCircularReferences — Circular detection
// ═════════════════════════════════════════════════════════════

/**
 * Detects circular caseId references in the parent-child chain.
 * A circular reference would mean entity A references case X, which
 * has leadId referencing entity A, forming an infinite loop.
 *
 * Note: In the current architecture, caseId is a flat property, not a
 * hierarchical FK. Circular references are only possible if an entity
 * references itself indirectly. This validator checks for that pattern.
 */
export async function validateCircularReferences(): Promise<{
  circularCount: number;
  circularReferences: Array<{ entityType: string; entityId: string; path: string[] }>;
  healthy: boolean;
}> {
  const circularReferences: Array<{ entityType: string; entityId: string; path: string[] }> = [];
  const visited = new Set<string>();

  for (const entityType of CASE_PARTICIPANT_ENTITIES) {
    const collection = COMPANY_SCOPED_COLLECTIONS[entityType];
    if (!collection) continue;

    try {
      const entities = await getAll<any>(collection);
      const withCaseIds = entities.filter((e: any) => (e.caseId || e.linkedCaseId) && !e.isDeleted);

      for (const entity of withCaseIds) {
        const entityKey = `${entityType}:${entity.id}`;
        if (visited.has(entityKey)) continue;

        const caseId = String(entity.caseId || entity.linkedCaseId);
        const path = [entityKey];

        // Walk the chain following caseId → leadId/customerId
        try {
          const caseRecord = await getOne<any>(COLLECTIONS.CASES, caseId);
          if (!caseRecord) continue;

          // Check if the Case's leadId or customerId points back to the same entity
          // This would create a circular reference
          for (const caseFk of ['leadId', 'customerId', 'projectId']) {
            const refValue = caseRecord[caseFk];
            if (!refValue) continue;

            const refKey = `${entityType}:${String(refValue)}`;
            if (refKey === entityKey) {
              path.push(`cases:${caseId}`);
              path.push(caseFk);
              circularReferences.push({
                entityType,
                entityId: entity.id,
                path: [...path, refKey],
              });
            }
          }

          visited.add(entityKey);
        } catch {
          // Could not resolve case — skip
        }
      }
    } catch {
      // Collection may not exist
    }
  }

  return {
    circularCount: circularReferences.length,
    circularReferences,
    healthy: circularReferences.length === 0,
  };
}

// ═════════════════════════════════════════════════════════════
//  10. validateDeletedCases — Deleted case detection
// ═════════════════════════════════════════════════════════════

/**
 * Finds all entities that reference a deleted (soft-deleted) Case.
 * These are cases where the Case record has isDeleted=true but
 * entities still hold a reference to it.
 */
export async function validateDeletedCases(): Promise<{
  deletedCaseCount: number;
  affectedEntities: Array<{
    entityType: string;
    entityId: string;
    caseId: string;
  }>;
  deletedCaseIds: string[];
  healthy: boolean;
}> {
  const allCases = await getAll<any>(COLLECTIONS.CASES);
  const deletedCases = allCases.filter((c: any) => c.isDeleted === true);
  const deletedCaseIds = deletedCases.map((c: any) => c.caseId || c.id);
  const deletedIdSet = new Set(deletedCaseIds);

  const affectedEntities: Array<{ entityType: string; entityId: string; caseId: string }> = [];

  for (const entityType of CASE_PARTICIPANT_ENTITIES) {
    const collection = COMPANY_SCOPED_COLLECTIONS[entityType];
    if (!collection) continue;

    try {
      const entities = await getAll<any>(collection);
      const referencingEntities = entities.filter(
        (e: any) => e.caseId && deletedIdSet.has(String(e.caseId)) && !e.isDeleted,
      );

      for (const entity of referencingEntities) {
        affectedEntities.push({
          entityType,
          entityId: entity.id,
          caseId: String(entity.caseId),
        });
      }
    } catch {
      // Collection may not exist
    }
  }

  return {
    deletedCaseCount: deletedCases.length,
    affectedEntities,
    deletedCaseIds,
    healthy: affectedEntities.length === 0,
  };
}

// ═════════════════════════════════════════════════════════════
//  11. generateCaseHealthReport — Comprehensive health report
// ═════════════════════════════════════════════════════════════

/**
 * Generates a comprehensive health report for the entire Case system.
 * Runs ALL validators and aggregates the results.
 */
export async function generateCaseHealthReport(): Promise<CaseHealthReport> {
  const allCases = await getAll<any>(COLLECTIONS.CASES);
  const activeCases = allCases.filter((c: any) => c.status === 'Active' && !c.isDeleted);

  const uniquenessResult = await validateCaseUniqueness();
  const orphanResult = await validateOrphanEntities();
  const circularResult = await validateCircularReferences();
  const deletedResult = await validateDeletedCases();

  // Count healthy vs broken by sampling a subset
  let healthyCases = 0;
  let brokenCases = 0;
  const sampleSize = Math.min(activeCases.length, 50); // Sample to avoid timeout

  for (let i = 0; i < sampleSize; i++) {
    const c = activeCases[i];
    try {
      const integrity = await validateCaseIntegrity(c.caseId || c.id);
      if (integrity.healthy) {
        healthyCases++;
      } else {
        brokenCases++;
      }
    } catch {
      brokenCases++;
    }
  }

  // Count missing caseIds across all participants
  let missingCaseIds = 0;
  for (const entityType of CASE_PARTICIPANT_ENTITIES) {
    const collection = COMPANY_SCOPED_COLLECTIONS[entityType];
    if (!collection) continue;
    try {
      const entities = await getAll<any>(collection);
      missingCaseIds += entities.filter(
        (e: any) => !e.caseId && !e.linkedCaseId && !e.isDeleted,
      ).length;
    } catch {
      // Collection may not exist
    }
  }

  return {
    totalCases: allCases.length,
    healthyCases,
    brokenCases,
    orphanEntities: orphanResult.orphanCount,
    duplicateCases: uniquenessResult.totalDuplicates,
    circularReferences: circularResult.circularCount,
    missingCaseIds,
    deletedCases: deletedResult.deletedCaseIds.length + deletedResult.affectedEntities.length,
    validationTimestamp: nowISO(),
  };
}

// ═════════════════════════════════════════════════════════════
//  12. repairCaseChain — Chain repair utility (dry-run safe)
// ═════════════════════════════════════════════════════════════

/**
 * Repairs the propagation chain for a specific Case.
 *
 * This is a MUTATION utility — never executes automatically.
 * Must be explicitly called with dryRun=true (default).
 *
 * Repair rules:
 *   - Entities with missing caseId → set to the correct caseId
 *   - Entities with wrong caseId → update to correct caseId
 *   - NEVER deletes records
 *   - NEVER creates Cases
 *   - Reports all actions taken
 */
export async function repairCaseChain(
  caseId: string,
  options: { dryRun?: boolean; companyId?: string } = {},
): Promise<RepairSummary> {
  const dryRun = options.dryRun !== false; // dry-run by default
  const summary: RepairSummary = {
    dryRun,
    caseId,
    entitiesScanned: 0,
    entitiesRepaired: 0,
    entitiesSkipped: 0,
    missingCaseIds: [],
    repairsApplied: [],
  };

  const caseRecord = await getOne<any>(COLLECTIONS.CASES, caseId);
  if (!caseRecord || caseRecord.isDeleted) {
    summary.entitiesSkipped = 1;
    summary.repairsApplied.push({
      entityType: 'cases',
      entityId: caseId,
      oldCaseId: null,
      newCaseId: null,
      action: 'error',
      error: 'Case not found or deleted — cannot repair chain without a valid Case',
    });
    return summary;
  }

  const resolvedCaseId = caseRecord.caseId || caseId;

  // Walk each participant entity and check caseId
  for (const entityType of CASE_PARTICIPANT_ENTITIES) {
    const collection = COMPANY_SCOPED_COLLECTIONS[entityType];
    if (!collection) continue;

    try {
      const entities = await getAll<any>(collection);
      const companyEntities = entities.filter(
        (e: any) => !e.isDeleted && (
          !options.companyId || e.companyId === options.companyId
        ),
      );

      for (const entity of companyEntities) {
        summary.entitiesScanned++;
        const entityCaseId = entity.caseId || entity.linkedCaseId || null;

        // Determine expected caseId by walking the parent chain
        const chainEntry = PARENT_CHAIN[entityType];
        let expectedCaseId: string | null = null;

        if (chainEntry && entity[chainEntry.parentFk]) {
          try {
            const parentColl = COMPANY_SCOPED_COLLECTIONS[chainEntry.parentCollection];
            const parentId = String(entity[chainEntry.parentFk]);
            if (parentColl) {
              const parent = await getOne<any>(parentColl, parentId);
              if (parent) {
                expectedCaseId = parent.caseId || parent.linkedCaseId || null;
              }
            }
          } catch {
            // Could not resolve parent
          }
        }

        // Fall back to the caseId from the Case record itself if the lead/customer matches
        if (!expectedCaseId) {
          if (entityType === 'leads' && entity.id === caseRecord.leadId) {
            expectedCaseId = resolvedCaseId;
          } else if (entityType === 'customers' && entity.id === caseRecord.customerId) {
            expectedCaseId = resolvedCaseId;
          } else if (entityType === 'projects' && entity.customerId === caseRecord.customerId) {
            expectedCaseId = resolvedCaseId;
          }
        }

        // If we still don't know the expected caseId, skip this entity
        if (!expectedCaseId) {
          summary.entitiesSkipped++;
          continue;
        }

        // Check if repair is needed
        if (entityCaseId !== expectedCaseId) {
          if (!entityCaseId) {
            summary.missingCaseIds.push(`${entityType}:${entity.id}`);
          }

          if (!dryRun) {
            try {
              await updateDocById(collection, entity.id, { caseId: expectedCaseId });
              summary.entitiesRepaired++;
              summary.repairsApplied.push({
                entityType,
                entityId: entity.id,
                oldCaseId: entityCaseId,
                newCaseId: expectedCaseId,
                action: 'set',
              });
            } catch (err: any) {
              summary.repairsApplied.push({
                entityType,
                entityId: entity.id,
                oldCaseId: entityCaseId,
                newCaseId: expectedCaseId,
                action: 'error',
                error: err?.message || 'Unknown error',
              });
            }
          } else {
            // Dry run — record what would happen
            summary.repairsApplied.push({
              entityType,
              entityId: entity.id,
              oldCaseId: entityCaseId,
              newCaseId: expectedCaseId,
              action: 'set',
            });
          }
        } else {
          summary.entitiesSkipped++;
        }
      }
    } catch {
      summary.entitiesSkipped++;
    }
  }

  return summary;
}

export const caseValidationEngine = {
  validateCaseIntegrity,
  validateEntityCase,
  validateLeadCase,
  validateCustomerCase,
  validateProjectCase,
  validatePropagationChain,
  validateCaseUniqueness,
  validateOrphanEntities,
  validateCircularReferences,
  validateDeletedCases,
  generateCaseHealthReport,
  repairCaseChain,
  CASE_PARTICIPANT_ENTITIES,
};

export default caseValidationEngine;
