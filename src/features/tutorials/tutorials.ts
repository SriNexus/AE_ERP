/**
 * tutorials — data-driven tutorial definitions for the interactive tutorial
 * system.
 *
 * PILOT SCOPE: Leads. Every step below points at a real element that carries
 * a matching `data-tour` attribute (see src/pages/Leads.tsx,
 * src/features/leads/components/LeadWorkspaceDialogs.tsx and
 * src/pages/LeadWorkspace.tsx), or a real route. New tutorials are added by
 * appending definitions here — the engine needs no changes.
 *
 * Content rule: every step teaches WHAT the control does AND WHY it exists
 * (business context), not just "click here".
 */
import type { TutorialDefinition } from './types';

const SALES_LEADS_KEYWORDS = ['lead', 'leads', 'pipeline', 'sales'];

export const TUTORIALS: TutorialDefinition[] = [
  // ─────────────────────────────────────────────────────────────
  // Type A — Quick Tour
  // ─────────────────────────────────────────────────────────────
  {
    id: 'leads-quick-tour',
    title: 'Leads — Quick Tour',
    description: 'A short orientation to the Leads screen — layout, create, search, filters, table, and opening a record.',
    category: 'sales',
    difficulty: 'Beginner',
    estimatedMinutes: 4,
    route: '/leads',
    learnings: ['Read the pipeline at a glance', 'Add a lead', 'Search leads', 'Apply filters', 'Open a lead record'],
    keywords: [...SALES_LEADS_KEYWORDS, 'tour', 'orientation', 'overview', 'screen'],
    steps: [
      {
        id: 'intro',
        type: 'info',
        route: '/leads',
        title: 'Welcome to Leads',
        description:
          'The Leads screen is your sales pipeline. Every enquiry that comes in — a call, a website form, a referral — lands here as a lead, so nothing gets lost in phone calls or scattered notes. This tour walks you through the main parts of the screen.',
      },
      {
        id: 'kpi',
        type: 'highlight',
        target: 'leads-kpi',
        title: 'Pipeline at a glance',
        description:
          'These cards summarise your whole pipeline: Total leads, New, Follow-up, Converted, Lost and Overdue. Click a card to instantly filter the table to just that group — click it again to clear the filter.',
        placement: 'bottom',
      },
      {
        id: 'create',
        type: 'highlight',
        target: 'leads-create',
        title: 'Add a new lead',
        description:
          'Use Add Lead when a new potential customer enters the pipeline. Once created, the lead is automatically assigned to the next available Sales team member and a Case is created to track the deal end-to-end.',
        placement: 'bottom',
      },
      {
        id: 'search',
        type: 'highlight',
        target: 'leads-search',
        title: 'Find any lead',
        description:
          'Type a name, phone number, city or email here to search the whole list instantly. This is the fastest way to find a lead when you cannot remember exactly where it was filed.',
        placement: 'bottom',
      },
      {
        id: 'filters',
        type: 'highlight',
        target: 'leads-filters',
        title: 'Narrow the list',
        description:
          'These dropdowns filter by date, status, source and assigned salesperson. Combine them with search to build exactly the view you need — for example “New leads from the Website, unassigned”.',
        placement: 'bottom',
      },
      {
        id: 'table',
        type: 'highlight',
        target: 'leads-table',
        title: 'The lead table',
        description:
          'Every row is one lead. Columns show name, phone, source, score, status, who it is assigned to, the next follow-up date and the latest note. Click a column header to sort, or tick the checkboxes to run bulk actions.',
        placement: 'top',
      },
      {
        id: 'open-record',
        type: 'highlight',
        target: 'leads-row-view',
        title: 'Open a lead',
        description:
          'Click View (or anywhere on a row) to open the full Lead Workspace — the single operating screen where a lead is actually worked on: call logging, follow-ups, documents and status changes all happen there.',
        placement: 'top',
      },
      {
        id: 'pagination',
        type: 'highlight',
        target: 'leads-pagination',
        title: 'Move through pages',
        description:
          'When the list grows, use these page controls to move through the results and choose how many rows each page shows.',
        placement: 'top',
      },
      {
        id: 'done',
        type: 'complete',
        title: 'Tour complete',
        description: 'You now know the main functions available in the Leads workspace.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // Type B — Complete Workflow
  // ─────────────────────────────────────────────────────────────
  {
    id: 'leads-workflow',
    title: 'Lead Management — Complete Workflow',
    description: 'The full lead lifecycle in the real system: create, find, open, log the call, record the outcome and save.',
    category: 'sales',
    difficulty: 'Intermediate',
    estimatedMinutes: 9,
    route: '/leads',
    learnings: ['Understand the lead lifecycle', 'Create a lead', 'Find and open a lead', 'Log a call outcome', 'Save and move on'],
    keywords: [...SALES_LEADS_KEYWORDS, 'workflow', 'lifecycle', 'process', 'convert', 'call'],
    steps: [
      {
        id: 'lifecycle',
        type: 'info',
        route: '/leads',
        title: 'The lead lifecycle',
        description:
          'A lead travels a real path: it is created → assigned → contacted → followed up → and either Converted (it becomes a Customer record and a Case) or Lost. This tutorial walks that exact path on the real screens, using real buttons.',
      },
      {
        id: 'create',
        type: 'highlight',
        target: 'leads-create',
        title: 'Where leads enter',
        description:
          'Every lead starts here with Add Lead. The system captures who the customer is and where they came from, then auto-assigns the lead to the next available Sales team member — no manual roster needed.',
        placement: 'bottom',
      },
      {
        id: 'kpi',
        type: 'highlight',
        target: 'leads-kpi',
        title: 'Read the pipeline',
        description:
          'Before working, look at the KPI cards. Overdue and Follow-up need attention first — they are the leads waiting on someone. Click a card to jump straight to that group.',
        placement: 'bottom',
      },
      {
        id: 'search',
        type: 'highlight',
        target: 'leads-search',
        title: 'Find the lead you want',
        description:
          'Search by name, phone, city or email to pull up the exact lead you need to work on next.',
        placement: 'bottom',
      },
      {
        id: 'filters',
        type: 'highlight',
        target: 'leads-filters',
        title: 'Filter the pipeline',
        description:
          'Status and assignment filters are how you answer “what is mine today?” — filter by your own name, or by statuses that need action.',
        placement: 'bottom',
      },
      {
        id: 'open',
        type: 'click',
        target: 'leads-row-view',
        title: 'Open a lead',
        description:
          'Click View on any lead row to open its Workspace. This is where the actual work happens — the list is just the queue.',
        hint: 'Click the View button on a lead row to continue. If the list is empty, use Skip Step.',
        placement: 'top',
      },
      {
        id: 'workspace',
        type: 'info',
        route: '/leads/workspace/:id',
        title: 'Inside the Lead Workspace',
        description:
          'You are now on the single-lead operating screen. It answers three questions: who is this lead (left), what should I do now (center), and what is the current state (right). Nothing here edits the lead until you press Save.',
      },
      {
        id: 'call-outcome',
        type: 'highlight',
        target: 'lead-ws-call-outcome',
        title: 'What should I do now?',
        description:
          'The Call Outcome card is the heart of the workspace. Every conversation with this lead is logged here — the system guides you step by step through the outcome, instead of leaving notes in random places.',
        placement: 'bottom',
      },
      {
        id: 'add-call-log',
        type: 'click',
        target: 'lead-ws-add-call-log',
        title: 'Log the call',
        description:
          'Start the call log with Add Call Log. This is the first real action in processing a lead — it records that a contact attempt happened, which becomes part of the lead’s audit trail.',
        hint: 'Click “Add Call Log” to continue.',
        placement: 'bottom',
      },
      {
        id: 'outcome',
        type: 'click',
        target: 'lead-ws-outcome-options',
        title: 'Connected or Not Connected?',
        description:
          'After the call, record the outcome. Connected opens statuses like Interested, Need Follow-up, Qualified and Converted; Not Connected captures Busy, No Answer and so on. Selecting Converted turns the lead into a Customer record automatically. Click either option — nothing is saved until you press Save.',
        hint: 'Click Connected or Not Connected to continue.',
        placement: 'top',
      },
      {
        id: 'save',
        type: 'highlight',
        target: 'lead-ws-save',
        title: 'Save every call',
        description:
          'Nothing is written to the lead until you press Save — the workspace deliberately protects against accidental changes. Saving commits the call outcome, updates the status and moves the lead along the pipeline.',
        placement: 'top',
      },
      {
        id: 'done',
        type: 'complete',
        title: 'Workflow complete',
        description: 'You now understand the complete lead processing workflow, from pipeline to call log to save.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // Type C — Task tutorials (the support-call reducers)
  // ─────────────────────────────────────────────────────────────
  {
    id: 'leads-create',
    title: 'Create a Lead',
    description: 'The 2-minute answer to “where do I create a lead?” — capture a new potential customer correctly.',
    category: 'sales',
    difficulty: 'Beginner',
    estimatedMinutes: 2,
    route: '/leads',
    learnings: ['Open the Add Lead form', 'Enter required contact details', 'Choose a source', 'Understand assignment', 'Save the lead'],
    keywords: [...SALES_LEADS_KEYWORDS, 'create', 'add', 'new', 'enquiry'],
    steps: [
      {
        id: 'intro',
        type: 'info',
        route: '/leads',
        title: 'Creating a lead',
        description:
          'When someone shows interest — a call, a site visit request, a referral — capture them as a lead immediately. Leads live in the Sales pipeline and everything later (customer, project, order) traces back to this moment.',
      },
      {
        id: 'create-button',
        type: 'highlight',
        target: 'leads-create',
        title: 'The Add Lead button',
        description:
          'In the top-right of the Leads screen, Add Lead opens the creation form. Only roles with permission to create leads see this button.',
        placement: 'bottom',
      },
      {
        id: 'open-form',
        type: 'click',
        target: 'leads-create',
        title: 'Open the form',
        description: 'Go ahead — click Add Lead. A form opens with the fields a lead needs to be created properly.',
        hint: 'Click “Add Lead” to open the form.',
        placement: 'bottom',
      },
      {
        id: 'name',
        type: 'input',
        target: 'lead-form-name',
        title: 'Customer name',
        description:
          'The full name is required — it is how the lead appears in the pipeline and in search. Type the customer’s name here.',
        inputPlaceholder: 'e.g. Anil Kumar',
        hint: 'Type a name, then press Next. You do not have to save at the end of this tutorial.',
      },
      {
        id: 'phone',
        type: 'input',
        target: 'lead-form-phone',
        title: 'Phone number',
        description:
          'A contact number is also required — it is the primary way your team will reach this lead. Use the 10-digit mobile number when possible.',
        inputPlaceholder: '10-digit mobile',
        hint: 'Type a phone number, then press Next.',
      },
      {
        id: 'source',
        type: 'highlight',
        target: 'lead-form-source',
        title: 'Where did they come from?',
        description:
          'Source records how the customer found you — Website, Referral, Walk-in and so on. It feeds your reporting, so a correct source is what tells you which channels actually bring business.',
        placement: 'top',
      },
      {
        id: 'assign',
        type: 'highlight',
        target: 'lead-form-assign',
        title: 'Assignment',
        description:
          'Leave “Unassigned” and the system rotates the lead to the next available Sales team member automatically. You can also pick a specific person if the enquiry belongs to them.',
        placement: 'top',
      },
      {
        id: 'save',
        type: 'highlight',
        target: 'lead-form-save',
        title: 'Save the lead',
        description:
          'Add Lead creates the record, assigns it, and opens its Workspace so you can start working it immediately. For this tutorial, you can press Cancel instead — no test data needed.',
        placement: 'top',
      },
      {
        id: 'done',
        type: 'complete',
        title: 'Done',
        description: 'You now know exactly how to create a lead — and why each field matters.',
      },
    ],
  },

  {
    id: 'leads-search-filter',
    title: 'Search & Filter Leads',
    description: 'Stop scrolling — find any lead in seconds with search, filters and the pipeline cards.',
    category: 'sales',
    difficulty: 'Beginner',
    estimatedMinutes: 3,
    route: '/leads',
    learnings: ['Search by name, phone, city or email', 'Filter by status, source and owner', 'Use KPI cards as shortcuts', 'Clear filters'],
    keywords: [...SALES_LEADS_KEYWORDS, 'search', 'filter', 'find', 'lookup'],
    steps: [
      {
        id: 'intro',
        type: 'info',
        route: '/leads',
        title: 'Finding a lead',
        description:
          'The most common support question is “how do I find that lead again?”. The answer is always the same: search or filter — never scroll. Let’s practice on the real screen.',
      },
      {
        id: 'search',
        type: 'highlight',
        target: 'leads-search',
        title: 'The search box',
        description:
          'This box searches name, phone, city and email together — one box, all fields. Typing filters the table instantly as you type.',
        placement: 'bottom',
      },
      {
        id: 'try-search',
        type: 'input',
        target: 'leads-search',
        title: 'Try it',
        description:
          'Type part of a name, a city or a phone digit — even two characters are enough. Watch the table narrow as you type.',
        inputPlaceholder: 'Type to search…',
        hint: 'Type something in the search box, then press Next.',
      },
      {
        id: 'filters',
        type: 'highlight',
        target: 'leads-filters',
        title: 'The filters',
        description:
          'The dropdowns filter by date, status, source and assigned salesperson. They combine with search and with each other.',
        placement: 'bottom',
      },
      {
        id: 'status-filter',
        type: 'select',
        target: 'leads-filter-status',
        title: 'Pick a status',
        description:
          'Try the Status filter — choose something like “New” or “Follow-up” to see only leads in that stage. Useful when you need to focus on one part of the pipeline.',
        hint: 'Select any status from the dropdown, then press Next.',
      },
      {
        id: 'reset',
        type: 'info',
        title: 'Reset your view',
        description:
          'To start fresh, click the active filter pills and Clear All in the toolbar — or click the currently-active KPI card again. The URL also mirrors your filters, so a filtered view can be bookmarked and shared.',
      },
      {
        id: 'done',
        type: 'complete',
        title: 'Done',
        description: 'You can now find any lead in seconds — by search, by filter, or by KPI shortcut.',
      },
    ],
  },

  {
    id: 'leads-followup',
    title: 'Follow Up on a Lead',
    description: 'Work an overdue lead from the list to a logged call with a scheduled follow-up — the real daily routine.',
    category: 'sales',
    difficulty: 'Intermediate',
    estimatedMinutes: 4,
    route: '/leads',
    learnings: ['Find overdue leads', 'Open the right lead', 'Log a call outcome', 'Schedule the next follow-up'],
    keywords: [...SALES_LEADS_KEYWORDS, 'follow-up', 'followup', 'overdue', 'call', 'reminder'],
    steps: [
      {
        id: 'intro',
        type: 'info',
        route: '/leads',
        title: 'The daily follow-up routine',
        description:
          'Following up is what moves the pipeline: reach the lead, record what happened, and set the next touchpoint. This tutorial shows the real routine — starting from the leads that need you most.',
      },
      {
        id: 'overdue',
        type: 'click',
        target: 'leads-kpi-overdue',
        title: 'Start with overdue',
        description:
          'The Overdue card counts leads whose follow-up date has passed. Click it to filter the table to exactly those — they are your priority.',
        hint: 'Click the Overdue card to filter the list.',
      },
      {
        id: 'list',
        type: 'highlight',
        target: 'leads-table',
        title: 'The overdue list',
        description:
          'Only overdue leads remain. The Next Follow-up column shows how late each one is — work from the most overdue down.',
        placement: 'top',
      },
      {
        id: 'open',
        type: 'click',
        target: 'leads-row-view',
        title: 'Open the lead',
        description:
          'Click View on the first overdue lead. Everything about the follow-up happens in the workspace, not here.',
        hint: 'Click View on a lead row to continue. If the list is empty, use Skip Step.',
        placement: 'top',
      },
      {
        id: 'workspace',
        type: 'info',
        route: '/leads/workspace/:id',
        title: 'Now log the call',
        description:
          'You are in the lead’s workspace. The center card tells you exactly what to do — in this case, reach out and log the outcome of the call.',
      },
      {
        id: 'add-call-log',
        type: 'click',
        target: 'lead-ws-add-call-log',
        title: 'Start the call log',
        description:
          'Click Add Call Log to begin recording this follow-up call. Every attempt is part of the lead’s history, so no call is ever “lost”.',
        hint: 'Click “Add Call Log” to continue.',
        placement: 'bottom',
      },
      {
        id: 'outcome',
        type: 'highlight',
        target: 'lead-ws-outcome-options',
        title: 'Record what happened',
        description:
          'If you reached the customer, pick a Connected status. If you could not reach them, pick a Not Connected reason like Busy or No Answer — the system then asks for a retry date.',
        placement: 'top',
      },
      {
        id: 'schedule',
        type: 'info',
        title: 'Schedule the next touchpoint',
        description:
          'Choose “Need Follow-up” (or a retry date) and the system sets the next follow-up date. Save, and the lead is back in the queue for that date — the Overdue card will pick it up again only if it slips.',
      },
      {
        id: 'done',
        type: 'complete',
        title: 'Done',
        description: 'You now know the complete follow-up routine: overdue → open → log the call → schedule the next step.',
      },
    ],
  },
  // ─────────────────────────────────────────────────────────────
  // OPERATIONS — Projects
  // ─────────────────────────────────────────────────────────────
  {
    id: 'projects-quick-tour',
    title: 'Projects — Quick Tour',
    description: 'Orient yourself in the Projects workspace — pipeline view, creating a project, searching, filtering and opening records.',
    category: 'operations',
    difficulty: 'Beginner',
    estimatedMinutes: 4,
    route: '/projects',
    learnings: ['Read the project pipeline', 'Create a project', 'Search projects', 'Filter by stage', 'Open a project'],
    keywords: ['project', 'projects', 'epc', 'site', 'installation', 'tour'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/projects',
        title: 'Welcome to Projects',
        description:
          'Projects is where every solar EPC job lives — from the moment an order is converted until handover. Each project tracks stages, site details, materials and the people responsible. This tour shows you the main parts of the screen.',
      },
      {
        id: 'kpi', type: 'highlight', target: 'projects-kpi',
        title: 'Pipeline at a glance',
        description:
          'The KPI cards summarise your project pipeline — counts by stage like New, In Progress and Completed. Click a card to filter the list to that stage instantly.',
        placement: 'bottom',
      },
      {
        id: 'create', type: 'highlight', target: 'projects-create',
        title: 'Start a new project',
        description:
          'New Project opens the creation form where you attach the project to a customer, pick the project type and set the stage. Projects are the tracking backbone of every EPC installation.',
        placement: 'bottom',
      },
      {
        id: 'search', type: 'highlight', target: 'projects-search',
        title: 'Find a project',
        description:
          'Type a project name, customer or ID here to search instantly. When a customer calls about their installation, this is how you pull their project up in seconds.',
        placement: 'bottom',
      },
      {
        id: 'filters', type: 'highlight', target: 'projects-filters',
        title: 'Filter the pipeline',
        description:
          'These filters narrow the list by stage and date. Combine them with search to answer questions like “which projects are stuck in Materials stage from last month?”',
        placement: 'bottom',
      },
      {
        id: 'table', type: 'highlight', target: 'projects-table',
        title: 'The project list',
        description:
          'Every row is one project with its customer, stage, dates and value. Tick the checkboxes to run bulk actions like changing stage for several projects at once.',
        placement: 'top',
      },
      {
        id: 'open-record', type: 'highlight', target: 'projects-row-view',
        title: 'Open a project',
        description:
          'Click View on any row to open the full Project Workspace — the operating screen where stages are advanced, materials are tracked and the project is managed day to day.',
        placement: 'top',
      },
      {
        id: 'pagination', type: 'highlight', target: 'projects-pagination',
        title: 'More pages',
        description:
          'When the list grows, use these controls to move through pages and set how many projects you see per page.',
        placement: 'top',
      },
      {
        id: 'done', type: 'complete',
        title: 'Tour complete',
        description: 'You now know the main functions available in the Projects workspace.',
      },
    ],
  },

  {
    id: 'projects-create',
    title: 'Create a Project',
    description: 'The quick answer to “how do I add a new EPC project?” — from the button to the key fields.',
    category: 'operations',
    difficulty: 'Beginner',
    estimatedMinutes: 3,
    route: '/projects',
    learnings: ['Open the New Project form', 'Pick the customer', 'Choose the project type', 'Understand stages', 'Save the project'],
    keywords: ['project', 'create', 'add', 'new', 'epc'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/projects',
        title: 'Adding a project',
        description:
          'A project represents one EPC installation for one customer. It is created from an existing order — or directly when a customer signs up — and then tracked through stages until handover.',
      },
      {
        id: 'create-button', type: 'highlight', target: 'projects-create',
        title: 'The New Project button',
        description:
          'Top-right of the Projects screen. Only roles with permission to create projects see this button.',
        placement: 'bottom',
      },
      {
        id: 'open-form', type: 'click', target: 'projects-create',
        title: 'Open the form',
        description: 'Go ahead — click New Project. The creation form collects everything the project needs to start.',
        hint: 'Click “New Project” to continue. If you prefer not to create test data, use Skip Step.',
        placement: 'bottom',
      },
      {
        id: 'customer', type: 'info',
        title: 'Attach the customer',
        description:
          'The form links the project to a customer record — that is what ties the installation back to the person who pays for it. Pick the existing customer for this project.',
      },
      {
        id: 'type', type: 'info',
        title: 'Choose the type',
        description:
          'Project Type tells the system what kind of job this is (e.g. residential, commercial, industrial). It drives which stages the project will pass through.',
      },
      {
        id: 'stage', type: 'info',
        title: 'Starting stage',
        description:
          'New projects usually begin at the first stage. You can move them forward as work progresses — the stage is how the whole team knows where every job stands.',
      },
      {
        id: 'save', type: 'info',
        title: 'Save it',
        description:
          'Create saves the project and opens its workspace. For this tutorial you can close the form instead — no test data needed.',
      },
      {
        id: 'done', type: 'complete',
        title: 'Done',
        description: 'You now know exactly how to create a project — and why each field matters.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // OPERATIONS — Stock / Inventory
  // ─────────────────────────────────────────────────────────────
  {
    id: 'stock-quick-tour',
    title: 'Stock — Quick Tour',
    description: 'Learn the Inventory workspace — stock summary vs ledger, searching products and opening stock records.',
    category: 'operations',
    difficulty: 'Beginner',
    estimatedMinutes: 4,
    route: '/stock',
    learnings: ['Read stock KPI cards', 'Understand Summary vs Ledger', 'Search stock', 'Open a stock record', 'Page through results'],
    keywords: ['stock', 'inventory', 'ledger', 'warehouse', 'product', 'quantity', 'tour'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/stock',
        title: 'Welcome to Stock',
        description:
          'Stock answers one question: how much of every product do we have, and where? From panels to inverters, every item that moves in or out of a warehouse lands here as a stock record.',
      },
      {
        id: 'kpi', type: 'highlight', target: 'stock-kpi',
        title: 'Inventory at a glance',
        description:
          'These cards summarise your inventory — total items, low stock, reserved and available. They give the health of your warehouse without opening a single record.',
        placement: 'bottom',
      },
      {
        id: 'create', type: 'highlight', target: 'stock-create',
        title: 'Add stock',
        description:
          'Use this to record stock coming into a warehouse — usually from a purchase order or goods receipt. Every entry keeps the ledger accurate, which prevents overselling and shortages.',
        placement: 'bottom',
      },
      {
        id: 'search', type: 'highlight', target: 'stock-search',
        title: 'Find any product',
        description:
          'Search by product name or code to jump straight to an item. “How many 540W panels do we have?” — type, and the answer is right there.',
        placement: 'bottom',
      },
      {
        id: 'table', type: 'highlight', target: 'stock-table',
        title: 'The stock list',
        description:
          'Each row shows a product, its quantity, unit, warehouse and status. The Summary view shows totals per product; the Ledger view shows every individual movement.',
        placement: 'top',
      },
      {
        id: 'open-record', type: 'highlight', target: 'stock-row',
        title: 'Open a stock record',
        description:
          'Click any row to see the full stock record — warehouse details, movement history and actions like adjusting quantity.',
        placement: 'top',
      },
      {
        id: 'pagination', type: 'highlight', target: 'stock-pagination',
        title: 'Page through',
        description:
          'Use these controls to move through the stock list as it grows and choose your page size.',
        placement: 'top',
      },
      {
        id: 'done', type: 'complete',
        title: 'Tour complete',
        description: 'You now know the main functions available in the Stock workspace.',
      },
    ],
  },

  {
    id: 'stock-check',
    title: 'Check Stock Levels',
    description: 'The daily “do we have stock?” question — find a product and read exactly how much is available.',
    category: 'operations',
    difficulty: 'Beginner',
    estimatedMinutes: 2,
    route: '/stock',
    learnings: ['Search for a product', 'Read available quantity', 'Spot low stock', 'Open the record for details'],
    keywords: ['stock', 'check', 'available', 'quantity', 'low', 'inventory'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/stock',
        title: 'Checking stock',
        description:
          'Before promising a delivery or planning a purchase, verify what is actually available. This is the fastest path in the system.',
      },
      {
        id: 'search', type: 'highlight', target: 'stock-search',
        title: 'Search the product',
        description:
          'Type the product name or code in the search box. The list narrows as you type — no need to scroll through hundreds of items.',
        placement: 'bottom',
      },
      {
        id: 'try-search', type: 'input', target: 'stock-search',
        title: 'Try it',
        description: 'Type part of a product name to see the list narrow in real time.',
        inputPlaceholder: 'Type to search…',
        hint: 'Type in the search box, then press Next.',
      },
      {
        id: 'read', type: 'highlight', target: 'stock-table',
        title: 'Read the quantity',
        description:
          'The quantity column tells you what is on hand. The status badge — like In Stock or Low — flags items that need reordering before they run out.',
        placement: 'top',
      },
      {
        id: 'open', type: 'click', target: 'stock-row',
        title: 'Open the record',
        description: 'Click the row to see the full record: which warehouse holds it, movement history, and available vs reserved quantities.',
        hint: 'Click a stock row to continue. If the list is empty, use Skip Step.',
        placement: 'top',
      },
      {
        id: 'done', type: 'complete',
        title: 'Done',
        description: 'You can now check stock levels in seconds — search, read, open.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // OPERATIONS — Purchase Orders
  // ─────────────────────────────────────────────────────────────
  {
    id: 'purchase-orders-quick-tour',
    title: 'Purchase Orders — Quick Tour',
    description: 'Learn the Procurement workspace — creating a PO, searching orders, and opening a purchase order record.',
    category: 'operations',
    difficulty: 'Beginner',
    estimatedMinutes: 4,
    route: '/purchase-orders',
    learnings: ['Create a purchase order', 'Search POs', 'Read PO status', 'Open a PO', 'Page through results'],
    keywords: ['purchase', 'order', 'po', 'procurement', 'buy', 'vendor', 'tour'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/purchase-orders',
        title: 'Welcome to Purchase Orders',
        description:
          'A Purchase Order is the formal record of what you are buying from a vendor — the items, quantities, prices and delivery date. Every PO here connects to a vendor and later feeds goods receipts and stock.',
      },
      {
        id: 'create', type: 'highlight', target: 'purchase-orders-create',
        title: 'Create a PO',
        description:
          'Create PO opens the purchase order form — pick the vendor, add items, set quantities and prices. This is how procurement is officially authorised.',
        placement: 'bottom',
      },
      {
        id: 'search', type: 'highlight', target: 'purchase-orders-search',
        title: 'Find an order',
        description:
          'Search by PO number, vendor or project to pull up any order quickly. When a vendor asks “which PO was this?” — you will find it in seconds.',
        placement: 'bottom',
      },
      {
        id: 'table', type: 'highlight', target: 'purchase-orders-table',
        title: 'The orders list',
        description:
          'Every row is one PO with its number, vendor, dates, total and status — Draft, Ordered, Partially Received or Closed. Status tells you where each order stands in the pipeline.',
        placement: 'top',
      },
      {
        id: 'open-record', type: 'highlight', target: 'purchase-orders-row-view',
        title: 'Open a PO',
        description:
          'Click View to open the full PO — line items, vendor details and the actions to receive goods against it.',
        placement: 'top',
      },
      {
        id: 'pagination', type: 'highlight', target: 'purchase-orders-pagination',
        title: 'Page through',
        description:
          'Use these controls to move through orders and set how many you see per page.',
        placement: 'top',
      },
      {
        id: 'done', type: 'complete',
        title: 'Tour complete',
        description: 'You now know the main functions available in the Purchase Orders workspace.',
      },
    ],
  },

  {
    id: 'purchase-orders-create',
    title: 'Create a Purchase Order',
    description: 'The answer to “how do I raise a PO?” — from the Create button to the key fields.',
    category: 'operations',
    difficulty: 'Intermediate',
    estimatedMinutes: 3,
    route: '/purchase-orders',
    learnings: ['Open the PO form', 'Select a vendor', 'Add line items', 'Understand PO status', 'Save the order'],
    keywords: ['purchase', 'order', 'po', 'create', 'raise', 'procurement'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/purchase-orders',
        title: 'Raising a PO',
        description:
          'When a project needs material you do not stock, procurement raises a Purchase Order to buy it from a vendor. The PO is the paper trail for that purchase.',
      },
      {
        id: 'create-button', type: 'highlight', target: 'purchase-orders-create',
        title: 'The Create PO button',
        description: 'Top-right of the Purchase Orders screen. Visible only to roles with procurement permissions.',
        placement: 'bottom',
      },
      {
        id: 'open-form', type: 'click', target: 'purchase-orders-create',
        title: 'Open the form',
        description: 'Click Create PO. The form walks through vendor, items and delivery in a logical order.',
        hint: 'Click “Create PO” to continue. Use Skip Step if you prefer not to open the form.',
        placement: 'bottom',
      },
      {
        id: 'vendor', type: 'info',
        title: 'Pick the vendor',
        description:
          'Every PO must name a vendor from the Vendors module. This ties the purchase to a supplier you can track for payments and ratings.',
      },
      {
        id: 'items', type: 'info',
        title: 'Add the items',
        description:
          'Add each product, quantity and agreed price. The total calculates automatically — the PO is what the goods receipt will later be checked against.',
      },
      {
        id: 'save', type: 'info',
        title: 'Save the PO',
        description:
          'Save creates the PO, usually in Draft or Ordered status. For this tutorial you can close the form instead.',
      },
      {
        id: 'done', type: 'complete',
        title: 'Done',
        description: 'You now know how to raise a purchase order from start to finish.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // OPERATIONS — Vendors
  // ─────────────────────────────────────────────────────────────
  {
    id: 'vendors-quick-tour',
    title: 'Vendors — Quick Tour',
    description: 'Learn the Vendors workspace — the supplier directory, adding a vendor, searching and opening vendor details.',
    category: 'operations',
    difficulty: 'Beginner',
    estimatedMinutes: 3,
    route: '/vendors',
    learnings: ['Add a vendor', 'Search vendors', 'Read vendor details', 'Open a vendor record'],
    keywords: ['vendor', 'supplier', 'vendor master', 'procurement', 'tour'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/vendors',
        title: 'Welcome to Vendors',
        description:
          'Vendors is your supplier master — every company you buy from lives here with its GSTIN, contact person and payment terms. Purchase Orders draw their vendor from this list.',
      },
      {
        id: 'create', type: 'highlight', target: 'vendors-create',
        title: 'Add a vendor',
        description:
          'Add vendor registers a new supplier. Keeping the vendor master complete means procurement never has to re-type supplier details on every PO.',
        placement: 'bottom',
      },
      {
        id: 'search', type: 'highlight', target: 'vendors-search',
        title: 'Find a supplier',
        description:
          'Search by name, code, GSTIN or phone. When you need a supplier’s details — say, for an invoice or a follow-up call — this is the fastest route.',
        placement: 'bottom',
      },
      {
        id: 'table', type: 'highlight', target: 'vendors-table',
        title: 'The vendor list',
        description:
          'Each row is one supplier with code, GSTIN, contact and payment terms. A well-maintained list keeps compliance details — like GSTIN — accurate and easy to find.',
        placement: 'top',
      },
      {
        id: 'open-record', type: 'highlight', target: 'vendors-row-view',
        title: 'Open a vendor',
        description:
          'Click View to open the vendor profile — full contact information, categories and their purchase history.',
        placement: 'top',
      },
      {
        id: 'done', type: 'complete',
        title: 'Tour complete',
        description: 'You now know the main functions available in the Vendors workspace.',
      },
    ],
  },

  {
    id: 'vendors-create',
    title: 'Add a Vendor',
    description: 'The 2-minute answer to “how do I add a new supplier?” — capture a vendor correctly the first time.',
    category: 'operations',
    difficulty: 'Beginner',
    estimatedMinutes: 2,
    route: '/vendors',
    learnings: ['Open the Add Vendor form', 'Enter business details', 'Capture GSTIN and payment terms', 'Save the vendor'],
    keywords: ['vendor', 'supplier', 'add', 'create', 'gstin'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/vendors',
        title: 'Adding a supplier',
        description:
          'When you start buying from a new company, add them as a vendor once — then every PO, goods receipt and payment reuses that record instead of retyping details.',
      },
      {
        id: 'create-button', type: 'highlight', target: 'vendors-create',
        title: 'The Add vendor button',
        description: 'Top-right of the Vendors screen. Only procurement roles with permission see it.',
        placement: 'bottom',
      },
      {
        id: 'open-form', type: 'click', target: 'vendors-create',
        title: 'Open the form',
        description: 'Click Add vendor to open the registration form.',
        hint: 'Click “Add vendor” to continue. Use Skip Step if you prefer not to open the form.',
        placement: 'bottom',
      },
      {
        id: 'business', type: 'info',
        title: 'Business details',
        description:
          'Name and code identify the vendor across the system. Add the contact person and phone so anyone in the company can reach them.',
      },
      {
        id: 'gstin', type: 'info',
        title: 'GSTIN and terms',
        description:
          'GSTIN matters for tax-compliant purchasing, and payment terms (like 30 days) drive your accounts. Capturing them now saves chasing them later.',
      },
      {
        id: 'save', type: 'info',
        title: 'Save',
        description: 'Save registers the vendor. For this tutorial you can close the form instead.',
      },
      {
        id: 'done', type: 'complete',
        title: 'Done',
        description: 'You now know exactly how to add a vendor — and why each field matters.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // OPERATIONS — Dispatch
  // ─────────────────────────────────────────────────────────────
  {
    id: 'dispatch-quick-tour',
    title: 'Dispatch — Quick Tour',
    description: 'Learn the Dispatch workspace — the logistics pipeline, creating a dispatch and tracking shipments.',
    category: 'operations',
    difficulty: 'Intermediate',
    estimatedMinutes: 4,
    route: '/dispatch',
    learnings: ['Read dispatch KPIs', 'Create a dispatch', 'Search dispatches', 'Open a dispatch', 'Track delivery status'],
    keywords: ['dispatch', 'logistics', 'delivery', 'shipment', 'otp', 'transport', 'tour'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/dispatch',
        title: 'Welcome to Dispatch',
        description:
          'Dispatch is where orders become deliveries — material leaves the warehouse, moves to the site and is verified on arrival. Every dispatch tracks the goods, the transporter and the delivery confirmation.',
      },
      {
        id: 'kpi', type: 'highlight', target: 'dispatch-kpi',
        title: 'Logistics at a glance',
        description:
          'The KPI cards show the state of your logistics — pending dispatches, in-transit, delivered and exceptions that need attention.',
        placement: 'bottom',
      },
      {
        id: 'create', type: 'highlight', target: 'dispatch-create',
        title: 'Create a dispatch',
        description:
          'Use this to raise a dispatch for an order — pick the items, warehouse and transporter. The system then issues a delivery OTP so the site team can verify receipt.',
        placement: 'bottom',
      },
      {
        id: 'search', type: 'highlight', target: 'dispatch-search',
        title: 'Find a dispatch',
        description:
          'Search by dispatch ID, order, customer or vehicle. When a customer asks “where is my material?” — this finds the shipment instantly.',
        placement: 'bottom',
      },
      {
        id: 'table', type: 'highlight', target: 'dispatch-table',
        title: 'The dispatch list',
        description:
          'Each row is one dispatch with its order, items, status and assigned transporter. Status moves from Pending through In Transit to Delivered.',
        placement: 'top',
      },
      {
        id: 'open-record', type: 'highlight', target: 'dispatch-row-view',
        title: 'Open a dispatch',
        description:
          'Click View to open the dispatch detail — full item list, transporter, OTP and the actions to confirm or close delivery.',
        placement: 'top',
      },
      {
        id: 'pagination', type: 'highlight', target: 'dispatch-pagination',
        title: 'Page through',
        description: 'Use these controls to move through dispatches and set your page size.',
        placement: 'top',
      },
      {
        id: 'done', type: 'complete',
        title: 'Tour complete',
        description: 'You now know the main functions available in the Dispatch workspace.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // FINANCE — Payments
  // ─────────────────────────────────────────────────────────────
  {
    id: 'payments-quick-tour',
    title: 'Payments — Quick Tour',
    description: 'Learn the Payments workspace — recording payments, searching transactions and reading payment status.',
    category: 'finance',
    difficulty: 'Beginner',
    estimatedMinutes: 4,
    route: '/payments',
    learnings: ['Record a payment', 'Search transactions', 'Filter by mode and status', 'Read payment details'],
    keywords: ['payment', 'payment received', 'upi', 'cash', 'bank', 'collection', 'tour'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/payments',
        title: 'Welcome to Payments',
        description:
          'Payments records every rupee that comes in — from the customer, against an order. Each entry ties the money to a customer, an order, a payment mode and a status, so the accounts always reconcile.',
      },
      {
        id: 'create', type: 'highlight', target: 'payments-create',
        title: 'Record a payment',
        description:
          'Record Payment captures an incoming payment — customer, order, amount, mode (UPI, cash, bank) and reference. Recording payments here is what keeps customer accounts and revenue reports accurate.',
        placement: 'bottom',
      },
      {
        id: 'search', type: 'highlight', target: 'payments-search',
        title: 'Search transactions',
        description:
          'Search by customer, order or reference. When a customer asks whether their payment was received, this is where you prove it in seconds.',
        placement: 'bottom',
      },
      {
        id: 'table', type: 'highlight', target: 'payments-table',
        title: 'The payments list',
        description:
          'Every row is one transaction with its ID, date, customer, amount, mode and status. The mode cards above — UPI, Cash and more — give you totals at a glance.',
        placement: 'top',
      },
      {
        id: 'open-record', type: 'info',
        title: 'Open a payment',
        description:
          'Use the actions on a row to view the full payment detail, including its reference number — or to handle a refund for an incorrect payment.',
      },
      {
        id: 'pagination', type: 'highlight', target: 'payments-pagination',
        title: 'Page through',
        description: 'Use these controls to move through the payment history.',
        placement: 'top',
      },
      {
        id: 'done', type: 'complete',
        title: 'Tour complete',
        description: 'You now know the main functions available in the Payments workspace.',
      },
    ],
  },

  {
    id: 'payments-record',
    title: 'Record a Payment',
    description: 'The answer to “a customer paid me — where do I enter it?” — the full record-a-payment flow.',
    category: 'finance',
    difficulty: 'Intermediate',
    estimatedMinutes: 3,
    route: '/payments',
    learnings: ['Open the Record Payment form', 'Select the customer and order', 'Enter amount and mode', 'Save the transaction'],
    keywords: ['payment', 'record', 'receive', 'upi', 'cash', 'collection'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/payments',
        title: 'Recording money in',
        description:
          'The moment a customer pays — by UPI, cash or bank transfer — that money must be recorded against their order. Doing it here keeps their account, the stock release and the revenue reports correct.',
      },
      {
        id: 'create-button', type: 'highlight', target: 'payments-create',
        title: 'The Record Payment button',
        description: 'Top-right of the Payments screen. Only roles with payment permissions see it.',
        placement: 'bottom',
      },
      {
        id: 'open-form', type: 'click', target: 'payments-create',
        title: 'Open the form',
        description: 'Click Record Payment to open the form.',
        hint: 'Click “Record Payment” to continue. Use Skip Step if you prefer not to open the form.',
        placement: 'bottom',
      },
      {
        id: 'customer', type: 'info',
        title: 'Customer and order',
        description:
          'Pick who paid and which order the payment is for. Tying the money to the order is what lets the system mark it paid and release the next step.',
      },
      {
        id: 'amount', type: 'info',
        title: 'Amount and mode',
        description:
          'Enter the amount and the mode — UPI, cash, bank. Add the reference/UTR number; it is what banks and customers will recognise in their own records.',
      },
      {
        id: 'save', type: 'info',
        title: 'Save it',
        description: 'Save posts the transaction and updates the order. For this tutorial you can close the form instead.',
      },
      {
        id: 'done', type: 'complete',
        title: 'Done',
        description: 'You now know exactly how to record a payment — and why the details matter.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // FINANCE — Reports
  // ─────────────────────────────────────────────────────────────
  {
    id: 'reports-quick-tour',
    title: 'Reports — Quick Tour',
    description: 'Learn the Reports & Analytics workspace — KPIs, revenue trends and the charts that tell you how the business is doing.',
    category: 'finance',
    difficulty: 'Beginner',
    estimatedMinutes: 3,
    route: '/reports',
    learnings: ['Read headline KPIs', 'Understand the revenue trend', 'Use the breakdown charts', 'Where exports live'],
    keywords: ['report', 'analytics', 'revenue', 'kpi', 'chart', 'trend', 'export', 'tour'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/reports',
        title: 'Welcome to Reports',
        description:
          'Reports turns the ERP’s live data into a business picture — revenue, payments, leads, customers and orders, all summarised automatically from the records your team already keeps.',
      },
      {
        id: 'kpi', type: 'highlight', target: 'reports-kpi',
        title: 'Headline numbers',
        description:
          'These six cards are the business at a glance: Total Revenue, Payments Received, Leads, Customers, Orders and Employees. No calculation needed — the system adds it up from real records.',
        placement: 'bottom',
      },
      {
        id: 'revenue', type: 'highlight', target: 'reports-revenue',
        title: 'The revenue trend',
        description:
          'This chart shows 12 months of revenue and orders. It is the fastest way to see whether the business is growing, flat or seasonal — and to spot a month that needs attention.',
        placement: 'bottom',
      },
      {
        id: 'sources', type: 'highlight', target: 'reports-lead-sources',
        title: 'Where leads come from',
        description:
          'The Lead Sources chart shows which channels bring business — website, referrals, walk-ins. If a channel is quiet, that is a signal for the sales team, not just a number.',
        placement: 'top',
      },
      {
        id: 'export', type: 'info',
        title: 'Take it with you',
        description:
          'Reports also tracks your export history — use the export controls on this page to pull reports out for presentations, board reviews or offline analysis.',
      },
      {
        id: 'done', type: 'complete',
        title: 'Tour complete',
        description: 'You now know how to read the main reports in the Reports & Analytics workspace.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // HR — Employees
  // ─────────────────────────────────────────────────────────────
  {
    id: 'employees-quick-tour',
    title: 'Employees — Quick Tour',
    description: 'Learn the Employees workspace — the people directory, adding staff and opening an employee profile.',
    category: 'hr',
    difficulty: 'Beginner',
    estimatedMinutes: 3,
    route: '/employees',
    learnings: ['Add an employee', 'Search staff', 'Read employee details', 'Open a profile'],
    keywords: ['employee', 'staff', 'team', 'people', 'hr', 'tour'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/employees',
        title: 'Welcome to Employees',
        description:
          'Employees is your people directory — every staff member with their role, department and contact details. Employee records power assignments, attendance and payroll across the ERP.',
      },
      {
        id: 'create', type: 'highlight', target: 'employees-create',
        title: 'Add an employee',
        description:
          'Add Employee registers a new staff member. Doing this once means they can be assigned leads, marked in attendance and paid through payroll.',
        placement: 'bottom',
      },
      {
        id: 'search', type: 'highlight', target: 'employees-search',
        title: 'Find staff',
        description:
          'Search by name, phone, email or department. Need a colleague’s number, or to check who is in which team? Type and you are there.',
        placement: 'bottom',
      },
      {
        id: 'table', type: 'highlight', target: 'employees-table',
        title: 'The people list',
        description:
          'Each row is one employee with role, department, contact and status. The status shows who is active — useful for assignment and attendance decisions.',
        placement: 'top',
      },
      {
        id: 'open-record', type: 'highlight', target: 'employees-row',
        title: 'Open a profile',
        description:
          'Click any row to open the employee’s full profile — personal details, role, and the records connected to them.',
        placement: 'top',
      },
      {
        id: 'done', type: 'complete',
        title: 'Tour complete',
        description: 'You now know the main functions available in the Employees workspace.',
      },
    ],
  },

  {
    id: 'employees-add',
    title: 'Add an Employee',
    description: 'The answer to “how do I add a new team member?” — the quick, complete flow.',
    category: 'hr',
    difficulty: 'Beginner',
    estimatedMinutes: 2,
    route: '/employees',
    learnings: ['Open the Add Employee form', 'Enter personal details', 'Set role and department', 'Save the employee'],
    keywords: ['employee', 'staff', 'add', 'create', 'hire', 'hr'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/employees',
        title: 'Adding a team member',
        description:
          'When someone joins, add them here once — then the whole system knows them: assignments, attendance, payroll and reporting all reference this record.',
      },
      {
        id: 'create-button', type: 'highlight', target: 'employees-create',
        title: 'The Add Employee button',
        description: 'Top-right of the Employees screen. Visible to roles with employee management permission.',
        placement: 'bottom',
      },
      {
        id: 'open-form', type: 'click', target: 'employees-create',
        title: 'Open the form',
        description: 'Click Add Employee to open the form.',
        hint: 'Click “Add Employee” to continue. Use Skip Step if you prefer not to open the form.',
        placement: 'bottom',
      },
      {
        id: 'details', type: 'info',
        title: 'Personal details',
        description:
          'Name, phone, email and designation identify the person everywhere in the system — from lead assignments to payslips.',
      },
      {
        id: 'role', type: 'info',
        title: 'Role and department',
        description:
          'Role and department decide what the employee sees and does in the ERP — their permissions follow from this. Get it right at creation to avoid access problems later.',
      },
      {
        id: 'save', type: 'info',
        title: 'Save',
        description: 'Save creates the employee record. For this tutorial you can close the form instead.',
      },
      {
        id: 'done', type: 'complete',
        title: 'Done',
        description: 'You now know exactly how to add an employee — and why each field matters.',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // HR — Attendance
  // ─────────────────────────────────────────────────────────────
  {
    id: 'attendance-quick-tour',
    title: 'Attendance — Quick Tour',
    description: 'Learn the Attendance workspace — checking in and out, searching records and reading daily presence.',
    category: 'hr',
    difficulty: 'Beginner',
    estimatedMinutes: 3,
    route: '/attendance',
    learnings: ['Check in and out', 'Search attendance records', 'Read presence status', 'Open an attendance record'],
    keywords: ['attendance', 'present', 'absent', 'leave', 'timesheet', 'hr', 'tour', 'check in', 'check out'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/attendance',
        title: 'Welcome to Attendance',
        description:
          'Attendance records who was present, on leave, or absent on each day. These records are the ground truth for payroll and for spotting staffing gaps.',
      },
      {
        id: 'actions', type: 'highlight', target: 'attendance-actions',
        title: 'Two ways to mark your own attendance',
        description:
          'Manual Attendance is a one-click action — no form, no picking a date or time. Geo Attendance does the same thing but also verifies you are at the work location via GPS. Your first click of the day checks you in; the next checks you out.',
        placement: 'bottom',
      },
      {
        id: 'search', type: 'highlight', target: 'attendance-search',
        title: 'Search records',
        description:
          'Search by employee name, ID or notes. “Was Ramesh present last Thursday?” — one search answers it.',
        placement: 'bottom',
      },
      {
        id: 'table', type: 'highlight', target: 'attendance-table',
        title: 'The attendance list',
        description:
          'Each row is one day for one employee with date, status, and in/out times. The status badges — Present, Absent, Leave — make the day readable at a glance.',
        placement: 'top',
      },
      {
        id: 'open-record', type: 'highlight', target: 'attendance-row',
        title: 'Open a record',
        description:
          'Click any row to open the full record with in/out times and notes — the detail behind the badge.',
        placement: 'top',
      },
      {
        id: 'done', type: 'complete',
        title: 'Tour complete',
        description: 'You now know the main functions available in the Attendance workspace.',
      },
    ],
  },

  {
    id: 'attendance-mark',
    title: 'Check In / Check Out',
    description: 'The answer to “how do I mark my own attendance today?” — the daily check-in/check-out flow.',
    category: 'hr',
    difficulty: 'Beginner',
    estimatedMinutes: 2,
    route: '/attendance',
    learnings: ['Find the attendance action buttons', 'Check in with one click', 'Check out with one click'],
    keywords: ['attendance', 'mark', 'present', 'absent', 'daily', 'hr', 'check in', 'check out'],
    steps: [
      {
        id: 'intro', type: 'info', route: '/attendance',
        title: 'Marking your day',
        description:
          'There is no form to fill in. The system already knows who you are — one click records the current moment as your check-in or check-out, whichever is next.',
      },
      {
        id: 'actions', type: 'highlight', target: 'attendance-actions',
        title: 'Manual Attendance and Geo Attendance',
        description:
          'Both buttons live here, side by side. Manual Attendance works anywhere. Geo Attendance additionally confirms your GPS location is within the work area before recording the event.',
        placement: 'bottom',
      },
      {
        id: 'first-click', type: 'info',
        title: 'First click of the day',
        description: 'Automatically records a Check In — no date, time, or status to choose.',
      },
      {
        id: 'second-click', type: 'info',
        title: 'Second click of the day',
        description: 'The same button now records your Check Out and calculates working hours automatically.',
      },
      {
        id: 'done', type: 'complete',
        title: 'Done',
        description: 'You now know exactly how to check in and out for the day.',
      },
    ],
  },
];

export function getTutorialById(id: string): TutorialDefinition | undefined {
  return TUTORIALS.find((t) => t.id === id);
}

export function getTutorialsByCategory(categoryId: string): TutorialDefinition[] {
  return TUTORIALS.filter((t) => t.category === categoryId);
}
