/**
 * WorkspaceSearchEngine — Universal workspace search engine (Phase 0F/0F.1 / 9C)
 *
 * SINGLE SOURCE OF TRUTH for all search categories.
 * searchIndex.ts delegates here; no duplicate search logic exists.
 *
 * Architecture:
 * - Self-contained: all 32 category search implementations live here
 * - No imports from searchIndex.ts (avoids circular dependency)
 * - Permission-aware: filters results by user's module permissions
 * - Multi-company compatible: all queries scoped to companyId
 * - Results limit: 5 per category
 *
 * Usage:
 *   import { workspaceSearchEngine } from '../engines';
 *   const results = await workspaceSearchEngine.search('John', companyId, permissions);
 */

import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { fromDoc } from '../lib/firestore';

import { COLLECTIONS } from '../lib/firebase';
import type {
  SearchCategory,
} from '../features/search/types';

// ── Types ──────────────────────────────────────────────────

export type WorkspaceSearchCategory = SearchCategory;

export interface WorkspaceSearchResult {
  id: string;
  category: WorkspaceSearchCategory;
  title: string;
  subtitle?: string;
  link: string;
}

export interface WorkspaceSearchGroup {
  category: WorkspaceSearchCategory;
  label: string;
  results: WorkspaceSearchResult[];
}

// ── Labels & Routes ───────────────────────────────────────

export const WORKSPACE_CATEGORY_LABELS: Record<WorkspaceSearchCategory, string> = {
  tasks: 'Tasks',
  leads: 'Leads',
  customers: 'Customers',
  loan_applications: 'Loan Applications',
  orders: 'Orders',
  quotations: 'Quotations',
  invoices: 'Invoices',
  products: 'Products',
  categories: 'Categories',
  warehouses: 'Warehouses',
  stock: 'Stock',
  dispatch: 'Dispatch',
  cases: 'Cases',
  projects: 'Projects',
  vendors: 'Vendors',
  purchase_orders: 'Purchase Orders',
  goods_receipts: 'Goods Receipts',
  // Phase 9C
  partners: 'Partners',
  employees: 'Employees',
  payments: 'Payments',
  installations: 'Installations',
  qc_checks: 'QC Checks',
  commissioning: 'Commissioning',
  net_metering: 'Net Metering',
  subsidy: 'Subsidy',
  handovers: 'Handovers',
  amc_contracts: 'AMC Contracts',
  service_tickets: 'Service Tickets',
  monitoring: 'Monitoring',
  surveys: 'Surveys',
  engineering_designs: 'Engineering Designs',
  tax_invoices: 'Tax Invoices',
  notifications: 'Notifications',
  // Phase 9E
  audit_logs: 'Audit Logs',
  security_logs: 'Security Logs',
  // Bank Master
  banks: 'Bank Master',
};

export const WORKSPACE_CATEGORY_ROUTES: Record<WorkspaceSearchCategory, string> = {
  tasks: '/tasks',
  leads: '/leads',
  customers: '/customers',
  loan_applications: '/loan-applications',
  orders: '/orders',
  quotations: '/quotations',
  invoices: '/invoices',
  products: '/products',
  categories: '/categories',
  warehouses: '/warehouses',
  stock: '/stock',
  dispatch: '/dispatch',
  cases: '/cases',
  projects: '/projects',
  vendors: '/vendors',
  purchase_orders: '/purchase-orders',
  goods_receipts: '/goods-receipts',
  // Phase 9C
  partners: '/partners',
  employees: '/employees',
  payments: '/payments',
  installations: '/installations',
  qc_checks: '/qc',
  commissioning: '/commissioning',
  net_metering: '/net-metering',
  subsidy: '/subsidy',
  handovers: '/handovers',
  amc_contracts: '/amc-contracts',
  service_tickets: '/service-tickets',
  monitoring: '/monitoring',
  surveys: '/surveys',
  engineering_designs: '/engineering-designs',
  tax_invoices: '/tax-invoices',
  notifications: '/notifications',
  // Phase 9E
  audit_logs: '/audit-logs',
  security_logs: '/audit-logs?filter=security',
  // Bank Master
  banks: '/banks',
};

// ── Category → module permission mapping ──────────────────

const CATEGORY_MODULE_MAP: Record<WorkspaceSearchCategory, string | null> = {
  tasks: 'tasks',
  leads: 'leads',
  customers: 'customers',
  loan_applications: 'loan_applications',
  orders: 'orders',
  quotations: 'quotations',
  invoices: 'invoices',
  products: 'products',
  categories: 'categories',
  warehouses: 'warehouses',
  stock: 'stock',
  dispatch: 'dispatch',
  cases: 'cases',
  projects: 'projects',
  vendors: 'vendors',
  purchase_orders: 'purchase_orders',
  goods_receipts: 'goods_receipts',
  // Phase 9C — mapped to relevant permission modules
  // Phase 9E — audit_logs & security_logs use null so search respects ownerOnly via route guard
  // Bank Master
  banks: 'banks',
  audit_logs: null,
  security_logs: null,
  partners: 'partners',
  employees: 'employees',
  payments: 'payments',
  installations: 'installations',
  qc_checks: 'qc',
  commissioning: 'commissioning',
  net_metering: 'net_metering',
  subsidy: 'subsidy',
  handovers: 'projects',
  amc_contracts: 'projects',
  service_tickets: 'service_tickets',
  monitoring: 'projects',
  surveys: 'surveys',
  engineering_designs: 'engineering',
  tax_invoices: 'tax_invoices',
  notifications: 'dashboard',
};

