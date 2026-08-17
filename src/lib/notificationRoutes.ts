/**
 * Notification Route Resolver
 *
 * Maps entityType + entityId → ERP route with deep-link navigation.
 * Used by NotificationPanel when user clicks a notification.
 *
 * Every notification should navigate to the correct ERP context.
 * This centralized resolver prevents scattered route logic.
 */

export function getNotificationRoute(entityType: string, entityId: string, projectId?: string): string {
  const type = entityType.toLowerCase();

  // ── Core CRM / Sales ──
  if (type === 'lead') return entityId ? `/leads?open=${encodeURIComponent(entityId)}` : '/leads';
  if (type === 'customer') return entityId ? `/customers?open=${encodeURIComponent(entityId)}` : '/customers';
  // Quotation notifications open the /quotations/:id detail page — the
  // standalone quotation popup was retired (Quotation Workspace Migration).
  if (type === 'quotation' || type === 'quote') return entityId ? `/quotations/${encodeURIComponent(entityId)}` : '/quotations';
  // Order notifications open the /orders/:id detail page — the standalone
  // Order view popup was retired (Order Workspace Migration; the Order
  // stage's operational workspace lives inside the Project Workspace).
  if (type === 'order') return entityId ? `/orders/${encodeURIComponent(entityId)}` : '/orders';
  if (type === 'invoice' || type === 'pi' || type === 'proforma_invoice') return entityId ? `/invoices?open=${encodeURIComponent(entityId)}` : '/invoices';
  if (type === 'tax_invoice') return entityId ? `/tax-invoices?open=${encodeURIComponent(entityId)}` : '/tax-invoices';
  if (type === 'payment') return entityId ? `/payments?open=${encodeURIComponent(entityId)}` : '/payments';

  // ── Operations / Dispatch ──
  // Dispatch notifications open the /dispatch/:id detail page — the standalone
  // Dispatch management popup was retired (Dispatch Workspace Migration; the
  // Dispatch stage's operational workspace lives inside the Project Workspace).
  if (type === 'dispatch') return entityId ? `/dispatch/${encodeURIComponent(entityId)}` : '/dispatch';

  // ── Inventory / Stock ──
  if (type === 'product') return entityId ? `/products?open=${encodeURIComponent(entityId)}` : '/products';
  if (type === 'stock' || type === 'inventory') return entityId ? `/stock?open=${encodeURIComponent(entityId)}` : '/stock';
  if (type === 'warehouse') return entityId ? `/warehouses?open=${encodeURIComponent(entityId)}` : '/warehouses';
  // The standalone Purchase Order view popup was retired — PO notifications
  // route to the full /purchase-orders/:id workspace, like Order ones do.
  if (type === 'purchase_order' || type === 'purchaseorder') return entityId ? `/purchase-orders/${encodeURIComponent(entityId)}` : '/purchase-orders';
  if (type === 'goods_receipt' || type === 'goodsreceipt') return entityId ? `/goods-receipts?open=${encodeURIComponent(entityId)}` : '/goods-receipts';
  if (type === 'vendor') return entityId ? `/vendors?open=${encodeURIComponent(entityId)}` : '/vendors';

  // ── Project Lifecycle ──
  if (type === 'project') return entityId ? `/projects/${encodeURIComponent(entityId)}` : '/projects';
  // Survey notifications open the Survey stage card inside the Project
  // Workspace (/projects/:id) — the survey detail popup on the Surveys list
  // page was retired (Survey Workspace Migration; the Survey stage's
  // operational workspace lives inside the Project Workspace). Notifications
  // carry the survey's projectId so a click lands on the actual record's
  // operational workspace (the Project Workspace auto-opens the current
  // stage); legacy records without it fall back to the list page.
  if (type === 'survey') return entityId && projectId ? `/projects/${encodeURIComponent(projectId)}` : '/surveys';
  // Engineering notifications open the Engineering stage card inside the
  // Project Workspace (/projects/:id) — the engineering design detail popup
  // was retired (Engineering Workspace Migration; the Engineering stage's
  // operational workspace lives inside the Project Workspace). Notifications
  // carry the design's projectId so a click lands on the actual record's
  // operational workspace; legacy records without it fall back to the list
  // page.
  if (type === 'engineering_design' || type === 'engineeringdesign' || type === 'engineering') return entityId && projectId ? `/projects/${encodeURIComponent(projectId)}` : '/engineering-designs';
  // Installation notifications open the /installations/:id record workspace
  // page — the read-only installation detail modal on the Installations list
  // page was retired (Installation Workspace Migration; the Installation
  // stage's operational workspace lives inside the Project Workspace).
  if (type === 'installation') return entityId ? `/installations/${encodeURIComponent(entityId)}` : '/installations';
  // QC notifications open the /qc/:id record workspace page — the QC detail
  // modal on the Quality Checks list page was retired (QC Workspace
  // Migration; the QC stage's operational workspace lives inside the Project
  // Workspace, Stage 9).
  if (type === 'qc_check' || type === 'qccheck' || type === 'qc') return entityId ? `/qc/${encodeURIComponent(entityId)}` : '/qc';
  // Commissioning notifications open the /commissioning/:id record workspace
  // page — the read-only commissioning detail modal on the Commissioning list
  // page was retired (Commissioning Workspace Migration; the Commissioning
  // stage's operational workspace lives inside the Project Workspace).
  if (type === 'commissioning_record' || type === 'commissioningrecord' || type === 'commissioning') return entityId ? `/commissioning/${encodeURIComponent(entityId)}` : '/commissioning';
  // Net metering notifications open the /net-metering/:id record workspace
  // page — the net metering detail modal on the Net Metering list page was
  // retired (the operational workflow lives in the Project Workspace Stage
  // 11 card).
  if (type === 'net_metering_application' || type === 'netmeteringapplication' || type === 'net_metering') return entityId ? `/net-metering/${encodeURIComponent(entityId)}` : '/net-metering';
  // Subsidy notifications open the /subsidy/:id record workspace page — the
  // subsidy detail/disbursement modals on the Subsidy list page were retired
  // (the operational workflow lives in the Project Workspace Stage 12 card).
  if (type === 'subsidy_application' || type === 'subsidyapplication' || type === 'subsidy') return entityId ? `/subsidy/${encodeURIComponent(entityId)}` : '/subsidy';

  // ── Post-Sale ──
  if (type === 'project_handover' || type === 'projecthandover' || type === 'handover') return entityId ? `/handovers/${encodeURIComponent(entityId)}` : '/handovers';
  if (type === 'amc_contract' || type === 'amccontract' || type === 'amc') return entityId ? `/amc-contracts/${encodeURIComponent(entityId)}` : '/amc-contracts';
  if (type === 'service_ticket' || type === 'serviceticket' || type === 'service_ticket') return entityId ? `/service-tickets?open=${encodeURIComponent(entityId)}` : '/service-tickets';
  if (type === 'generation_reading' || type === 'generationreading' || type === 'monitoring') return entityId ? `/monitoring?open=${encodeURIComponent(entityId)}` : '/monitoring';

  // ── Cases (Phase 3J) ──
  if (type === 'case') return entityId ? `/cases/${encodeURIComponent(entityId)}` : '/cases';

  // ── Tasks ──
  if (type === 'task') return entityId ? `/tasks/${encodeURIComponent(entityId)}` : '/tasks';

  // ── HR ──
  if (type === 'employee') return entityId ? `/employees?open=${encodeURIComponent(entityId)}` : '/employees';
  if (type === 'attendance') return entityId ? `/attendance?open=${encodeURIComponent(entityId)}` : '/attendance';
  if (type === 'payroll') return entityId ? `/payroll?open=${encodeURIComponent(entityId)}` : '/payroll';

  // ── Admin / Settings ──
  if (type === 'user') return entityId ? `/users?open=${encodeURIComponent(entityId)}` : '/users';
  if (type === 'role') return entityId ? `/roles?open=${encodeURIComponent(entityId)}` : '/roles';
  if (type === 'company') return entityId ? `/companies?open=${encodeURIComponent(entityId)}` : '/companies';

  // ── Channel Partners ──
  if (type === 'channel_partner' || type === 'channelpartner' || type === 'partner') return entityId ? `/partners?open=${encodeURIComponent(entityId)}` : '/partners';
  if (type === 'commission_rule' || type === 'commissionrule' || type === 'commission') return entityId ? `/commission-rules?open=${encodeURIComponent(entityId)}` : '/commission-rules';
  if (type === 'settlement') return entityId ? `/settlements?open=${encodeURIComponent(entityId)}` : '/settlements';
  if (type === 'withdrawal') return entityId ? `/settlements?open=${encodeURIComponent(entityId)}` : '/settlements';
  // Registration (Vendor Lock / Scheme Registration) notifications open the
  // Registration stage card inside the Project Workspace (/projects/:id) —
  // role-safe for both the owning partner (self project) and staff (project
  // visibility already enforced). Notifications carry the registration's
  // projectId; legacy records without it fall back to the Projects list.
  // NOTE: only scheme_registration aliases — the Loan subsystem uses
  // entityType 'registration' and must keep its existing routing.
  if (type === 'scheme_registration' || type === 'schemeregistration') return entityId && projectId ? `/projects/${encodeURIComponent(projectId)}` : '/projects';

  // ── Fallback ──
  return '/notifications';
}

/**
 * Navigate to the notification's target and open the specific record.
 * Uses route params or query params depending on the target page's pattern.
 */
export function navigateToNotification(navigate: (path: string) => void, entityType: string, entityId: string, projectId?: string): void {
  const route = getNotificationRoute(entityType, entityId, projectId);
  navigate(route);
}
