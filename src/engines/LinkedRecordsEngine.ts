/**
 * LinkedRecordsEngine — Linked Records Engine (Section 8)
 *
 * Phase 0B: Full Firestore-backed implementation.
 *
 * Architecture:
 * - RELATIONSHIP_MAP is the authoritative source for entity relationship definitions
 * - Queries use the entity_relationships collection for the relationship graph
 * - Enriches linked record previews with display data from entity collections
 * - Permission-filtered results
 */

import { collection, getDocs, query, where } from 'firebase/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { fromDoc, getOne } from '../lib/firestore';
import { canDo } from '../lib/permissions';
import type { LinkedRecordGroup, LinkedRecordPreview } from '../types';

// ── Engine Interface ──────────────────────────────────────

export interface LinkedRecordsEngineAPI {
  /** Get all linked records for an entity, grouped by type */
  getLinkedRecords(
    entityId: string,
    entityType: string,
    companyId: string,
  ): Promise<LinkedRecordGroup[]>;

  /** Get count of linked records per entity type */
  getLinkedRecordCount(
    entityId: string,
    entityType: string,
    companyId: string,
  ): Promise<Record<string, number>>;

  /** Get a summary of the most recent/important linked records */
  getLinkedRecordSummary(
    entityId: string,
    entityType: string,
    companyId: string,
  ): Promise<Record<string, string>>;

  /** Resolve the entity type label for display */
  getEntityTypeLabel(entityType: string): string;
}

// ── Entity Type Labels ─────────────────────────────────────

const ENTITY_LABELS: Record<string, string> = {
  leads: 'Lead',
  customers: 'Customer',
  registrations: 'Loan Application',
  projects: 'Project',
  surveys: 'Survey',
  engineering_designs: 'Engineering Design',
  quotations: 'Quotation',
  orders: 'Order',
  proforma_invoices: 'Proforma Invoice',
  payments: 'Payment',
  purchase_orders: 'Purchase Order',
  goods_receipts: 'Goods Receipt',
  dispatch: 'Dispatch',
  stock: 'Stock',
  stock_ledger: 'Stock Ledger',
  products: 'Product',
  categories: 'Category',
  warehouses: 'Warehouse',
  vendors: 'Vendor',
  employees: 'Employee',
  installations: 'Installation',
  qc_checks: 'QC Check',
  commissioning_records: 'Commissioning Record',
  net_metering_applications: 'Net Metering',
  subsidy_applications: 'Subsidy',
  project_handovers: 'Handover',
  amc_contracts: 'AMC Contract',
  service_tickets: 'Service Ticket',
  generation_readings: 'Generation Reading',
  settlements: 'Settlement',
  channel_partners: 'Channel Partner',
  invoices: 'Invoice',
  tax_invoices: 'Tax Invoice',
  tasks: 'Task',
  users: 'User',
  roles: 'Role',
  companies: 'Company',
  settings: 'Settings',
  cases: 'Case',
  followups: 'Follow-up',
};

export function getEntityTypeLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Relationship Definitions ───────────────────────────────

/**
 * Defines which entity types are related to a given entity type
 * and how to query them (by foreign key or by Case ID).
 */
export interface RelationshipDef {
  /** The related entity type (module key) */
  entityType: string;
  /** Display label for the relationship group */
  label: string;
  /** The field on the related entity that references this entity */
  foreignKey?: string;
  /** If true, the relationship is derived from Case ID instead of a direct FK */
  viaCaseId?: boolean;
}

/**
 * Relationship map: key = entity type, value = array of relationship definitions.
 * This is the authoritative source of truth for the relationship graph (Section 8.1).
 */