// ── Search helpers ────────────────────────────────────────

const RESULTS_PER_CATEGORY = 5;

async function prefixSearch<T extends Record<string, any>>(
  collectionName: string,
  field: string,
  rawQ: string,
  companyId: string,
  mapFn: (doc: T & { id: string }) => WorkspaceSearchResult,
): Promise<WorkspaceSearchResult[]> {
  if (!companyId || !rawQ || rawQ.trim().length < 2) return [];
  const q = rawQ.toLowerCase();
  const end = q + '\uf8ff';

  try {
    const snap = await getDocs(query(
      collection(db, collectionName),
      where('companyId', '==', companyId),
      where('isDeleted', '==', false),
      where(field, '>=', q),
      where(field, '<=', end),
      limit(RESULTS_PER_CATEGORY),
    ));
    return snap.docs.map((d) => mapFn(fromDoc<T>(d as any)));
  } catch {
    return fallbackSearch(collectionName, rawQ, companyId, [field], mapFn);
  }
}

async function fallbackSearch<T extends Record<string, any>>(
  collectionName: string,
  rawQ: string,
  companyId: string,
  fields: string[],
  mapFn: (doc: T & { id: string }) => WorkspaceSearchResult,
): Promise<WorkspaceSearchResult[]> {
  if (!companyId || rawQ.trim().length < 2) return [];
  const term = rawQ.trim().toLowerCase();

  try {
    const snap = await getDocs(query(
      collection(db, collectionName),
      where('companyId', '==', companyId),
      limit(50),
    ));
    return snap.docs
      .map((d) => fromDoc<T>(d as any))
      .filter((doc) => doc.isDeleted !== true)
      .filter((doc) => fields.some((f) => String(doc[f] || '').toLowerCase().includes(term)))
      .slice(0, RESULTS_PER_CATEGORY)
      .map(mapFn);
  } catch {
    return [];
  }
}

// ── Category Search Functions ─────────────────────────────

// Tasks
async function searchTasks(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch('tasks', 'title', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'tasks',
    title: doc.title ?? doc.id,
    subtitle: doc.status ?? doc.assignedToName,
    link: WORKSPACE_CATEGORY_ROUTES.tasks,
  }));
  if (rows.length) return rows;
  const entityRows = await prefixSearch('tasks', 'entityName', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'tasks',
    title: doc.title ?? doc.entityName ?? doc.id,
    subtitle: doc.status ?? doc.assignedToName,
    link: WORKSPACE_CATEGORY_ROUTES.tasks,
  }));
  if (entityRows.length) return entityRows;
  return fallbackSearch('tasks', rawQ, companyId, ['title', 'description', 'assignedToName', 'entityName'], (doc) => ({
    id: doc.id,
    category: 'tasks',
    title: doc.title ?? doc.entityName ?? doc.id,
    subtitle: doc.status ?? doc.assignedToName,
    link: WORKSPACE_CATEGORY_ROUTES.tasks,
  }));
}

// Leads
async function searchLeads(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.LEADS, 'searchName', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'leads',
    title: doc.name ?? doc.companyName ?? doc.id,
    subtitle: doc.status,
    link: WORKSPACE_CATEGORY_ROUTES.leads,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.LEADS, rawQ, companyId, ['name', 'company', 'companyName', 'phone', 'email', 'city'], (doc) => ({
    id: doc.id,
    category: 'leads',
    title: doc.name ?? doc.company ?? doc.companyName ?? doc.id,
    subtitle: doc.status ?? doc.phone,
    link: WORKSPACE_CATEGORY_ROUTES.leads,
  }));
}

// Customers
async function searchCustomers(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  return prefixSearch(COLLECTIONS.CUSTOMERS, 'searchName', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'customers',
    title: doc.name ?? doc.id,
    subtitle: doc.phone ?? doc.city,
    link: WORKSPACE_CATEGORY_ROUTES.customers,
  }));
}

// Orders
async function searchOrders(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  return prefixSearch(COLLECTIONS.ORDERS, 'orderNumber', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'orders',
    title: doc.orderNumber ?? doc.id,
    subtitle: doc.status ?? doc.customerName,
    link: WORKSPACE_CATEGORY_ROUTES.orders,
  }));
}

// Quotations
async function searchQuotations(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  return prefixSearch(COLLECTIONS.QUOTATIONS, 'quotationNumber', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'quotations',
    title: doc.quotationNumber ?? doc.id,
    subtitle: doc.status ?? doc.customerName,
    link: WORKSPACE_CATEGORY_ROUTES.quotations,
  }));
}

