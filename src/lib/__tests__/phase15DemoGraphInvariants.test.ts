/**
 * phase15DemoGraphInvariants.test.ts — Phase 15 (Demo Mode Finalization)
 * permanent graph-integrity regression tests.
 *
 * These are deliberately GENERIC (never keyed to one specific hardcoded
 * demo id) so they keep protecting the hard B2B/B2C invariant even if a
 * future phase changes which specific customer/project ids are B2B vs B2C,
 * per the Blueprint's own instruction: "codify it as a permanent test so it
 * can't regress silently again."
 *
 * Context: a fresh Phase 15 audit traced every line of
 * scripts/demo/datasets/businessGraph.ts and foundation.ts and confirmed
 * the CURRENT generator code already produces zero B2B-Customer-with-
 * Project relationships — buildCustomersProjects() only ever creates
 * type:'B2C' customers paired with a Project, and buildB2BExample()'s one
 * B2B customer (type:'B2B') is never referenced by any Project/Survey/
 * Engineering/Installation/QC/Commissioning/… record anywhere in the file
 * (confirmed by exhaustive grep). This is additionally enforced at the true
 * service layer (src/lib/projectWorkflow.ts's createProject(), which throws
 * if the linked customer is B2B) and at the reclassification boundary
 * (src/features/customers/hooks/useCustomers.ts's
 * updateCustomerProjectionWithPhoneLock(), which blocks reclassifying an
 * already-Project-linked B2C customer to B2B) — so no code path in this
 * repository, generator or production, can currently create this state.
 * These tests make that fact permanent and self-verifying.
 */
import { describe, expect, it } from 'vitest';
import { buildCompleteDemoPlan } from '../../../scripts/demo/datasets/complete.ts';
import { readFileSync } from 'node:fs';

const plan = () => buildCompleteDemoPlan('TEST-AUTH-UID');
const docs = (collection: string) => plan().documents.filter((d) => d.collection === collection);
const byId = <T extends { collection: string; id: string }>(rows: T[]) => new Map(rows.map((d) => [d.id, d]));

describe('Phase 15 — B2B/B2C demo graph segregation (hard invariant)', () => {
  it('every demo Customer has a real, valid type — B2B or B2C, never missing/invented', () => {
    const customers = docs('customers');
    expect(customers.length).toBeGreaterThan(0);
    for (const c of customers) {
      expect(['B2B', 'B2C']).toContain((c.data as any).type);
    }
  });

  it('B2B Customers with Projects: 0 — no B2B customer has ANY Project referencing it, checked generically for every B2B customer in the plan', () => {
    const customers = docs('customers');
    const b2bIds = new Set(customers.filter((c) => (c.data as any).type === 'B2B').map((c) => c.id));
    expect(b2bIds.size).toBeGreaterThan(0); // sanity: the B2B graph genuinely exists
    const projects = docs('projects');
    const violations = projects.filter((p) => b2bIds.has(String((p.data as any).customerId || '')));
    expect(violations).toEqual([]);
  });

  it('Projects referencing B2B Customers: 0 — reverse check, every Project\'s customerId resolves to a B2C customer', () => {
    const customersById = byId(docs('customers'));
    const projects = docs('projects');
    expect(projects.length).toBeGreaterThan(0);
    const violations = projects.filter((p) => {
      const customer = customersById.get(String((p.data as any).customerId || ''));
      return !customer || (customer.data as any).type !== 'B2C';
    });
    expect(violations).toEqual([]);
  });

  it('no B2B customer is referenced by any Survey/Engineering/Installation/QC/Commissioning/NetMetering/Subsidy/Handover/AMC/ServiceTicket record (the full B2C-only downstream chain)', () => {
    const customers = docs('customers');
    const b2bIds = new Set(customers.filter((c) => (c.data as any).type === 'B2B').map((c) => c.id));
    const b2cOnlyCollections = [
      'surveys', 'engineering_designs', 'installations', 'qc_checks', 'commissioning_records',
      'net_metering_applications', 'subsidy_applications', 'project_handovers', 'amc_contracts', 'service_tickets',
    ];
    for (const collection of b2cOnlyCollections) {
      const rows = docs(collection);
      const violations = rows.filter((r) => {
        const customerId = (r.data as any).customerId;
        return customerId && b2bIds.has(String(customerId));
      });
      expect(violations, `${collection} must never reference a B2B customer`).toEqual([]);
    }
  });

  it('B2B Customers have no projectId/leadId-derived Project field set on their own record', () => {
    const customers = docs('customers');
    const b2b = customers.filter((c) => (c.data as any).type === 'B2B');
    for (const c of b2b) {
      expect((c.data as any).projectId).toBeUndefined();
    }
  });
});