export const RELATIONSHIP_MAP: Record<string, RelationshipDef[]> = {
  leads: [
    { entityType: 'followups', label: 'Follow-ups', foreignKey: 'leadId' },
    { entityType: 'quotations', label: 'Quotations', foreignKey: 'leadId' },
    { entityType: 'customers', label: 'Customer (Converted)', foreignKey: 'leadId' },
    { entityType: 'cases', label: 'Case', foreignKey: 'leadId' },
  ],
  customers: [
    { entityType: 'leads', label: 'Source Lead', foreignKey: 'customerId' },
    { entityType: 'registrations', label: 'Loan Applications', foreignKey: 'customerId' },
    { entityType: 'projects', label: 'Projects', foreignKey: 'customerId' },
    { entityType: 'quotations', label: 'Quotations', foreignKey: 'customerId' },
    { entityType: 'orders', label: 'Orders', foreignKey: 'customerId' },
    { entityType: 'service_tickets', label: 'Service Tickets', foreignKey: 'customerId' },
    { entityType: 'amc_contracts', label: 'AMC Contracts', foreignKey: 'customerId' },
    { entityType: 'cases', label: 'Case', foreignKey: 'customerId' },
    // Added — Customer Workspace Phase 4 (see the Phase 4 report §7): these
    // four were identified as missing in the Phase 2 Master Plan audit and
    // re-verified genuinely absent here before adding. Each foreignKey was
    // confirmed against its real write path before adding, not assumed:
    // dispatchWorkflow.ts / paymentWorkflow.ts / invoiceWorkflow.ts /
    // projectHandoverWorkflow.ts all write `customerId` directly.
    { entityType: 'dispatch', label: 'Dispatches', foreignKey: 'customerId' },
    { entityType: 'payments', label: 'Payments', foreignKey: 'customerId' },
    { entityType: 'invoices', label: 'Invoices', foreignKey: 'customerId' },
    { entityType: 'project_handovers', label: 'Project Handovers', foreignKey: 'customerId' },
  ],
  registrations: [
    { entityType: 'customers', label: 'Customer', foreignKey: 'customerId' },
    { entityType: 'leads', label: 'Source Lead', foreignKey: 'leadId' },
    { entityType: 'payments', label: 'Payments', foreignKey: 'registrationId' },
    { entityType: 'projects', label: 'Project', foreignKey: 'registrationId' },
    { entityType: 'cases', label: 'Case', foreignKey: 'caseId' },
  ],
  projects: [
    { entityType: 'surveys', label: 'Surveys', foreignKey: 'projectId' },
    { entityType: 'engineering_designs', label: 'Engineering Designs', foreignKey: 'projectId' },
    { entityType: 'quotations', label: 'Quotations', foreignKey: 'projectId' },
    { entityType: 'orders', label: 'Orders', foreignKey: 'projectId' },
    { entityType: 'registrations', label: 'Loan Application', foreignKey: 'projectId' },
    // Phase 10: the real, Project-scoped installations collection —
    // previously Installation data lived only on the Lead document with no
    // FK a Project's Linked Records could ever resolve.
    { entityType: 'installations', label: 'Installations', foreignKey: 'projectId' },
    { entityType: 'qc_checks', label: 'QC Checks', foreignKey: 'projectId' },
    { entityType: 'commissioning_records', label: 'Commissioning Records', foreignKey: 'projectId' },
    { entityType: 'net_metering_applications', label: 'Net Metering Applications', foreignKey: 'projectId' },
    { entityType: 'subsidy_applications', label: 'Subsidy Applications', foreignKey: 'projectId' },
    { entityType: 'project_handovers', label: 'Handovers', foreignKey: 'projectId' },
    { entityType: 'dispatch', label: 'Dispatches', viaCaseId: true },
    { entityType: 'amc_contracts', label: 'AMC Contracts', foreignKey: 'projectId' },
    { entityType: 'service_tickets', label: 'Service Tickets', viaCaseId: true },
    { entityType: 'generation_readings', label: 'Generation Readings', foreignKey: 'projectId' },
  ],
  quotations: [
    { entityType: 'leads', label: 'Source Lead', foreignKey: 'leadId' },
    { entityType: 'customers', label: 'Customer', foreignKey: 'customerId' },
    { entityType: 'orders', label: 'Linked Order', foreignKey: 'convertedOrderId' },
    { entityType: 'cases', label: 'Case', foreignKey: 'caseId' },
  ],
  orders: [
    { entityType: 'proforma_invoices', label: 'Proforma Invoices', foreignKey: 'orderId' },
    { entityType: 'payments', label: 'Payments', foreignKey: 'orderId' },
    { entityType: 'dispatch', label: 'Dispatches', foreignKey: 'orderId' },
    { entityType: 'tax_invoices', label: 'Tax Invoices', foreignKey: 'orderId' },
  ],
  vendors: [
    { entityType: 'purchase_orders', label: 'Purchase Orders', foreignKey: 'vendorId' },
    { entityType: 'goods_receipts', label: 'Goods Receipts', foreignKey: 'vendorId' },
  ],
  purchase_orders: [
    { entityType: 'vendors', label: 'Vendor', foreignKey: 'vendorId' },
    { entityType: 'goods_receipts', label: 'Goods Receipts', foreignKey: 'purchaseOrderId' },
  ],
  goods_receipts: [
    { entityType: 'vendors', label: 'Vendor', foreignKey: 'vendorId' },
    { entityType: 'purchase_orders', label: 'Purchase Order', foreignKey: 'purchaseOrderId' },
  ],
  invoices: [
    { entityType: 'payments', label: 'Payments', foreignKey: 'invoiceId' },
  ],
  products: [
    { entityType: 'stock', label: 'Stock Ledger', foreignKey: 'productId' },
  ],
  channel_partners: [
    { entityType: 'leads', label: 'Sourced Leads', foreignKey: 'partnerId' },
    { entityType: 'settlements', label: 'Settlements', foreignKey: 'partnerId' },
  ],
  categories: [
    { entityType: 'products', label: 'Products', foreignKey: 'categoryId' },
  ],
  cases: [
    { entityType: 'leads', label: 'Linked Leads', foreignKey: 'leadId' },
    { entityType: 'customers', label: 'Linked Customers', foreignKey: 'customerId' },
    { entityType: 'quotations', label: 'Quotations', foreignKey: 'caseId' },
    { entityType: 'orders', label: 'Orders', foreignKey: 'caseId' },
    { entityType: 'dispatch', label: 'Dispatches', foreignKey: 'caseId' },
    { entityType: 'service_tickets', label: 'Service Tickets', foreignKey: 'caseId' },
  ],
};