// Invoices
async function searchInvoices(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.PROFORMA_INVOICES, 'invoiceNumber', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'invoices',
    title: doc.invoiceNumber ?? doc.piNumber ?? doc.id,
    subtitle: doc.paymentStatus ?? doc.customer ?? doc.customerName,
    link: WORKSPACE_CATEGORY_ROUTES.invoices,
  }));
  if (rows.length) return rows;
  const piRows = await prefixSearch(COLLECTIONS.PROFORMA_INVOICES, 'piNumber', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'invoices',
    title: doc.invoiceNumber ?? doc.piNumber ?? doc.id,
    subtitle: doc.paymentStatus ?? doc.customer ?? doc.customerName,
    link: WORKSPACE_CATEGORY_ROUTES.invoices,
  }));
  if (piRows.length) return piRows;
  return fallbackSearch(COLLECTIONS.PROFORMA_INVOICES, rawQ, companyId, ['invoiceNumber', 'piNumber', 'customer', 'customerName', 'orderId', 'sourceOrderId'], (doc) => ({
    id: doc.id,
    category: 'invoices',
    title: doc.invoiceNumber ?? doc.piNumber ?? doc.id,
    subtitle: doc.paymentStatus ?? doc.customer ?? doc.customerName,
    link: WORKSPACE_CATEGORY_ROUTES.invoices,
  }));
}

// Products
async function searchProducts(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  return prefixSearch(COLLECTIONS.PRODUCTS, 'searchName', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'products',
    title: doc.name ?? doc.id,
    subtitle: doc.sku ?? doc.category,
    link: WORKSPACE_CATEGORY_ROUTES.products,
  }));
}

// Categories
async function searchCategories(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.PRODUCT_CATEGORIES, 'searchName', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'categories',
    title: doc.name ?? doc.id,
    subtitle: doc.parentCategory ? `Parent: ${doc.parentCategory}` : 'Root category',
    link: WORKSPACE_CATEGORY_ROUTES.categories,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.PRODUCT_CATEGORIES, rawQ, companyId, ['name', 'description', 'parentCategory', 'code', 'categoryCode'], (doc) => ({
    id: doc.id,
    category: 'categories',
    title: doc.name ?? doc.id,
    subtitle: doc.parentCategory ? `Parent: ${doc.parentCategory}` : 'Root category',
    link: WORKSPACE_CATEGORY_ROUTES.categories,
  }));
}

// Warehouses
async function searchWarehouses(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.WAREHOUSES, 'searchName', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'warehouses',
    title: doc.name ?? doc.code ?? doc.id,
    subtitle: doc.city ?? doc.managerName ?? doc.status,
    link: WORKSPACE_CATEGORY_ROUTES.warehouses,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.WAREHOUSES, rawQ, companyId, ['name', 'code', 'city', 'state', 'address', 'managerName', 'managerPhone', 'status', 'warehouseType', 'type'], (doc) => ({
    id: doc.id,
    category: 'warehouses',
    title: doc.name ?? doc.code ?? doc.id,
    subtitle: doc.city ?? doc.managerName ?? doc.status,
    link: WORKSPACE_CATEGORY_ROUTES.warehouses,
  }));
}

// Stock
async function searchStock(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const summaryRows = await prefixSearch(COLLECTIONS.STOCK, 'product', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'stock',
    title: doc.product ?? doc.productName ?? doc.productId ?? doc.id,
    subtitle: `${doc.warehouse ?? doc.warehouseName ?? 'Warehouse'} · ${doc.availableQty ?? doc.available ?? 0} available`,
    link: WORKSPACE_CATEGORY_ROUTES.stock,
  }));
  if (summaryRows.length) return summaryRows;
  const ledgerRows = await prefixSearch(COLLECTIONS.STOCK_LEDGER, 'product', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'stock',
    title: doc.product ?? doc.productName ?? doc.productId ?? doc.id,
    subtitle: `${doc.type ?? doc.movementType ?? 'Movement'} · ${doc.qty ?? 0}`,
    link: WORKSPACE_CATEGORY_ROUTES.stock,
  }));
  if (ledgerRows.length) return ledgerRows;
  const fb1 = await fallbackSearch(COLLECTIONS.STOCK, rawQ, companyId, ['product', 'productName', 'productId', 'warehouse', 'warehouseName', 'warehouseId', 'category', 'notes'], (doc) => ({
    id: doc.id,
    category: 'stock',
    title: doc.product ?? doc.productName ?? doc.productId ?? doc.id,
    subtitle: `${doc.warehouse ?? doc.warehouseName ?? 'Warehouse'} · ${doc.availableQty ?? doc.available ?? 0} available`,
    link: WORKSPACE_CATEGORY_ROUTES.stock,
  }));
  if (fb1.length) return fb1;
  return fallbackSearch(COLLECTIONS.STOCK_LEDGER, rawQ, companyId, ['product', 'productName', 'productId', 'warehouse', 'warehouseName', 'warehouseId', 'reference', 'sourceId', 'notes'], (doc) => ({
    id: doc.id,
    category: 'stock',
    title: doc.product ?? doc.productName ?? doc.productId ?? doc.id,
    subtitle: `${doc.type ?? doc.movementType ?? 'Movement'} · ${doc.qty ?? 0}`,
    link: WORKSPACE_CATEGORY_ROUTES.stock,
  }));
}

