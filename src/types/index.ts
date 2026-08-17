// ═══════════════════════════════════════════════════════════
//  GLOBAL TYPES — SaaS
//  Shared type definitions used across all features.
//  Feature-specific types live in features/module/types.ts
// ═══════════════════════════════════════════════════════════

// ── Base record ──────────────────────────────────────────────
export interface BaseRecord {
  id:         string;
  companyId:  string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
}

// ── App User ─────────────────────────────────────────────────
export enum UserRole {
  Admin = 'Admin',
  Sales = 'Sales',
  Accounts = 'Accounts',
  Warehouse = 'Warehouse',
  HR = 'HR',
  Operations = 'Operations',
  Director = 'Director',
  Partner = 'Partner',
}

export enum UserType {
  internal = 'internal',
  external = 'external',
}

export interface MasterUser {
  id:            string;
  phone:         string;
  companyId:    string;
  name:         string;
  email:        string;
  role:         UserRole | string;
  isSuperAdmin?: boolean;
  linkedModules:string[];
  createdAt?:   string;
  updatedAt?:   string;
  isDeleted?:   boolean;
}

export interface AppUser {
  id:           string;
  name:         string;
  displayName?: string;
  email:        string;
  role:         string;
  phone?:       string;
  companyId:    string;
  warehouseId?: string;
  avatar?:      string;
  avatarUrl?:   string;
  signatureUrl?:string;
  managerId?:   string;
  department?:  string;
  status?:      string;
  /** Soft-delete flag carried by users documents (see notifications/round-robin). */
  isDeleted?:   boolean;
  isSuperAdmin?: boolean;
  /**
   * Phase 1 (Channel Partner identity): denormalized partner link on the user
   * doc — `users/{uid}.channelPartnerId` points at the ONE `channel_partners`
   * record this authenticated user is linked to. Canonical resolution path for
   * `usePartnerSelf()` (users.channelPartnerId → channel_partners/{id}); set by
   * `linkPartnerUser` and immutable via Firestore rules once established.
   */
  channelPartnerId?: string;
}

// ── Company ──────────────────────────────────────────────────
export interface CompanyConfig {
  id:               string;
  name:             string;
  shortName:        string;
  companyCode:      string;
  tagline:          string;
  logo?:            string;
  iconLogo?:        string;
  qrCode?:          string;
  signature?:       string;
  address:          string;
  city:             string;
  state:            string;
  pincode:          string;
  country:          string;
  phone:            string;
  email:            string;
  website?:         string;
  gst:              string;
  pan:              string;
  cin?:             string;
  bankName:         string;
  bankAccount:      string;
  bankIfsc:         string;
  bankBranch:       string;
  currency:         string;
  currencySymbol:   string;
  timezone:         string;
  fiscalYearStart:  string;
  invoicePrefix:    string;
  orderPrefix:      string;
  quotationPrefix:  string;
  dispatchPrefix:   string;
  primaryColor:     string;
  accentColor:      string;
  status:           string;
  isDefault?:       boolean;
  /** Phase 1: which workflow(s) this company operates — see lib/companyBusinessMode.ts. */
  businessMode?:    'B2B' | 'B2C' | 'Both';
}

// ── Customer ─────────────────────────────────────────────────
/**
 * Phase 2: the canonical Customer record. `type` is the ONLY reliable B2B/B2C
 * classification signal in the whole ERP (Audit §2/§8) — set once, at
 * Lead->Customer conversion or direct creation, via lib/customerClassification.ts's
 * `isCustomerTypeAllowedForBusinessMode()` gate. Never infer B2B/B2C from `gst`
 * presence, from `company` being set, or from `projectType` below.
 *
 * `type` is intentionally NOT widened to `| string` (unlike the pre-Phase-2
 * `Order.orderType`) — every real call site sets a real 'B2B'|'B2C' value.
 */
