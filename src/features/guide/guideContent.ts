/**
 * guideContent — data for the in-product User Guide (Settings → About ERP).
 *
 * Every `path`/`module` value here is taken directly from the real route
 * table (src/app/router/routes.tsx) and navigation config
 * (src/components/layout/navigationConfig.tsx) — nothing here is invented.
 * `module` is used to gate the "Open X" action through the SAME
 * usePermissions().canView() check RoleRoute itself uses, so the guide can
 * never link a user somewhere their own role wouldn't actually let them go.
 *
 * Role descriptions are taken verbatim (paraphrased, not invented) from the
 * live permission grants in src/lib/roleBootstrap.ts's LEGACY_SYSTEM_ROLES —
 * not guessed from role names.
 */
import type { Module } from '../../lib/permissions';

export interface GuideLink {
  label: string;
  path: string;
  module: Module;
}

export interface GuideTopic {
  id: string;
  title: string;
  what: string;
  /** Optional — kept out for simple reference-list modules (e.g. Bank Master)
   *  where a full why/when/after would pad the content without adding
   *  anything useful (see the "avoid walls of text" guide requirement). */
  why?: string;
  when?: string;
  info?: string;
  actions?: string[];
  after?: string;
  next?: string;
  links: GuideLink[];
}

export interface GuideSection {
  id: string;
  title: string;
  intro: string;
  topics: GuideTopic[];
}

export interface CommonTask {
  id: string;
  question: string;
  purpose: string;
  when: string;
  steps: string[];
  link?: GuideLink;
  next?: string;
}

export interface RoleGuide {
  role: string;
  summary: string;
  focusAreas: string[];
}

