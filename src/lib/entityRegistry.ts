// Central ERP entity registry.
// This file is intentionally pure: no Firebase imports, no writes, no browser APIs.

export type EntityType =
  | 'company'
  | 'user'
  | 'role'
  | 'employee'
  | 'lead'
  | 'followup'
  | 'customer'
  | 'project'
  | 'survey'
  | 'engineering_design'
  | 'vendor'
  | 'purchase_order'
  | 'goods_receipt'
  | 'product'
  | 'product_category'
  | 'warehouse'
  | 'stock'
  | 'stock_ledger'
  | 'order'
  | 'order_item'
  | 'quotation'
  | 'proforma_invoice'
  | 'pi_item'
  | 'dispatch'
  | 'dispatch_item'
  | 'transport'
  | 'payment'
  | 'tax_invoice'
  | 'serial_number'
  | 'attendance'
  | 'payroll'
  | 'activity'
  | 'channel_partner'
  | 'partner_wallet_transaction'
  | 'commission_rule'
  | 'qc_check'
  | 'commissioning_record'
  | 'net_metering_application'
  | 'subsidy_application'
  | 'scheme_registration'
  | 'project_handover'
  | 'amc_contract'
  | 'service_ticket'
  | 'generation_reading'
  | 'settlement'
  // Phase 16: these 8 real collections (confirmed against scripts/demo/
  // config.ts's DEMO_RESETTABLE_COLLECTIONS, the authoritative production
  // collection inventory) had no registry entry at all — meaning
  // relationships.ts's linked/recommended-relationships logic (keyed off
  // EntityType) could never recognize a reference to any of them, and
  // getEntityLabel()/resolveOwnerId() fell back to a bare id wherever one of
  // these needed a generic display label (e.g. activity.ts's audit trail).
  | 'installation'
  | 'document'
  | 'commission_record'
  | 'notification'
  | 'task'
  | 'entity_relationship'
  | 'bank'
  | 'registration'
  | 'master_entity'
  // Phase 21: 'cases' (CaseEngine.createCase()) was found missing entirely
  // from DEMO_RESETTABLE_COLLECTIONS during a live-Firestore audit — fixing
  // that surfaced this registry gap too (phase16EntityRegistryCoverage.test.ts
  // requires every resettable, labelable collection to have an entry).
  | 'case';

export type EntityModule =
  | 'dashboard'
  | 'projects'
  | 'surveys'
  | 'engineering'
  | 'vendors'
  | 'purchase_orders'
  | 'leads'
  | 'customers'
  | 'orders'
  | 'quotations'
  | 'invoices'
  | 'products'
  | 'categories'
  | 'stock'
  | 'dispatch'
  | 'payments'
  | 'reports'
  | 'employees'
  | 'attendance'
  | 'payroll'
  | 'warehouses'
  | 'users'
  | 'roles'
  | 'companies'
  | 'settings'
  | 'channel_partner'
  | 'qc'
  | 'commissioning'
  | 'net_metering'
  | 'subsidy'
  | 'tax_invoices'
  | 'project_handover'
  | 'service_tickets'
  | 'installations'
  | 'documents'
  | 'notifications'
  | 'tasks'
  | 'banks'
  | 'loan_applications'
  | 'scheme_registration'
  | 'entities'
  | 'cases';

export type EntityRef = {
  type: EntityType;
  id: string;
  label?: string;
  collection?: string;
};

export type EntityRegistryEntry = {
  collectionName: string;
  entityType: EntityType;
  module: EntityModule;
  isGlobal: boolean;
  labelFields: string[];
  ownerFields: string[];
  companyScoped: boolean;
  primaryDateField: string;
};

type UnknownRecord = Record<string, unknown> | null | undefined;

