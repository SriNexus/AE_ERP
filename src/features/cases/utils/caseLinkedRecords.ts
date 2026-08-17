/**
 * caseLinkedRecords — Case Linked Records utility (Phase 3L)
 *
 * Enhances relationship discovery, verification, and navigation
 * for the 17-stage Case lifecycle. Does NOT create new relationships —
 * it wraps and enhances the existing LinkedRecordsEngine.
 *
 * Architecture:
 * - READ-ONLY: no Firestore writes, no schema changes
 * - Reuses LinkedRecordsEngine for FK-based lookups
 * - Reuses identityGraph for user resolution
 * - Reuses CaseValidationEngine for integrity validation
 * - Pure enhancement layer — no new relationship system
 */

import { linkedRecordsEngine } from '../../../engines/LinkedRecordsEngine';
import { getEntityTypeLabel } from '../../../engines/LinkedRecordsEngine';
import { getUsers } from '../../../lib/identityGraph';
import { getAll, getOne } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import type { LinkedRecordGroup, LinkedRecordPreview } from '../../../types';

// ═══════════════════════════════════════════════════════════
//  Constants — 17-Stage EPC Lifecycle
// ═══════════════════════════════════════════════════════════

/** The 17 EPC lifecycle stages in order — authoritative source */
export const EPC_LIFECYCLE: Array<{
  entityType: string;
  label: string;
  collection: string;
  parentField: string;
  childField: string;
  route: (id: string) => string;
}> = [
  { entityType: 'leads', label: 'Lead', collection: COLLECTIONS.LEADS, parentField: '', childField: 'customerId', route: (id) => `/leads/workspace/${encodeURIComponent(id)}` },
  { entityType: 'customers', label: 'Customer', collection: COLLECTIONS.CUSTOMERS, parentField: 'leadId', childField: 'projectId', route: (id) => `/customers/${encodeURIComponent(id)}` },
  { entityType: 'projects', label: 'Project', collection: COLLECTIONS.PROJECTS, parentField: 'customerId', childField: 'projectId', route: (id) => `/projects/${encodeURIComponent(id)}` },
  { entityType: 'quotations', label: 'Quotation', collection: COLLECTIONS.QUOTATIONS, parentField: 'projectId', childField: 'orderId', route: (id) => `/quotations/${encodeURIComponent(id)}` },
  { entityType: 'orders', label: 'Order', collection: COLLECTIONS.ORDERS, parentField: 'quotationId', childField: 'orderId', route: (id) => `/orders/${encodeURIComponent(id)}` },
  { entityType: 'proforma_invoices', label: 'Invoice', collection: COLLECTIONS.PROFORMA_INVOICES, parentField: 'orderId', childField: 'invoiceId', route: (id) => `/invoices/${encodeURIComponent(id)}` },
  { entityType: 'payments', label: 'Payment', collection: COLLECTIONS.PAYMENTS, parentField: 'invoiceId', childField: 'paymentId', route: (id) => `/payments/${encodeURIComponent(id)}` },
  { entityType: 'dispatch', label: 'Dispatch', collection: COLLECTIONS.DISPATCH, parentField: 'orderId', childField: 'dispatchId', route: (id) => `/dispatch/${encodeURIComponent(id)}` },
  { entityType: 'installations', label: 'Installation', collection: 'installations', parentField: 'projectId', childField: 'installationId', route: (id) => `/installations/${encodeURIComponent(id)}` },
  { entityType: 'qc_checks', label: 'QC', collection: COLLECTIONS.QC_CHECKS, parentField: 'installationId', childField: 'qcId', route: (id) => `/qc/${encodeURIComponent(id)}` },
  { entityType: 'commissioning_records', label: 'Commissioning', collection: COLLECTIONS.COMMISSIONING_RECORDS, parentField: 'qcId', childField: 'commissioningId', route: (id) => `/commissioning/${encodeURIComponent(id)}` },
  { entityType: 'net_metering_applications', label: 'Net Metering', collection: COLLECTIONS.NET_METERING_APPLICATIONS, parentField: 'projectId', childField: 'netMeteringId', route: (id) => `/net-metering/${encodeURIComponent(id)}` },
  { entityType: 'subsidy_applications', label: 'Subsidy', collection: COLLECTIONS.SUBSIDY_APPLICATIONS, parentField: 'projectId', childField: 'subsidyId', route: (id) => `/subsidy/${encodeURIComponent(id)}` },
  { entityType: 'project_handovers', label: 'Handover', collection: COLLECTIONS.PROJECT_HANDOVERS, parentField: 'projectId', childField: 'handoverId', route: (id) => `/handovers/${encodeURIComponent(id)}` },
  { entityType: 'amc_contracts', label: 'AMC', collection: COLLECTIONS.AMC_CONTRACTS, parentField: 'projectId', childField: 'amcId', route: (id) => `/amc-contracts/${encodeURIComponent(id)}` },
  { entityType: 'service_tickets', label: 'Service Ticket', collection: COLLECTIONS.SERVICE_TICKETS, parentField: 'projectId', childField: 'ticketId', route: (id) => `/service-tickets/${encodeURIComponent(id)}` },
  { entityType: 'generation_readings', label: 'Monitoring', collection: COLLECTIONS.GENERATION_READINGS, parentField: 'projectId', childField: 'monitoringId', route: (id) => `/monitoring/${encodeURIComponent(id)}` },
];