// ── Entity type → Firestore collection mapping ─────────────

const COLLECTION_NAME_MAP: Record<string, string> = {
  leads: COLLECTIONS.LEADS,
  customers: COLLECTIONS.CUSTOMERS,
  projects: COLLECTIONS.PROJECTS,
  surveys: COLLECTIONS.SURVEYS,
  engineering_designs: COLLECTIONS.ENGINEERING_DESIGNS,
  quotations: COLLECTIONS.QUOTATIONS,
  orders: COLLECTIONS.ORDERS,
  proforma_invoices: COLLECTIONS.PROFORMA_INVOICES,
  payments: COLLECTIONS.PAYMENTS,
  purchase_orders: COLLECTIONS.PURCHASE_ORDERS,
  goods_receipts: COLLECTIONS.GOODS_RECEIPTS,
  dispatch: COLLECTIONS.DISPATCH,
  stock: COLLECTIONS.STOCK,
  stock_ledger: COLLECTIONS.STOCK_LEDGER,
  products: COLLECTIONS.PRODUCTS,
  categories: COLLECTIONS.PRODUCT_CATEGORIES,
  warehouses: COLLECTIONS.WAREHOUSES,
  vendors: COLLECTIONS.VENDORS,
  employees: COLLECTIONS.EMPLOYEES,
  installations: COLLECTIONS.INSTALLATIONS,
  qc_checks: COLLECTIONS.QC_CHECKS,
  commissioning_records: COLLECTIONS.COMMISSIONING_RECORDS,
  net_metering_applications: COLLECTIONS.NET_METERING_APPLICATIONS,
  subsidy_applications: COLLECTIONS.SUBSIDY_APPLICATIONS,
  project_handovers: COLLECTIONS.PROJECT_HANDOVERS,
  amc_contracts: COLLECTIONS.AMC_CONTRACTS,
  service_tickets: COLLECTIONS.SERVICE_TICKETS,
  generation_readings: COLLECTIONS.GENERATION_READINGS,
  settlements: COLLECTIONS.SETTLEMENTS,
  channel_partners: COLLECTIONS.CHANNEL_PARTNERS,
  invoices: COLLECTIONS.PROFORMA_INVOICES,
  tax_invoices: COLLECTIONS.TAX_INVOICES,
  tasks: 'tasks',
  users: COLLECTIONS.USERS,
  roles: COLLECTIONS.ROLES,
  companies: COLLECTIONS.COMPANIES,
  cases: COLLECTIONS.CASES,
  followups: COLLECTIONS.FOLLOWUPS,
};

