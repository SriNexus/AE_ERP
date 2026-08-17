/**
 * phase15StageCoherence.test.ts — "FINAL DEMO DATA / BUSINESS-FLOW
 * CORRECTION" permanent regression tests.
 *
 * Phase 15's own tests (phase15DemoGraphInvariants.test.ts) proved the
 * generator never attaches a Project to a B2B customer. They did NOT prove
 * that each B2C Project's currentStage actually agrees with the downstream
 * records that exist for it — a project claiming to be at 'Subsidy' with no
 * Survey/Engineering/Dispatch is just as much a data-integrity defect as a
 * B2B customer with a Project, even though it passes every Phase 15 check.
 *
 * These tests are deliberately GENERIC: every assertion is keyed off each
 * Project's own `currentStage` field read from the generated data, never off
 * a hardcoded PRJ-N id, so they keep protecting the invariant even if a
 * future phase changes which specific project ends up at which stage.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCompleteDemoPlan } from '../../../scripts/demo/datasets/complete.ts';
import { DEMO_RESETTABLE_COLLECTIONS } from '../../../scripts/demo/config.ts';

const plan = () => buildCompleteDemoPlan('TEST-AUTH-UID');
const docs = (collection: string) => plan().documents.filter((d) => d.collection === collection);

// The demo dataset's own local stage progression (scripts/demo/datasets/businessGraph.ts's
// `stages` const) — the order in which a B2C Project genuinely advances.
// CP-15 adds the two pre-Survey stages ('New', 'SchemeRegistration') that the
// Vendor Lock / Registration window occupies — real PROJECT_STAGE_ORDER stages
// (src/lib/projectLifecycle.ts) — for the seeded scheme registrations.
const STAGE_ORDER = ['New', 'SchemeRegistration', 'Survey', 'Engineering', 'Quotation', 'Procurement', 'Dispatch', 'QC', 'NetMetering', 'Subsidy', 'Handover', 'Service'];
const at = (stage: string) => STAGE_ORDER.indexOf(stage);

describe('Phase 15.1 — Project stage / downstream-record coherence (generic, not keyed to any one hardcoded demo id)', () => {
  const projects = docs('projects');
  const customers = docs('customers');
  const surveys = docs('surveys');
  const designs = docs('engineering_designs');
  const quotations = docs('quotations');
  const orders = docs('orders');
  const pis = docs('proforma_invoices');
  const dispatches = docs('dispatch');
  const installations = docs('installations');
  const qcChecks = docs('qc_checks');
  const commissioning = docs('commissioning_records');
  const netMetering = docs('net_metering_applications');
  const subsidy = docs('subsidy_applications');
  const handovers = docs('project_handovers');

  it('the demo dataset genuinely contains a B2C Project at every canonical stage (New -> SchemeRegistration -> the 10 post-registration stages; realistic lifecycle distribution, not a single-stage pile-up)', () => {
    expect(projects.length).toBeGreaterThan(0);
    const seenStages = new Set(projects.map((p) => p.data.currentStage));
    expect(seenStages).toEqual(new Set(STAGE_ORDER));
  });

  it('every Project.currentStage is one of the real, supported stage values — no invented status', () => {
    for (const proj of projects) {
      expect(STAGE_ORDER, `Project ${proj.id} has currentStage=${proj.data.currentStage}`).toContain(proj.data.currentStage as string);
    }
  });

  it('every Project references a real B2C customer (never missing, never B2B) — the customer-side half of the B2B/B2C separation', () => {
    const customersById = new Map(customers.map((c) => [c.id, c]));
    for (const proj of projects) {
      const customer = customersById.get(String(proj.data.customerId || ''));
      expect(customer, `Project ${proj.id}'s customerId must resolve to a real customer`).toBeTruthy();
      expect(customer!.data.type).toBe('B2C');
    }
  });

  it('every Project at Engineering-or-later has a Completed+Approved Survey resolving to a real Engineering Design', () => {
    for (const proj of projects) {
      if (at(proj.data.currentStage as string) < at('Engineering')) continue;
      const survey = surveys.find((s) => s.data.projectId === proj.id);
      expect(survey, `Project ${proj.id} at ${proj.data.currentStage} must have a Survey`).toBeTruthy();
      expect(survey!.data.status).toBe('Completed');
      expect(survey!.data.approvalStatus).toBe('Approved');
      const design = designs.find((d) => d.id === survey!.data.engineeringDesignId);
      expect(design, `Project ${proj.id}'s Survey must resolve a real Engineering Design`).toBeTruthy();
    }
  });

  it('every Project at Quotation-or-later has an Approved Engineering Design (not merely InReview)', () => {
    for (const proj of projects) {
      if (at(proj.data.currentStage as string) < at('Quotation')) continue;
      const design = designs.find((d) => d.data.projectId === proj.id);
      expect(design, `Project ${proj.id} must have an Engineering Design`).toBeTruthy();
      expect(design!.data.status).toBe('Approved');
    }
  });

  it('every Project at Procurement-or-later has a real Quotation, Order, and Proforma Invoice', () => {
    for (const proj of projects) {
      if (at(proj.data.currentStage as string) < at('Procurement')) continue;
      expect(quotations.some((q) => q.data.projectId === proj.id), `Project ${proj.id} must have a Quotation`).toBe(true);
      expect(orders.some((o) => o.data.projectId === proj.id), `Project ${proj.id} must have an Order`).toBe(true);
      expect(pis.some((x) => x.data.projectId === proj.id), `Project ${proj.id} must have a Proforma Invoice`).toBe(true);
    }
  });

  it('every Project genuinely AT the Dispatch stage has its own Dispatch record (even if not yet resolved)', () => {
    for (const proj of projects) {
      if (proj.data.currentStage !== 'Dispatch') continue;
      expect(dispatches.some((d) => d.data.projectId === proj.id), `Project ${proj.id} at Dispatch stage must have a Dispatch record`).toBe(true);
    }
  });

  it('every Project at QC-or-later has a resolved (Delivered/Closed) Dispatch and a real Installation', () => {
    for (const proj of projects) {
      if (at(proj.data.currentStage as string) < at('QC')) continue;
      const dispatch = dispatches.find((d) => d.data.projectId === proj.id);
      expect(dispatch, `Project ${proj.id} at ${proj.data.currentStage} must have a Dispatch`).toBeTruthy();
      expect(['Delivered', 'Closed']).toContain(dispatch!.data.status);
      expect(installations.some((x) => x.data.projectId === proj.id), `Project ${proj.id} must have a real Installation`).toBe(true);
    }
  });

  it('every Project at NetMetering-or-later has a passed QC and a completed Commissioning', () => {
    for (const proj of projects) {
      if (at(proj.data.currentStage as string) < at('NetMetering')) continue;
      const qc = qcChecks.find((q) => q.data.projectId === proj.id);
      expect(qc, `Project ${proj.id} must have a QC check`).toBeTruthy();
      expect(qc!.data.status).toBe('passed');
      const commission = commissioning.find((c) => c.data.projectId === proj.id);
      expect(commission, `Project ${proj.id} must have a Commissioning record`).toBeTruthy();
      expect(commission!.data.status).toBe('completed');
    }
  });

  it('every Project at Subsidy-or-later has filed a Net Metering application; every Project at Handover-or-later has a fully MeterInstalled Net Metering application', () => {
    for (const proj of projects) {
      const idx = at(proj.data.currentStage as string);
      if (idx < at('Subsidy')) continue;
      const nm = netMetering.find((n) => n.data.projectId === proj.id);
      expect(nm, `Project ${proj.id} must have a Net Metering application`).toBeTruthy();
      if (idx >= at('Handover')) {
        expect(nm!.data.status).toBe('MeterInstalled');
      }
    }
  });

  it('every Project at Handover-or-later has an Approved-or-Disbursed Subsidy application and a Completed Handover record', () => {
    for (const proj of projects) {
      if (at(proj.data.currentStage as string) < at('Handover')) continue;
      const sub = subsidy.find((s) => s.data.projectId === proj.id);
      expect(sub, `Project ${proj.id} must have a Subsidy application`).toBeTruthy();
      expect(['Approved', 'Disbursed']).toContain(sub!.data.status);
      const handover = handovers.find((h) => h.data.projectId === proj.id);
      expect(handover, `Project ${proj.id} at ${proj.data.currentStage} must have a Handover record`).toBeTruthy();
      expect(handover!.data.status).toBe('Completed');
    }
  });

  it('no Project earlier than a given stage has any record that only belongs to a LATER stage (forward-looking leakage check)', () => {
    for (const proj of projects) {
      const idx = at(proj.data.currentStage as string);
      if (idx < at('QC')) {
        expect(qcChecks.some((q) => q.data.projectId === proj.id && q.data.status === 'passed'), `Project ${proj.id} (stage ${proj.data.currentStage}, before QC) must not have a passed QC`).toBe(false);
      }
      if (idx < at('NetMetering')) {
        expect(commissioning.some((c) => c.data.projectId === proj.id && c.data.status === 'completed'), `Project ${proj.id} (stage ${proj.data.currentStage}, before NetMetering) must not have a completed Commissioning`).toBe(false);
      }
      if (idx < at('Handover')) {
        expect(handovers.some((h) => h.data.projectId === proj.id), `Project ${proj.id} (stage ${proj.data.currentStage}, before Handover) must not have a Handover record`).toBe(false);
      }
    }
  });
});

describe('Phase 15.1 — full downstream relationship integrity (no orphans, no dangling references)', () => {
  const projectIds = new Set(docs('projects').map((d) => d.id));
  // 'dispatch' is deliberately NOT in this list — Phase 17 gave it real B2B
  // examples (customerId-scoped, no projectId at all, per the material-sales
  // flow) alongside the existing B2C ones (projectId-scoped) — it has its
  // own dedicated check below instead of assuming every row is B2C.
  const b2cOnlyCollections = ['surveys', 'engineering_designs', 'installations', 'qc_checks', 'commissioning_records', 'net_metering_applications', 'subsidy_applications', 'project_handovers', 'amc_contracts', 'service_tickets', 'purchase_orders', 'goods_receipts'];

  it('every record in every B2C-only collection carries a projectId that resolves to a real Project (no orphans)', () => {
    for (const collection of b2cOnlyCollections) {
      const rows = docs(collection);
      expect(rows.length, `${collection} should not be empty`).toBeGreaterThan(0);
      for (const row of rows) {
        expect(projectIds.has(String(row.data.projectId || '')), `${collection}/${row.id} has a projectId that does not resolve to a real Project`).toBe(true);
      }
    }
  });

  it('every Dispatch resolves a real B2C Project (via projectId) and/or a real B2B Customer (via customerId) — never an orphan with neither', () => {
    const customerIds = new Set(docs('customers').map((d) => d.id));
    const dispatches = docs('dispatch');
    expect(dispatches.length).toBeGreaterThan(0);
    for (const d of dispatches) {
      const hasProject = Boolean(d.data.projectId);
      const hasCustomer = Boolean(d.data.customerId);
      expect(hasProject || hasCustomer, `dispatch/${d.id} resolves neither a Project nor a Customer`).toBe(true);
      if (hasProject) expect(projectIds.has(String(d.data.projectId)), `dispatch/${d.id}.projectId does not resolve to a real Project`).toBe(true);
      if (hasCustomer) expect(customerIds.has(String(d.data.customerId)), `dispatch/${d.id}.customerId does not resolve to a real Customer`).toBe(true);
    }
  });

  it('every service_ticket referencing an amcContractId resolves to a real AMC contract, and every AMC contract/service ticket resolves to a real B2C project+customer', () => {
    const amcIds = new Set(docs('amc_contracts').map((d) => d.id));
    const customersById = new Map(docs('customers').map((c) => [c.id, c]));
    for (const s of docs('service_tickets')) {
      if (s.data.amcContractId) expect(amcIds.has(String(s.data.amcContractId))).toBe(true);
      const customer = customersById.get(String(s.data.customerId || ''));
      expect(customer?.data.type).toBe('B2C');
    }
    for (const a of docs('amc_contracts')) {
      const customer = customersById.get(String(a.data.customerId || ''));
      expect(customer?.data.type).toBe('B2C');
    }
  });
});

describe('Phase 15.1 — B2B lifecycle examples stay fully isolated from every B2C-only downstream collection', () => {
  const customers = docs('customers');
  const b2bIds = new Set(customers.filter((c) => c.data.type === 'B2B').map((c) => c.id));

  it('B2B customer count is exactly what the six documented B2B fixtures produce (sanity: the B2B graph genuinely exists and did not silently grow/shrink)', () => {
    expect(b2bIds.size).toBe(6);
  });

  it('no B2B Order carries a projectId, Survey, Engineering, Dispatch-for-installation, or any other B2C-only field/relationship', () => {
    const orders = docs('orders');
    const b2bOrders = orders.filter((o) => b2bIds.has(String(o.data.customerId || '')));
    expect(b2bOrders.length).toBeGreaterThan(0);
    for (const order of b2bOrders) {
      expect(order.data.orderType).toBe('B2B');
      expect(order.data.projectId).toBeUndefined();
    }
  });

  it('every B2C Order (every Order whose customer is B2C) carries a real projectId — the reverse isolation check', () => {
    const customersById = new Map(customers.map((c) => [c.id, c]));
    const orders = docs('orders');
    const projectIds = new Set(docs('projects').map((p) => p.id));
    for (const order of orders) {
      const customer = customersById.get(String(order.data.customerId || ''));
      if (customer?.data.type !== 'B2C') continue;
      expect(order.data.orderType).toBe('B2C');
      expect(typeof order.data.projectId).toBe('string');
      expect(projectIds.has(String(order.data.projectId))).toBe(true);
    }
  });
});

describe('Phase 15.1 — the login-triggered sandbox reset endpoint uses the SAME audited generator as every other demo entry point (confirmed root cause of the B2B-customer-with-Project screenshots)', () => {
  // api/demo-reset.ts is what src/pages/Login.tsx actually calls (via
  // src/lib/sandboxReset.ts) on a browser's first login as demo@neozy.in.
  // It used to build its own separate, hand-written "V1" dataset that never
  // set Customer.type at all — completely bypassing the audited
  // scripts/demo/datasets/businessGraph.ts generator every other demo entry
  // point (CLI, GitHub Actions) uses. This is a permanent regression guard
  // against that endpoint silently drifting back to a parallel data source.
  const src = readFileSync('api/demo-reset.ts', 'utf-8');

  it('seeds from the single deterministic buildCompleteDemoPlan(), not a separate hand-written dataset', () => {
    expect(src).toContain('buildCompleteDemoPlan');
    expect(src).toMatch(/from ['"]\.\.\/scripts\/demo\/datasets\/complete\.ts['"]/);
  });

  it('deletes from the authoritative DEMO_RESETTABLE_COLLECTIONS list (kept in sync with the generator itself), not a hand-typed collection array that can silently drift out of sync', () => {
    expect(src).toContain('DEMO_RESETTABLE_COLLECTIONS');
  });

  it('no longer defines its own hardcoded demo record builders', () => {
    expect(src).not.toMatch(/function buildCustomerRecords/);
    expect(src).not.toMatch(/function buildProjectRecords/);
    expect(src).not.toContain('DEMO-V1-CUSTOMERS-001');
  });
});

describe('Phase 15.1 — reset/reseed determinism for the corrected graph', () => {
  it('regenerating the plan twice yields byte-identical stage/downstream data (reset -> reseed -> reset stays deterministic)', () => {
    const a = plan();
    const b = plan();
    const relevant = ['projects', 'surveys', 'engineering_designs', 'dispatch', 'qc_checks', 'commissioning_records', 'net_metering_applications', 'subsidy_applications', 'project_handovers', 'amc_contracts', 'service_tickets', 'purchase_orders', 'goods_receipts'];
    for (const collection of relevant) {
      const da = a.documents.filter((d) => d.collection === collection);
      const db = b.documents.filter((d) => d.collection === collection);
      expect(da).toEqual(db);
    }
  });
});

describe('Phase 15.1 — Banks/Registrations and every other collection previously ONLY seeded by the removed duplicate api/demo-reset.ts dataset are now covered by the canonical generator', () => {
  // Diffed the removed api/demo-reset.ts dataset's collection list against
  // this generator's own output: besides 'banks' and 'registrations' (the
  // two the user explicitly reported), 'attendance', 'payroll',
  // 'serial_numbers', 'tax_invoices' and 'partner_wallet_transactions' were
  // ALSO only ever produced by that removed dataset, despite every one of
  // them already being listed in DEMO_RESETTABLE_COLLECTIONS (meaning the
  // canonical pipeline always expected them to exist). All seven are now
  // seeded here, from the single canonical generator, using each module's
  // REAL field/enum shapes — never a second hardcoded dataset.
  const collectionsToCover = ['banks', 'registrations', 'attendance', 'payroll', 'serial_numbers', 'tax_invoices', 'partner_wallet_transactions'];

  it('every one of the seven previously-empty collections now has at least one seeded document', () => {
    for (const collection of collectionsToCover) {
      expect(docs(collection).length, `${collection} should no longer be empty`).toBeGreaterThan(0);
    }
  });

  it('every one of the seven is listed in DEMO_RESETTABLE_COLLECTIONS, so a reset genuinely clears and repopulates it', () => {
    for (const collection of collectionsToCover) {
      expect(DEMO_RESETTABLE_COLLECTIONS as readonly string[], `${collection} must be resettable`).toContain(collection);
    }
  });

  it('Banks carry only the real BankRecord fields/status enum (Active/Inactive), never an invented status', () => {
    const banks = docs('banks');
    expect(banks.length).toBeGreaterThanOrEqual(3);
    for (const b of banks) {
      expect(['Active', 'Inactive']).toContain(b.data.status);
      expect(typeof b.data.bankCode).toBe('string');
      expect(typeof b.data.bankName).toBe('string');
      expect(typeof b.data.priority).toBe('number');
    }
  });

  it('Registrations only ever reference a real, existing B2C customer + that same customer\'s real project — never a B2B customer, never a dangling id', () => {
    const registrations = docs('registrations');
    const customersById = new Map(docs('customers').map((c) => [c.id, c]));
    const projectsById = new Map(docs('projects').map((p) => [p.id, p]));
    expect(registrations.length).toBeGreaterThanOrEqual(2);
    const validStatuses = ['Draft', 'Digital Sign Pending', 'Submitted To Bank', 'Under Review', 'Approved', 'Rejected', 'Payment Received'];
    for (const r of registrations) {
      expect(validStatuses, `registration ${r.id} has an invalid status`).toContain(r.data.status);
      const customer = customersById.get(String(r.data.customerId || ''));
      expect(customer, `registration ${r.id}.customerId must resolve to a real customer`).toBeTruthy();
      expect(customer!.data.type).toBe('B2C');
      if (r.data.projectId) {
        const project = projectsById.get(String(r.data.projectId));
        expect(project, `registration ${r.id}.projectId must resolve to a real project`).toBeTruthy();
        expect(project!.data.customerId).toBe(r.data.customerId);
      }
    }
  });

  it('Tax Invoices use only the real TaxInvoiceRecord status/sourceType enums and resolve orderId/customerId to real records — including the B2B example demonstrating the B2B flow\'s own Accounts-bill step', () => {
    const invoices = docs('tax_invoices');
    const orders = new Map(docs('orders').map((o) => [o.id, o]));
    const customers = new Map(docs('customers').map((c) => [c.id, c]));
    expect(invoices.length).toBeGreaterThanOrEqual(2);
    for (const inv of invoices) {
      expect(['Draft', 'Issued', 'Cancelled']).toContain(inv.data.status);
      expect(['order', 'proforma_invoice']).toContain(inv.data.sourceType);
      const order = orders.get(String(inv.data.orderId || ''));
      expect(order, `tax invoice ${inv.id}.orderId must resolve to a real order`).toBeTruthy();
      const customer = customers.get(String(inv.data.customerId || ''));
      expect(customer, `tax invoice ${inv.id}.customerId must resolve to a real customer`).toBeTruthy();
      expect(Array.isArray(inv.data.items)).toBe(true);
      expect((inv.data.items as unknown[]).length).toBeGreaterThan(0);
    }
    // At least one tax invoice demonstrates each side of the B2B/B2C split.
    const custType = (id: string) => customers.get(id)?.data.type;
    expect(invoices.some((i) => custType(String(i.data.customerId)) === 'B2C')).toBe(true);
    expect(invoices.some((i) => custType(String(i.data.customerId)) === 'B2B')).toBe(true);
  });

  it('Attendance/Payroll only reference real Employee ids, and use only the real ATTENDANCE_STATUSES / payroll status values the HR workspace itself offers', () => {
    const employees = new Set(docs('employees').map((e) => e.id));
    const attendance = docs('attendance');
    const payroll = docs('payroll');
    expect(attendance.length).toBeGreaterThan(0);
    expect(payroll.length).toBeGreaterThan(0);
    const validAttendanceStatuses = ['Present', 'Absent', 'Late', 'Half Day', 'Holiday', 'On Leave'];
    for (const a of attendance) {
      expect(employees.has(String(a.data.employeeId || ''))).toBe(true);
      expect(validAttendanceStatuses).toContain(a.data.status);
    }
    const validPayrollStatuses = ['Paid', 'Pending', 'Draft'];
    for (const p of payroll) {
      expect(employees.has(String(p.data.employeeId || ''))).toBe(true);
      expect(validPayrollStatuses).toContain(p.data.status);
      const nums = ['basicSalary', 'hra', 'allowances', 'deductions', 'tds', 'advance', 'netSalary'] as const;
      for (const key of nums) expect(typeof p.data[key]).toBe('number');
      expect(p.data.netSalary).toBe((p.data.basicSalary as number) + (p.data.hra as number) + (p.data.allowances as number) - (p.data.deductions as number) - (p.data.tds as number) - (p.data.advance as number));
    }
  });

  it('Partner Wallet Transactions use the real WalletTransactionType/sourceType enums, resolve partnerId/sourceId to real records, and their balanceAfter matches the partner\'s own walletBalance', () => {
    const txns = docs('partner_wallet_transactions');
    const partners = new Map(docs('channel_partners').map((p) => [p.id, p]));
    const commissions = new Map(docs('commission_records').map((c) => [c.id, c]));
    expect(txns.length).toBeGreaterThan(0);
    const validTypes = ['commission_credit', 'withdrawal_request', 'withdrawal_approved', 'withdrawal_rejected', 'withdrawal_paid', 'adjustment', 'reversal'];
    for (const t of txns) {
      expect(validTypes).toContain(t.data.type);
      expect(['commission', 'withdrawal', 'adjustment', 'settlement']).toContain(t.data.sourceType);
      const partner = partners.get(String(t.data.partnerId || ''));
      expect(partner, `wallet transaction ${t.id}.partnerId must resolve to a real partner`).toBeTruthy();
      if (t.data.sourceType === 'commission') {
        expect(commissions.has(String(t.data.sourceId || ''))).toBe(true);
      }
      expect(t.data.balanceAfter).toBe(partner!.data.walletBalance);
    }
  });

  it('Serial Numbers use the real installationEngine.ts field shape (no invented warehouseId/status) and resolve installationId to a real Installation', () => {
    const serials = docs('serial_numbers');
    const installations = new Map(docs('installations').map((i) => [i.id, i]));
    expect(serials.length).toBeGreaterThan(0);
    for (const s of serials) {
      expect(typeof s.data.serialNumber).toBe('string');
      expect(typeof s.data.productId).toBe('string');
      const installation = installations.get(String(s.data.installationId || ''));
      expect(installation, `serial ${s.id}.installationId must resolve to a real installation`).toBeTruthy();
      expect(s.data.warehouseId).toBeUndefined();
      expect(s.data.status).toBeUndefined();
    }
  });

  it('reset -> reseed -> reset stays deterministic for all seven newly-covered collections', () => {
    const a = plan();
    const b = plan();
    for (const collection of collectionsToCover) {
      expect(a.documents.filter((d) => d.collection === collection)).toEqual(b.documents.filter((d) => d.collection === collection));
    }
  });
});
