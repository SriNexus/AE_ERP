/**
 * AppRoutes — Centralized route registry with lazy loading
 * All pages are code-split for optimal bundle performance.
 */

import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Layout             from '../../components/layout/Layout';
import { ProtectedRoute } from '../../components/auth/ProtectedRoute';
import { RoleRoute }      from '../../components/auth/RoleRoute';
import { OwnerRoute } from '../../components/auth/OwnerRoute';
import { SuperAdminRoute } from '../../components/auth/SuperAdminRoute';
import { useGlobalBoot }  from '../../lib/useGlobalBoot';
import { ErrorBoundary }  from '../../components/shared/ErrorBoundary';
import { useAppStore }    from '../../store/useAppStore';
import { useDemoSession } from '../../lib/demoSession';
import { isPartnerPortalUser } from '../../lib/permissions';
import PartnerLayout      from '../../components/partner/PartnerLayout';

// ── Lazy page imports (route-level code splitting) ────────────
const InstallationsPage = lazy(() => import('../../pages/Installations'));
const InstallationWorkspace = lazy(() => import('../../pages/InstallationWorkspace'));
const QC            = lazy(() => import('../../pages/QC'));
const QCWorkspace   = lazy(() => import('../../pages/QCWorkspace'));
const Commissioning = lazy(() => import('../../pages/Commissioning'));
const CommissioningWorkspace = lazy(() => import('../../pages/CommissioningWorkspace'));
const Login        = lazy(() => import('../../pages/Login'));
const Home         = lazy(() => import('../../pages/Home'));
const Dashboards   = lazy(() => import('../../pages/Dashboards'));
const Tasks        = lazy(() => import('../../pages/Tasks'));

// HR
const Employees    = lazy(() => import('../../pages/Employees'));
const Attendance   = lazy(() => import('../../pages/Attendance'));
const Payroll      = lazy(() => import('../../pages/Payroll'));

// Sales
const Leads        = lazy(() => import('../../pages/Leads'));
const LeadWorkspace = lazy(() => import('../../pages/LeadWorkspace'));
const LoanApplications = lazy(() => import('../../pages/LoanApplications'));
const Customers    = lazy(() => import('../../pages/Customers'));
const CustomerWorkspace = lazy(() => import('../../pages/CustomerWorkspace'));
const Quotations   = lazy(() => import('../../pages/Quotations'));
const QuotationsWorkspace = lazy(() => import('../../pages/QuotationsWorkspace'));
const Orders       = lazy(() => import('../../pages/Orders'));
const OrdersWorkspace = lazy(() => import('../../pages/OrdersWorkspace'));
const Invoices     = lazy(() => import('../../pages/Invoices'));
const InvoiceDetail = lazy(() => import('../../pages/InvoiceDetail'));
const SalesDocuments = lazy(() => import('../../pages/SalesDocuments'));
const Projects     = lazy(() => import('../../pages/Projects'));
const ProjectWorkspace = lazy(() => import('../../pages/ProjectWorkspace'));
const Surveys      = lazy(() => import('../../pages/Surveys'));
const EngineeringDesigns = lazy(() => import('../../pages/EngineeringDesigns'));
const Vendors      = lazy(() => import('../../pages/Vendors'));
const VendorsWorkspace = lazy(() => import('../../pages/VendorsWorkspace'));
const PurchaseOrders = lazy(() => import('../../pages/PurchaseOrders'));
const PurchaseOrdersWorkspace = lazy(() => import('../../pages/PurchaseOrdersWorkspace'));
const GoodsReceipts = lazy(() => import('../../pages/GoodsReceipts'));
const GoodsReceiptsWorkspace = lazy(() => import('../../pages/GoodsReceiptsWorkspace'));

