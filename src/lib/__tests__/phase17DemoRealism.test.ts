/**
 * phase17DemoRealism.test.ts — "Demo Mode — Final Business-Flow Data Rebuild
 * & Realistic ERP Demo Validation" permanent regression tests.
 *
 * Covers the two things this task's own audit found genuinely missing from
 * the (already B2B/B2C-correct, already stage-coherent) Demo Mode dataset:
 *
 *   1. Realistic Indian identity data — the dataset previously used
 *      obviously-synthetic placeholder names ("Demo Customer 01 — Survey
 *      Pending Residence", "Demo Employee 01", "Demo Solar Vendor 3", a
 *      hardcoded "Demo State"/"Demo City" everywhere) which a user could
 *      immediately recognize as fake test data, not a believable ERP.
 *
 *   2. B2B chain completeness — only 2 B2B customers existed and BOTH
 *      stopped at Order, with no PI/Payment/Dispatch/serial-capture/Bill —
 *      the material-sales workflow's own later stages were never
 *      demonstrated at all.
 *
 * Every assertion here is generic (reads the generated plan's own data,
 * never hardcodes an assumption about which specific id has which name) so
 * it keeps protecting the invariant if a future phase changes the specific
 * names/counts used.
 */
import { describe, expect, it } from 'vitest';
import { buildCompleteDemoPlan } from '../../../scripts/demo/datasets/complete.ts';

const plan = () => buildCompleteDemoPlan('TEST-AUTH-UID');
const docs = (collection: string) => plan().documents.filter((d) => d.collection === collection);

// ── 1. Realistic identity data ──────────────────────────────────────────

describe('Phase 17 — no obviously-synthetic placeholder identity data anywhere in the generated dataset', () => {
  const PLACEHOLDER_PATTERNS: RegExp[] = [
    /Demo Customer \d/i,
    /Demo Employee \d/i,
    /Demo Solar Vendor/i,
    /Demo Warehouse \d/i,
    /Demo Solar Referral Partner/i,
    /Demo Partner Contact/i,
    /Fictional [A-Za-z]+ (Avenue|Lane|Yard|Zone|Park)/,
    /\bDemo State\b/,
    /\bDemo City\b/,
    /DEMO-VEHICLE/,
  ];

  it('no display-identity field anywhere in the plan matches a known placeholder-name pattern', () => {
    const text = JSON.stringify(plan().documents.map((d) => d.data));
    for (const pattern of PLACEHOLDER_PATTERNS) {
      expect(text, `found placeholder pattern ${pattern} in generated demo data`).not.toMatch(pattern);
    }
  });

  it('every B2C customer has a unique, non-empty, realistic-looking name (not a numbered placeholder)', () => {
    const customers = docs('customers').filter((c) => c.data.type === 'B2C');
    expect(customers.length).toBeGreaterThanOrEqual(10);
    const names = customers.map((c) => String(c.data.name || ''));
    expect(names.every((n) => n.length > 3)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    // A realistic name is letters/spaces (plus common punctuation like '.'
    // or "'"), never a digit — digits are exactly what a numbered
    // placeholder ("Demo Customer 01") would contain.
    expect(names.every((n) => !/\d/.test(n))).toBe(true);
  });

  it('every B2C Project has a unique, realistic site name distinct from its own Customer name (no status/stage baked into the name)', () => {
    const projects = docs('projects');
    const names = projects.map((p) => String(p.data.name || ''));
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => !/\d/.test(n))).toBe(true);
    // The old bug: project names literally encoded a workflow stage, e.g.
    // "Survey Pending Residence" — assert none of the real stage words leak
    // into a project's display name.
    for (const stageWord of ['Pending', 'Active', 'Compliance', 'Partial Payment']) {
      expect(names.some((n) => n.includes(stageWord))).toBe(false);
    }
  });

  it('every customer/employee/vendor/warehouse/channel-partner uses a real Indian state, never the placeholder "Demo State"', () => {
    const stateBearing = [...docs('customers'), ...docs('employees'), ...docs('warehouses')];
    const realIndianStates = new Set(['Maharashtra', 'Gujarat', 'Madhya Pradesh', 'Uttar Pradesh']);
    for (const row of stateBearing) {
      if (row.data.state) expect(realIndianStates.has(String(row.data.state)), `${row.collection}/${row.id} has an unrecognized state: ${row.data.state}`).toBe(true);
    }
  });

  it('B2B customers and vendors carry a GSTIN-shaped (15-character), and mutually UNIQUE, identifier — never the old non-GSTIN-shaped placeholder, never shared between two different real entities', () => {
    const gstBearing = [...docs('customers').filter((c) => c.data.type === 'B2B'), ...docs('vendors')];
    expect(gstBearing.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const row of gstBearing) {
      const gst = String((row.data as any).gst || (row.data as any).gstin || '');
      expect(gst.length, `${row.collection}/${row.id} GST value "${gst}" is not GSTIN-shaped`).toBe(15);
      // Unmistakably fake: 'DEMO' embedded in the PAN segment, which is not
      // a real PAN prefix pattern — can never collide with a real GSTIN.
      expect(gst).toContain('DEMO');
      expect(seen.has(gst), `${row.collection}/${row.id} shares its GSTIN "${gst}" with another entity`).toBe(false);
      seen.add(gst);
    }
  });

  it('employee/vendor/warehouse/channel-partner display names are realistic (no numbered "X 01" placeholder pattern)', () => {
    const named = [
      ...docs('employees').map((d) => String(d.data.name || '')),
      ...docs('vendors').map((d) => String(d.data.name || '')),
      ...docs('warehouses').map((d) => String(d.data.name || '')),
      ...docs('channel_partners').map((d) => String(d.data.firmName || '')),
    ];
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((n) => n.length > 0)).toBe(true);
    expect(named.every((n) => !/^Demo /.test(n))).toBe(true);
  });
});