// Dispatch
// The standalone Dispatch management popup was retired — search results open
// the full /dispatch/:id record workspace (Dispatch Workspace Migration; the
// Dispatch stage's operational workspace lives inside the Project Workspace).
async function searchDispatch(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.DISPATCH, 'dispatchNumber', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'dispatch',
    title: doc.dispatchNumber ?? doc.dispatchNo ?? doc.id,
    subtitle: `${doc.status ?? doc.approvalStatus ?? 'Dispatch'} · ${doc.customerName ?? doc.customer ?? doc.orderNumber ?? ''}`.trim(),
    link: `/dispatch/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.DISPATCH, rawQ, companyId, ['dispatchNumber', 'dispatchNo', 'orderNumber', 'orderNo', 'orderId', 'customer', 'customerName', 'warehouse', 'warehouseName', 'driverName', 'vehicleNo', 'lrNumber', 'status', 'approvalStatus'], (doc) => ({
    id: doc.id,
    category: 'dispatch',
    title: doc.dispatchNumber ?? doc.dispatchNo ?? doc.id,
    subtitle: `${doc.status ?? doc.approvalStatus ?? 'Dispatch'} · ${doc.customerName ?? doc.customer ?? doc.orderNumber ?? ''}`.trim(),
    link: `/dispatch/${encodeURIComponent(doc.id)}`,
  }));
}

// Cases
async function searchCases(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.CASES, 'caseId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'cases',
    title: doc.caseId ?? doc.id,
    subtitle: `${doc.currentStage ?? 'New'} · ${doc.status ?? 'Active'}`,
    link: `/cases/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.CASES, rawQ, companyId, ['caseId', 'leadId', 'customerId', 'currentStage', 'status'], (doc) => ({
    id: doc.id,
    category: 'cases',
    title: doc.caseId ?? doc.id,
    subtitle: `${doc.currentStage ?? 'New'} · ${doc.status ?? 'Active'}`,
    link: `/cases/${encodeURIComponent(doc.id)}`,
  }));
}

// Projects
async function searchProjects(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.PROJECTS, 'projectId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'projects',
    title: doc.projectId ?? doc.id,
    subtitle: `${doc.currentStage ?? 'New'} · ${doc.capacityKw ?? ''}kW`,
    link: `/projects/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.PROJECTS, rawQ, companyId, ['projectId', 'customerId', 'leadId', 'currentStage', 'salesOwner', 'assignedSurveyor', 'assignedInstaller'], (doc) => ({
    id: doc.id,
    category: 'projects',
    title: doc.projectId ?? doc.id,
    subtitle: `${doc.currentStage ?? 'New'} · ${doc.capacityKw ?? ''}kW`,
    link: `/projects/${encodeURIComponent(doc.id)}`,
  }));
}

// Vendors
async function searchVendors(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.VENDORS, 'searchName', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'vendors',
    title: doc.name ?? doc.firmName ?? doc.id,
    subtitle: doc.phone ?? doc.city ?? doc.category ?? '',
    link: `/vendors?open=${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.VENDORS, rawQ, companyId, ['name', 'firmName', 'phone', 'email', 'city', 'category', 'contactPerson'], (doc) => ({
    id: doc.id,
    category: 'vendors',
    title: doc.name ?? doc.firmName ?? doc.id,
    subtitle: doc.phone ?? doc.city ?? doc.category ?? '',
    link: `/vendors?open=${encodeURIComponent(doc.id)}`,
  }));
}

// Purchase Orders
async function searchPurchaseOrders(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  return prefixSearch(COLLECTIONS.PURCHASE_ORDERS, 'poNumber', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'purchase_orders',
    title: doc.poNumber ?? doc.id,
    subtitle: `${doc.status ?? 'Draft'} · ${doc.vendorName ?? ''}`,
    // The standalone Purchase Order view popup was retired — search results
    // open the full /purchase-orders/:id workspace.
    link: `/purchase-orders/${encodeURIComponent(doc.id)}`,
  }));
}

// Goods Receipts
async function searchGoodsReceipts(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  return prefixSearch(COLLECTIONS.GOODS_RECEIPTS, 'grNumber', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'goods_receipts',
    title: doc.grNumber ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.vendorName ?? ''}`,
    link: `/goods-receipts?open=${encodeURIComponent(doc.id)}`,
  }));
}

// ══════════════════════════════════════════════════════════════
//  Phase 9C — New Search Functions
// ══════════════════════════════════════════════════════════════

// Channel Partners
async function searchPartners(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.CHANNEL_PARTNERS, 'searchName', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'partners',
    title: doc.name ?? doc.firmName ?? doc.id,
    subtitle: doc.status ?? doc.tier ?? doc.type ?? '',
    link: `/partners/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.CHANNEL_PARTNERS, rawQ, companyId, ['name', 'firmName', 'phone', 'email', 'city', 'contactPerson', 'gstNo'], (doc) => ({
    id: doc.id,
    category: 'partners',
    title: doc.name ?? doc.firmName ?? doc.id,
    subtitle: doc.status ?? doc.tier ?? doc.type ?? '',
    link: `/partners/${encodeURIComponent(doc.id)}`,
  }));
}