// ── Helper: Query entity_relationships for a given entity ────

interface RelationshipRow {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relation: string;
  createdAt?: string;
}

async function getEntityRelationships(
  entityType: string,
  entityId: string,
  companyId: string,
): Promise<RelationshipRow[]> {
  const results: RelationshipRow[] = [];

  try {
    // As source
    const sourceSnap = await getDocs(query(
      collection(db, COLLECTIONS.ENTITY_RELATIONSHIPS),
      where('companyId', '==', companyId),
      where('sourceId', '==', entityId),
      where('isDeleted', '==', false),
    ));
    sourceSnap.docs.forEach((d) => {
      const data = fromDoc<any>(d as any);
      results.push({
        id: data.id,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        targetType: data.targetType,
        targetId: data.targetId,
        relation: data.relation || 'linked_to',
        createdAt: data.createdAt,
      });
    });

    // As target
    const targetSnap = await getDocs(query(
      collection(db, COLLECTIONS.ENTITY_RELATIONSHIPS),
      where('companyId', '==', companyId),
      where('targetId', '==', entityId),
      where('isDeleted', '==', false),
    ));
    targetSnap.docs.forEach((d) => {
      const data = fromDoc<any>(d as any);
      results.push({
        id: data.id,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        targetType: data.targetType,
        targetId: data.targetId,
        relation: data.relation || 'linked_to',
        createdAt: data.createdAt,
      });
    });
  } catch {
    // Collection may not exist — return empty
  }

  return results;
}

// ── Helper: Enrich a linked ID into a preview ──────────────

async function enrichToPreview(
  collectionName: string,
  entityId: string,
  link: string,
): Promise<LinkedRecordPreview | null> {
  try {
    const doc = await getOne<any>(collectionName, entityId);
    if (!doc || doc.isDeleted) return null;

    const name = doc.name || doc.displayName || doc.title || doc.firmName || entityId;
    const status = doc.status || doc.leadStatus || 'Unknown';
    const createdAt = doc.createdAt ? String(doc.createdAt) : '';

    return { id: entityId, name, status, createdAt, link };
  } catch {
    return null;
  }
}

// ── Helper: Query directly by foreign key ──────────────────

async function queryByForeignKey(
  collectionName: string,
  foreignKey: string,
  entityId: string,
  companyId: string,
): Promise<Array<{ id: string; name: string; status: string; createdAt: string }>> {
  const results: Array<{ id: string; name: string; status: string; createdAt: string }> = [];

  try {
    const snap = await getDocs(query(
      collection(db, collectionName),
      where('companyId', '==', companyId),
      where(foreignKey, '==', entityId),
      where('isDeleted', '==', false),
    ));

    snap.docs.forEach((d) => {
      const data = fromDoc<any>(d as any);
      const name = data.name || data.displayName || data.title || data.firmName || d.id;
      results.push({
        id: d.id,
        name,
        status: data.status || 'Unknown',
        createdAt: data.createdAt ? String(data.createdAt) : '',
      });
    });
  } catch {
    // Query may fail if index doesn't exist
  }

  return results;
}

// ── Permission check helper ────────────────────────────────

const ENTITY_TYPE_TO_MODULE: Record<string, string> = {
  leads: 'leads',
  customers: 'customers',
  projects: 'projects',
  surveys: 'surveys',
  engineering_designs: 'engineering',
  quotations: 'quotations',
  orders: 'orders',
  invoices: 'invoices',
  proforma_invoices: 'invoices',
  dispatch: 'dispatch',
  payments: 'payments',
  stock: 'stock',
  products: 'products',
  categories: 'categories',
  warehouses: 'warehouses',
  employees: 'employees',
  service_tickets: 'service_tickets',
};

function hasPermissionForEntityType(entityType: string): boolean {
  const module = ENTITY_TYPE_TO_MODULE[entityType];
  if (!module) return true; // Unknown types default to visible
  // Bug fix (Phase 4 prerequisite — see Customer Workspace Phase 4 report):
  // this was previously `usePermissions().canView(...)`, a React hook called
  // from a plain async function outside any component render — an Invalid
  // Hook Call that threw "Cannot read properties of null (reading
  // 'useCallback')" the moment RELATIONSHIP_MAP had any entries for the
  // queried entityType (true for customers/leads/projects/etc., i.e. always
  // in practice). `canDo()` is the equivalent non-hook permission check
  // (reads useAppStore.getState() directly), already used this way elsewhere
  // in the codebase (e.g. lib/quotationWorkflow.ts).
  return canDo('view', module as any);
}