// Inventory
const Products     = lazy(() => import('../../pages/Products'));
const Categories   = lazy(() => import('../../pages/Categories'));
const Warehouses   = lazy(() => import('../../pages/Warehouses'));
const Stock        = lazy(() => import('../../pages/Stock'));
const StockLedger  = lazy(() => import('../../pages/StockLedger'));
const Dispatch     = lazy(() => import('../../pages/Dispatch'));
const DispatchDetail = lazy(() => import('../../pages/DispatchDetail'));

// Accounts
const Payments     = lazy(() => import('../../pages/Payments'));
const PaymentsWorkspace = lazy(() => import('../../pages/PaymentsWorkspace'));
const Reports      = lazy(() => import('../../pages/Reports'));
const Notifications = lazy(() => import('../../pages/Notifications'));
const TaxInvoices  = lazy(() => import('../../pages/TaxInvoices'));

// Channel Partners
const PartnersPage  = lazy(() => import('../../pages/Partners'));
const PartnersWorkspace = lazy(() => import('../../pages/PartnersWorkspace'));
const PartnerCommissionsPage = lazy(() => import('../../pages/PartnerCommissions'));
const SettlementsPage = lazy(() => import('../../pages/Settlements'));
const SettlementsWorkspace = lazy(() => import('../../pages/SettlementsWorkspace'));
const CommissionRulesPage = lazy(() => import('../../pages/CommissionRules'));
const CommissionRulesWorkspace = lazy(() => import('../../pages/CommissionRulesWorkspace'));
const CommissionApprovalsPage = lazy(() => import('../../pages/CommissionApprovals'));
const CommissionApprovalsWorkspace = lazy(() => import('../../pages/CommissionApprovalsWorkspace'));
const PartnerPerformancePage = lazy(() => import('../../pages/PartnerPerformance'));
const FraudInvestigationPage = lazy(() => import('../../pages/FraudInvestigation'));

// Partner Portal
const PartnerDashboard    = lazy(() => import('../../pages/partner/PartnerDashboard'));
const PartnerLeads        = lazy(() => import('../../pages/partner/PartnerLeads'));
const PartnerCustomers    = lazy(() => import('../../pages/partner/PartnerCustomers'));
const PartnerProjects     = lazy(() => import('../../pages/partner/PartnerProjects'));
const PartnerWallet       = lazy(() => import('../../pages/partner/PartnerWallet'));
const PartnerCommissionsHistory = lazy(() => import('../../pages/partner/PartnerCommissions'));
const PartnerDocuments    = lazy(() => import('../../pages/partner/PartnerDocuments'));
const PartnerProfile      = lazy(() => import('../../pages/partner/PartnerProfile'));
const PartnerSettings     = lazy(() => import('../../pages/partner/PartnerSettings'));
const PartnerRegistration = lazy(() => import('../../pages/partner/PartnerRegistration'));
// VL-9/VL-10: standalone Registration (Vendor Lock / Scheme Registration)
// list — Manager/TL team view + Management/Director read-only + Admin controls.
const SchemeRegistrations = lazy(() => import('../../pages/SchemeRegistrations'));
const NetMetering = lazy(() => import('../../pages/NetMetering'));
const Subsidy = lazy(() => import('../../pages/Subsidy'));
const ProjectHandover = lazy(() => import('../../pages/ProjectHandover'));
const AmcContracts = lazy(() => import('../../pages/AmcContracts'));
const AmcContractsWorkspace = lazy(() => import('../../pages/AmcContractsWorkspace'));
const ServiceTickets = lazy(() => import('../../pages/ServiceTickets'));
const ServiceTicketsWorkspace = lazy(() => import('../../pages/ServiceTicketsWorkspace'));
const NetMeteringWorkspace = lazy(() => import('../../pages/NetMeteringWorkspace'));
const SubsidyWorkspace = lazy(() => import('../../pages/SubsidyWorkspace'));
const ProjectHandoverWorkspace = lazy(() => import('../../pages/ProjectHandoverWorkspace'));
const Monitoring = lazy(() => import('../../pages/Monitoring'));
const MonitoringWorkspace = lazy(() => import('../../pages/MonitoringWorkspace'));