// Employees
async function searchEmployees(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.EMPLOYEES, 'searchName', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'employees',
    title: doc.name ?? doc.id,
    subtitle: doc.role ?? doc.department ?? doc.designation ?? '',
    link: WORKSPACE_CATEGORY_ROUTES.employees,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.EMPLOYEES, rawQ, companyId, ['name', 'phone', 'email', 'employeeCode', 'role', 'department', 'designation'], (doc) => ({
    id: doc.id,
    category: 'employees',
    title: doc.name ?? doc.id,
    subtitle: doc.role ?? doc.department ?? doc.designation ?? '',
    link: WORKSPACE_CATEGORY_ROUTES.employees,
  }));
}

// Payments
async function searchPayments(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.PAYMENTS, 'paymentId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'payments',
    title: doc.paymentId ?? doc.receiptNo ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.amount ? `₹${Number(doc.amount).toLocaleString()}` : ''}`,
    link: WORKSPACE_CATEGORY_ROUTES.payments,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.PAYMENTS, rawQ, companyId, ['paymentId', 'receiptNo', 'orderId', 'customer', 'customerName', 'customerPhone', 'mode', 'reference'], (doc) => ({
    id: doc.id,
    category: 'payments',
    title: doc.paymentId ?? doc.receiptNo ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.amount ? `₹${Number(doc.amount).toLocaleString()}` : ''}`,
    link: WORKSPACE_CATEGORY_ROUTES.payments,
  }));
}

// Installations
//
// Phase 10: this already targeted the real 'installations' collection name
// (COLLECTIONS.INSTALLATIONS) before that collection had any real documents
// — so results were always silently empty. Now that installationEngine.ts's
// dual-write fix populates it, two latent field mismatches would have
// surfaced: (1) the record's real fields are `installationStatus` /
// `assignedEngineerName`, not `status` / `assignedInstaller` — fixed below.
// (2) `/installations/:id` (InstallationWorkspace.tsx) still resolves by
// LEAD id, not this collection's own id — the link must use `leadId`.
async function searchInstallations(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch('installations', 'installationId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'installations',
    title: doc.installationId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.installationStatus ?? 'Pending'} · ${doc.assignedEngineerName ?? ''}`,
    link: `/installations/${encodeURIComponent(doc.leadId ?? doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch('installations', rawQ, companyId, ['installationId', 'projectId', 'leadId', 'assignedEngineerName', 'installationStatus'], (doc) => ({
    id: doc.id,
    category: 'installations',
    title: doc.installationId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.installationStatus ?? 'Pending'} · ${doc.assignedEngineerName ?? ''}`,
    link: `/installations/${encodeURIComponent(doc.leadId ?? doc.id)}`,
  }));
}

// QC Checks
async function searchQcChecks(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.QC_CHECKS, 'qcId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'qc_checks',
    title: doc.qcId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.assignedTo ?? doc.inspectorName ?? ''}`,
    link: `/qc/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.QC_CHECKS, rawQ, companyId, ['qcId', 'projectId', 'customerName', 'assignedTo', 'inspectorName', 'status'], (doc) => ({
    id: doc.id,
    category: 'qc_checks',
    title: doc.qcId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.assignedTo ?? doc.inspectorName ?? ''}`,
    link: `/qc/${encodeURIComponent(doc.id)}`,
  }));
}

// Commissioning Records
async function searchCommissioning(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.COMMISSIONING_RECORDS, 'commissioningId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'commissioning',
    title: doc.commissioningId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.assignedTo ?? ''}`,
    link: `/commissioning/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.COMMISSIONING_RECORDS, rawQ, companyId, ['commissioningId', 'projectId', 'customerName', 'assignedTo', 'status'], (doc) => ({
    id: doc.id,
    category: 'commissioning',
    title: doc.commissioningId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.assignedTo ?? ''}`,
    link: `/commissioning/${encodeURIComponent(doc.id)}`,
  }));
}

// Net Metering Applications
async function searchNetMetering(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.NET_METERING_APPLICATIONS, 'applicationId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'net_metering',
    title: doc.applicationId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.utilityProvider ?? ''}`,
    link: `/net-metering/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.NET_METERING_APPLICATIONS, rawQ, companyId, ['applicationId', 'projectId', 'customerName', 'utilityProvider', 'status'], (doc) => ({
    id: doc.id,
    category: 'net_metering',
    title: doc.applicationId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.utilityProvider ?? ''}`,
    link: `/net-metering/${encodeURIComponent(doc.id)}`,
  }));
}

