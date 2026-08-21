/**
 * MobileRoutes — Mobile route definitions
 *
 * Rendered by App.tsx when viewport < 1024px.
 * Mirrors the desktop AppRoutes structure but uses MobileLayout
 * instead of the desktop Layout + Sidebar + TopBar.
 *
 * Batch 3: Added /create, /recent, /profile placeholder routes.
 * Batch 5: Replaced Home index route with <HomeWorkspace />.
 * Batch 6: Added /app route with AppWorkspace (ModuleGrid).
 *          Added /tasks placeholder route.
 * Module context tracking for the App tab is handled by
 * ContextResolver (via useMobileNavigation hook).
 * See Batch 4: src/components/mobile/context/ContextResolver.tsx
 */

import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MobileLayout } from '../shell/MobileLayout';
import { ProtectedRoute } from '../../auth/ProtectedRoute';
import { RoleRoute } from '../../auth/RoleRoute';
import { useGlobalBoot } from '../../../lib/useGlobalBoot';
import { useAppStore } from '../../../store/useAppStore';
import { isPartnerPortalUser } from '../../../lib/permissions';
import { HomeWorkspace } from '../home/HomeWorkspace';
import { MobileTaskWorkspace } from '../tasks/MobileTaskWorkspace';
import { AppWorkspace } from '../app/AppWorkspace';
import { MobileLeadWorkspace } from '../leads/MobileLeadWorkspace';
import { MobileCustomerWorkspace } from '../customers/MobileCustomerWorkspace';
import { MobileQuotationWorkspace } from '../quotations/MobileQuotationWorkspace';
import { MobileOrderWorkspace } from '../orders/MobileOrderWorkspace';
import { MobileInvoiceWorkspace } from '../invoices/MobileInvoiceWorkspace';
import { MobileProductWorkspace } from '../products/MobileProductWorkspace';
import { MobileCategoryWorkspace } from '../categories/MobileCategoryWorkspace';
import { MobileWarehouseWorkspace } from '../warehouses/MobileWarehouseWorkspace';
import { MobileStockWorkspace } from '../stock/MobileStockWorkspace';
import { MobileDispatchWorkspace } from '../dispatch/MobileDispatchWorkspace';
import { MobilePartnerWorkspace } from '../partners/MobilePartnerWorkspace';
import { MobileCommissionRulesWorkspace } from '../commission-rules/MobileCommissionRulesWorkspace';
import { MobileCommissionApprovalsWorkspace } from '../commission-approvals/MobileCommissionApprovalsWorkspace';
import { MobileSettlementWorkspace } from '../settlements/MobileSettlementWorkspace';
import { MobilePartnerShell } from '../partner/MobilePartnerShell';
import { MobilePartnerHome } from '../partner/MobilePartnerHome';
import { PartnerMobileLeadsWorkspace } from '../leads/PartnerMobileLeadsWorkspace';
import { PartnerMobileWalletWorkspace } from '../partner/PartnerMobileWalletWorkspace';
import { PartnerMobileCommissionsWorkspace } from '../partner/PartnerMobileCommissionsWorkspace';
import { PartnerMobileDocumentsWorkspace } from '../partner/PartnerMobileDocumentsWorkspace';
import { PartnerMobileProfileWorkspace } from '../partner/PartnerMobileProfileWorkspace';
import { PartnerMobileSettlementWorkspace } from '../partner/PartnerMobileSettlementWorkspace';
import { PartnerMobileCommissionRulesWorkspace } from '../partner/PartnerMobileCommissionRulesWorkspace';
import { PartnerMobilePerformanceWorkspace } from '../partner/PartnerMobilePerformanceWorkspace';
import { MobileFraudInvestigationWorkspace } from '../fraud/MobileFraudInvestigationWorkspace';
import { PartnerMobileInstallationWorkspace } from '../partner/PartnerMobileInstallationWorkspace';
import { PartnerMobileNotificationCenter } from '../partner/PartnerMobileNotificationCenter';
/** Partner Customers/Projects reuse the shared desktop pages — the same
 * business logic/ownership contract on both platforms (Phase 5). */