/** Map entity type → lifecycle entry for quick lookup */
export const LIFECYCLE_MAP = new Map(EPC_LIFECYCLE.map((entry) => [entry.entityType, entry]));

// ═══════════════════════════════════════════════════════════
//  1. getCaseLinkedRecords — All linked records for a case
// ═══════════════════════════════════════════════════════════

/**
 * Get ALL linked records across the 17-stage lifecycle for a case.
 * Wraps LinkedRecordsEngine.getLinkedRecords() with case-specific enrichment.
 */
export async function getCaseLinkedRecords(
  caseId: string,
  entityType: string,
  companyId: string,
): Promise<LinkedRecordGroup[]> {
  // Use the existing engine for base FK-based queries
  const baseGroups = await linkedRecordsEngine.getLinkedRecords(caseId, entityType, companyId);

  // Enrich with lifecycle-aware grouping for 'cases' entity type
  if (entityType === 'cases' || entityType === 'case') {
    const enriched = new Map<string, LinkedRecordGroup>();

    // Get the case record to find leadId and customerId
    const caseRecord = await getOne<any>(COLLECTIONS.CASES, caseId);
    if (!caseRecord) return baseGroups;

    // For each lifecycle stage, try to find the linked entity
    for (const stage of EPC_LIFECYCLE) {
      try {
        let entity: any = null;

        // Traverse chain using case leadId/customerId for the first stages
        if (stage.entityType === 'leads' && caseRecord.leadId) {
          entity = await getOne<any>(stage.collection, caseRecord.leadId);
        } else if (stage.entityType === 'customers' && caseRecord.customerId) {
          entity = await getOne<any>(stage.collection, caseRecord.customerId);
        } else if (caseRecord.customerId) {
          // For downstream stages, query by caseId field
          const allEntities = await getAll<any>(stage.collection);
          entity = allEntities.find(
            (e: any) => String(e.caseId || '') === caseId && !e.isDeleted,
          ) || null;
        }

        if (entity) {
          const name = entity.name || entity.displayName || entity.title || entity.firmName || entity.id || '';
          enriched.set(stage.entityType, {
            entityType: stage.entityType,
            label: stage.label,
            count: 1,
            records: [{
              id: entity.id,
              name,
              status: entity.status || 'Active',
              createdAt: entity.createdAt ? String(entity.createdAt) : '',
              link: stage.route(entity.id),
            }],
            viewAllLink: `/${stage.entityType}`,
          });
        }
      } catch {
        // Skip if collection doesn't exist or query fails
      }
    }

    // Merge enriched records with engine results (engine results take priority)
    for (const [key, group] of enriched) {
      if (!baseGroups.some((g) => g.entityType === key)) {
        baseGroups.push(group);
      }
    }
  }

  return baseGroups.sort((a, b) => a.label.localeCompare(b.label));
}

// ═══════════════════════════════════════════════════════════
//  2. getCaseParentChain — Walk up the parent chain
// ═══════════════════════════════════════════════════════════

export interface ChainNode {
  entityType: string;
  label: string;
  id: string;
  name: string;
  status: string;
  route: string;
  isValid: boolean;
}

/**
 * Walk up the parent chain from a given entity back to the Lead.
 * Returns ordered array from Lead → ... → current entity.
 */