// Subsidy Applications
async function searchSubsidy(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.SUBSIDY_APPLICATIONS, 'applicationId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'subsidy',
    title: doc.applicationId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.schemeName ?? ''}`,
    link: `/subsidy/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.SUBSIDY_APPLICATIONS, rawQ, companyId, ['applicationId', 'projectId', 'customerName', 'schemeName', 'status'], (doc) => ({
    id: doc.id,
    category: 'subsidy',
    title: doc.applicationId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.schemeName ?? ''}`,
    link: `/subsidy/${encodeURIComponent(doc.id)}`,
  }));
}

// Handovers
async function searchHandovers(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.PROJECT_HANDOVERS, 'handoverId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'handovers',
    title: doc.handoverId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.handoverDate ?? ''}`,
    link: `/handovers/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.PROJECT_HANDOVERS, rawQ, companyId, ['handoverId', 'projectId', 'customerName', 'status'], (doc) => ({
    id: doc.id,
    category: 'handovers',
    title: doc.handoverId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.handoverDate ?? ''}`,
    link: `/handovers/${encodeURIComponent(doc.id)}`,
  }));
}

// AMC Contracts
async function searchAmcContracts(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.AMC_CONTRACTS, 'contractId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'amc_contracts',
    title: doc.contractId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Active'} · ${doc.contractType ?? ''}`,
    link: `/amc-contracts/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.AMC_CONTRACTS, rawQ, companyId, ['contractId', 'projectId', 'customerName', 'contractType', 'status'], (doc) => ({
    id: doc.id,
    category: 'amc_contracts',
    title: doc.contractId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Active'} · ${doc.contractType ?? ''}`,
    link: `/amc-contracts/${encodeURIComponent(doc.id)}`,
  }));
}

// Service Tickets
async function searchServiceTickets(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.SERVICE_TICKETS, 'ticketId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'service_tickets',
    title: doc.ticketId ?? doc.id,
    subtitle: `${doc.status ?? 'Open'} · ${doc.priority ?? ''}`.trim(),
    link: `/service-tickets/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.SERVICE_TICKETS, rawQ, companyId, ['ticketId', 'projectId', 'customerName', 'issue', 'description', 'status', 'priority'], (doc) => ({
    id: doc.id,
    category: 'service_tickets',
    title: doc.ticketId ?? doc.id,
    subtitle: `${doc.status ?? 'Open'} · ${doc.priority ?? ''}`.trim(),
    link: `/service-tickets/${encodeURIComponent(doc.id)}`,
  }));
}

// Monitoring (Generation Readings)
async function searchMonitoring(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.GENERATION_READINGS, 'projectId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'monitoring',
    title: doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Active'} · ${doc.generation ?? ''} kWh`,
    link: `/monitoring/${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.GENERATION_READINGS, rawQ, companyId, ['projectId', 'customerName', 'status', 'generation'], (doc) => ({
    id: doc.id,
    category: 'monitoring',
    title: doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Active'} · ${doc.generation ?? ''} kWh`,
    link: `/monitoring/${encodeURIComponent(doc.id)}`,
  }));
}

// Surveys
// The survey detail popup was retired — search results open the Survey stage
// card inside the Project Workspace (/projects/:id), exactly like the Surveys
// list page's row click (Survey Workspace Migration).
async function searchSurveys(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.SURVEYS, 'surveyId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'surveys',
    title: doc.surveyId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.assignedSurveyor ?? ''}`,
    link: doc.projectId ? `/projects/${encodeURIComponent(doc.projectId)}` : '/surveys',
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.SURVEYS, rawQ, companyId, ['surveyId', 'projectId', 'customerName', 'assignedSurveyor', 'status'], (doc) => ({
    id: doc.id,
    category: 'surveys',
    title: doc.surveyId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Pending'} · ${doc.assignedSurveyor ?? ''}`,
    link: doc.projectId ? `/projects/${encodeURIComponent(doc.projectId)}` : '/surveys',
  }));
}

// Engineering Designs
// The engineering design detail popup was retired — search results open the
// Engineering stage card inside the Project Workspace (/projects/:id), exactly
// like the Engineering Designs list page's row click (Engineering Workspace
// Migration).
async function searchEngineeringDesigns(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.ENGINEERING_DESIGNS, 'designId', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'engineering_designs',
    title: doc.designId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Draft'} · ${doc.designerName ?? ''}`,
    link: doc.projectId ? `/projects/${encodeURIComponent(doc.projectId)}` : '/engineering-designs',
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.ENGINEERING_DESIGNS, rawQ, companyId, ['designId', 'projectId', 'customerName', 'designerName', 'status'], (doc) => ({
    id: doc.id,
    category: 'engineering_designs',
    title: doc.designId ?? doc.projectId ?? doc.id,
    subtitle: `${doc.status ?? 'Draft'} · ${doc.designerName ?? ''}`,
    link: doc.projectId ? `/projects/${encodeURIComponent(doc.projectId)}` : '/engineering-designs',
  }));
}