// ── Sections ──────────────────────────────────────────────────────
export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'sales',
    title: 'Sales',
    intro: 'Where the customer relationship starts and the paperwork that gets a deal signed.',
    topics: [
      {
        id: 'leads',
        title: 'Leads',
        what: 'A Lead is a potential customer who has shown interest but hasn’t signed anything yet.',
        why: 'It keeps every enquiry in one pipeline instead of scattered notes, so nothing gets forgotten.',
        when: 'As soon as someone enquires — a call, a site visit request, a referral.',
        info: 'Name, phone, source (e.g. Website, Referral), and a next follow-up date.',
        actions: ['View the pipeline', 'Create a new lead', 'Edit lead details', 'Search & filter'],
        after: 'The lead gets a status (New, in-progress statuses, Converted, or Lost) and, if no one is manually assigned, the system automatically rotates it to the next available Sales team member.',
        next: 'A won lead becomes a Customer record; a Case is also created automatically to track the deal end-to-end.',
        links: [{ label: 'Open Leads', path: '/leads', module: 'leads' }],
      },
      {
        id: 'customers',
        title: 'Customers',
        what: 'The record for a confirmed customer relationship — contact details, site address, and everything tied to that account.',
        why: 'Projects, quotations, orders, and invoices all attach to a Customer, so it’s the anchor for a client’s history.',
        when: 'When a Lead is won, or directly if the customer relationship already exists (e.g. a walk-in).',
        actions: ['View customer records', 'Create a customer', 'Edit details', 'Search & filter'],
        after: 'A Customer record is ready to have Projects, Quotations, and Orders linked to it.',
        next: 'Feeds into Projects and the whole Field Operations flow (Survey → Engineering → Installation).',
        links: [{ label: 'Open Customers', path: '/customers', module: 'customers' }],
      },
      {
        id: 'loan_applications',
        title: 'Loan Applications',
        what: 'Tracks loan/financing paperwork tied to a customer’s purchase, where applicable.',
        why: 'Keeps financing status visible alongside the sale, instead of in a separate spreadsheet.',
        when: 'When a customer is financing their purchase and needs the loan application tracked.',
        actions: ['View loan applications', 'Create', 'Edit', 'Approve (Accounts)'],
        after: 'Once approved, it can feed directly into a Payment record.',
        links: [{ label: 'Open Loan Applications', path: '/loan-applications', module: 'loan_applications' }],
      },
      {
        id: 'quotations',
        title: 'Quotations',
        what: 'A formal price quote sent to a customer for the proposed system/materials.',
        why: 'It’s the documented offer the customer agrees to before an Order is raised.',
        when: 'After the customer’s requirement is understood — often once a Survey/Engineering design exists for a B2C project, or directly for a B2B material order.',
        actions: ['View quotations', 'Create a quotation', 'Edit'],
        after: 'An accepted quotation is converted into an Order.',
        next: 'Order → Invoice → Payment.',
        links: [{ label: 'Open Quotations', path: '/quotations', module: 'quotations' }],
      },
      {
        id: 'orders',
        title: 'Orders',
        what: 'A confirmed sale — the customer has accepted the quotation and committed to buy.',
        why: 'This is what drives dispatch, invoicing, and (for installation companies) project execution.',
        when: 'Once a Quotation is accepted.',
        actions: ['View orders', 'Create an order', 'Edit', 'Approve (Accounts)'],
        after: 'Materials get dispatched from Inventory, and an Invoice is raised.',
        next: 'Dispatch and Invoices/Payments.',
        links: [{ label: 'Open Orders', path: '/orders', module: 'orders' }],
      },
      {
        id: 'invoices',
        title: 'Invoices',
        what: 'The billing document raised against an Order.',
        why: 'It’s what the customer pays against, and what accounting reconciles.',
        when: 'After an Order is confirmed (or dispatched, depending on your company’s process).',
        actions: ['View invoices', 'Open invoice detail'],
        after: 'Payments are recorded against the invoice until it’s settled.',
        links: [{ label: 'Open Invoices', path: '/invoices', module: 'invoices' }],
      },
    ],
  },
  {
    id: 'field-ops',
    title: 'Field Operations',
    intro: 'For a company that performs the installation itself (B2C) — the technical journey from site visit to a working system.',
    topics: [
      {
        id: 'surveys',
        title: 'Surveys',
        what: 'The site visit that captures roof/site conditions, measurements, and photos before design work starts.',
        why: 'Engineering can’t design a system without knowing the real site conditions.',
        when: 'After a Project is created for a customer who needs installation (B2C).',
        actions: ['View assigned surveys', 'Create/submit a survey'],
        after: 'A submitted survey goes to Engineering for review and approval.',
        next: 'Survey → Engineering Design.',
        links: [{ label: 'Open Surveys', path: '/surveys', module: 'surveys' }],
      },
      {
        id: 'engineering',
        title: 'Engineering Designs',
        what: 'The technical design (system sizing, layout, equipment list) based on the survey.',
        why: 'This is what gets quoted, procured, and installed.',
        when: 'Once a Survey has been submitted and needs to be turned into a buildable design.',
        actions: ['View designs', 'Create/edit a design', 'Approve a survey'],
        after: 'An approved design feeds into the Quotation for that project.',
        links: [{ label: 'Open Engineering Designs', path: '/engineering-designs', module: 'engineering' }],
      },
      {
        id: 'installations',
        title: 'Installations',
        what: 'Tracks on-site installation progress for a project.',
        why: 'Gives visibility into where physical work stands — not yet started, in progress, or complete.',
        when: 'After materials are dispatched to site.',
        actions: ['View installations', 'Create/update installation records'],
        after: 'Once installation work is done, the project moves to Quality Check.',
        next: 'Installation → QC → Commissioning.',
        links: [{ label: 'Open Installations', path: '/installations', module: 'installations' }],
      },
      {
        id: 'qc',
        title: 'Quality Checks',
        what: 'A formal inspection confirming the installation meets standards before commissioning.',
        why: 'Catches issues before the system is switched on and handed over.',
        when: 'After installation work is reported complete.',
        actions: ['View QC records', 'Create a QC check'],
        after: 'A passed QC clears the project for Commissioning.',
        links: [{ label: 'Open Quality Checks', path: '/qc', module: 'qc' }],
      },
      {
        id: 'commissioning',
        title: 'Commissioning',
        what: 'The step where the installed system is switched on and verified to be working.',
        why: 'It’s the technical milestone that confirms the system is live.',
        when: 'After QC has passed.',
        actions: ['View commissioning records', 'Create a commissioning record'],
        after: 'A commissioned project is ready for Net Metering / Subsidy applications and eventual Handover.',
        links: [{ label: 'Open Commissioning', path: '/commissioning', module: 'commissioning' }],
      },
      {
        id: 'handover',
        title: 'Project Handover',
        what: 'The formal close-out where the finished project is handed to the customer.',
        why: 'Marks the project as delivered and starts any post-sale service window (e.g. AMC).',
        when: 'After commissioning is complete.',
        links: [{ label: 'Open Project Handover', path: '/handovers', module: 'projects' }],
      },
    ],
  },
  {
    id: 'compliance',
    title: 'Compliance',
    intro: 'Regulatory and tax paperwork tied to a project.',
    topics: [
      {
        id: 'net-metering',
        title: 'Net Metering',
        what: 'Tracks the application for connecting the system to the grid for net metering.',
        why: 'Required before the customer can actually export/import power against the grid.',
        when: 'Typically after commissioning.',
        links: [{ label: 'Open Net Metering', path: '/net-metering', module: 'net_metering' }],
      },
      {
        id: 'subsidy',
        title: 'Subsidy',
        what: 'Tracks government subsidy applications for eligible installations.',
        why: 'Subsidy approval affects the customer’s final cost and needs to be tracked to closure.',
        when: 'For eligible residential/commercial B2C projects.',
        links: [{ label: 'Open Subsidy', path: '/subsidy', module: 'subsidy' }],
      },
      {
        id: 'tax-invoices',
        title: 'Tax Invoices',
        what: 'GST-compliant tax invoices, distinct from the general Invoices list.',
        why: 'Needed for statutory tax filing and compliance.',
        actions: ['View', 'Create', 'Edit', 'Cancel (Accounts)'],
        after: 'Used by Accounts/Finance for GST reporting.',
        links: [{ label: 'Open Tax Invoices', path: '/tax-invoices', module: 'tax_invoices' }],
      },
    ],
  },
  {
    id: 'procurement',
    title: 'Procurement',
    intro: 'Buying materials from vendors and getting them into your warehouse.',
    topics: [
      {
        id: 'vendors',
        title: 'Vendors',
        what: 'Your master list of suppliers — contact details, terms, and history.',
        why: 'Every Purchase Order needs a vendor to buy from.',
        actions: ['View', 'Create', 'Edit', 'Delete'],
        after: 'A vendor is ready to be used on a Purchase Order.',
        links: [{ label: 'Open Vendors', path: '/vendors', module: 'vendors' }],
      },
      {
        id: 'purchase-orders',
        title: 'Purchase Orders',
        what: 'A formal order placed with a Vendor for materials.',
        why: 'It’s the commitment to buy — what triggers the vendor to ship, and what a Goods Receipt is checked against.',
        when: 'When stock needs replenishing, or materials are needed for a specific project/order.',
        actions: ['View', 'Create', 'Edit', 'Approve'],
        after: 'When materials arrive, they’re recorded as a Goods Receipt against this PO.',
        next: 'Purchase Order → Goods Receipt → Stock.',
        links: [{ label: 'Open Purchase Orders', path: '/purchase-orders', module: 'purchase_orders' }],
      },
      {
        id: 'goods-receipts',
        title: 'Goods Receipts',
        what: 'The record confirming materials from a Purchase Order actually arrived.',
        why: 'This is what actually increases your Stock count — not the Purchase Order itself.',
        when: 'When a vendor delivery arrives at your warehouse.',
        after: 'Stock levels update to reflect the received quantity.',
        links: [{ label: 'Open Goods Receipts', path: '/goods-receipts', module: 'purchase_orders' }],
      },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory',
    intro: 'What you have, where it’s stored, and how it moves out to customers.',
    topics: [
      {
        id: 'products',
        title: 'Products',
        what: 'Your catalog of sellable/installable items — panels, inverters, mounting structures, and so on.',
        why: 'Quotations, Orders, and Stock all reference Products from this catalog.',
        links: [{ label: 'Open Products', path: '/products', module: 'products' }],
      },
      {
        id: 'warehouses',
        title: 'Warehouses',
        what: 'Your physical storage locations.',
        why: 'Stock is tracked per warehouse, so you know exactly where materials are sitting.',
        links: [{ label: 'Open Warehouses', path: '/warehouses', module: 'warehouses' }],
      },
      {
        id: 'stock',
        title: 'Stock',
        what: 'Live quantity-on-hand for every product, per warehouse.',
        why: 'Tells you what’s actually available before you commit to an Order.',
        actions: ['View stock levels', 'Create/adjust stock entries'],
        links: [{ label: 'Open Stock', path: '/stock', module: 'stock' }],
      },
      {
        id: 'dispatch',
        title: 'Dispatch',
        what: 'The record of materials physically leaving the warehouse for a customer/site.',
        why: 'It’s the handoff point between Inventory and Installation/delivery.',
        when: 'After an Order is confirmed and materials need to go out.',
        actions: ['View dispatches', 'Create a dispatch', 'Approve (confirms delivery)'],
        info: 'Selling price is intentionally hidden from the Warehouse role at this stage — they only need to verify quantities being loaded.',
        links: [{ label: 'Open Dispatch', path: '/dispatch', module: 'dispatch' }],
      },
    ],
  },
  {
    id: 'post-sale',
    title: 'Post-Sale',
    intro: 'What happens after a project is delivered.',
    topics: [
      {
        id: 'amc',
        title: 'AMC Contracts',
        what: 'Annual Maintenance Contracts for ongoing service after handover.',
        why: 'Tracks recurring service commitments to the customer.',
        links: [{ label: 'Open AMC Contracts', path: '/amc-contracts', module: 'projects' }],
      },
      {
        id: 'service-tickets',
        title: 'Service Tickets',
        what: 'A support/service request raised for an existing installation — a fault, a maintenance visit, a complaint.',
        why: 'Keeps post-sale service requests tracked to resolution instead of lost in phone calls.',
        actions: ['View tickets', 'Create a ticket', 'Edit/update status'],
        links: [{ label: 'Open Service Tickets', path: '/service-tickets', module: 'service_tickets' }],
      },
      {
        id: 'monitoring',
        title: 'Monitoring',
        what: 'Ongoing visibility into a commissioned system’s performance.',
        links: [{ label: 'Open Monitoring', path: '/monitoring', module: 'projects' }],
      },
    ],
  },
  {
    id: 'partners',
    title: 'Channel Partners',
    intro: 'For business generated through external referral/channel partners.',
    topics: [
      {
        id: 'partners-list',
        title: 'Partners',
        what: 'Your registered channel/referral partners.',
        why: 'Partners can submit Leads and earn commission on resulting business.',
        links: [{ label: 'Open Partners', path: '/partners', module: 'partners' }],
      },
      {
        id: 'commission-rules',
        title: 'Commission Rules',
        what: 'The rules defining how much commission a partner earns.',
        links: [{ label: 'Open Commission Rules', path: '/partners/commission-rules', module: 'partners' }],
      },
      {
        id: 'commission-approvals',
        title: 'Commission Approvals',
        what: 'Where earned commissions are reviewed and approved for payout.',
        links: [{ label: 'Open Commission Approvals', path: '/partners/commission-approvals', module: 'partners' }],
      },
      {
        id: 'settlements',
        title: 'Settlements',
        what: 'The actual payout record once commission is approved.',
        links: [{ label: 'Open Settlements', path: '/partners/settlements', module: 'partners' }],
      },
      {
        id: 'partner-performance',
        title: 'Performance',
        what: 'Partner-level performance reporting — leads submitted, conversion, commission earned.',
        links: [{ label: 'Open Performance', path: '/partners/performance', module: 'partners' }],
      },
    ],
  },
  {
    id: 'hr',
    title: 'HR',
    intro: 'Employee, attendance, and payroll management.',
    topics: [
      {
        id: 'employees',
        title: 'Employees',
        what: 'The staff directory — employee records for your team.',
        actions: ['View', 'Create', 'Edit', 'Delete'],
        links: [{ label: 'Open Employees', path: '/employees', module: 'employees' }],
      },
      {
        id: 'attendance',
        title: 'Attendance',
        what: 'Daily attendance tracking for employees.',
        actions: ['View', 'Create', 'Edit'],
        links: [{ label: 'Open Attendance', path: '/attendance', module: 'attendance' }],
      },
      {
        id: 'payroll',
        title: 'Payroll',
        what: 'Salary/payroll processing tied to attendance and employee records.',
        links: [{ label: 'Open Payroll', path: '/payroll', module: 'payroll' }],
      },
    ],
  },
  {
    id: 'finance',
    title: 'Finance',
    intro: 'Money in, and visibility into how the business is doing.',
    topics: [
      {
        id: 'payments',
        title: 'Payments',
        what: 'Records of money received against Invoices/Orders.',
        why: 'This is how you track what’s been collected versus what’s still outstanding.',
        when: 'Whenever a customer payment is received.',
        actions: ['View', 'Create', 'Edit', 'Delete (Accounts)'],
        links: [{ label: 'Open Payments', path: '/payments', module: 'payments' }],
      },
      {
        id: 'reports',
        title: 'Reports',
        what: 'Cross-module reporting for management/finance visibility.',
        actions: ['View', 'Export'],
        links: [{ label: 'Open Reports', path: '/reports', module: 'reports' }],
      },
    ],
  },
  {
    id: 'settings-admin',
    title: 'Settings & Administration',
    intro: 'System configuration — mostly restricted to Admin.',
    topics: [
      {
        id: 'users',
        title: 'Users & Access',
        what: 'Manage ERP user accounts — who can log in and what role they have.',
        links: [{ label: 'Open Users', path: '/users', module: 'users' }],
      },
      {
        id: 'roles',
        title: 'Roles & Permissions',
        what: 'Define roles and exactly which modules/actions each role can access.',
        why: 'This is what controls what every other user in the system can and can’t do.',
        links: [{ label: 'Open Roles & Permissions', path: '/roles', module: 'roles' }],
      },
      {
        id: 'companies',
        title: 'Companies',
        what: 'Manage your organization’s legal entities/branches — branding, tax details, bank info, logos.',
        links: [{ label: 'Open Companies', path: '/companies', module: 'companies' }],
      },
      {
        id: 'banks',
        title: 'Bank Master',
        what: 'Master list of bank accounts used across the system.',
        links: [{ label: 'Open Bank Master', path: '/banks', module: 'banks' }],
      },
    ],
  },
];