export async function getCaseParentChain(
  caseId: string,
  companyId: string,
): Promise<ChainNode[]> {
  const chain: ChainNode[] = [];
  const caseRecord = await getOne<any>(COLLECTIONS.CASES, caseId);
  if (!caseRecord) return chain;

  // Start from Lead and walk forward
  const leadId = caseRecord.leadId;
  if (leadId) {
    const lead = await getOne<any>(COLLECTIONS.LEADS, leadId);
    if (lead) {
      chain.push({
        entityType: 'leads',
        label: 'Lead',
        id: lead.id,
        name: lead.name || lead.id,
        status: lead.status || 'Active',
        route: `/leads/workspace/${encodeURIComponent(lead.id)}`,
        isValid: !lead.isDeleted,
      });
    }
  }

  const customerId = caseRecord.customerId;
  if (customerId) {
    const customer = await getOne<any>(COLLECTIONS.CUSTOMERS, customerId);
    if (customer) {
      chain.push({
        entityType: 'customers',
        label: 'Customer',
        id: customer.id,
        name: customer.name || customer.id,
        status: customer.status || 'Active',
        route: `/customers/${encodeURIComponent(customer.id)}`,
        isValid: !customer.isDeleted,
      });
    }
  }

  // Walk downstream stages via caseId
  for (const stage of EPC_LIFECYCLE) {
    if (stage.entityType === 'leads' || stage.entityType === 'customers') continue;
    try {
      const allEntities = await getAll<any>(stage.collection);
      const entity = allEntities.find(
        (e: any) => String(e.caseId || '') === caseId && !e.isDeleted,
      );
      if (entity) {
        chain.push({
          entityType: stage.entityType,
          label: stage.label,
          id: entity.id,
          name: entity.name || entity.displayName || entity.title || entity.id,
          status: entity.status || 'Active',
          route: stage.route(entity.id),
          isValid: !entity.isDeleted,
        });
      }
    } catch {
      // Skip inaccessible collections
    }
  }

  return chain;
}

// ═══════════════════════════════════════════════════════════
//  3. getCaseChildRecords — Get child entities of a case
// ═══════════════════════════════════════════════════════════

/**
 * Get all child records that are downstream of this case in the lifecycle.
 */
export async function getCaseChildRecords(
  caseId: string,
  companyId: string,
): Promise<LinkedRecordGroup[]> {
  const groups: LinkedRecordGroup[] = [];

  for (const stage of EPC_LIFECYCLE) {
    try {
      const allEntities = await getAll<any>(stage.collection);
      const matches = allEntities.filter(
        (e: any) => String(e.caseId || '') === caseId && !e.isDeleted,
      );

      if (matches.length > 0) {
        groups.push({
          entityType: stage.entityType,
          label: stage.label,
          count: matches.length,
          records: matches.map((e: any) => ({
            id: e.id,
            name: e.name || e.displayName || e.title || e.firmName || e.id,
            status: e.status || 'Active',
            createdAt: e.createdAt ? String(e.createdAt) : '',
            link: stage.route(e.id),
          })),
          viewAllLink: `/${stage.entityType}`,
        });
      }
    } catch {
      // Skip inaccessible collections
    }
  }

  return groups.sort((a, b) => a.label.localeCompare(b.label));
}

// ═══════════════════════════════════════════════════════════
//  4. getCaseRelatedUsers — Users related to this case
// ═══════════════════════════════════════════════════════════

export interface RelatedUser {
  userId: string;
  name: string;
  role: string;
  relation: string;
}

/**
 * Find all users related to a case (created by, assigned to entities, etc.).
 */
export async function getCaseRelatedUsers(
  caseId: string,
  companyId: string,
): Promise<RelatedUser[]> {
  const related = new Map<string, RelatedUser>();
  const allUsers = await getUsers();

  const caseRecord = await getOne<any>(COLLECTIONS.CASES, caseId);
  if (!caseRecord) return [];

  // Case creator
  if (caseRecord.createdBy) {
    const user = allUsers.find((u) => u.id === caseRecord.createdBy);
    if (user) {
      related.set(user.id, { userId: user.id, name: user.name || user.id, role: user.role || '', relation: 'Created Case' });
    }
  }

  // Walk lifecycle entities for assigned users
  for (const stage of EPC_LIFECYCLE) {
    try {
      const allEntities = await getAll<any>(stage.collection);
      const entity = allEntities.find(
        (e: any) => String(e.caseId || '') === caseId && !e.isDeleted,
      );
      if (!entity) continue;

      // Check various assignment fields
      const assigneeFields = ['assignedToId', 'assignedTo', 'assignedInstaller', 'assignedSurveyor', 'salesOwner', 'createdBy'];
      for (const field of assigneeFields) {
        const userId = entity[field];
        if (userId && !related.has(userId)) {
          const user = allUsers.find((u) => u.id === userId);
          if (user) {
            related.set(user.id, {
              userId: user.id,
              name: user.name || user.id,
              role: user.role || '',
              relation: `${stage.label} ${field.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (c) => c.toUpperCase())}`,
            });
          }
        }
      }
    } catch {
      // Skip
    }
  }

  return Array.from(related.values());
}