// Tax Invoices
async function searchTaxInvoices(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.TAX_INVOICES, 'invoiceNumber', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'tax_invoices',
    title: doc.invoiceNumber ?? doc.id,
    subtitle: `${doc.status ?? 'Draft'} · ${doc.customerName ?? ''} · ${doc.amount ? `₹${Number(doc.amount).toLocaleString()}` : ''}`,
    link: `/tax-invoices?open=${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.TAX_INVOICES, rawQ, companyId, ['invoiceNumber', 'customerName', 'customerGst', 'customerId', 'status'], (doc) => ({
    id: doc.id,
    category: 'tax_invoices',
    title: doc.invoiceNumber ?? doc.id,
    subtitle: `${doc.status ?? 'Draft'} · ${doc.customerName ?? ''} · ${doc.amount ? `₹${Number(doc.amount).toLocaleString()}` : ''}`,
    link: `/tax-invoices?open=${encodeURIComponent(doc.id)}`,
  }));
}

// Loan Applications
async function searchLoanApplications(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const col = COLLECTIONS.LOAN_APPLICATIONS;
  const rows = await prefixSearch(col, 'searchName', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'loan_applications',
    title: doc.customerName ?? doc.registrationId ?? doc.id,
    subtitle: `${doc.status ?? 'Draft'} · ${doc.bankName ?? ''} · ${doc.loanAmount ? `₹${Number(doc.loanAmount).toLocaleString()}` : ''}`,
    link: `/loan-applications?open=${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(col, rawQ, companyId, ['customerName', 'customerPhone', 'bankName', 'branch', 'registrationId', 'assignedToName', 'applicationNumber'], (doc) => ({
    id: doc.id,
    category: 'loan_applications',
    title: doc.customerName ?? doc.registrationId ?? doc.id,
    subtitle: `${doc.status ?? 'Draft'} · ${doc.bankName ?? ''}`,
    link: `/loan-applications?open=${encodeURIComponent(doc.id)}`,
  }));
}

// Notifications
async function searchNotifications(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  return fallbackSearch(COLLECTIONS.NOTIFICATIONS, rawQ, companyId, ['title', 'message', 'body', 'entityType', 'recipientUserId'], (doc) => ({
    id: doc.id,
    category: 'notifications',
    title: doc.title ?? doc.message ?? doc.id,
    subtitle: doc.isRead ? 'Read' : 'Unread',
    link: `/notifications/${encodeURIComponent(doc.id)}`,
  }));
}

// ══════════════════════════════════════════════════════════════
//  Phase 9E — Audit Log Search Functions
// ══════════════════════════════════════════════════════════════

// Audit Logs
async function searchAuditLogs(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  return fallbackSearch(COLLECTIONS.AUDIT_LOGS, rawQ, companyId, ['message', 'userEmail', 'action', 'entityType', 'entityId', 'module'], (doc) => ({
    id: doc.id,
    category: 'audit_logs',
    title: doc.message ?? doc.id,
    subtitle: `${doc.action ?? 'action'} · ${doc.userEmail ?? ''}`,
    link: `/audit-logs`,
  }));
}

// Security Logs (severity-filtered from audit_logs)
async function searchSecurityLogs(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const all = await searchAuditLogs(rawQ, companyId);
  return all;
}

// Bank Master
async function searchBanks(rawQ: string, companyId: string): Promise<WorkspaceSearchResult[]> {
  const rows = await prefixSearch(COLLECTIONS.BANKS, 'bankName', rawQ, companyId, (doc) => ({
    id: doc.id,
    category: 'banks',
    title: doc.bankName ?? doc.id,
    subtitle: `${doc.bankCode ?? ''} · ${doc.status ?? 'Active'}`.trim(),
    link: `/banks?open=${encodeURIComponent(doc.id)}`,
  }));
  if (rows.length) return rows;
  return fallbackSearch(COLLECTIONS.BANKS, rawQ, companyId, ['bankName', 'bankCode', 'displayName'], (doc) => ({
    id: doc.id,
    category: 'banks',
    title: doc.bankName ?? doc.id,
    subtitle: `${doc.bankCode ?? ''} · ${doc.status ?? 'Active'}`.trim(),
    link: `/banks?open=${encodeURIComponent(doc.id)}`,
  }));
}

// ── Permission Filter ─────────────────────────────────────

function filterByPermission(
  categories: WorkspaceSearchCategory[],
  canView: (module: string) => boolean,
): WorkspaceSearchCategory[] {
  return categories.filter((cat) => {
    const module = CATEGORY_MODULE_MAP[cat];
    return !module || canView(module);
  });
}

// ── Engine Interface ──────────────────────────────────────

export interface WorkspaceSearchEngineAPI {
  search(
    query: string,
    companyId: string,
    permissions?: { canView: (module: string) => boolean },
    categoryFilter?: WorkspaceSearchCategory[],
  ): Promise<WorkspaceSearchGroup[]>;

  searchScope(
    query: string,
    companyId: string,
    category: WorkspaceSearchCategory,
  ): Promise<WorkspaceSearchResult[]>;

  getAvailableCategories(canView: (module: string) => boolean): WorkspaceSearchCategory[];
  getResultRoute(result: WorkspaceSearchResult): string;
  getCategoryModule(category: WorkspaceSearchCategory): string | null;
}

// ── Engine Implementation ─────────────────────────────────

const searchFns: Record<WorkspaceSearchCategory, (q: string, cid: string) => Promise<WorkspaceSearchResult[]>> = {
  tasks: searchTasks,
  leads: searchLeads,
  customers: searchCustomers,
  loan_applications: searchLoanApplications,
  orders: searchOrders,
  quotations: searchQuotations,
  invoices: searchInvoices,
  products: searchProducts,
  categories: searchCategories,
  warehouses: searchWarehouses,
  stock: searchStock,
  dispatch: searchDispatch,
  cases: searchCases,
  projects: searchProjects,
  vendors: searchVendors,
  purchase_orders: searchPurchaseOrders,
  goods_receipts: searchGoodsReceipts,
  // Phase 9C
  partners: searchPartners,
  employees: searchEmployees,
  payments: searchPayments,
  installations: searchInstallations,
  qc_checks: searchQcChecks,
  commissioning: searchCommissioning,
  net_metering: searchNetMetering,
  subsidy: searchSubsidy,
  handovers: searchHandovers,
  amc_contracts: searchAmcContracts,
  service_tickets: searchServiceTickets,
  monitoring: searchMonitoring,
  surveys: searchSurveys,
  engineering_designs: searchEngineeringDesigns,
  tax_invoices: searchTaxInvoices,
  notifications: searchNotifications,
  // Phase 9E
  audit_logs: searchAuditLogs,
  security_logs: searchSecurityLogs,
  // Bank Master
  banks: searchBanks,
};

async function search(
  rawQuery: string,
  companyId: string,
  permissions?: { canView: (module: string) => boolean },
  categoryFilter?: WorkspaceSearchCategory[],
): Promise<WorkspaceSearchGroup[]> {
  const q = rawQuery.trim();
  if (!q || q.length < 2 || !companyId) return [];

  const allCategories: WorkspaceSearchCategory[] = categoryFilter ?? [
    'cases', 'projects', 'leads', 'customers', 'loan_applications', 'orders', 'quotations',
    'invoices', 'products', 'categories', 'warehouses', 'stock', 'dispatch',
    'tasks', 'vendors', 'purchase_orders', 'goods_receipts',
    'partners', 'employees', 'payments', 'installations', 'qc_checks',
    'commissioning', 'net_metering', 'subsidy', 'handovers', 'amc_contracts',
    'service_tickets', 'monitoring', 'surveys', 'engineering_designs',
    'tax_invoices', 'notifications',
    // Phase 9E
    'audit_logs', 'security_logs',
    // Bank Master
    'banks',
  ];

  const canView = permissions?.canView ?? (() => true);
  const permittedCategories = filterByPermission(allCategories, canView);
  if (permittedCategories.length === 0) return [];

  const results = await Promise.allSettled(
    permittedCategories.map((cat) => searchFns[cat](q, companyId)),
  );

  const groups: WorkspaceSearchGroup[] = [];
  for (let i = 0; i < permittedCategories.length; i++) {
    const cat = permittedCategories[i];
    const result = results[i];
    if (result.status !== 'fulfilled') continue;
    if (result.value.length === 0) continue;
    groups.push({
      category: cat,
      label: WORKSPACE_CATEGORY_LABELS[cat] ?? cat,
      results: result.value,
    });
  }

  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

async function searchScope(
  rawQuery: string,
  companyId: string,
  category: WorkspaceSearchCategory,
): Promise<WorkspaceSearchResult[]> {
  const fn = searchFns[category];
  if (!fn) return [];
  return fn(rawQuery, companyId);
}

function getAvailableCategories(canView: (module: string) => boolean): WorkspaceSearchCategory[] {
  const all: WorkspaceSearchCategory[] = [
    'cases', 'projects', 'leads', 'customers', 'orders', 'quotations',
    'invoices', 'products', 'categories', 'warehouses', 'stock', 'dispatch',
    'tasks', 'vendors', 'purchase_orders', 'goods_receipts',
    'partners', 'employees', 'payments', 'installations', 'qc_checks',
    'commissioning', 'net_metering', 'subsidy', 'handovers', 'amc_contracts',
    'service_tickets', 'monitoring', 'surveys', 'engineering_designs',
    'tax_invoices', 'notifications',
    // Phase 9E
    'audit_logs', 'security_logs',
    // Bank Master
    'banks',
  ];
  return filterByPermission(all, canView);
}

function getResultRoute(result: WorkspaceSearchResult): string {
  return result.link || WORKSPACE_CATEGORY_ROUTES[result.category] || `/${result.category}`;
}

function getCategoryModule(category: WorkspaceSearchCategory): string | null {
  return CATEGORY_MODULE_MAP[category];
}

// ── Export ────────────────────────────────────────────────

export const workspaceSearchEngine: WorkspaceSearchEngineAPI = {
  search,
  searchScope,
  getAvailableCategories,
  getResultRoute,
  getCategoryModule,
};

export default workspaceSearchEngine;