export interface Customer extends BaseRecord {
  name: string;
  type: 'B2B' | 'B2C';
  phone?: string;
  email?: string;
  /** B2B business/company name (also used as the B2B contact's display company). */
  company?: string;
  companyName?: string;
  contactPerson?: string;
  businessEmail?: string;
  businessPhone?: string;
  gst?: string;
  pan?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  category?: string;
  creditLimit?: number | string;
  paymentTerms?: string;
  notes?: string;
  status?: string;
  sourceLeadId?: string;
  convertedAt?: string;
  convertedBy?: string;
  assignedToId?: string;
  assignedToName?: string;
  caseId?: string;
  documents?: unknown[];
  /**
   * B2C-only, captured at creation for early qualification. NOT the same concept
   * as `Project.projectType` (Residential/Commercial/Industrial, Phase 4) — this
   * field pre-dates any Project existing and is a known architectural loose end
   * (Customer and Project Type should stay fully independent per Blueprint §4
   * rule 3); flagged for Phase 4 to resolve (deprecate here vs. keep as a
   * pre-Project hint), not removed speculatively in Phase 2.
   */
  projectType?: string;
  altMobile?: string;
  aadhaar?: string;
  monthlyBillAmount?: string | number;
  sanctionLoad?: string | number;
  roofType?: string;
  electricityBillFileName?: string;
}

// ── Role & Permissions ────────────────────────────────────────
export type Permission   = 'view' | 'create' | 'edit' | 'delete' | 'cancel' | 'export' | 'import' | 'approve' | 'view_pricing';
export type Visibility   = 'all' | 'team' | 'self';
export type Module       = 'dashboard' | 'leads' | 'customers' | 'orders' | 'quotations' | 'invoices'
                         | 'projects'
                         | 'surveys' | 'engineering' | 'installations' | 'qc' | 'commissioning' | 'net_metering' | 'subsidy' | 'service_tickets'
                         | 'products' | 'categories' | 'stock' | 'dispatch' | 'payments' | 'reports'
                         | 'employees' | 'attendance' | 'payroll' | 'warehouses'
                         | 'users' | 'roles' | 'companies' | 'settings'
                         | 'partners' | 'tax_invoices' | 'vendors' | 'purchase_orders'
                         | 'cases';

export type ProjectStage =
  | 'New'
  | 'SchemeRegistration'
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
  | 'Monitoring'
  | 'Archived';

export interface ProjectSiteAddress {
  line1?: string;
  line2?: string;
  landmark?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  /** Best-effort reverse-geocoded label for the surveyed GPS point above —
   * distinct from this Project's own registered address (line1..country):
   * "where the survey was actually conducted" vs "where the Project is
   * registered." Never written into the registered-address fields. */
  surveyedLocationLabel?: string;
}

export interface ProjectStageHistoryEntry {
  stage: ProjectStage;
  changedAt: string;
  changedBy?: string;
  note?: string;
}

export interface Project extends BaseRecord {
  projectId: string;
  customerId: string;
  leadId?: string;
  capacityKw: number;
  siteAddress: ProjectSiteAddress;
  currentStage: ProjectStage;
  stageHistory: ProjectStageHistoryEntry[];
  assignedSurveyor?: string;
  assignedInstaller?: string;
  salesOwner?: string;
  linkedQuotationIds: string[];
  linkedOrderIds: string[];
  linkedDispatchIds: string[];
  archivedAt?: string;
  archiveReason?: string;
}

export interface ModulePermissions {
  view:          boolean;
  create:        boolean;
  edit:          boolean;
  delete:        boolean;
  cancel:        boolean;
  export:        boolean;
  import:        boolean;
  approve:       boolean;
  view_pricing:  boolean;
  visibility:    Visibility;
}

export interface RoleDefinition {
  id?:          string;
  name:         string;
  schemaVersion?: 1;
  permissions:  Record<Module, ModulePermissions>;
}

// ── Activity Log entry ────────────────────────────────────────
export interface ActivityLogEntry {
  id:        string;
  type:      string;
  desc:      string;
  date:      string;
  userName:  string;
}