// ── Full Implementation ────────────────────────────────────

/**
 * Get all linked records for an entity, grouped by type.
 *
 * Uses two strategies in parallel:
 * 1. entity_relationships collection (for entities with explicit relationship records)
 * 2. FK-based queries from RELATIONSHIP_MAP (for entities without relationship records yet)
 */
async function getLinkedRecords(
  entityId: string,
  entityType: string,
  companyId: string,
): Promise<LinkedRecordGroup[]> {
  const groupMap = new Map<string, LinkedRecordGroup>();

  // Strategy 1: Query entity_relationships collection
  const relationships = await getEntityRelationships(entityType, entityId, companyId);
  for (const rel of relationships) {
    const linkedType = rel.sourceType === entityType ? rel.targetType : rel.sourceType;
    const linkedId = rel.sourceType === entityType ? rel.targetId : rel.sourceId;

    if (!linkedId || !linkedType) continue;
    if (!hasPermissionForEntityType(linkedType)) continue;

    const col = COLLECTION_NAME_MAP[linkedType];
    if (!col) continue;

    const label = getEntityTypeLabel(linkedType);
    const link = `/${linkedType}/${linkedId}`;

    const preview = await enrichToPreview(col, linkedId, link);
    if (!preview) continue;

    const existing = groupMap.get(linkedType);
    if (existing) {
      existing.records.push(preview);
      existing.count = existing.records.length;
    } else {
      groupMap.set(linkedType, {
        entityType: linkedType,
        label,
        count: 1,
        records: [preview],
        viewAllLink: `/${linkedType}`,
      });
    }
  }

  // Strategy 2: Use RELATIONSHIP_MAP for FK-based queries (supplemental)
  const defs = RELATIONSHIP_MAP[entityType];
  if (defs) {
    for (const def of defs) {
      if (!hasPermissionForEntityType(def.entityType)) continue;

      // Skip if already populated from entity_relationships
      if (groupMap.has(def.entityType)) continue;

      const col = COLLECTION_NAME_MAP[def.entityType];
      if (!col) continue;

      if (def.foreignKey && !def.viaCaseId) {
        const relatedDocs = await queryByForeignKey(col, def.foreignKey, entityId, companyId);
        if (relatedDocs.length === 0) continue;

        const link = `/${def.entityType}`;
        groupMap.set(def.entityType, {
          entityType: def.entityType,
          label: def.label,
          count: relatedDocs.length,
          records: relatedDocs.map((d) => ({ id: d.id, name: d.name, status: d.status, createdAt: d.createdAt, link: `/${def.entityType}/${d.id}` })),
          viewAllLink: link,
        });
      }
    }
  }

  // Convert map to array, sorted by label
  return Array.from(groupMap.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Get count of linked records per entity type.
 */
async function getLinkedRecordCount(
  entityId: string,
  entityType: string,
  companyId: string,
): Promise<Record<string, number>> {
  const groups = await getLinkedRecords(entityId, entityType, companyId);
  const counts: Record<string, number> = {};
  for (const group of groups) {
    counts[group.entityType] = group.count;
  }
  return counts;
}

/**
 * Get a summary of the most recent linked records per group.
 */
async function getLinkedRecordSummary(
  entityId: string,
  entityType: string,
  companyId: string,
): Promise<Record<string, string>> {
  const groups = await getLinkedRecords(entityId, entityType, companyId);
  const summary: Record<string, string> = {};

  for (const group of groups) {
    // Take the most recent record name as the summary
    const sorted = [...group.records].sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    summary[group.entityType] = sorted[0]?.name || group.label;
  }

  return summary;
}

// ── Engine Export ────────────────────────────────────────────

export const linkedRecordsEngine: LinkedRecordsEngineAPI = {
  getLinkedRecords,
  getLinkedRecordCount,
  getLinkedRecordSummary,
  getEntityTypeLabel,
};

export default linkedRecordsEngine;