describe('Phase 15 — Order.orderType === Customer.type invariant (permanent, checked for every Order via every creation path)', () => {
  it('Invalid OrderType mismatches: 0 — every demo Order\'s orderType matches its linked Customer\'s real type, with zero exceptions', () => {
    const customersById = byId(docs('customers'));
    const orders = docs('orders');
    expect(orders.length).toBeGreaterThan(0);
    const mismatches = orders.filter((o) => {
      const customer = customersById.get(String((o.data as any).customerId || ''));
      return !customer || (o.data as any).orderType !== (customer.data as any).type;
    });
    expect(mismatches).toEqual([]);
  });

  it('at least one Order genuinely exercises each of B2B and B2C orderType (not a single-branch coincidence)', () => {
    const orders = docs('orders');
    expect(orders.some((o) => (o.data as any).orderType === 'B2B')).toBe(true);
    expect(orders.some((o) => (o.data as any).orderType === 'B2C')).toBe(true);
  });
});

describe('Phase 15 — downstream integrity: no record exists without its required upstream parent', () => {
  it('every Quotation with a projectId resolves to a real Project; every Quotation resolves to a real Customer', () => {
    const projectIds = new Set(docs('projects').map((d) => d.id));
    const customerIds = new Set(docs('customers').map((d) => d.id));
    for (const q of docs('quotations')) {
      if ((q.data as any).projectId) expect(projectIds.has((q.data as any).projectId)).toBe(true);
      expect(customerIds.has(String((q.data as any).customerId || ''))).toBe(true);
    }
  });

  it('every Order resolves to a real Customer, and (when present) a real Quotation and a real Project', () => {
    const customerIds = new Set(docs('customers').map((d) => d.id));
    const quotationIds = new Set(docs('quotations').map((d) => d.id));
    const projectIds = new Set(docs('projects').map((d) => d.id));
    for (const o of docs('orders')) {
      expect(customerIds.has(String((o.data as any).customerId || ''))).toBe(true);
      if ((o.data as any).quotationId) expect(quotationIds.has((o.data as any).quotationId)).toBe(true);
      if ((o.data as any).projectId) expect(projectIds.has((o.data as any).projectId)).toBe(true);
    }
  });

  it('every Dispatch resolves to a real Order and a real Warehouse', () => {
    const orderIds = new Set(docs('orders').map((d) => d.id));
    const warehouseIds = new Set(docs('warehouses').map((d) => d.id));
    const dispatches = docs('dispatch');
    expect(dispatches.length).toBeGreaterThan(0);
    for (const d of dispatches) {
      expect(orderIds.has(String((d.data as any).orderId || ''))).toBe(true);
      expect(warehouseIds.has(String((d.data as any).warehouseId || ''))).toBe(true);
    }
  });

  it('every Payment resolves to a real Customer, and (when present) a real Order/Invoice', () => {
    const customerIds = new Set(docs('customers').map((d) => d.id));
    const orderIds = new Set(docs('orders').map((d) => d.id));
    const invoiceIds = new Set(docs('proforma_invoices').map((d) => d.id));
    const payments = docs('payments');
    expect(payments.length).toBeGreaterThan(0);
    for (const p of payments) {
      expect(customerIds.has(String((p.data as any).customerId || ''))).toBe(true);
      if ((p.data as any).orderId) expect(orderIds.has((p.data as any).orderId)).toBe(true);
      if ((p.data as any).invoiceId) expect(invoiceIds.has((p.data as any).invoiceId)).toBe(true);
    }
  });

  it('every Employee resolves to a real linked User (Phase 12 link); every linked User with a warehouseId resolves to a real Warehouse', () => {
    const userIds = new Set(docs('users').map((d) => d.id));
    const warehouseIds = new Set(docs('warehouses').map((d) => d.id));
    const usersById = byId(docs('users'));
    for (const e of docs('employees')) {
      expect(userIds.has(String((e.data as any).userId || ''))).toBe(true);
      const linkedUser = usersById.get(String((e.data as any).userId));
      if (linkedUser && (linkedUser.data as any).warehouseId) {
        expect(warehouseIds.has((linkedUser.data as any).warehouseId)).toBe(true);
      }
    }
  });
});

