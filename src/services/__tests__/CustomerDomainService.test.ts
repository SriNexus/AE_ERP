/**
 * CustomerDomainService.test.ts — Phase 5.1 Final Validation Audit.
 *
 * Regression test for the most severe bug found during the audit (see
 * CUSTOMER_WORKSPACE_PHASE_5_1_FINAL_VALIDATION_REPORT.md §18-19):
 * `CustomerDomainService.updateProjection()` applies a narrow 4-field
 * allowlist (name/phone/email/city) intended for cross-entity projection
 * sync — LeadDomainService.update() uses it to propagate a converted
 * Lead's identity fields onto its Customer. useCustomers.ts's own
 * `updateCustomerProjection()` wrapper — the customer's OWN primary update
 * path, used by the list-page Edit form, Mobile Customer Workspace, and
 * Customer Workspace Save — was mistakenly calling `.updateProjection()`
 * instead of `.update()`, silently dropping every field outside that
 * allowlist (gst, pan, address, state, pincode, company, creditLimit,
 * paymentTerms, notes, assignedToId/Name, activityLog, ...) on every save.
 * This predates Phase 0 (introduced with the file itself).
 *
 * These tests exercise CustomerDomainService directly (only `updateDocById`
 * mocked) to prove: `.update()` persists the full delta unfiltered, while
 * `.updateProjection()` still correctly narrows to the 4 allowed fields —
 * the narrowing behavior itself is intentional and must be preserved for
 * LeadDomainService's use.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateDocById: vi.fn(),
}));

vi.mock('../../lib/firestore', () => ({
  updateDocById: mocks.updateDocById,
}));

vi.mock('../../lib/firebase', () => ({
  COLLECTIONS: { CUSTOMERS: 'customers' },
}));

import { CustomerDomainService } from '../CustomerDomainService';

describe('CustomerDomainService.update — the customer\'s own primary update path', () => {
  beforeEach(() => {
    mocks.updateDocById.mockClear();
    mocks.updateDocById.mockResolvedValue(undefined);
  });

  it('persists the full delta, not just name/phone/email/city (Phase 5.1 regression)', async () => {
    await CustomerDomainService.update('C-1', {
      name: 'Acme Corp', phone: '9876543210', email: 'a@acme.com', city: 'Pune',
      gst: '27AAAAA0000A1Z5', pan: 'AAAAA0000A', company: 'Acme Pvt Ltd',
      address: '123 Main St', state: 'MH', pincode: '411001',
      creditLimit: 50000, paymentTerms: 45, notes: 'VIP customer',
      assignedToId: 'U-1', assignedToName: 'Rahul',
      activityLog: [{ id: 'LOG-1', type: 'Update', desc: 'x' }],
    });

    expect(mocks.updateDocById).toHaveBeenCalledTimes(1);
    const [, , payload] = mocks.updateDocById.mock.calls[0];
    expect(payload).toMatchObject({
      gst: '27AAAAA0000A1Z5', pan: 'AAAAA0000A', company: 'Acme Pvt Ltd',
      address: '123 Main St', state: 'MH', pincode: '411001',
      creditLimit: 50000, paymentTerms: 45, notes: 'VIP customer',
      assignedToId: 'U-1', assignedToName: 'Rahul',
    });
    expect(payload.activityLog).toEqual([{ id: 'LOG-1', type: 'Update', desc: 'x' }]);
  });

  it('still drops undefined/null values (compactDelta unchanged)', async () => {
    await CustomerDomainService.update('C-1', { name: 'Acme', notes: undefined, gst: null });
    const [, , payload] = mocks.updateDocById.mock.calls[0];
    expect(payload).not.toHaveProperty('notes');
    expect(payload).not.toHaveProperty('gst');
    expect(payload).toEqual({ name: 'Acme' });
  });
});

describe('CustomerDomainService.updateProjection — intentional narrow cross-entity sync (unchanged)', () => {
  beforeEach(() => {
    mocks.updateDocById.mockClear();
    mocks.updateDocById.mockResolvedValue(undefined);
  });

  it('still narrows to only name/phone/email/city — LeadDomainService relies on this for Lead-to-Customer identity sync', async () => {
    await CustomerDomainService.updateProjection('C-1', {
      name: 'Acme', phone: '9876543210', email: 'a@acme.com', city: 'Pune',
      gst: '27AAAAA0000A1Z5', notes: 'should not leak through',
    });

    const [, , payload] = mocks.updateDocById.mock.calls[0];
    expect(payload).toEqual({ name: 'Acme', phone: '9876543210', email: 'a@acme.com', city: 'Pune' });
    expect(payload).not.toHaveProperty('gst');
    expect(payload).not.toHaveProperty('notes');
  });

  it('skips the write entirely when the projection reduces to nothing', async () => {
    await CustomerDomainService.updateProjection('C-1', { gst: '27AAAAA0000A1Z5', notes: 'x' });
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });
});