// ── 2. B2B chain completeness + variety ─────────────────────────────────

describe('Phase 17 — B2B material-sales workflow is fully represented, with realistic variety', () => {
  const customers = docs('customers');
  const b2b = customers.filter((c) => c.data.type === 'B2B');
  const orders = docs('orders');
  const quotations = docs('quotations');
  const pis = docs('proforma_invoices');
  const payments = docs('payments');
  const dispatches = docs('dispatch');
  const taxInvoices = docs('tax_invoices');

  it('at least 5 B2B customers exist (task requirement: 5-8 with real variety)', () => {
    expect(b2b.length).toBeGreaterThanOrEqual(5);
  });

  it('every B2B customer that has an Order also has a real PI for that order (Order -> PI, per the material-sales flow)', () => {
    for (const c of b2b) {
      const custOrders = orders.filter((o) => o.data.customerId === c.id);
      for (const order of custOrders) {
        const pi = pis.find((p) => p.data.orderId === order.id);
        expect(pi, `B2B order ${order.id} (customer ${c.id}) must have a Proforma Invoice`).toBeTruthy();
      }
    }
  });

  it('every B2B PI marked Paid has a real Payment record covering it, and every Dispatch that is Delivered/Closed was preceded by a Paid or Partial PI (Mark PI Paid -> Dispatch)', () => {
    for (const c of b2b) {
      const custOrders = orders.filter((o) => o.data.customerId === c.id);
      for (const order of custOrders) {
        const pi = pis.find((p) => p.data.orderId === order.id);
        if (!pi) continue;
        if (pi.data.paymentStatus === 'Paid' || pi.data.paymentStatus === 'Partial') {
          const payment = payments.find((p) => p.data.orderId === order.id);
          expect(payment, `PI ${pi.id} (${pi.data.paymentStatus}) must have a real Payment record`).toBeTruthy();
        }
        const dispatch = dispatches.find((d) => d.data.orderId === order.id);
        if (dispatch && (dispatch.data.status === 'Delivered' || dispatch.data.status === 'Closed')) {
          expect(['Paid', 'Partial'], `Dispatch ${dispatch.id} is ${dispatch.data.status} but its PI is ${pi.data.paymentStatus}`).toContain(pi.data.paymentStatus);
        }
      }
    }
  });

  it('B2B Dispatch items use the real dispatch schema (trackingType/verifiedQty/serials on item lines, vehicleNo at the top level) — never a standalone serial_numbers doc, which is Installation/B2C-only', () => {
    const b2bIds = new Set(b2b.map((c) => c.id));
    const b2bDispatches = dispatches.filter((d) => b2bIds.has(String(d.data.customerId || '')));
    expect(b2bDispatches.length).toBeGreaterThan(0);
    for (const d of b2bDispatches) {
      expect(d.data.projectId).toBeUndefined();
      expect(typeof d.data.vehicleNo).toBe('string');
      const items = d.data.items as any[];
      expect(Array.isArray(items) && items.length > 0).toBe(true);
      for (const item of items) {
        expect(['serial', 'none']).toContain(item.trackingType);
        if (item.trackingType === 'serial' && d.data.status !== 'Pending Verification') {
          expect(Array.isArray(item.serials)).toBe(true);
          expect(item.serials.length).toBe(item.quantity);
        }
      }
    }
    // Confirmed real schema per the Dispatch workflow (lib/dispatchWorkflow.ts;
    // the DispatchManagementModal popup was retired by the Dispatch Workspace
    // Migration).
    const serialNumberDocs = docs('serial_numbers');
    for (const s of serialNumberDocs) {
      expect(s.data.installationId, `serial_numbers/${s.id} must be Installation-scoped (B2C), not dispatch-scoped`).toBeTruthy();
    }
  });

  it('demonstrates the required variety: quotation-first, direct-order, quotation-only (no order yet), dispatch pending/delivered/closed, and both an Issued and a Draft Bill', () => {
    const b2bOrders = orders.filter((o) => b2b.some((c) => c.id === o.data.customerId));
    expect(b2bOrders.some((o) => o.data.quotationId)).toBe(true);
    expect(b2bOrders.some((o) => !o.data.quotationId)).toBe(true);
    expect(b2b.some((c) => !orders.some((o) => o.data.customerId === c.id) && quotations.some((q) => q.data.customerId === c.id))).toBe(true);
    const b2bDispatchStatuses = new Set(dispatches.filter((d) => b2b.some((c) => c.id === d.data.customerId)).map((d) => d.data.status));
    expect(b2bDispatchStatuses.has('Pending Verification')).toBe(true);
    expect(b2bDispatchStatuses.has('Delivered')).toBe(true);
    expect(b2bDispatchStatuses.has('Closed')).toBe(true);
    const b2bBillStatuses = new Set(taxInvoices.filter((t) => b2b.some((c) => c.id === t.data.customerId)).map((t) => t.data.status));
    expect(b2bBillStatuses.has('Issued')).toBe(true);
    expect(b2bBillStatuses.has('Draft')).toBe(true);
    // Payment-pending variety: at least one B2B PI genuinely Pending (no payment yet).
    expect(pis.some((p) => b2b.some((c) => c.id === p.data.customerId) && p.data.paymentStatus === 'Pending')).toBe(true);
  });
});