// ── Notifications ────────────────────────────────────────────
export enum NotificationType {
  LEAD_ASSIGNED = 'LEAD_ASSIGNED',
  LEAD_CREATED = 'LEAD_CREATED',
  LEAD_UPDATED = 'LEAD_UPDATED',
  LEAD_DELETED = 'LEAD_DELETED',
  ORDER_PLACED = 'ORDER_PLACED',
  ORDER_UPDATED = 'ORDER_UPDATED',
  ORDER_DELETED = 'ORDER_DELETED',
  DISPATCH_APPROVED = 'DISPATCH_APPROVED',
  DISPATCH_VERIFIED = 'DISPATCH_VERIFIED',
  DISPATCH_REQUESTED = 'DISPATCH_REQUESTED',
  DISPATCH_CLOSED = 'DISPATCH_CLOSED',
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED',
  PAYMENT_RECORDED = 'PAYMENT_RECORDED',
  PAYMENT_DELETED = 'PAYMENT_DELETED',
  PI_GENERATED = 'PI_GENERATED',
  INVOICE_UPDATED = 'INVOICE_UPDATED',
  INVOICE_DELETED = 'INVOICE_DELETED',
  CUSTOMER_CREATED = 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED = 'CUSTOMER_UPDATED',
  CUSTOMER_DELETED = 'CUSTOMER_DELETED',
  CUSTOMER_ASSIGNED = 'CUSTOMER_ASSIGNED',
  INVENTORY_UPDATED = 'INVENTORY_UPDATED',
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  TASK_STATUS_CHANGED = 'TASK_STATUS_CHANGED',
  // ── Channel Partner Notifications ──
  PARTNER_REGISTERED = 'PARTNER_REGISTERED',
  PARTNER_KYC_SUBMITTED = 'PARTNER_KYC_SUBMITTED',
  PARTNER_KYC_APPROVED = 'PARTNER_KYC_APPROVED',
  PARTNER_KYC_REJECTED = 'PARTNER_KYC_REJECTED',
  PARTNER_APPROVED = 'PARTNER_APPROVED',
  PARTNER_SUSPENDED = 'PARTNER_SUSPENDED',
  PARTNER_REACTIVATED = 'PARTNER_REACTIVATED',
  LEAD_CREATED_BY_PARTNER = 'LEAD_CREATED_BY_PARTNER',
  COMMISSION_GENERATED = 'COMMISSION_GENERATED',
  COMMISSION_APPROVED = 'COMMISSION_APPROVED',
  WITHDRAWAL_REQUESTED = 'WITHDRAWAL_REQUESTED',
  WITHDRAWAL_APPROVED = 'WITHDRAWAL_APPROVED',
  WITHDRAWAL_REJECTED = 'WITHDRAWAL_REJECTED',
  WITHDRAWAL_PAID = 'WITHDRAWAL_PAID',
  SETTLEMENT_COMPLETED = 'SETTLEMENT_COMPLETED',
  DOCUMENT_REQUIRED = 'DOCUMENT_REQUIRED',
  DOCUMENT_VERIFIED = 'DOCUMENT_VERIFIED',
  DOCUMENT_REJECTED = 'DOCUMENT_REJECTED',
  INSTALLATION_SCHEDULED = 'INSTALLATION_SCHEDULED',
  INSTALLATION_COMPLETED = 'INSTALLATION_COMPLETED',
  PARTNER_MILESTONE = 'PARTNER_MILESTONE',

  // ── Fraud Detection ──
  FRAUD_CRITICAL_RISK = 'FRAUD_CRITICAL_RISK',
  FRAUD_NEW_INVESTIGATION = 'FRAUD_NEW_INVESTIGATION',
  FRAUD_STATUS_CHANGE = 'FRAUD_STATUS_CHANGE',
  FRAUD_RISK_ESCALATION = 'FRAUD_RISK_ESCALATION',
  FRAUD_INVESTIGATION_RESOLVED = 'FRAUD_INVESTIGATION_RESOLVED',

  // ── Auto-Reminders ──
  REMINDER = 'REMINDER',
  ESCALATION_CRITICAL = 'ESCALATION_CRITICAL',