// Cases
const CasesDash = lazy(() => import('../../pages/CasesDash'));
const CaseAnalytics = lazy(() => import('../../pages/CaseAnalytics'));
const CaseSearch = lazy(() => import('../../pages/CaseSearch'));
const CaseReports = lazy(() => import('../../pages/CaseReports'));
const CasesWorkspace = lazy(() => import('../../pages/CasesWorkspace'));

// AI Intelligence
const AiIntelligence = lazy(() => import('../../pages/AiIntelligence'));

// Audit Logs
const AuditLogs = lazy(() => import('../../pages/AuditLogs'));

// Phase 4 (Master Plan §6): Super Admin Control Plane
const PlatformDashboard = lazy(() => import('../../pages/platform/PlatformDashboard'));
const PlatformGroups    = lazy(() => import('../../pages/platform/PlatformGroups'));
const PlatformCompanies = lazy(() => import('../../pages/platform/PlatformCompanies'));
const PlatformUsers     = lazy(() => import('../../pages/platform/PlatformUsers'));
const GroupOverview     = lazy(() => import('../../pages/group/GroupOverview'));
const GroupTeams        = lazy(() => import('../../pages/group/GroupTeams'));
const GroupSettingsPage = lazy(() => import('../../pages/group/GroupSettings'));
const PlatformSecurity  = lazy(() => import('../../pages/platform/PlatformSecurity'));
const PlatformSettings  = lazy(() => import('../../pages/platform/PlatformSettings'));

// Settings
const UsersPage    = lazy(() => import('../../pages/Users'));
const BanksPage    = lazy(() => import('../../pages/Banks'));
const Companies    = lazy(() => import('../../pages/Companies'));
const SettingsPage = lazy(() => import('../../pages/Settings'));
const RolesPage    = lazy(() => import('../../pages/Roles'));

// ── Page-level loading fallback ───────────────────────────────
function PageSkeleton() {
  return (
    <div className="space-y-4 animate-pulse p-1">
      <div className="h-8 w-64 skeleton rounded-lg" />
      <div className="grid grid-cols-4 gap-3">
        {[...Array(4)].map((_,i) => <div key={i} className="h-24 skeleton rounded-xl" />)}
      </div>
      <div className="h-64 skeleton rounded-xl" />
    </div>
  );
}

function SafePage({ children }: { children: ReactNode }) {
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const user = useAppStore((state) => state.user);
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = (activeCompanyId && activeCompanyId !== 'all' && activeCompanyId !== 'default')
    ? activeCompanyId
    : user?.companyId && user?.companyId !== 'default'
      ? user?.companyId
      : '';

  return (
    <Suspense fallback={<PageSkeleton />}>
      <ErrorBoundary monitoringContext={{ companyId, userId: user?.id, userEmail: user?.email }}>
        {children}
      </ErrorBoundary>
    </Suspense>
  );
}

// ── Legacy /leads/:id redirect — the single-record Lead detail
// experience is now exclusively /leads/workspace/:leadId. This keeps
// any old bookmarked/shared /leads/:id links working.
function LegacyLeadRedirect() {
  const { id } = useParams();
  return <Navigate to={`/leads/workspace/${id}`} replace />;
}

// ── Protected layout wrapper ──────────────────────────────────
function ProtectedLayout() {
  useGlobalBoot();
  useDemoSession();
  return (
    <ProtectedRoute>
      <Layout />
    </ProtectedRoute>
  );
}

// ── Partner Portal layout wrapper (no app sidebar) ────────────
function PartnerPortalLayout() {
  useGlobalBoot();
  const user = useAppStore((s) => s.user);
  // Phase 2 (G11 fix): the portal is a Partner-role surface — it must not be
  // open to every role holding `partners:view`. Only the Partner role (and
  // super-admin oversight) may enter; everyone else is redirected to the app.
  if (user && !isPartnerPortalUser(user.role, user.isSuperAdmin)) {
    return <Navigate to="/" replace />;
  }
  return (
    <ProtectedRoute>
      <PartnerLayout />
    </ProtectedRoute>
  );
}

