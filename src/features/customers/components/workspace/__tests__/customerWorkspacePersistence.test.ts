import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateCustomerProjectionWithPhoneLock: vi.fn(),
  sendNotification: vi.fn(),
  resolveNotificationCompanyId: vi.fn((id: string) => `resolved-${id}`),
  logActivity: vi.fn(),
  genId: { generic: vi.fn((prefix: string) => `${prefix}-001`) },
}));

vi.mock('../../../hooks/useCustomers', () => ({
  updateCustomerProjectionWithPhoneLock: mocks.updateCustomerProjectionWithPhoneLock,
}));

vi.mock('../../../../../lib/notifications', () => ({
  sendNotification: mocks.sendNotification,
  resolveNotificationCompanyId: mocks.resolveNotificationCompanyId,
}));

vi.mock('../../../../../lib/workflow', () => ({
  logActivity: mocks.logActivity,
}));

vi.mock('../../../../../lib/firestore', () => ({
  genId: mocks.genId,
}));

vi.mock('../../../../../types', () => ({
  NotificationType: { CUSTOMER_UPDATED: 'CUSTOMER_UPDATED' },
}));

import { buildCustomerDraftDelta, saveCustomerWorkspace, validateCustomerDraft, hasConflict, CUSTOMER_DRAFT_FIELDS } from '../CustomerWorkspacePersistence';