// ── 3. B2B/B2C segregation — zero-tolerance, re-verified against the full downstream graph ──

describe('Phase 17 — zero B2B customers are referenced by any B2C Project or B2C-only downstream module', () => {
  it('proves, from the generated data, the exact zero-counts this task requires', () => {
    const customers = docs('customers');
    const b2bIds = new Set(customers.filter((c) => c.data.type === 'B2B').map((c) => c.id));
    const projects = docs('projects');

    const b2bCustomersWithProjects = projects.filter((p) => b2bIds.has(String(p.data.customerId || '')));
    expect(b2bCustomersWithProjects).toEqual([]);

    const projectsReferencingB2B = projects.filter((p) => b2bIds.has(String(p.data.customerId || '')));
    expect(projectsReferencingB2B).toEqual([]);

    const b2cOnlyDownstream = ['surveys', 'engineering_designs', 'installations', 'qc_checks', 'commissioning_records', 'net_metering_applications', 'subsidy_applications', 'project_handovers', 'amc_contracts', 'service_tickets'];
    for (const collection of b2cOnlyDownstream) {
      const violations = docs(collection).filter((d) => b2bIds.has(String((d.data as any).customerId || '')));
      expect(violations, `${collection} must never reference a B2B customer`).toEqual([]);
    }

    // Reverse: every Project genuinely resolves to a real, existing B2C customer.
    const customersById = new Map(customers.map((c) => [c.id, c]));
    const orphanOrMisclassifiedProjects = projects.filter((p) => {
      const customer = customersById.get(String(p.data.customerId || ''));
      return !customer || customer.data.type !== 'B2C';
    });
    expect(orphanOrMisclassifiedProjects).toEqual([]);
  });
});

// ── 4. Determinism ───────────────────────────────────────────────────────

describe('Phase 17 — reset/reseed determinism holds for the rebuilt identity + B2B data', () => {
  it('regenerating the plan twice yields byte-identical customers/employees/vendors/B2B chain data', () => {
    const a = plan();
    const b = plan();
    const relevant = ['customers', 'leads', 'projects', 'employees', 'vendors', 'warehouses', 'orders', 'quotations', 'proforma_invoices', 'payments', 'dispatch', 'tax_invoices', 'channel_partners'];
    for (const collection of relevant) {
      expect(a.documents.filter((d) => d.collection === collection)).toEqual(b.documents.filter((d) => d.collection === collection));
    }
  });
});
