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
  /**
   * INVENTORY-02: when true, the generic REST handlers serve GET only.
   * Any mutating method (POST / PUT / PATCH / DELETE) returns 405 — the
   * collection's writes MUST go through the authorized application inventory
   * workflow (Firestore SDK under firestore.rules), never the Admin-SDK
   * generic entity path which bypasses the ledger, transaction safety, FK
   * validation and security rules (audit P0-2).
   */
  readOnly?: boolean;
}

export const ENTITY_REGISTRY: Record<string, EntityConfig> = {
  projects: { collection: 'projects', module: 'projects', searchFields: ['projectId', 'customerId', 'siteAddress'] },
  leads: { collection: 'leads', module: 'leads', searchFields: ['name', 'company', 'phone', 'email'] },
  customers: { collection: 'customers', module: 'customers', searchFields: ['name', 'company', 'phone', 'email'] },
  quotations: { collection: 'quotations', module: 'quotations', searchFields: ['quotationNumber', 'customer', 'id'] },
  orders: { collection: 'orders', module: 'orders', searchFields: ['orderNumber', 'customer', 'id'] },
  dispatch: { collection: 'dispatch', module: 'dispatch', searchFields: ['id', 'customer', 'vehicleNo', 'lrNumber'] },
  products: { collection: 'products', module: 'products', searchFields: ['name', 'sku', 'category'] },
  // INVENTORY-02 (P0-2): stock and stock_ledger are READ-ONLY over the REST API.
  // Stock quantities and ledger movements are written only by the application
  // inventory workflows (stockWorkflow / dispatchWorkflow / goodsReceiptWorkflow
  // / useInventory) which run under firestore.rules with transaction safety and
  // a matching ledger entry — never through the generic Admin-SDK entity path.
  stock: { collection: 'stock', module: 'stock', searchFields: ['product', 'productId', 'warehouse'], readOnly: true },
  stock_ledger: { collection: 'stock_ledger', module: 'stock', searchFields: ['productId', 'warehouseId', 'referenceId', 'sourceId', 'type'], readOnly: true },
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

/**
 * INVENTORY-02: mutating HTTP methods that the generic entity handlers can
 * perform. Anything in this set against a `readOnly` entity is rejected 405.
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Returns true when this method against this registered entity must be
 * rejected with 405 because the entity is read-only over the REST API.
 * `method` is case-insensitive; a missing/unknown entity returns false
 * (the caller already handles "unknown entity" as 400).
 */
export function isRestWriteBlocked(entityName: string, method: string | undefined): boolean {
  const config = ENTITY_REGISTRY[entityName];
  if (!config || config.readOnly !== true) return false;
  return MUTATING_METHODS.has(String(method || '').toUpperCase());
}
export type ApiTenantIdentity = {
  companyId: string;
  isSuperAdmin?: boolean;
  /** RBAC Master Plan Phase 8 — see AuthenticatedUser.role/groupId. */
  role?: string;
  groupId?: string;
};

/** Error thrown when an API create/write targets a company the actor may not reach. */
export class ApiTenantScopeError extends Error {
  readonly statusCode = 403;
  readonly code = 'TENANT_SCOPE';
  constructor(message: string) {
    super(message);
    this.name = 'ApiTenantScopeError';
  }
}

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * RBAC Master Plan Phase 8 — a GroupAdmin whose profile carries an
 * authoritative groupId. Mirrors the client's `user?.role === 'GroupAdmin'`
 * scope check and `firestore.rules`' `actorIsGroupAdmin()`. A GroupAdmin
 * with NO real groupId (broken profile) fails this check and is treated
 * exactly like an ordinary single-company user — never widened, fail closed.
 * SuperAdmin/Owner are handled by their own unconditional bypass everywhere
 * and are deliberately excluded here so this predicate stays "group-bounded
 * authority", never "platform authority".
 */
export function isApiGroupAdmin(user: ApiTenantIdentity): boolean {
  return user.isSuperAdmin !== true
    && trimmed(user.role).toLowerCase() === 'groupadmin'
    && trimmed(user.groupId).length > 0;
}

export function resolveApiCompanyScope(user: ApiTenantIdentity, requestedCompanyId?: unknown): string {
  if (user.isSuperAdmin && typeof requestedCompanyId === 'string' && requestedCompanyId.trim()) return requestedCompanyId.trim();
  return String(user.companyId || '').trim();
}

/**
 * Central API resource-access decision for a single already-fetched document.
 * Used by api/[entity]/[id].ts (GET / UPDATE / DELETE) and elsewhere instead
 * of an inline `data.companyId !== user.companyId` check.
 *
 * - global collections (roles): always readable (Company scoping does not apply)
 * - SuperAdmin / Owner: unconditional
 * - anyone: their own company's documents
 * - GroupAdmin (with a real groupId): any document whose `groupId` equals
 *   their authoritative group — mirrors `firestore.rules`' `groupAdminCanRead`
 *   (`data.groupId == actorGroupId()`). A document with NO groupId, or a
 *   GroupAdmin with no groupId, falls back to the company-only rule above.
 *
 * Non-GroupAdmin behaviour is byte-identical to the previous inline check.
 */
export function canAccessApiResource(user: ApiTenantIdentity, collection: string, data?: Record<string, unknown>): boolean {
  if (isGlobalCollection(collection)) return true;
  if (user.isSuperAdmin === true) return true;
  if (data?.companyId === user.companyId) return true;
  if (isApiGroupAdmin(user)) {
    const docGroupId = trimmed(data?.groupId);
    if (docGroupId.length > 0 && docGroupId === trimmed(user.groupId)) return true;
  }
  return false;
}

/**
 * Reads a company's own authoritative `groupId` (the value the client's
 * `resolveWriteGroupId()` stamps). '' when the company doc is missing or
 * carries no groupId — the caller then decides whether that is fatal.
 */
export async function readCompanyGroupId(
  db: { collection(name: string): { doc(id: string): { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }> } } },
  companyId: string,
): Promise<string> {
  const id = trimmed(companyId);
  if (!id) return '';
  try {
    const snap = await db.collection('companies').doc(id).get();
    return snap.exists ? trimmed(snap.data()?.groupId) : '';
  } catch {
    return '';
  }
}