// ── Route tree ────────────────────────────────────────────────
export function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<SafePage><Login /></SafePage>} />

      {/* Protected — all inside ProtectedLayout */}
      <Route element={<ProtectedLayout />}>
        <Route path="/"           element={<RoleRoute module="dashboard"><SafePage><Home /></SafePage></RoleRoute>} />
        <Route path="/dashboard"  element={<RoleRoute module="dashboard"><SafePage><Home /></SafePage></RoleRoute>} />
        <Route path="/dashboards" element={<RoleRoute module="dashboard"><SafePage><Dashboards /></SafePage></RoleRoute>} />
        <Route path="/tasks"      element={<RoleRoute module="dashboard"><SafePage><Tasks /></SafePage></RoleRoute>} />
        <Route path="/tasks/:id"  element={<RoleRoute module="dashboard"><SafePage><Tasks /></SafePage></RoleRoute>} />

        {/* HR */}
        <Route path="/employees"  element={<RoleRoute module="employees"><SafePage><Employees /></SafePage></RoleRoute>} />
        <Route path="/attendance" element={<RoleRoute module="attendance"><SafePage><Attendance /></SafePage></RoleRoute>} />
        <Route path="/payroll"    element={<RoleRoute module="payroll"><SafePage><Payroll /></SafePage></RoleRoute>} />

        {/* Sales */}
        <Route path="/leads"      element={<RoleRoute module="leads"><SafePage><Leads /></SafePage></RoleRoute>} />
        <Route path="/leads/workspace/:leadId" element={<RoleRoute module="leads"><SafePage><LeadWorkspace /></SafePage></RoleRoute>} />
        <Route path="/leads/:id"   element={<LegacyLeadRedirect />} />
        <Route path="/loan-applications" element={<RoleRoute module="loan_applications"><SafePage><LoanApplications /></SafePage></RoleRoute>} />
        {/* Backward-compatible redirect: the old loan module route now lives at /loan-applications */}
        <Route path="/registrations" element={<Navigate to="/loan-applications" replace />} />
        <Route path="/customers"  element={<RoleRoute module="customers"><SafePage><Customers /></SafePage></RoleRoute>} />
        <Route path="/customers/:id" element={<RoleRoute module="customers"><SafePage><CustomerWorkspace /></SafePage></RoleRoute>} />
        <Route path="/projects"   element={<RoleRoute module="projects"><SafePage><Projects /></SafePage></RoleRoute>} />
        <Route path="/projects/:id" element={<RoleRoute module="projects"><SafePage><ProjectWorkspace /></SafePage></RoleRoute>} />
        <Route path="/surveys"   element={<RoleRoute module="surveys"><SafePage><Surveys /></SafePage></RoleRoute>} />
        <Route path="/engineering-designs" element={<RoleRoute module="engineering"><SafePage><EngineeringDesigns /></SafePage></RoleRoute>} />
        <Route path="/vendors" element={<RoleRoute module="vendors"><SafePage><Vendors /></SafePage></RoleRoute>} />
        <Route path="/vendors/:id" element={<RoleRoute module="vendors"><SafePage><VendorsWorkspace /></SafePage></RoleRoute>} />
        <Route path="/purchase-orders" element={<RoleRoute module="purchase_orders"><SafePage><PurchaseOrders /></SafePage></RoleRoute>} />
        <Route path="/purchase-orders/:id" element={<RoleRoute module="purchase_orders"><SafePage><PurchaseOrdersWorkspace /></SafePage></RoleRoute>} />
        <Route path="/goods-receipts" element={<RoleRoute module="purchase_orders"><SafePage><GoodsReceipts /></SafePage></RoleRoute>} />
        <Route path="/goods-receipts/:id" element={<RoleRoute module="purchase_orders"><SafePage><GoodsReceiptsWorkspace /></SafePage></RoleRoute>} />
        <Route path="/quotations" element={<RoleRoute module="quotations"><SafePage><Quotations /></SafePage></RoleRoute>} />
        <Route path="/quotations/:id" element={<RoleRoute module="quotations"><SafePage><QuotationsWorkspace /></SafePage></RoleRoute>} />
        <Route path="/orders"     element={<RoleRoute module="orders"><SafePage><Orders /></SafePage></RoleRoute>} />
        <Route path="/orders/:id"  element={<RoleRoute module="orders"><SafePage><OrdersWorkspace /></SafePage></RoleRoute>} />
        <Route path="/invoices"   element={<RoleRoute module="invoices"><SafePage><Invoices /></SafePage></RoleRoute>} />
        <Route path="/invoices/:id" element={<RoleRoute module="invoices"><SafePage><InvoiceDetail /></SafePage></RoleRoute>} />
        <Route path="/sales-documents" element={<RoleRoute module="leads"><SafePage><SalesDocuments /></SafePage></RoleRoute>} />

        {/* Inventory */}
        <Route path="/products"   element={<RoleRoute module="products"><SafePage><Products /></SafePage></RoleRoute>} />
        <Route path="/categories" element={<RoleRoute module="categories"><SafePage><Categories /></SafePage></RoleRoute>} />
        <Route path="/warehouses" element={<RoleRoute module="warehouses"><SafePage><Warehouses /></SafePage></RoleRoute>} />
        <Route path="/stock"        element={<RoleRoute module="stock"><SafePage><Stock /></SafePage></RoleRoute>} />
        <Route path="/stock-ledger" element={<RoleRoute module="stock"><SafePage><StockLedger /></SafePage></RoleRoute>} />
        <Route path="/dispatch"     element={<RoleRoute module="dispatch"><SafePage><Dispatch /></SafePage></RoleRoute>} />
        <Route path="/dispatch/:id" element={<RoleRoute module="dispatch"><SafePage><DispatchDetail /></SafePage></RoleRoute>} />
        <Route path="/qc" element={<RoleRoute module="qc"><SafePage><QC /></SafePage></RoleRoute>} />
        <Route path="/qc/:id" element={<RoleRoute module="qc"><SafePage><QCWorkspace /></SafePage></RoleRoute>} />
        <Route path="/installations" element={<RoleRoute module="installations"><SafePage><InstallationsPage /></SafePage></RoleRoute>} />
        <Route path="/installations/:id" element={<RoleRoute module="installations"><SafePage><InstallationWorkspace /></SafePage></RoleRoute>} />
        <Route path="/commissioning" element={<RoleRoute module="commissioning"><SafePage><Commissioning /></SafePage></RoleRoute>} />
        <Route path="/commissioning/:id" element={<RoleRoute module="commissioning"><SafePage><CommissioningWorkspace /></SafePage></RoleRoute>} />
        <Route path="/net-metering" element={<RoleRoute module="net_metering"><SafePage><NetMetering /></SafePage></RoleRoute>} />
        <Route path="/net-metering/:id" element={<RoleRoute module="net_metering"><SafePage><NetMeteringWorkspace /></SafePage></RoleRoute>} />
        <Route path="/subsidy" element={<RoleRoute module="subsidy"><SafePage><Subsidy /></SafePage></RoleRoute>} />
        <Route path="/subsidy/:id" element={<RoleRoute module="subsidy"><SafePage><SubsidyWorkspace /></SafePage></RoleRoute>} />
        <Route path="/handovers" element={<RoleRoute module="projects"><SafePage><ProjectHandover /></SafePage></RoleRoute>} />
        <Route path="/handovers/:id" element={<RoleRoute module="projects"><SafePage><ProjectHandoverWorkspace /></SafePage></RoleRoute>} />
        <Route path="/amc-contracts" element={<RoleRoute module="projects"><SafePage><AmcContracts /></SafePage></RoleRoute>} />
        <Route path="/amc-contracts/:id" element={<RoleRoute module="projects"><SafePage><AmcContractsWorkspace /></SafePage></RoleRoute>} />
        <Route path="/service-tickets" element={<RoleRoute module="service_tickets"><SafePage><ServiceTickets /></SafePage></RoleRoute>} />
        <Route path="/service-tickets/:id" element={<RoleRoute module="service_tickets"><SafePage><ServiceTicketsWorkspace /></SafePage></RoleRoute>} />
        <Route path="/monitoring" element={<RoleRoute module="projects"><SafePage><Monitoring /></SafePage></RoleRoute>} />
        <Route path="/monitoring/:id" element={<RoleRoute module="projects"><SafePage><MonitoringWorkspace /></SafePage></RoleRoute>} />

        {/* Accounts */}
        <Route path="/payments"   element={<RoleRoute module="payments"><SafePage><Payments /></SafePage></RoleRoute>} />
        <Route path="/payments/:id" element={<RoleRoute module="payments"><SafePage><PaymentsWorkspace /></SafePage></RoleRoute>} />
        <Route path="/reports"    element={<RoleRoute module="reports"><SafePage><Reports /></SafePage></RoleRoute>} />
        <Route path="/tax-invoices" element={<RoleRoute module="tax_invoices"><SafePage><TaxInvoices /></SafePage></RoleRoute>} />
        <Route path="/notifications" element={<RoleRoute module="dashboard"><SafePage><Notifications /></SafePage></RoleRoute>} />
        <Route path="/notifications/:id" element={<RoleRoute module="dashboard"><SafePage><Notifications /></SafePage></RoleRoute>} />
        {/* Cases */}
        <Route path="/cases" element={<RoleRoute module="cases"><SafePage><CasesDash /></SafePage></RoleRoute>} />
        <Route path="/cases/analytics" element={<RoleRoute module="cases"><SafePage><CaseAnalytics /></SafePage></RoleRoute>} />
        <Route path="/cases/search" element={<RoleRoute module="cases"><SafePage><CaseSearch /></SafePage></RoleRoute>} />
        <Route path="/cases/reports" element={<RoleRoute module="cases"><SafePage><CaseReports /></SafePage></RoleRoute>} />
        <Route path="/cases/:id" element={<RoleRoute module="cases"><SafePage><CasesWorkspace /></SafePage></RoleRoute>} />

        <Route path="/ai-intelligence" element={<SuperAdminRoute><SafePage><AiIntelligence /></SafePage></SuperAdminRoute>} />
        <Route path="/audit-logs" element={<SuperAdminRoute><SafePage><AuditLogs /></SafePage></SuperAdminRoute>} />

        {/* Phase 4 (Master Plan §6): Super Admin Control Plane — every screen
            gated by SuperAdminRoute (owner identity only), no RoleRoute. */}
        <Route path="/platform"            element={<SuperAdminRoute><SafePage><PlatformDashboard /></SafePage></SuperAdminRoute>} />
        <Route path="/platform/groups"     element={<SuperAdminRoute><SafePage><PlatformGroups /></SafePage></SuperAdminRoute>} />
        <Route path="/platform/companies"  element={<SuperAdminRoute><SafePage><PlatformCompanies /></SafePage></SuperAdminRoute>} />
        <Route path="/platform/users"      element={<SuperAdminRoute><SafePage><PlatformUsers /></SafePage></SuperAdminRoute>} />
        <Route path="/platform/security"   element={<SuperAdminRoute><SafePage><PlatformSecurity /></SafePage></SuperAdminRoute>} />
        <Route path="/platform/settings"   element={<SuperAdminRoute><SafePage><PlatformSettings /></SafePage></SuperAdminRoute>} />

        {/* Group Administration console — Super Admin (owner identity) only,
            gated by SuperAdminRoute. GroupAdmin actors manage their own group's
            users/companies/warehouses through the main business pages
            (/users, /companies, /warehouses — RoleRoute-gated), not this
            console. Screens reuse the existing business pages (Companies/
            Users/Warehouses/Roles/AuditLogs) — the 'group' sentinel
            (activeCompanyId) + query layer scope them Group-wide; new screens
            are GroupOverview/GroupTeams/GroupSettings. */}
        <Route path="/group"              element={<SuperAdminRoute><SafePage><GroupOverview /></SafePage></SuperAdminRoute>} />
        <Route path="/group/companies"   element={<SuperAdminRoute><SafePage><Companies /></SafePage></SuperAdminRoute>} />
        <Route path="/group/warehouses"  element={<SuperAdminRoute><SafePage><Warehouses /></SafePage></SuperAdminRoute>} />
        <Route path="/group/users"       element={<SuperAdminRoute><SafePage><UsersPage /></SafePage></SuperAdminRoute>} />
        <Route path="/group/teams"       element={<SuperAdminRoute><SafePage><GroupTeams /></SafePage></SuperAdminRoute>} />
        <Route path="/group/roles"       element={<SuperAdminRoute><SafePage><RolesPage /></SafePage></SuperAdminRoute>} />
        <Route path="/group/audit-log"   element={<SuperAdminRoute><SafePage><AuditLogs /></SafePage></SuperAdminRoute>} />
        <Route path="/group/settings"    element={<SuperAdminRoute><SafePage><GroupSettingsPage /></SafePage></SuperAdminRoute>} />

        {/* Channel Partners */}
        {/* VL-9/VL-10: standalone Registration list (team/management/admin view).
            Partner-portal users are redirected to /partner/registration inside
            the page; the loan /registrations route remains untouched. */}
        <Route path="/registration" element={<RoleRoute module="scheme_registration"><SafePage><SchemeRegistrations /></SafePage></RoleRoute>} />
        <Route path="/partners">
          <Route index element={<RoleRoute module="partners"><SafePage><PartnersPage /></SafePage></RoleRoute>} />
          <Route path=":id" element={<RoleRoute module="partners"><SafePage><PartnersWorkspace /></SafePage></RoleRoute>} />
          <Route path="commissions" element={<RoleRoute module="partners"><SafePage><PartnerCommissionsPage /></SafePage></RoleRoute>} />
          <Route path="settlements">
            <Route index element={<RoleRoute module="partners"><SafePage><SettlementsPage /></SafePage></RoleRoute>} />
            <Route path=":id" element={<RoleRoute module="partners"><SafePage><SettlementsWorkspace /></SafePage></RoleRoute>} />
          </Route>
          <Route path="commission-rules">
            <Route index element={<RoleRoute module="partners"><SafePage><CommissionRulesPage /></SafePage></RoleRoute>} />
            <Route path=":id" element={<RoleRoute module="partners"><SafePage><CommissionRulesWorkspace /></SafePage></RoleRoute>} />
          </Route>
          <Route path="commission-approvals">
            <Route index element={<RoleRoute module="partners"><SafePage><CommissionApprovalsPage /></SafePage></RoleRoute>} />
            <Route path=":id" element={<RoleRoute module="partners"><SafePage><CommissionApprovalsWorkspace /></SafePage></RoleRoute>} />
          </Route>
          <Route path="performance" element={<RoleRoute module="partners"><SafePage><PartnerPerformancePage /></SafePage></RoleRoute>} />
          <Route path="fraud-investigation" element={<RoleRoute module="partners"><SafePage><FraudInvestigationPage /></SafePage></RoleRoute>} />
        </Route>

        {/* Settings */}
        <Route path="/users"     element={<RoleRoute module="users"><SafePage><UsersPage /></SafePage></RoleRoute>} />
        <Route path="/banks"     element={<RoleRoute module="banks"><SafePage><BanksPage /></SafePage></RoleRoute>} />
        <Route path="/roles"     element={<RoleRoute module="roles"><SafePage><RolesPage /></SafePage></RoleRoute>} />
        <Route path="/companies" element={<RoleRoute module="companies"><SafePage><Companies /></SafePage></RoleRoute>} />
        <Route path="/settings" element={<Navigate to="/settings/my-profile" replace />} />
        {/*
          No RoleRoute here, deliberately: "settings" is not a single
          permission boundary. Settings contains a mix of universal sections
          (Profile, General, Theme & Appearance, About ERP — every
          authenticated user) and admin-controlled sections (Theme UI,
          Email, WhatsApp, SMS, Integrations, etc). Gating the whole route
          behind one RoleRoute module="settings" check required every role
          to have settings.view=true just to reach Profile — which most
          non-admin roles never had, making Settings effectively admin-only.
          SettingsSectionRenderer already does the correct per-section check
          via canViewSection() (features/settings/permissions.ts): universal
          sections always pass, admin-only sections still require
          canDo('view','settings') — the exact same permission this route
          guard used to gate everything with. ProtectedLayout (above, via
          ProtectedRoute) still requires authentication for this whole route.
        */}
        <Route path="/settings/:sectionId" element={<SafePage><SettingsPage /></SafePage>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>

      {/* Partner Portal — separate layout, no app sidebar */}
      <Route element={<PartnerPortalLayout />}>
        <Route path="/partner" element={<Navigate to="dashboard" replace />} />
        <Route path="/partner/dashboard"    element={<RoleRoute module="partners"><SafePage><PartnerDashboard /></SafePage></RoleRoute>} />
        <Route path="/partner/leads"        element={<RoleRoute module="partners"><SafePage><PartnerLeads /></SafePage></RoleRoute>} />
        <Route path="/partner/leads/new"    element={<RoleRoute module="partners"><SafePage><PartnerLeads /></SafePage></RoleRoute>} />
        <Route path="/partner/leads/:id"    element={<RoleRoute module="partners"><SafePage><PartnerLeads /></SafePage></RoleRoute>} />
        <Route path="/partner/customers"    element={<RoleRoute module="partners"><SafePage><PartnerCustomers /></SafePage></RoleRoute>} />
        <Route path="/partner/customers/new" element={<RoleRoute module="partners"><SafePage><PartnerCustomers /></SafePage></RoleRoute>} />
        <Route path="/partner/customers/:id" element={<RoleRoute module="partners"><SafePage><PartnerCustomers /></SafePage></RoleRoute>} />
        <Route path="/partner/projects"     element={<RoleRoute module="partners"><SafePage><PartnerProjects /></SafePage></RoleRoute>} />
        <Route path="/partner/projects/new" element={<RoleRoute module="partners"><SafePage><PartnerProjects /></SafePage></RoleRoute>} />
        <Route path="/partner/projects/:id" element={<RoleRoute module="partners"><SafePage><PartnerProjects /></SafePage></RoleRoute>} />
        <Route path="/partner/wallet"       element={<RoleRoute module="partners"><SafePage><PartnerWallet /></SafePage></RoleRoute>} />
        <Route path="/partner/commissions"  element={<RoleRoute module="partners"><SafePage><PartnerCommissionsHistory /></SafePage></RoleRoute>} />
        <Route path="/partner/documents"    element={<RoleRoute module="partners"><SafePage><PartnerDocuments /></SafePage></RoleRoute>} />
        <Route path="/partner/profile"      element={<RoleRoute module="partners"><SafePage><PartnerProfile /></SafePage></RoleRoute>} />
        <Route path="/partner/registration" element={<RoleRoute module="partners"><SafePage><PartnerRegistration /></SafePage></RoleRoute>} />
        <Route path="/partner/settings"     element={<RoleRoute module="partners"><SafePage><PartnerSettings /></SafePage></RoleRoute>} />
      </Route>
    </Routes>
  );
}