export const ENTITY_REGISTRY: readonly EntityRegistryEntry[] = [
  {
    collectionName: 'users',
    entityType: 'user',
    module: 'users',
    isGlobal: true,
    labelFields: ['name', 'email', 'phone', 'id'],
    ownerFields: ['id'],
    companyScoped: false,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'companies',
    entityType: 'company',
    module: 'companies',
    isGlobal: true,
    labelFields: ['shortName', 'name', 'companyCode', 'id'],
    ownerFields: ['createdBy'],
    companyScoped: false,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'leads',
    entityType: 'lead',
    module: 'leads',
    isGlobal: false,
    labelFields: ['name', 'company', 'phone', 'email', 'id'],
    ownerFields: ['ownerId', 'assignedToId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'followups',
    entityType: 'followup',
    module: 'leads',
    isGlobal: false,
    labelFields: ['note', 'leadId', 'customerId', 'id'],
    ownerFields: ['ownerId', 'assignedToId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'next_date',
  },
  {
    collectionName: 'customers',
    entityType: 'customer',
    module: 'customers',
    isGlobal: false,
    labelFields: ['name', 'company', 'phone', 'email', 'id'],
    ownerFields: ['ownerId', 'assignedToId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'projects',
    entityType: 'project',
    module: 'projects',
    isGlobal: false,
    labelFields: ['projectId', 'customerId', 'id'],
    ownerFields: ['salesOwner', 'assignedSurveyor', 'assignedInstaller', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'surveys',
    entityType: 'survey',
    module: 'surveys',
    isGlobal: false,
    labelFields: ['surveyId', 'projectId', 'id'],
    ownerFields: ['surveyorId', 'assignedSurveyor', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'scheduledDate',
  },
  {
    collectionName: 'engineering_designs',
    entityType: 'engineering_design',
    module: 'engineering',
    isGlobal: false,
    labelFields: ['designId', 'projectId', 'surveyId', 'id'],
    ownerFields: ['designerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'vendors',
    entityType: 'vendor',
    module: 'vendors',
    isGlobal: false,
    labelFields: ['name', 'gstin', 'vendorId', 'id'],
    ownerFields: ['createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'purchase_orders',
    entityType: 'purchase_order',
    module: 'purchase_orders',
    isGlobal: false,
    labelFields: ['purchaseOrderId', 'vendorName', 'id'],
    ownerFields: ['createdBy'],
    companyScoped: true,
    primaryDateField: 'orderDate',
  },
  {
    collectionName: 'goods_receipts',
    entityType: 'goods_receipt',
    module: 'purchase_orders',
    isGlobal: false,
    labelFields: ['goodsReceiptId', 'purchaseOrderId', 'vendorName', 'id'],
    ownerFields: ['receivedBy', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'receivedDate',
  },
  {
    collectionName: 'products',
    entityType: 'product',
    module: 'products',
    isGlobal: false,
    labelFields: ['name', 'sku', 'id'],
    ownerFields: ['ownerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'product_categories',
    entityType: 'product_category',
    module: 'categories',
    isGlobal: false,
    labelFields: ['name', 'parentCategory', 'id'],
    ownerFields: ['ownerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'warehouses',
    entityType: 'warehouse',
    module: 'warehouses',
    isGlobal: false,
    labelFields: ['name', 'code', 'city', 'id'],
    ownerFields: ['ownerId', 'managerUserId', 'managerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'stock',
    entityType: 'stock',
    module: 'stock',
    isGlobal: false,
    labelFields: ['product', 'productId', 'warehouse', 'warehouseId', 'id'],
    ownerFields: ['ownerId', 'updatedBy', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'last_updated',
  },
  {
    collectionName: 'stock_ledger',
    entityType: 'stock_ledger',
    module: 'stock',
    isGlobal: false,
    labelFields: ['product', 'productId', 'reference', 'referenceId', 'id'],
    ownerFields: ['ownerId', 'performedBy', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'date',
  },
  {
    collectionName: 'orders',
    entityType: 'order',
    module: 'orders',
    isGlobal: false,
    labelFields: ['orderNumber', 'id', 'customer'],
    ownerFields: ['ownerId', 'assignedToId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'date',
  },
  {
    collectionName: 'order_items',
    entityType: 'order_item',
    module: 'orders',
    isGlobal: false,
    labelFields: ['product', 'productId', 'orderId', 'id'],
    ownerFields: ['ownerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'proforma_invoices',
    entityType: 'proforma_invoice',
    module: 'invoices',
    isGlobal: false,
    labelFields: ['invoiceNumber', 'id', 'customer'],
    ownerFields: ['ownerId', 'generatedBy', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'date',
  },
  {
    collectionName: 'tax_invoices',
    entityType: 'tax_invoice',
    module: 'tax_invoices',
    isGlobal: false,
    labelFields: ['invoiceNumber', 'orderId', 'customerName', 'id'],
    ownerFields: ['createdBy', 'issuedBy', 'cancelledBy'],
    companyScoped: true,
    primaryDateField: 'date',
  },
  {
    collectionName: 'pi_items',
    entityType: 'pi_item',
    module: 'invoices',
    isGlobal: false,
    labelFields: ['product', 'productId', 'invoiceId', 'proformaInvoiceId', 'id'],
    ownerFields: ['ownerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'quotations',
    entityType: 'quotation',
    module: 'quotations',
    isGlobal: false,
    labelFields: ['quotationNumber', 'id', 'customer'],
    ownerFields: ['ownerId', 'assignedToId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'date',
  },
  {
    collectionName: 'dispatch',
    entityType: 'dispatch',
    module: 'dispatch',
    isGlobal: false,
    labelFields: ['id', 'customer', 'vehicleNo', 'lrNumber'],
    ownerFields: ['ownerId', 'assignedToId', 'verifiedBy', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'date',
  },
  {
    collectionName: 'dispatch_items',
    entityType: 'dispatch_item',
    module: 'dispatch',
    isGlobal: false,
    labelFields: ['product', 'productId', 'dispatchId', 'id'],
    ownerFields: ['ownerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'transport',
    entityType: 'transport',
    module: 'dispatch',
    isGlobal: false,
    labelFields: ['name', 'transporter', 'vehicleNo', 'driverName', 'id'],
    ownerFields: ['ownerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'payments',
    entityType: 'payment',
    module: 'payments',
    isGlobal: false,
    labelFields: ['id', 'customer', 'reference', 'orderId'],
    ownerFields: ['ownerId', 'receivedBy', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'date',
  },
  {
    collectionName: 'serial_numbers',
    entityType: 'serial_number',
    module: 'stock',
    isGlobal: false,
    labelFields: ['serialNumber', 'barcode', 'product', 'productId', 'id'],
    ownerFields: ['ownerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'cases',
    entityType: 'case',
    module: 'cases',
    isGlobal: false,
    labelFields: ['caseId', 'id'],
    ownerFields: ['createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'audit_logs',
    entityType: 'activity',
    module: 'reports',
    isGlobal: true,
    labelFields: ['message', 'action', 'module', 'entityId', 'id'],
    ownerFields: ['userId', 'createdBy'],
    companyScoped: false,
    primaryDateField: 'occurredAt',
  },
  {
    collectionName: 'employees',
    entityType: 'employee',
    module: 'employees',
    isGlobal: false,
    labelFields: ['name', 'email', 'phone', 'id'],
    ownerFields: ['ownerId', 'userId', 'managerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'joinDate',
  },
  {
    collectionName: 'attendance',
    entityType: 'attendance',
    module: 'attendance',
    isGlobal: false,
    labelFields: ['employee', 'employeeId', 'status', 'date', 'id'],
    ownerFields: ['ownerId', 'employeeId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'date',
  },
  {
    collectionName: 'payroll',
    entityType: 'payroll',
    module: 'payroll',
    isGlobal: false,
    labelFields: ['employee', 'employeeId', 'month', 'year', 'id'],
    ownerFields: ['ownerId', 'employeeId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'roles',
    entityType: 'role',
    module: 'roles',
    isGlobal: true,
    labelFields: ['name', 'description', 'id'],
    ownerFields: ['createdBy'],
    companyScoped: false,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'channel_partners',
    entityType: 'channel_partner',
    module: 'channel_partner',
    isGlobal: false,
    labelFields: ['firmName', 'contactPerson', 'email', 'phone', 'id'],
    ownerFields: ['createdBy', 'assignedSalesPerson'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'partner_wallet_transactions',
    entityType: 'partner_wallet_transaction',
    module: 'channel_partner',
    isGlobal: false,
    labelFields: ['description', 'id'],
    ownerFields: ['partnerId', 'processedBy', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'commission_rules',
    entityType: 'commission_rule',
    module: 'channel_partner',
    isGlobal: false,
    labelFields: ['name', 'description', 'id'],
    ownerFields: ['createdBy', 'updatedBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'qc_checks',
    entityType: 'qc_check',
    module: 'qc',
    isGlobal: false,
    labelFields: ['id', 'projectId', 'installationId', 'inspectorName'],
    ownerFields: ['inspectorId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'commissioning_records',
    entityType: 'commissioning_record',
    module: 'commissioning',
    isGlobal: false,
    labelFields: ['id', 'projectId', 'commissionedBy'],
    ownerFields: ['commissionedBy', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'commissionedDate',
  },
  {
    collectionName: 'net_metering_applications',
    entityType: 'net_metering_application',
    module: 'net_metering',
    isGlobal: false,
    labelFields: ['id', 'projectId', 'applicationNumber', 'discomName'],
    ownerFields: ['createdBy'],
    companyScoped: true,
    primaryDateField: 'submittedDate',
  },
  {
    collectionName: 'subsidy_applications',
    entityType: 'subsidy_application',
    module: 'subsidy',
    isGlobal: false,
    labelFields: ['id', 'projectId', 'schemeName', 'applicationNumber'],
    ownerFields: ['createdBy'],
    companyScoped: true,
    primaryDateField: 'submittedDate',
  },
  {
    // Phase 6: Channel Partner Vendor Lock / Scheme Registration — the
    // registration joins the Project's canonical partner ownership chain
    // (ownerFields: partnerId + createdBy) and its own module scope.
    collectionName: 'scheme_registrations',
    entityType: 'scheme_registration',
    module: 'scheme_registration',
    isGlobal: false,
    labelFields: ['id', 'registrationId', 'projectId', 'vendorName', 'status'],
    ownerFields: ['partnerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'submittedAt',
  },
  {
    collectionName: 'project_handovers',
    entityType: 'project_handover',
    module: 'project_handover',
    isGlobal: false,
    labelFields: ['id', 'projectId', 'handoverNumber', 'customerName'],
    ownerFields: ['createdBy', 'assignedEngineer'],
    companyScoped: true,
    primaryDateField: 'handoverDate',
  },
  {
    collectionName: 'amc_contracts',
    entityType: 'amc_contract',
    module: 'projects',
    isGlobal: false,
    labelFields: ['id', 'projectId', 'contractNumber', 'customerName'],
    ownerFields: ['createdBy', 'assignedTo'],
    companyScoped: true,
    primaryDateField: 'startDate',
  },
  {
    collectionName: 'service_tickets',
    entityType: 'service_ticket',
    module: 'service_tickets',
    isGlobal: false,
    labelFields: ['id', 'ticketNumber', 'issueType', 'customerName', 'projectName'],
    ownerFields: ['createdBy', 'assignedTechnician'],
    companyScoped: true,
    primaryDateField: 'reportedDate',
  },
  {
    collectionName: 'generation_readings',
    entityType: 'generation_reading',
    module: 'projects',
    isGlobal: false,
    labelFields: ['id', 'projectId', 'readingKwh', 'readingDate'],
    ownerFields: ['createdBy', 'recordedBy'],
    companyScoped: true,
    primaryDateField: 'readingDate',
  },
  {
    collectionName: 'settlements',
    entityType: 'settlement',
    module: 'channel_partner',
    isGlobal: false,
    labelFields: ['id', 'partnerName', 'partnerId'],
    ownerFields: ['createdBy', 'processedBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  // Phase 16 additions — see the EntityType union's own comment above.
  {
    collectionName: 'installations',
    entityType: 'installation',
    module: 'installations',
    isGlobal: false,
    labelFields: ['installationId', 'projectId', 'id'],
    ownerFields: ['assignedEngineerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'documents',
    entityType: 'document',
    module: 'documents',
    isGlobal: false,
    labelFields: ['name', 'label', 'id'],
    ownerFields: ['uploadedBy', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'uploadedAt',
  },
  {
    collectionName: 'commission_records',
    entityType: 'commission_record',
    module: 'channel_partner',
    isGlobal: false,
    labelFields: ['id', 'partnerId', 'leadId'],
    ownerFields: ['approvedBy', 'partnerId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'generatedDate',
  },
  {
    collectionName: 'notifications',
    entityType: 'notification',
    module: 'notifications',
    isGlobal: false,
    labelFields: ['title', 'message', 'id'],
    ownerFields: ['userId', 'recipientUserId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'tasks',
    entityType: 'task',
    module: 'tasks',
    isGlobal: false,
    labelFields: ['title', 'id'],
    ownerFields: ['assignedToId', 'assignedTo', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'dueDate',
  },
  {
    collectionName: 'entity_relationships',
    entityType: 'entity_relationship',
    module: 'reports',
    isGlobal: false,
    labelFields: ['relation', 'sourceId', 'targetId', 'id'],
    ownerFields: ['createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'banks',
    entityType: 'bank',
    module: 'banks',
    isGlobal: false,
    labelFields: ['displayName', 'bankName', 'bankCode', 'id'],
    ownerFields: ['createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'registrations',
    entityType: 'registration',
    module: 'loan_applications',
    isGlobal: false,
    labelFields: ['customerName', 'registrationId', 'applicationNumber', 'id'],
    ownerFields: ['assignedToId', 'createdBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
  {
    collectionName: 'entities',
    entityType: 'master_entity',
    module: 'entities',
    isGlobal: false,
    labelFields: ['displayName', 'legalName', 'id'],
    ownerFields: ['createdBy', 'updatedBy'],
    companyScoped: true,
    primaryDateField: 'createdAt',
  },
] as const;

const REGISTRY_BY_COLLECTION = new Map<string, EntityRegistryEntry>(
  ENTITY_REGISTRY.map((entry) => [entry.collectionName, entry])
);

const REGISTRY_BY_ENTITY_TYPE = new Map<EntityType, EntityRegistryEntry>(
  ENTITY_REGISTRY.map((entry) => [entry.entityType, entry])
);

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

export function getEntityRegistryEntry(collectionName: string): EntityRegistryEntry | undefined {
  return REGISTRY_BY_COLLECTION.get(collectionName);
}

export function getEntityTypeForCollection(collectionName: string): EntityType | undefined {
  return getEntityRegistryEntry(collectionName)?.entityType;
}

export function getCollectionForEntityType(entityType: EntityType): string | undefined {
  return REGISTRY_BY_ENTITY_TYPE.get(entityType)?.collectionName;
}

export function getEntityLabel(entityType: EntityType, record: UnknownRecord): string {
  const entry = REGISTRY_BY_ENTITY_TYPE.get(entityType);
  const data = asRecord(record);
  const fields = entry?.labelFields ?? ['name', 'id'];

  for (const field of fields) {
    const value = stringValue(data[field]);
    if (value) return value;
  }

  return stringValue(data.id) ?? entityType;
}

export function resolveOwnerId(entityType: EntityType, record: UnknownRecord): string | undefined {
  const entry = REGISTRY_BY_ENTITY_TYPE.get(entityType);
  const data = asRecord(record);
  const fields = entry?.ownerFields ?? ['ownerId', 'assignedToId', 'createdBy'];

  for (const field of fields) {
    const value = stringValue(data[field]);
    if (value) return value;
  }

  return undefined;
}

export function isGlobalEntity(entityType: EntityType): boolean {
  return REGISTRY_BY_ENTITY_TYPE.get(entityType)?.isGlobal ?? false;
}

export function isCompanyScopedEntity(entityType: EntityType): boolean {
  return REGISTRY_BY_ENTITY_TYPE.get(entityType)?.companyScoped ?? false;
}