  // ── Case Notifications (Phase 3J) ──
  CASE_CREATED = 'CASE_CREATED',
  CASE_ASSIGNED = 'CASE_ASSIGNED',
  CASE_STAGE_CHANGED = 'CASE_STAGE_CHANGED',
  CASE_COMPLETED = 'CASE_COMPLETED',
  CASE_FAILED = 'CASE_FAILED',
  CASE_CANCELLED = 'CASE_CANCELLED',
  CASE_VALIDATION_FAILED = 'CASE_VALIDATION_FAILED',
  CASE_REPAIR_RECOMMENDED = 'CASE_REPAIR_RECOMMENDED',
  CASE_REPAIR_COMPLETED = 'CASE_REPAIR_COMPLETED',
  CASE_HEALTH_CHANGED = 'CASE_HEALTH_CHANGED',
  CASE_DUPLICATE_DETECTED = 'CASE_DUPLICATE_DETECTED',
  CASE_ORPHAN_DETECTED = 'CASE_ORPHAN_DETECTED',
  CASE_CIRCULAR_REFERENCE = 'CASE_CIRCULAR_REFERENCE',
  CASE_MONITORING_STARTED = 'CASE_MONITORING_STARTED',
  CASE_AMC_CREATED = 'CASE_AMC_CREATED',
  CASE_SERVICE_TICKET_CREATED = 'CASE_SERVICE_TICKET_CREATED',
  CASE_SUBSIDY_APPROVED = 'CASE_SUBSIDY_APPROVED',
}

export interface Notification {
  id: string;
  companyId: string;
  recipientUserId: string;
  recipientName?: string;
  createdBy?: string;
  createdByName?: string;
  visibleTo?: string[];
  type: NotificationType;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  /** Optional project context for project-linked entities (survey, engineering
   * design, …). Lets the route resolver open the record's Project Workspace
   * stage card directly (popup retirement deep links). */
  projectId?: string;
  isRead: boolean;
  readAt?: unknown;
  createdAt: unknown;
  updatedAt?: unknown;
  isDeleted?: boolean;
  deletedAt?: unknown;
  deletedBy?: string;
}

export type OrderType = 'B2B' | 'B2C';

export interface Quotation extends BaseRecord {
  quotationNumber?: string;
  quoteNumber?: string;
  refNo?: string;
  projectId?: string;
  engineeringDesignId?: string;
  customer?: string;
  customerId?: string;
  orderId?: string;
  status?: string;
  convertedOrderId?: string;
  date?: string;
  validUntil?: string;
  terms?: string;
  notes?: string;
  total?: number;
  items?: Array<{
    productId?: string;
    product?: string;
    qty?: number;
    price?: number;
    tax?: number;
  }>;
}

export interface Order extends BaseRecord {
  orderNumber?: string;
  orderNo?: string;
  customer?: string;
  customerId?: string;
  /** Phase 3: strict, no longer widened to `| string` — always derived from the
   * linked Customer's real `type` (lib/customerClassification.ts), never hardcoded. */
  orderType?: OrderType;
  status?: string;
  paymentStatus?: string;
  paymentMode?: string;
  date?: string;
  deliveryDate?: string;
  shippingAddress?: string;
  notes?: string;
  subtotal?: number;
  taxTotal?: number;
  taxAmount?: number;
  discount?: number;
  totalInvoiced?: number;
  pendingBilling?: number;
  stockBlocked?: boolean;
  total?: number;
  piGenerated?: boolean;
  generatedPIs?: string[];
  items?: Array<{
    productId?: string;
    product?: string;
    qty?: number;
    price?: number;
    tax?: number;
    dispatchedQty?: number;
    pendingQty?: number;
  }>;
}

export interface ProformaInvoice extends BaseRecord {
  invoiceNumber?: string;
  piNumber?: string;
  refNo?: string;
  orderId?: string;
  sourceOrderId?: string;
  customerId?: string;
  customer?: string;
  date?: string;
  dueDate?: string;
  status?: string;
  paymentStatus?: string;
  paidAt?: unknown;
  terms?: string;
  notes?: string;
  total?: number;
  templateUsed?: string;
  items?: Array<{
    productId?: string;
    product?: string;
    qty?: number;
    price?: number;
    tax?: number;
  }>;
}

