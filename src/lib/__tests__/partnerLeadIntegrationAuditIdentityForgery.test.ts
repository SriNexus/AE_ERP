/**
 * Final Gap Sweep (Master Plan Phase 13/14, item 3 — "any remaining raw
 * write path that can bypass the security protections implemented in
 * Phases 4, 9, or 11"): markCommissionApproved()/markCommissionPaid() are
 * exported, client-side (browser) functions that previously let a
 * caller-supplied metadata.approvedBy/metadata.paidBy win over the real
 * signed-in actor when attributing a commission approval/payment — the same
 * forgery class Phase 11 (OWNERSHIP-001) fixed in entityProjection.ts and
 * channelPartnerSettlement.ts. Fixed to always derive from the real session
 * user.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdateDocById = vi.fn().mockResolvedValue(undefined);
const mockGetOne = vi.fn();
vi.mock('../firestore', () => ({
  updateDocById: (...args: any[]) => mockUpdateDocById(...args),
  genId: { generic: vi.fn(() => 'GEN-1') },
  createDocWithId: vi.fn().mockResolvedValue(undefined),
  getAll: vi.fn().mockResolvedValue([]),
  getOne: (...args: any[]) => mockGetOne(...args),
  resolveWriteCompanyId: vi.fn(() => 'company-real-session'),
  resolveWriteGroupId: vi.fn(() => ''),
}));

vi.mock('../partnerOwnership', () => ({
  resolveCurrentPartnerDocId: vi.fn().mockResolvedValue(null),
  partnerDisplayName: (p: any, fb = 'Partner') =>
    (p?.firmName || p?.contactPerson || p?.name || fb),
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: { COMMISSION_RECORDS: 'commission_records', LEADS: 'leads' },
}));

const mockLogActivity = vi.fn().mockResolvedValue(undefined);
vi.mock('../workflow', () => ({
  logActivity: (...args: any[]) => mockLogActivity(...args),
}));

vi.mock('../notifications', () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
  notifyRoleUsers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../channelPartnerCommissionEngine', () => ({
  resolveCommissionRule: vi.fn(),
  calculateCommission: vi.fn(),
  getCommissionBreakdown: vi.fn(),
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ user: { id: 'REAL-SIGNED-IN-USER' }, activeCompanyId: 'company-real-session' })) },
}));

describe('partnerLeadIntegration — commission identity fields cannot be forged (Final Gap Sweep)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('markCommissionApproved ignores a forged metadata.approvedBy — always attributes to the real signed-in actor', async () => {
    mockGetOne.mockResolvedValue({ id: 'CR-1', leadId: 'LEAD-1', status: 'pending', amount: 500 });
    const { markCommissionApproved } = await import('../partnerLeadIntegration');
    await markCommissionApproved('CR-1', { approvedBy: 'FORGED-VICTIM-USER', approvedAmount: 500 });

    const [, , writtenUpdate] = mockUpdateDocById.mock.calls[0];
    expect(writtenUpdate.approvedBy).toBe('REAL-SIGNED-IN-USER');
    expect(writtenUpdate.approvedBy).not.toBe('FORGED-VICTIM-USER');
  });

  it('markCommissionPaid ignores a forged metadata.paidBy but still honors legitimate paymentReference', async () => {
    mockGetOne.mockResolvedValue({ id: 'CR-1', leadId: 'LEAD-1', status: 'approved', amount: 500, approvedAmount: 500 });
    const { markCommissionPaid } = await import('../partnerLeadIntegration');
    await markCommissionPaid('CR-1', { paidBy: 'FORGED-VICTIM-USER', paymentReference: 'REF-999' });

    const [, , writtenUpdate] = mockUpdateDocById.mock.calls[0];
    expect(writtenUpdate.paidBy).toBe('REAL-SIGNED-IN-USER');
    expect(writtenUpdate.paidBy).not.toBe('FORGED-VICTIM-USER');
    expect(writtenUpdate.paymentReference).toBe('REF-999');
  });
});