describe('Phase 15 — Company Business Mode is genuinely present and correctly shapes the seeded graph', () => {
  it('the seeded companies/{DEMO_COMPANY_ID} document itself carries businessMode (not only the UI-side static fallback config)', () => {
    const companies = docs('companies');
    expect(companies).toHaveLength(1);
    expect((companies[0].data as any).businessMode).toBe('Both');
  });

  it('a "Both"-mode company\'s seeded graph genuinely contains both a real B2B flow and a real B2C flow (not a single-mode dataset mislabeled "Both")', () => {
    const customers = docs('customers');
    const b2bCount = customers.filter((c) => (c.data as any).type === 'B2B').length;
    const b2cCount = customers.filter((c) => (c.data as any).type === 'B2C').length;
    expect(b2bCount).toBeGreaterThan(0);
    expect(b2cCount).toBeGreaterThan(0);
    // The B2C graph must reach into the full downstream EPC chain (Project onward) — not just Leads/Customers.
    expect(docs('projects').length).toBeGreaterThan(0);
    expect(docs('surveys').length).toBeGreaterThan(0);
    expect(docs('qc_checks').length).toBeGreaterThan(0);
    // The B2B graph must reach Quotation -> Order without ever touching Project.
    const b2bCustomerIds = new Set(customers.filter((c) => (c.data as any).type === 'B2B').map((c) => c.id));
    const b2bOrders = docs('orders').filter((o) => b2bCustomerIds.has(String((o.data as any).customerId || '')));
    expect(b2bOrders.length).toBeGreaterThan(0);
    expect(b2bOrders.every((o) => !(o.data as any).projectId)).toBe(true);
  });
});

describe('Phase 15 — no artificial Demo record-count ceiling (source-verified; this environment cannot write to live Firestore)', () => {
  const firestoreSrc = readFileSync('src/lib/firestore.ts', 'utf-8');
  const configSrc = readFileSync('src/config/demo.ts', 'utf-8');
  // A duplicate, server-side mirror of the exact same ceiling was found
  // during this phase's audit in the Vercel serverless API route (a
  // completely separate code path from the client-side Firestore SDK calls
  // firestore.ts covers) — must be fixed at both places, not just one.
  const apiEntitySrc = readFileSync('api/[entity].ts', 'utf-8');
  const apiDemoResetSrc = readFileSync('api/demo-reset.ts', 'utf-8');

  it('DEMO_MAX_RECORDS no longer exists anywhere — the confirmed enforcement mechanism (Blueprint Appendix E item 5) was located and removed at every call site, not merely raised to a bigger number', () => {
    expect(configSrc).not.toContain('DEMO_MAX_RECORDS');
    expect(firestoreSrc).not.toContain('DEMO_MAX_RECORDS');
    expect(apiEntitySrc).not.toContain('DEMO_MAX_RECORDS');
    expect(apiDemoResetSrc).not.toContain('DEMO_MAX_RECORDS');
  });

  it('the server-side API route (api/[entity].ts) no longer rejects demo creates with DEMO_LIMIT_REACHED', () => {
    expect(apiEntitySrc).not.toContain('DEMO_LIMIT_REACHED');
    expect(apiEntitySrc).not.toContain('Demo limit reached');
  });

  it('enforceDemoRecordLimit() still enforces the legitimate business-crud capability gate, but no longer counts existing documents or throws a "limit reached" error', () => {
    const fnBody = firestoreSrc.slice(
      firestoreSrc.indexOf('async function enforceDemoRecordLimit'),
      firestoreSrc.indexOf('\n}', firestoreSrc.indexOf('async function enforceDemoRecordLimit')),
    );
    expect(fnBody).toContain("isDemoCapabilityAllowed(companyId, 'business-crud')");
    expect(fnBody).not.toContain('getDocs');
    expect(fnBody).not.toContain('Demo limit reached');
  });

  it('createDoc/createDocWithId/batchCreate all still call enforceDemoRecordLimit (the capability gate itself is preserved, only the numeric cap was removed)', () => {
    const createDocBody = firestoreSrc.slice(firestoreSrc.indexOf('export async function createDoc<'), firestoreSrc.indexOf('export async function createDocWithId'));
    const createDocWithIdBody = firestoreSrc.slice(firestoreSrc.indexOf('export async function createDocWithId'), firestoreSrc.indexOf('export async function updateDocById'));
    const batchCreateBody = firestoreSrc.slice(firestoreSrc.indexOf('export async function batchCreate'), firestoreSrc.indexOf('export async function batchCreate') + 800);
    expect(createDocBody).toContain('enforceDemoRecordLimit(col)');
    expect(createDocWithIdBody).toContain('enforceDemoRecordLimit(col)');
    expect(batchCreateBody).toContain('enforceDemoRecordLimit(col)');
  });
});

describe('Phase 15 — Demo reset/rebuild is idempotent and does not leave stale B2B->Project relationships', () => {
  it('regenerating the plan multiple times produces byte-identical document sets and manifest checksums (no drift, no duplicates)', () => {
    const a = plan(), b = plan(), c = plan();
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('every regeneration independently satisfies the B2B/Project segregation invariant (not just the first run)', () => {
    for (let i = 0; i < 3; i++) {
      const p = buildCompleteDemoPlan(`RUN-${i}`);
      const customers = p.documents.filter((d) => d.collection === 'customers');
      const b2bIds = new Set(customers.filter((c) => (c.data as any).type === 'B2B').map((c) => c.id));
      const projects = p.documents.filter((d) => d.collection === 'projects');
      expect(projects.some((pr) => b2bIds.has(String((pr.data as any).customerId || '')))).toBe(false);
    }
  });
});
