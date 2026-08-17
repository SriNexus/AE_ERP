/**
 * Entity Registry — Single source of truth for entity-to-collection mappings
 *
 * Shared between api/[entity].ts and api/[entity]/[id].ts to prevent
 * maintenance drift from duplicate definitions.
 */

export interface EntityConfig {
  collection: string;
  module: string;
  searchFields: string[];
}

export const ENTITY_REGISTRY: Record<string, EntityConfig> = {
  projects: { collection: 'projects', module: 'projects', searchFields: ['projectId', 'customerId', 'siteAddress'] },
  leads: { collection: 'leads', module: 'leads', searchFields: ['name', 'company', 'phone', 'email'] },
  customers: { collection: 'customers', module: 'customers', searchFields: ['name', 'company', 'phone', 'email'] },
  quotations: { collection: 'quotations', module: 'quotations', searchFields: ['quotationNumber', 'customer', 'id'] },
  orders: { collection: 'orders', module: 'orders', searchFields: ['orderNumber', 'customer', 'id'] },
  dispatch: { collection: 'dispatch', module: 'dispatch', searchFields: ['id', 'customer', 'vehicleNo', 'lrNumber'] },
  products: { collection: 'products', module: 'products', searchFields: ['name', 'sku', 'category'] },
  stock: { collection: 'stock', module: 'stock', searchFields: ['product', 'productId', 'warehouse'] },
  users: { collection: 'users', module: 'users', searchFields: ['name', 'email', 'phone'] },
  vendors: { collection: 'vendors', module: 'vendors', searchFields: ['name', 'gstin', 'vendorId'] },
  purchase_orders: { collection: 'purchase_orders', module: 'purchase_orders', searchFields: ['purchaseOrderId', 'vendorName', 'id'] },
  goods_receipts: { collection: 'goods_receipts', module: 'purchase_orders', searchFields: ['goodsReceiptId', 'purchaseOrderId', 'vendorName'] },
  invoices: { collection: 'proforma_invoices', module: 'invoices', searchFields: ['invoiceNumber', 'customer', 'id'] },
  tax_invoices: { collection: 'tax_invoices', module: 'tax_invoices', searchFields: ['invoiceNumber', 'customerName', 'id'] },
  payments: { collection: 'payments', module: 'payments', searchFields: ['id', 'customer', 'reference'] },
  employees: { collection: 'employees', module: 'employees', searchFields: ['name', 'email', 'phone'] },
  attendance: { collection: 'attendance', module: 'attendance', searchFields: ['employee', 'employeeId', 'status'] },
  payroll: { collection: 'payroll', module: 'payroll', searchFields: ['employee', 'employeeId', 'month'] },
  warehouses: { collection: 'warehouses', module: 'warehouses', searchFields: ['name', 'code', 'city'] },
  surveys: { collection: 'surveys', module: 'surveys', searchFields: ['surveyId', 'projectId', 'id'] },
  engineering_designs: { collection: 'engineering_designs', module: 'engineering', searchFields: ['designId', 'projectId', 'id'] },
  qc_checks: { collection: 'qc_checks', module: 'qc', searchFields: ['id', 'projectId', 'inspectorName'] },
  commissioning_records: { collection: 'commissioning_records', module: 'commissioning', searchFields: ['id', 'projectId', 'commissionedBy'] },
  net_metering: { collection: 'net_metering_applications', module: 'net_metering', searchFields: ['id', 'projectId', 'applicationNumber'] },
  subsidy: { collection: 'subsidy_applications', module: 'subsidy', searchFields: ['id', 'projectId', 'schemeName'] },
  handovers: { collection: 'project_handovers', module: 'projects', searchFields: ['id', 'projectId', 'handoverNumber'] },
  amc_contracts: { collection: 'amc_contracts', module: 'projects', searchFields: ['id', 'projectId', 'contractNumber'] },
  service_tickets: { collection: 'service_tickets', module: 'service_tickets', searchFields: ['id', 'ticketNumber', 'issueType'] },
  generation_readings: { collection: 'generation_readings', module: 'projects', searchFields: ['id', 'projectId', 'readingKwh'] },
  roles: { collection: 'roles', module: 'roles', searchFields: ['name', 'description'] },
  companies: { collection: 'companies', module: 'companies', searchFields: ['name', 'shortName', 'companyCode'] },
  notifications: { collection: 'notifications', module: 'dashboard', searchFields: ['title', 'body', 'type'] },
  channel_partners: { collection: 'channel_partners', module: 'partners', searchFields: ['firmName', 'contactPerson', 'email'] },
};

/**
 * Global collections that are NOT company-scoped.
 */
export const GLOBAL_COLLECTIONS = new Set(['roles']);

/**
 * Check if an entity is registered.
 */
export function isEntityRegistered(entityName: string): boolean {
  return entityName in ENTITY_REGISTRY;
}

/**
 * Get entity config for a given entity name.
 */
export function getEntityConfig(entityName: string): EntityConfig | undefined {
  return ENTITY_REGISTRY[entityName];
}

/**
 * Check if a collection is global (not company-scoped).
 */
export function isGlobalCollection(collection: string): boolean {
  return GLOBAL_COLLECTIONS.has(collection);
}
export type ApiTenantIdentity = { companyId: string; isSuperAdmin?: boolean };

export function resolveApiCompanyScope(user: ApiTenantIdentity, requestedCompanyId?: unknown): string {
  if (user.isSuperAdmin && typeof requestedCompanyId === 'string' && requestedCompanyId.trim()) return requestedCompanyId.trim();
  return String(user.companyId || '').trim();
}

export function canAccessApiResource(user: ApiTenantIdentity, collection: string, data?: Record<string, unknown>): boolean {
  return isGlobalCollection(collection) || user.isSuperAdmin === true || data?.companyId === user.companyId;
}
