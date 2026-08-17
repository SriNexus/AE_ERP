import {
  getCollectionForEntityType,
  getEntityLabel,
  type EntityRef,
  type EntityType,
} from './entityRegistry';

export type RelationshipType =
  | 'owns'
  | 'assigned_to'
  | 'reports_to'
  | 'converted_to'
  | 'originated_from'
  | 'placed_by'
  | 'contains'
  | 'generated'
  | 'paid_by'
  | 'dispatched_from'
  | 'moves_stock'
  | 'belongs_to'
  | 'created_by'
  | 'linked_to';

export type EntityRelationship = {
  from: EntityRef;
  to: EntityRef;
  relation: RelationshipType;
  metadata?: Record<string, unknown>;
};

type UnknownRecord = Record<string, unknown> | null | undefined;

type RelationshipRule = {
  field: string;
  targetType: EntityType;
  relation: RelationshipType;
  labelField?: string;
};

const RELATIONSHIP_RULES: Partial<Record<EntityType, RelationshipRule[]>> = {
  user: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'roleId', targetType: 'role', relation: 'belongs_to' },
    { field: 'managerId', targetType: 'user', relation: 'reports_to' },
    { field: 'employeeId', targetType: 'employee', relation: 'linked_to' },
    { field: 'warehouseId', targetType: 'warehouse', relation: 'belongs_to' },
  ],
  employee: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'userId', targetType: 'user', relation: 'linked_to' },
    { field: 'managerEmployeeId', targetType: 'employee', relation: 'reports_to' },
    { field: 'managerId', targetType: 'user', relation: 'reports_to' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  lead: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'assignedToId', targetType: 'user', relation: 'assigned_to', labelField: 'assignedToName' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
    { field: 'convertedCustomerId', targetType: 'customer', relation: 'converted_to' },
    { field: 'customerId', targetType: 'customer', relation: 'linked_to' },
  ],
  followup: [
    { field: 'leadId', targetType: 'lead', relation: 'belongs_to' },
    { field: 'customerId', targetType: 'customer', relation: 'belongs_to' },
    { field: 'assignedToId', targetType: 'user', relation: 'assigned_to', labelField: 'assignedToName' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  customer: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'assignedToId', targetType: 'user', relation: 'assigned_to', labelField: 'assignedToName' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
    { field: 'sourceLeadId', targetType: 'lead', relation: 'originated_from' },
  ],
  product: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'categoryId', targetType: 'product_category', relation: 'belongs_to' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  product_category: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'parentCategoryId', targetType: 'product_category', relation: 'belongs_to' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  warehouse: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'managerUserId', targetType: 'user', relation: 'assigned_to', labelField: 'managerName' },
    { field: 'managerId', targetType: 'user', relation: 'assigned_to', labelField: 'managerName' },
    { field: 'managerEmployeeId', targetType: 'employee', relation: 'assigned_to', labelField: 'managerName' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  stock: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'productId', targetType: 'product', relation: 'belongs_to', labelField: 'product' },
    { field: 'warehouseId', targetType: 'warehouse', relation: 'belongs_to', labelField: 'warehouse' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
    { field: 'updatedBy', targetType: 'user', relation: 'linked_to' },
  ],
  stock_ledger: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'productId', targetType: 'product', relation: 'moves_stock', labelField: 'product' },
    { field: 'warehouseId', targetType: 'warehouse', relation: 'belongs_to', labelField: 'warehouse' },
    { field: 'orderId', targetType: 'order', relation: 'linked_to' },
    { field: 'dispatchId', targetType: 'dispatch', relation: 'linked_to' },
    { field: 'customerId', targetType: 'customer', relation: 'linked_to' },
    { field: 'activityId', targetType: 'activity', relation: 'linked_to' },
    { field: 'performedBy', targetType: 'user', relation: 'created_by' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  order: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'customerId', targetType: 'customer', relation: 'placed_by', labelField: 'customer' },
    { field: 'warehouseId', targetType: 'warehouse', relation: 'dispatched_from' },
    { field: 'sourceQuotationId', targetType: 'quotation', relation: 'originated_from' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  order_item: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'orderId', targetType: 'order', relation: 'belongs_to' },
    { field: 'productId', targetType: 'product', relation: 'contains', labelField: 'product' },
  ],
  quotation: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'customerId', targetType: 'customer', relation: 'belongs_to', labelField: 'customer' },
    { field: 'leadId', targetType: 'lead', relation: 'originated_from' },
    { field: 'orderId', targetType: 'order', relation: 'linked_to' },
    { field: 'convertedOrderId', targetType: 'order', relation: 'converted_to' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  proforma_invoice: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'orderId', targetType: 'order', relation: 'generated' },
    { field: 'sourceOrderId', targetType: 'order', relation: 'generated' },
    { field: 'customerId', targetType: 'customer', relation: 'paid_by', labelField: 'customer' },
    { field: 'generatedBy', targetType: 'user', relation: 'created_by' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  pi_item: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'invoiceId', targetType: 'proforma_invoice', relation: 'belongs_to' },
    { field: 'proformaInvoiceId', targetType: 'proforma_invoice', relation: 'belongs_to' },
    { field: 'productId', targetType: 'product', relation: 'contains', labelField: 'product' },
  ],
  dispatch: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'orderId', targetType: 'order', relation: 'belongs_to' },
    { field: 'customerId', targetType: 'customer', relation: 'belongs_to', labelField: 'customer' },
    { field: 'warehouseId', targetType: 'warehouse', relation: 'dispatched_from', labelField: 'warehouse' },
    { field: 'transporterId', targetType: 'transport', relation: 'linked_to' },
    { field: 'verifiedBy', targetType: 'user', relation: 'linked_to' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  dispatch_item: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'dispatchId', targetType: 'dispatch', relation: 'belongs_to' },
    { field: 'productId', targetType: 'product', relation: 'moves_stock', labelField: 'product' },
  ],
  transport: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  payment: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'customerId', targetType: 'customer', relation: 'paid_by', labelField: 'customer' },
    { field: 'orderId', targetType: 'order', relation: 'belongs_to' },
    { field: 'invoiceId', targetType: 'proforma_invoice', relation: 'belongs_to' },
    { field: 'proformaInvoiceId', targetType: 'proforma_invoice', relation: 'belongs_to' },
    { field: 'receivedBy', targetType: 'user', relation: 'created_by' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  serial_number: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'productId', targetType: 'product', relation: 'belongs_to', labelField: 'product' },
    { field: 'warehouseId', targetType: 'warehouse', relation: 'belongs_to', labelField: 'warehouse' },
    { field: 'orderId', targetType: 'order', relation: 'linked_to' },
    { field: 'dispatchId', targetType: 'dispatch', relation: 'linked_to' },
    { field: 'stockLedgerId', targetType: 'stock_ledger', relation: 'linked_to' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  attendance: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'employeeId', targetType: 'employee', relation: 'belongs_to', labelField: 'employee' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  payroll: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'employeeId', targetType: 'employee', relation: 'belongs_to', labelField: 'employee' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  role: [
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  company: [
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
  activity: [
    { field: 'companyId', targetType: 'company', relation: 'belongs_to' },
    { field: 'userId', targetType: 'user', relation: 'created_by', labelField: 'userName' },
    { field: 'createdBy', targetType: 'user', relation: 'created_by' },
  ],
};

function asRecord(record: UnknownRecord): Record<string, unknown> {
  return record && typeof record === 'object' ? record : {};
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function arrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function pushUnique(refs: EntityRef[], ref: EntityRef): void {
  if (!refs.some((existing) => existing.type === ref.type && existing.id === ref.id)) {
    refs.push(ref);
  }
}

function getRecordId(record: UnknownRecord): string | undefined {
  return stringValue(asRecord(record).id);
}

function refFromRule(record: Record<string, unknown>, rule: RelationshipRule): EntityRef | undefined {
  const id = stringValue(record[rule.field]);
  if (!id) return undefined;

  const label = rule.labelField ? stringValue(record[rule.labelField]) : undefined;
  return makeEntityRef(rule.targetType, id, label);
}

function refsFromItems(items: Record<string, unknown>[]): EntityRef[] {
  const refs: EntityRef[] = [];
  for (const item of items) {
    const productId = stringValue(item.productId);
    if (productId) pushUnique(refs, makeEntityRef('product', productId, stringValue(item.product)));
  }
  return refs;
}

export function makeEntityRef(
  entityType: EntityType,
  id: string,
  label?: string,
  collection?: string
): EntityRef {
  const normalizedId = String(id ?? '').trim();
  const normalizedLabel = typeof label === 'string' && label.trim() ? label.trim() : undefined;
  return {
    type: entityType,
    id: normalizedId,
    ...(normalizedLabel ? { label: normalizedLabel } : {}),
    collection: collection ?? getCollectionForEntityType(entityType),
  };
}

export function makeRelationship(
  from: EntityRef,
  to: EntityRef,
  relation: RelationshipType,
  metadata?: Record<string, unknown>
): EntityRelationship {
  return {
    from,
    to,
    relation,
    ...(metadata ? { metadata } : {}),
  };
}

export function extractEntityRefsFromRecord(entityType: EntityType, record: UnknownRecord): EntityRef[] {
  const data = asRecord(record);
  const refs: EntityRef[] = [];
  const recordId = getRecordId(data);

  if (recordId) {
    pushUnique(refs, makeEntityRef(entityType, recordId, getEntityLabel(entityType, data)));
  }

  for (const rule of RELATIONSHIP_RULES[entityType] ?? []) {
    const ref = refFromRule(data, rule);
    if (ref) pushUnique(refs, ref);
  }

  for (const productRef of refsFromItems(arrayValue(data.items))) {
    pushUnique(refs, productRef);
  }

  return refs;
}

export function getRecommendedRelationships(entityType: EntityType, record: UnknownRecord): EntityRelationship[] {
  const data = asRecord(record);
  const recordId = getRecordId(data);
  if (!recordId) return [];

  const from = makeEntityRef(entityType, recordId, getEntityLabel(entityType, data));
  const relationships: EntityRelationship[] = [];

  for (const rule of RELATIONSHIP_RULES[entityType] ?? []) {
    const to = refFromRule(data, rule);
    if (to) relationships.push(makeRelationship(from, to, rule.relation, { field: rule.field }));
  }

  for (const productRef of refsFromItems(arrayValue(data.items))) {
    relationships.push(makeRelationship(from, productRef, 'contains', { field: 'items.productId' }));
  }

  const referenceId = stringValue(data.referenceId);
  const referenceType = stringValue(data.referenceType)?.toLowerCase();
  if (referenceId && entityType === 'stock_ledger') {
    if (referenceType?.includes('dispatch')) {
      relationships.push(makeRelationship(from, makeEntityRef('dispatch', referenceId), 'linked_to', { field: 'referenceId' }));
    } else if (referenceType?.includes('order')) {
      relationships.push(makeRelationship(from, makeEntityRef('order', referenceId), 'linked_to', { field: 'referenceId' }));
    } else {
      relationships.push(makeRelationship(from, makeEntityRef('activity', referenceId), 'linked_to', { field: 'referenceId' }));
    }
  }

  return relationships;
}