// ── Common Tasks ──────────────────────────────────────────────────
export const COMMON_TASKS: CommonTask[] = [
  {
    id: 'create-lead',
    question: 'How do I create a lead?',
    purpose: 'Capture a new potential customer as soon as they enquire.',
    when: 'The moment someone shows interest — a call, a visit, a referral.',
    steps: ['Open Leads.', 'Click Add/Create Lead.', 'Enter the name, phone, and source.', 'Save.'],
    link: { label: 'Open Leads', path: '/leads', module: 'leads' },
    next: 'The lead enters your pipeline and gets assigned to a Sales team member.',
  },
  {
    id: 'follow-up-lead',
    question: 'How do I follow up on a lead?',
    purpose: 'Move a lead toward becoming a paying customer.',
    when: 'On or before the lead’s next follow-up date.',
    steps: ['Open Leads.', 'Find the lead (search or filter by status).', 'Update its status and next follow-up date as the conversation progresses.', 'Mark it Converted once the customer commits, or Lost if they don’t.'],
    link: { label: 'Open Leads', path: '/leads', module: 'leads' },
  },
  {
    id: 'create-customer',
    question: 'How do I create a customer?',
    purpose: 'Set up the account record everything else (projects, orders, invoices) attaches to.',
    when: 'When a lead converts, or a customer relationship exists directly.',
    steps: ['Open Customers.', 'Click Add/Create Customer.', 'Enter contact and site details.', 'Save.'],
    link: { label: 'Open Customers', path: '/customers', module: 'customers' },
  },
  {
    id: 'create-project',
    question: 'How do I create a project?',
    purpose: 'Track the execution of a customer’s installation from survey through handover.',
    when: 'For B2C installation work, once a customer is confirmed.',
    steps: ['Open Projects.', 'Click Add/Create Project.', 'Link it to the customer.', 'Save.'],
    link: { label: 'Open Projects', path: '/projects', module: 'projects' },
    next: 'The project is ready for a Survey to be scheduled.',
  },
  {
    id: 'submit-survey',
    question: 'How do I schedule and submit a survey?',
    purpose: 'Capture real site conditions before design work starts.',
    when: 'Right after a project is created.',
    steps: ['Open Surveys.', 'Find or create the survey for the project.', 'Fill in measurements and attach site photos.', 'Submit.'],
    link: { label: 'Open Surveys', path: '/surveys', module: 'surveys' },
    next: 'Engineering reviews and approves the survey to move it to design.',
  },
  {
    id: 'create-quotation',
    question: 'How do I create a quotation?',
    purpose: 'Send the customer a formal price offer.',
    when: 'Once the requirement (and, for B2C, the engineering design) is ready.',
    steps: ['Open Quotations.', 'Click Add/Create Quotation.', 'Select the customer and add line items.', 'Save and share with the customer.'],
    link: { label: 'Open Quotations', path: '/quotations', module: 'quotations' },
    next: 'An accepted quotation becomes an Order.',
  },
  {
    id: 'record-payment',
    question: 'How do I record a payment?',
    purpose: 'Log money received from a customer against an invoice/order.',
    when: 'As soon as a payment is received.',
    steps: ['Open Payments.', 'Click Add/Create Payment.', 'Select the related invoice/order and enter the amount.', 'Save.'],
    link: { label: 'Open Payments', path: '/payments', module: 'payments' },
  },
  {
    id: 'check-inventory',
    question: 'How do I check inventory?',
    purpose: 'See what stock is available before committing to an order.',
    when: 'Before confirming an order or planning a purchase.',
    steps: ['Open Stock.', 'Search or filter by product/warehouse.'],
    link: { label: 'Open Stock', path: '/stock', module: 'stock' },
  },
  {
    id: 'raise-po',
    question: 'How do I raise a purchase order?',
    purpose: 'Order materials from a vendor to replenish stock.',
    when: 'When stock is low or a project needs specific materials.',
    steps: ['Open Purchase Orders.', 'Click Add/Create Purchase Order.', 'Select a vendor and add items.', 'Submit for approval.'],
    link: { label: 'Open Purchase Orders', path: '/purchase-orders', module: 'purchase_orders' },
    next: 'When materials arrive, record them as a Goods Receipt — that’s what actually updates Stock.',
  },
  {
    id: 'update-installation',
    question: 'How do I update installation progress?',
    purpose: 'Keep the project’s execution status current.',
    when: 'As work happens on site.',
    steps: ['Open Installations.', 'Find the project.', 'Update its status/progress.'],
    link: { label: 'Open Installations', path: '/installations', module: 'installations' },
    next: 'Once installation is done, the project moves to Quality Check.',
  },
  {
    id: 'complete-commissioning',
    question: 'How do I complete commissioning?',
    purpose: 'Confirm the installed system is live and working.',
    when: 'After Quality Check has passed.',
    steps: ['Open Commissioning.', 'Find the project.', 'Record the commissioning result.'],
    link: { label: 'Open Commissioning', path: '/commissioning', module: 'commissioning' },
  },
  {
    id: 'find-record',
    question: 'How do I find a previous record?',
    purpose: 'Locate something you created earlier without scrolling forever.',
    when: 'Anytime.',
    steps: ['Open the relevant module (e.g. Leads, Customers, Orders).', 'Use the search box for a name/phone/ID.', 'Use the status or KPI filters to narrow the list further.'],
  },
  {
    id: 'notifications',
    question: 'How do I see my notifications?',
    purpose: 'Stay on top of things assigned to you or that need your attention.',
    when: 'Anytime — check regularly.',
    steps: ['Open Notifications from the top bar or sidebar.'],
    link: { label: 'Open Notifications', path: '/notifications', module: 'dashboard' },
  },
  {
    id: 'update-profile-theme',
    question: 'How do I update my profile or change my theme/appearance?',
    purpose: 'Personalize your own account — name, contact info, light/dark mode, font size, sidebar behavior.',
    when: 'Anytime.',
    steps: ['Open Settings.', 'Go to Profile for your personal details, or Theme & Appearance for display preferences.'],
    link: { label: 'Open Settings', path: '/settings/my-profile', module: 'settings' },
  },
  {
    id: 'no-access',
    question: 'What do I do if I can’t access something?',
    purpose: 'Understand why a page or button might be missing, and how to fix it.',
    when: 'Whenever a page seems unavailable or a record is missing.',
    steps: [
      'Check whether it’s a permissions issue — your role may not have access to that module.',
      'Check whether it’s a visibility issue — some pages only show records assigned to you or your team, not the whole company.',
      'If you believe you should have access, contact your Administrator — they can grant it from Roles & Permissions.',
    ],
  },
];