const PartnerCustomers = lazy(() => import('../../../pages/partner/PartnerCustomers'));
const PartnerProjects  = lazy(() => import('../../../pages/partner/PartnerProjects'));
const PartnerRegistration = lazy(() => import('../../../pages/partner/PartnerRegistration'));
// VL-9/VL-10: the standalone Registration list reuses the SAME desktop page
// (same hooks/services/visibility) on mobile — presentation adapts, business
// logic does not.
const SchemeRegistrations = lazy(() => import('../../../pages/SchemeRegistrations'));
import { MobileQCWorkspace } from '../qc/MobileQCWorkspace';
import MobileCommissioningWorkspace from '../commissioning/MobileCommissioningWorkspace';
import { MobileNetMeteringWorkspace } from '../net-metering/MobileNetMeteringWorkspace';
import { MobileSubsidyWorkspace } from '../subsidy/MobileSubsidyWorkspace';
import { MobileTaxInvoiceWorkspace } from '../tax-invoice/MobileTaxInvoiceWorkspace';
import { MobilePaymentWorkspace } from '../payments/MobilePaymentWorkspace';
import MobileReportsWorkspace from '../reports/MobileReportsWorkspace';
import MobileAttendanceWorkspace from '../attendance/MobileAttendanceWorkspace';
import MobilePayrollWorkspace from '../payroll/MobilePayrollWorkspace';
import { MobileEmployeesWorkspace } from '../employees/MobileEmployeesWorkspace';
import MobileSettingsWorkspace from '../settings/MobileSettingsWorkspace';
import MobileUsersWorkspace from '../users/MobileUsersWorkspace';
import MobileCompaniesWorkspace from '../companies/MobileCompaniesWorkspace';
import { MobileProjectList } from '../projects/MobileProjectList';
import { MobileProjectWorkspace } from '../projects/MobileProjectWorkspace';
import { MobileSurveyWorkspace } from '../surveys/MobileSurveyWorkspace';
import { MobileEngineeringWorkspace } from '../engineering/MobileEngineeringWorkspace';
import { MobileProjectHandoverWorkspace } from '../project-handover/MobileProjectHandoverWorkspace';
import { MobileAmcContractsWorkspace } from '../amc-contracts/MobileAmcContractsWorkspace';
import { MobileServiceTicketWorkspace } from '../service-tickets/MobileServiceTicketWorkspace';
import { MobileMonitoringWorkspace } from '../monitoring/MobileMonitoringWorkspace';
import { MobileVendorWorkspace } from '../vendors/MobileVendorWorkspace';
import { MobileSalesDocuments } from '../sales-documents/MobileSalesDocuments';
import { MobilePurchaseOrderWorkspace } from '../purchase-orders/MobilePurchaseOrderWorkspace';
import { MobileGoodsReceiptWorkspace } from '../goods-receipts/MobileGoodsReceiptWorkspace';
import { MobileLoanApplicationWorkspace } from '../loan-applications/MobileLoanApplicationWorkspace';

/** Lazy-loaded pages shared with desktop */
const Login = lazy(() => import('../../../pages/Login'));
const Dashboards = lazy(() => import('../../../pages/Dashboards'));
const MobileInstallationsWorkspace = lazy(() => import('../installations/MobileInstallationsWorkspace'));
const NotificationsPage = lazy(() => import('../../../pages/Notifications'));
const RolesPage = lazy(() => import('../../../pages/Roles'));
const SettingsPage = lazy(() => import('../../../pages/Settings'));

/*
 * Module path tracking for the App tab is handled by the
 * useMobileNavigation hook (used in MobileBottomNav).
 * No per-route tracker component needed — the hook's
 * useEffect fires on every location change automatically.
 */

/**
 * Placeholder component for routes not yet implemented.
 */
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-[var(--color-primary-light)] flex items-center justify-center mb-4">
        <span className="text-2xl font-bold text-[var(--color-primary-text)]">
          {title.charAt(0).toUpperCase()}
        </span>
      </div>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-1">{title}</h2>
      <p className="text-sm text-[var(--color-text-muted)]">Coming soon</p>
    </div>
  );
}

function UnderDevelopmentPage({ title }: { title: string }) {
  return <PlaceholderPage title={title} />;
}

/** Mobile-protected layout with global boot (mirrors desktop ProtectedLayout) */
function MobileProtectedLayout() {
  useGlobalBoot();
  return (
    <ProtectedRoute>
      <MobileLayout />
    </ProtectedRoute>
  );
}

/** Loading fallback for lazy-loaded pages */
function MobileSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full min-h-[40vh]">
        <div className="h-8 w-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      {children}
    </Suspense>
  );
}