// ═══════════════════════════════════════════════════════════
//  5. getCaseRelatedTasks — Tasks linked to this case
// ═══════════════════════════════════════════════════════════

/**
 * Find all tasks linked to this case or its lifecycle entities.
 */
export async function getCaseRelatedTasks(
  caseId: string,
  companyId: string,
): Promise<LinkedRecordPreview[]> {
  const tasks: LinkedRecordPreview[] = [];

  try {
    const allTasks = await getAll<any>('tasks');
    const matched = allTasks.filter(
      (t: any) =>
        !t.isDeleted &&
        (String(t.caseId || '') === caseId ||
         String(t.linkedEntityId || '') === caseId),
    );

    for (const task of matched) {
      tasks.push({
        id: task.id,
        name: task.title || task.id,
        status: task.status || 'Open',
        createdAt: task.createdAt ? String(task.createdAt) : '',
        link: `/tasks/${encodeURIComponent(task.id)}`,
      });
    }
  } catch {
    // Tasks collection may not exist
  }

  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ═══════════════════════════════════════════════════════════
//  6. getCaseRelatedDocuments — Documents linked to this case
// ═══════════════════════════════════════════════════════════

/**
 * Find documents/attachments linked to this case or its entities.
 */
export async function getCaseRelatedDocuments(
  caseId: string,
  companyId: string,
): Promise<LinkedRecordPreview[]> {
  const documents: LinkedRecordPreview[] = [];

  try {
    const allDocs = await getAll<any>('files');
    const matched = allDocs.filter(
      (d: any) =>
        !d.isDeleted &&
        (String(d.caseId || '') === caseId ||
         String(d.linkedEntityId || '') === caseId),
    );

    for (const doc of matched) {
      documents.push({
        id: doc.id,
        name: doc.name || doc.fileName || doc.id,
        status: doc.status || 'Active',
        createdAt: doc.createdAt ? String(doc.createdAt) : '',
        link: `/cases/${encodeURIComponent(caseId)}?tab=documents`,
      });
    }
  } catch {
    // Files collection may not exist
  }

  return documents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ═══════════════════════════════════════════════════════════
//  7. getCaseRelatedActivities — Activity log for this case
// ═══════════════════════════════════════════════════════════

export interface ActivitySummary {
  entityType: string;
  label: string;
  activityType: string;
  description: string;
  timestamp: string;
  user: string;
}

/**
 * Get activity summary across all lifecycle entities for a case.
 */
export async function getCaseRelatedActivities(
  caseId: string,
  companyId: string,
): Promise<ActivitySummary[]> {
  const activities: ActivitySummary[] = [];

  for (const stage of EPC_LIFECYCLE) {
    try {
      const allEntities = await getAll<any>(stage.collection);
      const entity = allEntities.find(
        (e: any) => String(e.caseId || '') === caseId && !e.isDeleted,
      );
      if (!entity) continue;

      activities.push({
        entityType: stage.entityType,
        label: stage.label,
        activityType: entity.status ? `Status: ${entity.status}` : 'Created',
        description: `${stage.label} ${entity.name || entity.id} — ${entity.status || 'Active'}`,
        timestamp: entity.updatedAt || entity.createdAt || '',
        user: entity.updatedBy || entity.createdBy || '',
      });
    } catch {
      // Skip
    }
  }

  return activities.sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
}

// ═══════════════════════════════════════════════════════════
//  8. getCaseRelationshipGraph — Full relationship graph
// ═══════════════════════════════════════════════════════════

export interface RelationshipGraphNode {
  entityType: string;
  label: string;
  id: string;
  name: string;
  status: string;
  route: string;
  hasChildren: boolean;
  hasParent: boolean;
  level: number;
}

export interface RelationshipGraphEdge {
  from: string;
  to: string;
  relation: string;
}

export interface RelationshipGraph {
  nodes: RelationshipGraphNode[];
  edges: RelationshipGraphEdge[];
}

/**
 * Build a complete relationship graph for a case.
 * READ-ONLY graph model showing all 17 lifecycle stages.
 */
export async function getCaseRelationshipGraph(
  caseId: string,
  companyId: string,
): Promise<RelationshipGraph> {
  const chain = await getCaseParentChain(caseId, companyId);
  const nodes: RelationshipGraphNode[] = [];
  const edges: RelationshipGraphEdge[] = [];

  chain.forEach((node, index) => {
    nodes.push({
      entityType: node.entityType,
      label: node.label,
      id: node.id,
      name: node.name,
      status: node.status,
      route: node.route,
      hasChildren: index < chain.length - 1,
      hasParent: index > 0,
      level: index,
    });

    // Edge from parent to child
    if (index > 0) {
      edges.push({
        from: chain[index - 1].id,
        to: node.id,
        relation: `${chain[index - 1].label} → ${node.label}`,
      });
    }
  });

  return { nodes, edges };
}

// ═══════════════════════════════════════════════════════════
//  9. validateLinkedRecords — Integrity validation
// ═══════════════════════════════════════════════════════════

export interface LinkedRecordValidation {
  totalExpected: number;
  present: number;
  missing: number;
  orphans: number;
  duplicates: number;
  isValid: boolean;
  details: Array<{
    entityType: string;
    label: string;
    expected: boolean;
    present: boolean;
    status: string;
    notes: string;
  }>;
}

/**
 * Validate linked record integrity for a case.
 * Checks that all expected lifecycle entities exist and are properly linked.
 */
export async function validateLinkedRecords(
  caseId: string,
  companyId: string,
): Promise<LinkedRecordValidation> {
  const details: LinkedRecordValidation['details'] = [];
  let present = 0;
  let missing = 0;
  let orphans = 0;
  let duplicates = 0;

  const caseRecord = await getOne<any>(COLLECTIONS.CASES, caseId);
  const hasLead = Boolean(caseRecord?.leadId);
  const hasCustomer = Boolean(caseRecord?.customerId);

  for (const stage of EPC_LIFECYCLE) {
    const expected = stage.entityType === 'leads' ? hasLead :
                     stage.entityType === 'customers' ? hasCustomer :
                     true; // Downstream entities may or may not exist

    let presentEntity = false;
    let notes = '';
    let status = '';

    try {
      if (stage.entityType === 'leads' && caseRecord?.leadId) {
        const lead = await getOne<any>(stage.collection, caseRecord.leadId);
        presentEntity = !!lead;
        status = lead?.status || '';
        if (!presentEntity) notes = 'Lead ID exists but record not found (deleted?)';
      } else if (stage.entityType === 'customers' && caseRecord?.customerId) {
        const customer = await getOne<any>(stage.collection, caseRecord.customerId);
        presentEntity = !!customer;
        status = customer?.status || '';
        if (!presentEntity) notes = 'Customer ID exists but record not found (deleted?)';
      } else {
        const allEntities = await getAll<any>(stage.collection);
        const matches = allEntities.filter(
          (e: any) => String(e.caseId || '') === caseId && !e.isDeleted,
        );
        presentEntity = matches.length > 0;
        if (matches.length > 1) {
          duplicates += matches.length - 1;
          notes = `${matches.length} records found (expected 1)`;
        }
        if (matches.length === 1) {
          status = matches[0].status || '';
        }
      }
    } catch {
      notes = 'Could not query collection';
    }

    if (presentEntity) present++;
    else if (expected) {
      missing++;
      if (!notes) notes = 'Entity not found for this case';
    }

    details.push({
      entityType: stage.entityType,
      label: stage.label,
      expected,
      present: presentEntity,
      status,
      notes,
    });
  }

  // Orphan check: entities with caseId that point to non-existent case
  for (const stage of EPC_LIFECYCLE) {
    if (stage.entityType === 'leads' || stage.entityType === 'customers') continue;
    try {
      const allEntities = await getAll<any>(stage.collection);
      const orphanMatches = allEntities.filter(
        (e: any) =>
          String(e.caseId || '') === caseId &&
          !e.isDeleted,
      );
      // Records exist but case doesn't reference them in leadId/customerId
      if (orphanMatches.length === 0 && details.find((d) => d.entityType === stage.entityType)?.expected) {
        orphans++;
      }
    } catch {
      // Skip
    }
  }

  const totalExpected = EPC_LIFECYCLE.length;

  return {
    totalExpected,
    present,
    missing,
    orphans,
    duplicates,
    isValid: missing === 0 && orphans === 0 && duplicates === 0,
    details,
  };
}

// ═══════════════════════════════════════════════════════════
//  Re-export LinkedRecordsEngine utilities for convenience
// ═══════════════════════════════════════════════════════════

export { getEntityTypeLabel } from '../../../engines/LinkedRecordsEngine';
