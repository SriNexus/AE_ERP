// ═══════════════════════════════════════════════════════════
//  GLOBAL SEARCH TYPES — Neozy ERP
// ═══════════════════════════════════════════════════════════

export type SearchCategory =
  | 'tasks'
  | 'leads'
  | 'customers'
  | 'loan_applications'
  | 'orders'
  | 'quotations'
  | 'invoices'
  | 'products'
  | 'categories'
  | 'warehouses'
  | 'stock'
  | 'dispatch'
  | 'cases'
  | 'projects'
  | 'vendors'
  | 'purchase_orders'
  | 'goods_receipts'
  // Phase 9C — New categories
  | 'partners'
  | 'employees'
  | 'payments'
  | 'installations'
  | 'qc_checks'
  | 'commissioning'
  | 'net_metering'
  | 'subsidy'
  | 'handovers'
  | 'amc_contracts'
  | 'service_tickets'
  | 'monitoring'
  | 'surveys'
  | 'engineering_designs'
  | 'tax_invoices'
  | 'notifications'
  // Phase 9E
  | 'audit_logs'
  | 'security_logs'
  // Bank Master
  | 'banks';

export interface SearchResult {
  id:       string;
  category: SearchCategory;
  /** Primary display text */
  title:    string;
  /** Secondary display text (e.g. status, amount) */
  subtitle?: string;
  /** ERP route to navigate to on selection */
  link:     string;
}

export interface SearchGroup {
  category: SearchCategory;
  label:    string;
  results:  SearchResult[];
}

export interface RecentSearch {
  query: string;
  at:    number; // timestamp
}

export const CATEGORY_LABELS: Record<SearchCategory, string> = {
  tasks:             'Tasks',
  leads:             'Leads',
  customers:         'Customers',
  loan_applications:     'Loan Applications',
  orders:            'Orders',
  quotations:        'Quotations',
  invoices:          'Invoices',
  products:          'Products',
  categories:        'Categories',
  warehouses:        'Warehouses',
  stock:             'Stock',
  dispatch:          'Dispatch',
  cases:             'Cases',
  projects:          'Projects',
  vendors:           'Vendors',
  purchase_orders:   'Purchase Orders',
  goods_receipts:    'Goods Receipts',
  // Phase 9C
  partners:           'Partners',
  employees:          'Employees',
  payments:           'Payments',
  installations:      'Installations',
  qc_checks:          'QC Checks',
  commissioning:      'Commissioning',
  net_metering:       'Net Metering',
  subsidy:            'Subsidy',
  handovers:          'Handovers',
  amc_contracts:      'AMC Contracts',
  service_tickets:    'Service Tickets',
  monitoring:         'Monitoring',
  surveys:            'Surveys',
  engineering_designs:'Engineering Designs',
  tax_invoices:       'Tax Invoices',
  notifications:      'Notifications',
  // Phase 9E
  audit_logs:          'Audit Logs',
  security_logs:       'Security Logs',
  // Bank Master
  banks:               'Bank Master',
};

export const CATEGORY_ROUTES: Record<SearchCategory, string> = {
  tasks:             '/app',
  leads:             '/leads',
  customers:         '/customers',
  loan_applications:     '/loan-applications',
  orders:            '/orders',
  quotations:        '/quotations',
  invoices:          '/invoices',
  products:          '/products',
  categories:        '/categories',
  warehouses:        '/warehouses',
  stock:             '/stock',
  dispatch:          '/dispatch',
  cases:             '/cases',
  projects:          '/projects',
  vendors:           '/vendors',
  purchase_orders:   '/purchase-orders',
  goods_receipts:    '/goods-receipts',
  // Phase 9C
  partners:           '/partners',
  employees:          '/employees',
  payments:           '/payments',
  installations:      '/installations',
  qc_checks:          '/qc',
  commissioning:      '/commissioning',
  net_metering:       '/net-metering',
  subsidy:            '/subsidy',
  handovers:          '/handovers',
  amc_contracts:      '/amc-contracts',
  service_tickets:    '/service-tickets',
  monitoring:         '/monitoring',
  surveys:            '/surveys',
  engineering_designs:'/engineering-designs',
  tax_invoices:       '/tax-invoices',
  notifications:      '/notifications',
  // Phase 9E
  audit_logs:          '/audit-logs',
  security_logs:       '/audit-logs?filter=security',
  // Bank Master
  banks:               '/banks',
};