/**
 * Central API create/write tenant resolution — returns the `companyId` AND
 * the authoritative `groupId` a new document must be stamped with.
 *
 * - SuperAdmin / Owner: may target any company (existing behaviour); groupId
 *   is resolved from that company's own doc.
 * - GroupAdmin (with a real groupId): may target any company IN THEIR GROUP.
 *   An explicit request for a company outside the group is rejected
 *   (`ApiTenantScopeError`), not silently redirected. With no explicit
 *   request, their home company is used.
 * - every other role: their home company, exactly as before — an explicit
 *   `requestedCompanyId` is ignored (unchanged), and the ONLY new behaviour
 *   is that the resolved doc now also carries the company's `groupId`
 *   (additive; the client write path already stamps this — closes the API's
 *   missing-groupId gap so GroupAdmin group-scoped reads can see the record).
 */
export async function resolveApiCreateTenant(
  db: Parameters<typeof readCompanyGroupId>[0],
  user: ApiTenantIdentity,
  requestedCompanyId?: unknown,
): Promise<{ companyId: string; groupId: string }> {
  const req = trimmed(requestedCompanyId);
  const home = trimmed(user.companyId);

  if (user.isSuperAdmin === true) {
    const companyId = req || home;
    return { companyId, groupId: await readCompanyGroupId(db, companyId) };
  }

  if (isApiGroupAdmin(user)) {
    const actorGroupId = trimmed(user.groupId);
    const target = req || home;
    const targetGroupId = await readCompanyGroupId(db, target);
    if (targetGroupId && targetGroupId === actorGroupId) {
      return { companyId: target, groupId: actorGroupId };
    }
    if (req && req !== home) {
      throw new ApiTenantScopeError('The requested company is not in your group.');
    }
    // Home company whose own doc has no resolvable/matching groupId — allow,
    // stamping the actor's authoritative group so the record stays reachable.
    return { companyId: home, groupId: targetGroupId || actorGroupId };
  }

  // Every other role: home company only; requestedCompanyId ignored (unchanged).
  return { companyId: home, groupId: await readCompanyGroupId(db, home) };
}