// ── Role guides (paraphrased from live LEGACY_SYSTEM_ROLES grants) ──
export const ROLE_GUIDES: RoleGuide[] = [
  { role: 'Admin', summary: 'Full system access — every module, every action, plus user/role/company administration.', focusAreas: ['Everything', 'Users & Access', 'Roles & Permissions', 'Companies'] },
  { role: 'Director', summary: 'Read-only executive visibility across almost every module — for oversight, not day-to-day data entry.', focusAreas: ['Dashboard', 'Sales pipeline', 'Inventory', 'Reports', 'Users & Roles (view only)'] },
  { role: 'Manager', summary: 'Supervises sales and operations — can create/edit across the sales and inventory workflow.', focusAreas: ['Leads', 'Customers', 'Quotations', 'Orders', 'Dispatch', 'Inventory', 'Partners'] },
  { role: 'Sales', summary: 'Owns the sales pipeline — creates and progresses leads, customers, quotations, and orders.', focusAreas: ['Leads', 'Customers', 'Quotations', 'Orders', 'Loan Applications'] },
  { role: 'Accounts', summary: 'Handles billing and payment processing — approves orders, manages payments and invoices.', focusAreas: ['Payments', 'Invoices', 'Tax Invoices', 'Order approval', 'Reports'] },
  { role: 'Warehouse', summary: 'Manages inventory and dispatch — without visibility into selling prices while loading dispatches.', focusAreas: ['Inventory', 'Stock', 'Dispatch'] },
  { role: 'Procurement', summary: 'Manages vendors and purchase orders — the buying side of inventory.', focusAreas: ['Vendors', 'Purchase Orders', 'Stock'] },
  { role: 'Operations', summary: 'Operational oversight across order fulfilment and inventory.', focusAreas: ['Orders', 'Dispatch', 'Inventory'] },
  { role: 'HR', summary: 'Manages the staff directory, attendance, and payroll.', focusAreas: ['Employees', 'Attendance', 'Payroll'] },
  { role: 'Surveyor', summary: 'Executes field surveys for projects assigned to them.', focusAreas: ['Assigned Projects', 'Surveys'] },
  { role: 'Engineer', summary: 'Reviews/approves surveys and produces engineering designs.', focusAreas: ['Surveys (approve)', 'Engineering Designs'] },
  { role: 'InstallationLead', summary: 'Runs on-site installation execution and initial quality control.', focusAreas: ['Installations', 'Quality Checks', 'Commissioning'] },
  { role: 'ServiceTechnician', summary: 'Handles post-sale service requests.', focusAreas: ['Service Tickets'] },
  { role: 'ComplianceOfficer', summary: 'Tracks regulatory applications for a project.', focusAreas: ['Net Metering', 'Subsidy'] },
  { role: 'Partner', summary: 'External channel partner — can submit leads and view resulting customers.', focusAreas: ['Leads (submit)', 'Customers (view)', 'Partner portal'] },
];
