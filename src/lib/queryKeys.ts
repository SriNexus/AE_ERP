/**
 * queryKeys — Centralized React Query key factory
 *
 * Architecture:
 *   - Company-scoped queries: include activeCompanyId so cache isolates per company.
 *     When company switches, these keys differ → no stale cross-company data render.
 *   - Global queries: no company scope — they are cross-company by design.
 *
 * Usage (in hooks):
 *   const { activeCompanyId } = useAppStore();
 *   const keys = queryKeys.forCompany(activeCompanyId);
 *   useInfiniteQuery({ queryKey: keys.leadsPaged, queryFn: ... });
 *   useQuery({ queryKey: keys.leadsAll, queryFn: ... });
 *   qc.invalidateQueries({ queryKey: keys.leadsRoot });
 *
 * Usage (for global queries):
 *   useQuery({ queryKey: queryKeys.global.companies, queryFn: ... });
 *
 * Invalidation on company switch:
 *   CompanySwitcher calls qc.invalidateQueries() (no args = all).
 *   This is already correct and remains unchanged.
 */

// ── Company-scoped key factory ────────────────────────────
// Returns keys that include companyId as the second element.
// React Query's prefix matching means invalidating ['leads', cid]
// only invalidates that company's leads cache.

function forCompany(companyId: string) {
  const c = companyId || 'default';
  return {
    // Sales
    leadsRoot:       ['leads',       c] as const,
    leadsPaged:      ['leads',       c, 'paged'] as const,
    leadsAll:        ['leads',       c, 'all'] as const,
    banksRoot: ['banks', c] as const,
    banksAll: ['banks', c, 'all'] as const,
    registrationsRoot: ['registrations', c] as const,
    registrationsPaged: ['registrations', c, 'paged'] as const,
    registrationsAll: ['registrations', c, 'all'] as const,
    projectsRoot:    ['projects',    c] as const,
    caseDocumentsRoot: ['documents', c] as const,
    caseDocumentsAll:  ['documents', c, 'all'] as const,
    surveysRoot:     ['surveys',     c] as const,
    surveysAll:      ['surveys',     c, 'all'] as const,
    engineeringRoot: ['engineering_designs', c] as const,
    engineeringAll:  ['engineering_designs', c, 'all'] as const,
    qcChecks:         ['qc_checks',         c] as const,
    qcChecksAll:      ['qc_checks',         c, 'all'] as const,
    installationsRoot: ['installations',    c] as const,
    installationsAll:  ['installations',    c, 'all'] as const,
    commissioningRecords: ['commissioning_records', c] as const,
    commissioningRecordsAll: ['commissioning_records', c, 'all'] as const,
    netMetering: ['net_metering_applications', c] as const,
    netMeteringAll: ['net_metering_applications', c, 'all'] as const,
    subsidy: ['subsidy_applications', c] as const,
    subsidyAll: ['subsidy_applications', c, 'all'] as const,
    projectHandovers: ['project_handovers', c] as const,
    projectHandoversAll: ['project_handovers', c, 'all'] as const,
    amcContracts: ['amc_contracts', c] as const,
    amcContractsAll: ['amc_contracts', c, 'all'] as const,
    serviceTickets: ['service_tickets', c] as const,
    serviceTicketsAll: ['service_tickets', c, 'all'] as const,
    generationReadings: ['generation_readings', c] as const,
    generationReadingsAll: ['generation_readings', c, 'all'] as const,
    vendors:          ['vendors',      c] as const,
    purchaseOrders:   ['purchase_orders', c] as const,
    goodsReceipts:    ['goods_receipts', c] as const,
    customersRoot:   ['customers',   c] as const,
    customersPaged:  ['customers',   c, 'paged'] as const,
    customersAll:    ['customers',   c, 'all'] as const,
    ordersRoot:      ['orders',      c] as const,
    ordersPaged:     ['orders',      c, 'paged'] as const,
    ordersAll:       ['orders',      c, 'all'] as const,
    quotationsRoot:  ['quotations',  c] as const,
    quotationsPaged: ['quotations',  c, 'paged'] as const,
    quotationsAll:   ['quotations',  c, 'all'] as const,
    invoices:    ['invoices',    c] as const,
    taxInvoices: ['tax_invoices', c] as const,
    payments:    ['payments',    c] as const,
    dispatchRoot:    ['dispatch',    c] as const,
    dispatchPaged:   ['dispatch',    c, 'paged'] as const,
    dispatchAll:     ['dispatch',    c, 'all'] as const,
    // Inventory
    productsRoot:    ['products',    c] as const,
    productsPaged:   ['products',    c, 'paged'] as const,
    productsAll:     ['products',    c, 'all'] as const,
    categories:  ['product_categories', c] as const,
    warehouses:  ['warehouses',  c] as const,
    stock:       ['stock',       c] as const,
    stockLedger: ['stock_ledger', c] as const,
    // HR (company-scoped)
    employees:   ['employees',   c] as const,
    attendance:  ['attendance',  c] as const,
    payroll:     ['payroll',     c] as const,
    // Notifications (company-scoped)
    notifications: ['notifications', c] as const,
    // Channel Partners
    partnersRoot:    ['channel_partners',         c] as const,
    partnersAll:     ['channel_partners',         c, 'all'] as const,
    partnersPaged:   ['channel_partners',         c, 'paged'] as const,
    partnerSelf:     ['channel_partners',         c, 'self'] as const,
    partnerWalletTxns: ['partner_wallet_transactions', c] as const,
    commissionRules: ['commission_rules',         c] as const,
    commissionRecords: ['commission_records',         c] as const,
    settlementsRoot:     ['settlements',                        c] as const,
    settlementsAll:      ['settlements',                        c, 'all'] as const,
    settlementsPaged:    ['settlements',                        c, 'paged'] as const,
    // Phase 6 (Channel Partner — Vendor Lock / Registration).
    schemeRegistrationsRoot:  ['scheme_registrations', c] as const,
    schemeRegistrationsPaged: ['scheme_registrations', c, 'paged'] as const,
    schemeRegistrationsAll:   ['scheme_registrations', c, 'all'] as const,
    settlementsLegacy:   ['partner_wallet_transactions',        c, 'withdrawals'] as const,
    // Settings
    settings:    ['settings',    c] as const,
    settingsAll: ['settings',    c, 'all'] as const,
  } as const;
}

// ── Global (cross-company) keys ────────────────────────────
// These are NOT scoped — they apply across all companies.
const global = {
  companies:       ['companies']         as const,
  companiesGlobal: ['companies_global']  as const,
  roles:           ['roles_global']      as const,
  rolesPage:       ['roles']             as const,
  users:           ['users']             as const,
  usersHierarchy:  ['users_hierarchy']   as const,
  globalSearch:    ['global-search']     as const,  // sub-keyed by query string
} as const;

export const queryKeys = {
  forCompany,
  global,
} as const;

export type ScopedKeys = ReturnType<typeof forCompany>;
export type GlobalKeys = typeof global;