export interface Product extends BaseRecord {
  companyId: string;
  name: string;
  category: string;
  categoryId?: string;
  sku?: string;
  price: number;
  tax?: number;
  unit?: string;
  description?: string;
  /** Pricing / tax / tracking fields used by the product form and CSV import. */
  mrp?: number | string;
  cost?: number | string;
  discount?: number | string;
  hsn?: string;
  trackingType?: string;
  company?: string;
  specs?: Record<string, unknown>;
  photos?: string[];
  lowStockThreshold?: number;
  status?: 'Active' | 'Inactive' | string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  isDeleted?: boolean;
}

// ── Tasks ───────────────────────────────────────────────────
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type TaskStatus = 'Open' | 'In Progress' | 'Done' | 'Cancelled';

export interface Task extends BaseRecord {
  title: string;
  description?: string;
  assignedToId: string;
  assignedToName: string;
  createdBy: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  entityType?: 'Lead' | 'Customer' | 'Order' | string;
  entityId?: string;
  entityName?: string;
}

// ── Pagination ───────────────────────────────────────────────
export interface PaginationState {
  page:    number;
  perPage: number;
}

// ── Sort ─────────────────────────────────────────────────────
export interface SortState {
  key:  string;
  desc: boolean;
}

// ── Select option ─────────────────────────────────────────────
export interface SelectOption {
  label: string;
  value: string;
}

// ── Workspace Architecture (Phase 0) ────────────────────────

/** Workspace tab identifiers for the 10 universal tabs */
export type WorkspaceTabId =
  | 'overview'
  | 'notes'
  | 'activity'
  | 'documents'
  | 'history'
  | 'communication'
  | 'tasks'
  | 'attachments'
  | 'linked_records'
  | 'permissions'
  | 'disposable'
  // Central Panel Refinement mission: Customer Workspace's own module tabs
  // (orders-tab/invoices-tab — see features/customers/utils/workspaceConfig.ts)
  // were previously rejected by useWorkspace's own URL round-trip validation
  // (isValidTab), silently snapping activeTab back to 'overview' on every
  // click — a pre-existing bug, not a new module tab being introduced here.
  | 'orders-tab'
  | 'invoices-tab';

/** A single workspace tab definition */
export interface WorkspaceTab {
  id: WorkspaceTabId;
  label: string;
  component: React.ComponentType<UniversalTabProps>;
  /** If true, this tab is always rendered. Otherwise, omitted per module. */
  required?: boolean;
}

/** Props received by every universal tab component */
export interface UniversalTabProps {
  entityId: string;
  entityType: string;
  companyId: string;
  record: Record<string, unknown>;
  permissions: {
    canView: boolean;
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canApprove?: boolean;
  };
  caseId?: string;
}

/** Quick action definition for the workspace action bar */
export interface QuickAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  permission?: 'view' | 'create' | 'edit' | 'delete' | 'approve';
  handler: (record: Record<string, unknown>) => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

/** Case Engine - Case record structure */
export interface CaseRecord {
  id: string;
  caseId: string;
  companyId: string;
  leadId?: string;
  customerId?: string;
  currentStage: string;
  status: 'Active' | 'Completed' | 'Archived';
  stageHistory: Array<{
    stage: string;
    changedAt: string;
    changedBy?: string;
    note?: string;
  }>;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  isDeleted?: boolean;
}

/** Task Engine - Task record structure */
export interface TaskRecord {
  id: string;
  taskId: string;
  title: string;
  description?: string;
  assigneeId: string;
  assigneeName: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  dueDate: string;
  reminderAt?: string;
  completedAt?: string;
  linkedEntityId?: string;
  linkedEntityType?: string;
  caseId?: string;
  companyId: string;
  escalationLevel: number;
  escalatedAt?: string;
  escalatedTo?: string;
  slaMinutes?: number;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

/** Linked Records - relationship group */
export interface LinkedRecordGroup {
  entityType: string;
  label: string;
  count: number;
  records: LinkedRecordPreview[];
  viewAllLink: string;
}

export interface LinkedRecordPreview {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  link: string;
}

// ── Date range ───────────────────────────────────────────────
export type DateRangeKey = 'all' | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'custom';