describe('hasConflict — multi-user conflict detection', () => {
  it('same updatedAt as when loaded → no conflict, proceed normally', () => {
    expect(hasConflict('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(false);
  });

  it('different updatedAt than when loaded → conflict', () => {
    expect(hasConflict('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toBe(true);
  });

  it('no baseline captured yet (loadedUpdatedAt null) → never a conflict', () => {
    expect(hasConflict(null, '2026-01-02T00:00:00Z')).toBe(false);
  });

  it('treats a missing/falsy current updatedAt as an empty string, not a crash', () => {
    expect(hasConflict('2026-01-01T00:00:00Z', undefined)).toBe(true);
    expect(hasConflict('', undefined)).toBe(false);
  });
});

describe('buildCustomerDraftDelta — B2B/B2C use the same unified field set', () => {
  it('does not branch by customer.type — the real Edit form has one field set for both', () => {
    const b2b = { id: 'C-1', type: 'B2B', name: 'B2B Co', phone: '9999999999' };
    const b2c = { id: 'C-2', type: 'B2C', name: 'B2C Person', phone: '8888888888' };
    const deltaB2B = buildCustomerDraftDelta(b2b, { notes: 'note' });
    const deltaB2C = buildCustomerDraftDelta(b2c, { notes: 'note' });
    expect(deltaB2B).toEqual({ notes: 'note' });
    expect(deltaB2C).toEqual({ notes: 'note' });
  });

  it('B2C-only fields (roofType, sanctionLoad, aadhaar, etc.) are never accepted into the delta even if present in the draft object', () => {
    const b2c = { id: 'C-2', type: 'B2C', name: 'B2C Person', phone: '8888888888' };
    // @ts-expect-error — deliberately passing a non-draft field to prove it's ignored
    const delta = buildCustomerDraftDelta(b2c, { roofType: 'RCC', notes: 'kept' });
    expect(delta).not.toHaveProperty('roofType');
    expect(delta).toEqual({ notes: 'kept' });
  });
});

describe('buildCustomerDraftDelta — only real, changed, Customer-owned fields', () => {
  const customer = {
    id: 'C-1', name: 'Old Name', phone: '9999999999', email: 'old@x.com',
    company: 'Old Co', gst: '', pan: '', address: 'Old Addr', city: 'Pune', state: 'MH',
    pincode: '411001', creditLimit: 5000, paymentTerms: 30, notes: 'old notes',
    assignedToId: 'U-1', assignedToName: 'Old Owner',
  };

  it('includes only fields that actually differ from the loaded customer', () => {
    const delta = buildCustomerDraftDelta(customer, { email: 'new@x.com', city: 'Pune' });
    expect(delta).toEqual({ email: 'new@x.com' }); // city unchanged (same value) — not in delta
  });

  it('is a no-op (empty delta) when the draft matches the current customer exactly', () => {
    const delta = buildCustomerDraftDelta(customer, { name: 'Old Name', notes: 'old notes' });
    expect(delta).toEqual({});
  });

  it('coerces creditLimit/paymentTerms to numbers', () => {
    const delta = buildCustomerDraftDelta(customer, { creditLimit: '10000', paymentTerms: '45' });
    expect(delta).toEqual({ creditLimit: 10000, paymentTerms: 45 });
  });

  it('Phase 5.1 fix: a field stored as a non-string type in Firestore (e.g. legacy numeric pincode) is not spuriously included when unchanged', () => {
    const legacyCustomer = { ...customer, pincode: 411001 }; // number, not string
    const delta = buildCustomerDraftDelta(legacyCustomer, { pincode: '411001' }); // editor always submits a string
    expect(delta).toEqual({}); // same value, just different original type — not a real change
  });

  it('still detects a genuine change on a non-string-typed field', () => {
    const legacyCustomer = { ...customer, pincode: 411001 };
    const delta = buildCustomerDraftDelta(legacyCustomer, { pincode: '411002' });
    expect(delta).toEqual({ pincode: '411002' });
  });

  it('strips name and phone when the customer has a sourceLeadId (identity lock)', () => {
    const lockedCustomer = { ...customer, sourceLeadId: 'LEAD-1' };
    const delta = buildCustomerDraftDelta(lockedCustomer, { name: 'Attempted New Name', phone: '8888888888', email: 'new@x.com' });
    expect(delta).not.toHaveProperty('name');
    expect(delta).not.toHaveProperty('phone');
    expect(delta).toEqual({ email: 'new@x.com' });
  });

  it('does not lock name/phone when sourceLeadId is absent', () => {
    const delta = buildCustomerDraftDelta(customer, { name: 'New Name', phone: '8888888888' });
    expect(delta).toEqual({ name: 'New Name', phone: '8888888888' });
  });

  it('CUSTOMER_DRAFT_FIELDS matches the real Edit Customer field set, now including `type` (Header/action cleanup mission: B2B/B2C type is editable through this same deferred-commit editor, the legacy structural-edit form is retired) and altName/altMobile (Customer + Leads Workspace Completion Pass mission: Alternate Name/Number, the one B2C-originated field pair given a real edit path)', () => {
    expect(CUSTOMER_DRAFT_FIELDS).toEqual([
      'name', 'phone', 'altName', 'altMobile', 'email', 'type', 'company', 'gst', 'pan',
      'address', 'city', 'state', 'pincode',
      'creditLimit', 'paymentTerms', 'notes',
      'assignedToId', 'assignedToName',
    ]);
    expect(CUSTOMER_DRAFT_FIELDS).not.toContain('roofType');
    expect(CUSTOMER_DRAFT_FIELDS).not.toContain('aadhaar');
  });

  it('a changed type is included in the delta like any other field', () => {
    const customer = { name: 'Acme', phone: '9999999999', type: 'B2B' };
    expect(buildCustomerDraftDelta(customer, { type: 'B2C' })).toEqual({ type: 'B2C' });
  });

  it('an unchanged type produces no delta entry', () => {
    const customer = { name: 'Acme', phone: '9999999999', type: 'B2B' };
    expect(buildCustomerDraftDelta(customer, { type: 'B2B' })).toEqual({});
  });
});

describe('validateCustomerDraft', () => {
  const customer = { name: 'Existing Name', phone: '9999999999' };

  it('is valid when neither name nor phone is being cleared', () => {
    expect(validateCustomerDraft(customer, { notes: 'x' })).toBeNull();
  });

  it('rejects clearing name to empty', () => {
    expect(validateCustomerDraft(customer, { name: '' })).toBe('Name required');
  });

  it('rejects clearing phone to empty', () => {
    expect(validateCustomerDraft(customer, { phone: '' })).toBe('Phone required');
  });

  it('accepts a non-empty replacement name/phone', () => {
    expect(validateCustomerDraft(customer, { name: 'New Name', phone: '8888888888' })).toBeNull();
  });

  it('rejects any save while the customer has a pre-existing empty name — matches the existing Edit form\'s always-required-on-submit rule, not a new restriction', () => {
    expect(validateCustomerDraft({}, { notes: 'x' })).toBe('Name required');
  });
});

describe('saveCustomerWorkspace', () => {
  const customer = { id: 'C-1', name: 'Old Name', phone: '9999999999', updatedAt: '2026-01-01T00:00:00Z' };
  const user = { id: 'U-9', name: 'Operator' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateCustomerProjectionWithPhoneLock.mockResolvedValue(undefined);
  });

  it('returns changed:false and writes nothing when the draft is empty', async () => {
    const result = await saveCustomerWorkspace(customer, {}, user, 'comp-1');
    expect(result.changed).toBe(false);
    expect(mocks.updateCustomerProjectionWithPhoneLock).not.toHaveBeenCalled();
  });

  it('calls updateCustomerProjectionWithPhoneLock with the changed delta plus an appended activityLog entry', async () => {
    const result = await saveCustomerWorkspace(customer, { notes: 'new note' }, user, 'comp-1');
    expect(result.changed).toBe(true);
    expect(mocks.updateCustomerProjectionWithPhoneLock).toHaveBeenCalledWith('C-1', expect.objectContaining({
      notes: 'new note',
      activityLog: [expect.objectContaining({ type: 'Update', desc: 'Updated: Notes', userName: 'Operator' })],
    }));
  });

  it('Phase 5.1 fix: appends to customer.activityLog[] (not just logActivity()) — this is what Recent Activity / the Activity tab actually read', async () => {
    const withHistory = { ...customer, activityLog: [{ id: 'LOG-old', type: 'Creation', desc: 'Customer created', date: '2025-01-01T00:00:00Z', userName: 'System' }] };
    await saveCustomerWorkspace(withHistory, { email: 'new@x.com' }, user, 'comp-1');
    const [, payload] = mocks.updateCustomerProjectionWithPhoneLock.mock.calls[0];
    expect(payload.activityLog).toHaveLength(2);
    expect(payload.activityLog[0].id).toBe('LOG-old'); // existing entries preserved, new one appended after
    expect(payload.activityLog[1].type).toBe('Update');
  });

  it('describes multiple changed fields by readable label, not raw field names', async () => {
    await saveCustomerWorkspace(customer, { email: 'new@x.com', city: 'Mumbai' }, user, 'comp-1');
    const [, payload] = mocks.updateCustomerProjectionWithPhoneLock.mock.calls[0];
    expect(payload.activityLog[0].desc).toBe('Updated: Email, City');
  });

  it('collapses assignedToId/assignedToName into a single "Assigned Salesperson" mention, not two', async () => {
    await saveCustomerWorkspace(customer, { assignedToId: 'U-2', assignedToName: 'New Owner' }, user, 'comp-1');
    const [, payload] = mocks.updateCustomerProjectionWithPhoneLock.mock.calls[0];
    expect(payload.activityLog[0].desc).toBe('Updated: Assigned Salesperson');
  });

  it('rejects and writes nothing when the draft would clear the required name field', async () => {
    await expect(saveCustomerWorkspace(customer, { name: '' }, user, 'comp-1')).rejects.toThrow('Name required');
    expect(mocks.updateCustomerProjectionWithPhoneLock).not.toHaveBeenCalled();
  });

  it('propagates a phone-lock failure (e.g. duplicate phone) without swallowing it', async () => {
    mocks.updateCustomerProjectionWithPhoneLock.mockRejectedValueOnce(new Error('Customer phone already exists for this company'));
    await expect(saveCustomerWorkspace(customer, { phone: '8888888888' }, user, 'comp-1')).rejects.toThrow('Customer phone already exists for this company');
  });

  it('logs a Customer Updated activity entry on a real change', async () => {
    await saveCustomerWorkspace(customer, { notes: 'new note' }, user, 'comp-1');
    expect(mocks.logActivity).toHaveBeenCalledWith('Customers', 'Customer Updated', 'C-1', expect.objectContaining({
      actionLabel: 'Customer updated in workspace',
    }));
  });

  it('does not log activity or notify when there is nothing to save', async () => {
    await saveCustomerWorkspace(customer, {}, user, 'comp-1');
    expect(mocks.logActivity).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('sends a CUSTOMER_UPDATED notification only when assignedToId is actually part of the delta', async () => {
    await saveCustomerWorkspace(customer, { assignedToId: 'U-2', assignedToName: 'New Owner' }, user, 'comp-1');
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'U-2', 'CUSTOMER_UPDATED', 'Customer updated',
      expect.stringContaining('was updated'), 'customer', 'C-1', 'resolved-comp-1',
    );
  });

  it('does not notify when assignedToId is unchanged (not present in the delta)', async () => {
    await saveCustomerWorkspace(customer, { notes: 'new note' }, user, 'comp-1');
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('does nothing at all for a customer with no id', async () => {
    const result = await saveCustomerWorkspace({}, { notes: 'x' }, user, 'comp-1');
    expect(result.changed).toBe(false);
    expect(mocks.updateCustomerProjectionWithPhoneLock).not.toHaveBeenCalled();
  });
});