export function MobileRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={
        <MobileSuspense><Login /></MobileSuspense>
      } />

      {/* Protected — all inside MobileProtectedLayout */}
      <Route element={<MobileProtectedLayout />}>
        {/* Home Workspace (Batch 5) */}
        <Route index element={<HomeWorkspace />} />

        {/* Global tabs (no module tracking) */}
        <Route path="app" element={<AppWorkspace />} />
        <Route path="create" element={<MobileTaskWorkspace mode="create" />} />
        <Route path="dashboards" element={<MobileSuspense><Dashboards /></MobileSuspense>} />
        <Route path="recent" element={<Navigate to="/dashboards" replace />} />

        {/* Sales module placeholders */}
        {/* RoleRoute guards added below (RBAC live-verification root cause:
            these routes — added as unguarded stub "placeholders" and later
            built out into full workspaces — were the ONLY routes in this
            file without the module-permission check every desktop route
            already has, so a mobile user could reach them by direct URL
            regardless of their role's actual permissions, even when the
            module was correctly hidden from the mobile nav). Module names
            match the equivalent desktop route in app/router/routes.tsx
            exactly, so enforcement is identical on both platforms. */}
        <Route path="leads"      element={<RoleRoute module="leads"><MobileLeadWorkspace mode="records" /></RoleRoute>} />
        <Route path="customers"  element={<RoleRoute module="customers"><MobileCustomerWorkspace mode="records" /></RoleRoute>} />
        <Route path="loan-applications" element={<RoleRoute module="loan_applications"><MobileLoanApplicationWorkspace mode="records" /></RoleRoute>} />
        <Route path="registrations" element={<Navigate to="/loan-applications" replace />} />
        <Route path="projects"   element={<RoleRoute module="projects"><MobileProjectList mode="records" /></RoleRoute>} />
        <Route path="projects/:id" element={<RoleRoute module="projects"><MobileProjectWorkspace /></RoleRoute>} />
        <Route path="surveys"   element={<RoleRoute module="surveys"><MobileSurveyWorkspace /></RoleRoute>} />
        <Route path="engineering-designs" element={<RoleRoute module="engineering"><MobileEngineeringWorkspace /></RoleRoute>} />
        <Route path="vendors" element={<RoleRoute module="vendors"><MobileVendorWorkspace /></RoleRoute>} />
        <Route path="purchase-orders" element={<RoleRoute module="purchase_orders"><MobilePurchaseOrderWorkspace /></RoleRoute>} />
        <Route path="goods-receipts" element={<RoleRoute module="purchase_orders"><MobileGoodsReceiptWorkspace /></RoleRoute>} />
        <Route path="quotations" element={<RoleRoute module="quotations"><MobileQuotationWorkspace mode="records" /></RoleRoute>} />
        <Route path="orders"     element={<RoleRoute module="orders"><MobileOrderWorkspace mode="records" /></RoleRoute>} />
        <Route path="invoices"   element={<RoleRoute module="invoices"><MobileInvoiceWorkspace mode="records" /></RoleRoute>} />
        <Route path="sales-documents" element={<RoleRoute module="leads"><MobileSalesDocuments /></RoleRoute>} />

        {/* Inventory module placeholders */}
        <Route path="products"   element={<RoleRoute module="products"><MobileProductWorkspace mode="records" /></RoleRoute>} />
        <Route path="categories" element={<RoleRoute module="categories"><MobileCategoryWorkspace mode="records" /></RoleRoute>} />
        <Route path="warehouses" element={<RoleRoute module="warehouses"><MobileWarehouseWorkspace mode="records" /></RoleRoute>} />
        <Route path="stock"      element={<RoleRoute module="stock"><MobileStockWorkspace mode="records" /></RoleRoute>} />
        <Route path="dispatch"   element={<RoleRoute module="dispatch"><MobileDispatchWorkspace mode="records" /></RoleRoute>} />
        <Route path="partners"   element={<RoleRoute module="partners"><MobilePartnerWorkspace mode="records" /></RoleRoute>} />
        {/* Redirects from Desktop paths used by ModuleNavDrawer (navigationConfig) */}
        <Route path="partners/commission-rules" element={<Navigate to="/commission-rules" replace />} />
        <Route path="partners/commission-approvals" element={<Navigate to="/commission-approvals" replace />} />
        <Route path="partners/settlements" element={<Navigate to="/settlements" replace />} />
        <Route path="partners/performance" element={<Navigate to="/performance" replace />} />
        <Route path="commission-rules" element={<RoleRoute module="partners"><MobileCommissionRulesWorkspace /></RoleRoute>} />
        <Route path="commission-approvals" element={<RoleRoute module="partners"><MobileCommissionApprovalsWorkspace /></RoleRoute>} />
        <Route path="settlements" element={<RoleRoute module="partners"><MobileSettlementWorkspace mode="records" /></RoleRoute>} />
        <Route path="performance" element={<RoleRoute module="partners"><PartnerMobilePerformanceWorkspace /></RoleRoute>} />
        {/* Compliance */}
        <Route path="net-metering" element={<RoleRoute module="net_metering"><MobileNetMeteringWorkspace /></RoleRoute>} />
        <Route path="subsidy" element={<RoleRoute module="subsidy"><MobileSubsidyWorkspace /></RoleRoute>} />
        <Route path="tax-invoices" element={<RoleRoute module="tax_invoices"><MobileTaxInvoiceWorkspace /></RoleRoute>} />
        {/* Operations */}
        <Route path="commissioning" element={<RoleRoute module="commissioning"><MobileCommissioningWorkspace mode="records" /></RoleRoute>} />
        <Route path="qc" element={<RoleRoute module="qc"><MobileQCWorkspace mode="records" /></RoleRoute>} />
        <Route path="installations" element={<RoleRoute module="installations"><MobileSuspense><MobileInstallationsWorkspace mode="records" /></MobileSuspense></RoleRoute>} />
        <Route path="handovers" element={<RoleRoute module="projects"><MobileProjectHandoverWorkspace /></RoleRoute>} />
        <Route path="amc-contracts" element={<RoleRoute module="projects"><MobileAmcContractsWorkspace /></RoleRoute>} />
        <Route path="service-tickets" element={<RoleRoute module="service_tickets"><MobileServiceTicketWorkspace /></RoleRoute>} />
        <Route path="monitoring" element={<RoleRoute module="projects"><MobileMonitoringWorkspace /></RoleRoute>} />

        {/* Accounts module placeholders */}
        <Route path="payments"   element={<RoleRoute module="payments"><MobilePaymentWorkspace mode="records" /></RoleRoute>} />
        <Route path="reports"    element={<RoleRoute module="reports"><MobileReportsWorkspace /></RoleRoute>} />

        {/* HR module placeholders */}
        <Route path="employees"  element={<RoleRoute module="employees"><MobileEmployeesWorkspace mode="records" /></RoleRoute>} />
        <Route path="attendance" element={<RoleRoute module="attendance"><MobileAttendanceWorkspace /></RoleRoute>} />
        <Route path="payroll"    element={<RoleRoute module="payroll"><MobilePayrollWorkspace mode="records" /></RoleRoute>} />

        {/* Fraud & Risk */}
        <Route path="fraud"      element={<RoleRoute module="partners"><MobileFraudInvestigationWorkspace /></RoleRoute>} />

        {/* Productivity module placeholders */}
        <Route path="tasks"      element={<RoleRoute module="dashboard"><MobileTaskWorkspace mode="records" /></RoleRoute>} />
        <Route path="notifications" element={<RoleRoute module="dashboard"><MobileSuspense><NotificationsPage /></MobileSuspense></RoleRoute>} />
        <Route path="notifications/:id" element={<RoleRoute module="dashboard"><MobileSuspense><NotificationsPage /></MobileSuspense></RoleRoute>} />

        {/* Settings placeholders */}
        <Route path="users"      element={<RoleRoute module="users"><MobileUsersWorkspace mode="records" /></RoleRoute>} />
        <Route path="roles"      element={<RoleRoute module="roles"><MobileSuspense><RolesPage /></MobileSuspense></RoleRoute>} />
        <Route path="companies"  element={<RoleRoute module="companies"><MobileCompaniesWorkspace mode="records" /></RoleRoute>} />
        {/* No RoleRoute here, deliberately — matches desktop's routes.tsx.
            "settings" is not a single permission boundary: universal
            sections (Profile/General/Theme & Appearance/About ERP) must
            reach every authenticated user, while admin-controlled sections
            stay gated by SettingsSectionRenderer's own canViewSection()
            check, same permission source, applied per-section instead of
            once for the whole route. */}
        <Route path="settings"   element={<MobileSettingsWorkspace />} />
        <Route path="settings/:sectionId"   element={<MobileSettingsWorkspace />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>

      {/* Partner Mobile Portal — separate shell with custom bottom nav */}
      <Route element={<MobilePartnerPortalLayout />}>
        <Route path="/partner" element={<Navigate to="dashboard" replace />} />
        <Route path="/partner/dashboard"   element={<RoleRoute module="partners"><MobilePartnerHome /></RoleRoute>} />
        <Route path="/partner/leads"       element={<RoleRoute module="partners"><PartnerMobileLeadsWorkspace /></RoleRoute>} />
        <Route path="/partner/leads/new"   element={<RoleRoute module="partners"><PartnerMobileLeadsWorkspace /></RoleRoute>} />
        <Route path="/partner/customers"    element={<RoleRoute module="partners"><MobileSuspense><PartnerCustomers /></MobileSuspense></RoleRoute>} />
        <Route path="/partner/customers/new" element={<RoleRoute module="partners"><MobileSuspense><PartnerCustomers /></MobileSuspense></RoleRoute>} />
        <Route path="/partner/customers/:id" element={<RoleRoute module="partners"><MobileSuspense><PartnerCustomers /></MobileSuspense></RoleRoute>} />
        <Route path="/partner/projects"     element={<RoleRoute module="partners"><MobileSuspense><PartnerProjects /></MobileSuspense></RoleRoute>} />
        <Route path="/partner/projects/new" element={<RoleRoute module="partners"><MobileSuspense><PartnerProjects /></MobileSuspense></RoleRoute>} />
        <Route path="/partner/projects/:id" element={<RoleRoute module="partners"><MobileSuspense><PartnerProjects /></MobileSuspense></RoleRoute>} />
  <Route path="/partner/registration" element={<RoleRoute module="partners"><MobileSuspense><PartnerRegistration /></MobileSuspense></RoleRoute>} />
  {/* VL-9/VL-10: standalone Registration list (Manager/TL team view,
      Management/Director read-only, Admin controls) — desktop page reused. */}
  <Route path="/registration" element={<RoleRoute module="scheme_registration"><MobileSuspense><SchemeRegistrations /></MobileSuspense></RoleRoute>} />
        <Route path="/partner/wallet"      element={<RoleRoute module="partners"><PartnerMobileWalletWorkspace /></RoleRoute>} />
        <Route path="/partner/commissions" element={<RoleRoute module="partners"><PartnerMobileCommissionsWorkspace /></RoleRoute>} />
        <Route path="/partner/documents"   element={<RoleRoute module="partners"><PartnerMobileDocumentsWorkspace /></RoleRoute>} />
        <Route path="/partner/profile"     element={<RoleRoute module="partners"><PartnerMobileProfileWorkspace /></RoleRoute>} />
        <Route path="/partner/commission-rules" element={<RoleRoute module="partners"><PartnerMobileCommissionRulesWorkspace /></RoleRoute>} />
        <Route path="/partner/settlements" element={<RoleRoute module="partners"><PartnerMobileSettlementWorkspace /></RoleRoute>} />
        <Route path="/partner/performance" element={<RoleRoute module="partners"><PartnerMobilePerformanceWorkspace /></RoleRoute>} />
        <Route path="/partner/installations" element={<RoleRoute module="partners"><PartnerMobileInstallationWorkspace /></RoleRoute>} />
        <Route path="/partner/qc" element={<RoleRoute module="qc"><MobileQCWorkspace /></RoleRoute>} />
        <Route path="/partner/commissioning" element={<RoleRoute module="commissioning"><MobileCommissioningWorkspace /></RoleRoute>} />
        <Route path="/partner/notifications" element={<RoleRoute module="partners"><PartnerMobileNotificationCenter /></RoleRoute>} />
        <Route path="/partner/settings"      element={<RoleRoute module="partners"><PartnerMobilePlaceholder title="Settings" /></RoleRoute>} />
      </Route>
    </Routes>
  );
}

/** Mobile-protected partner portal layout with custom shell */
function MobilePartnerPortalLayout() {
  useGlobalBoot();
  const user = useAppStore((s) => s.user);
  // Phase 2 (G11 fix, mobile parity): same Partner-role restriction as the
  // desktop portal — only Partner (and super-admin oversight) may enter.
  if (user && !isPartnerPortalUser(user.role, user.isSuperAdmin)) {
    return <Navigate to="/" replace />;
  }
  return (
    <ProtectedRoute>
      <MobilePartnerShell />
    </ProtectedRoute>
  );
}

/** Placeholder for partner mobile pages (replaced in later phases) */
function PartnerMobilePlaceholder({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-[var(--color-primary-light)] flex items-center justify-center mb-4">
        <span className="text-2xl font-bold text-[var(--color-primary-text)]">
          {title.charAt(0).toUpperCase()}
        </span>
      </div>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-1">{title}</h2>
      <p className="text-sm text-[var(--color-text-muted)]">Coming soon</p>
    </div>
  );
}

export default MobileRoutes;
