/**
 * Phase 11 (OWNERSHIP-001, Master Plan "Record Ownership / Business
 * Authorization Audit") — approveWithdrawal/rejectWithdrawal/
 * processWithdrawal/completeWithdrawal must always attribute the action to
 * the actually-signed-in actor, never a caller-supplied `metadata.X`
 * identity field. These are exported, client-side (browser) functions —
 * reachable directly, not only through the UI (which never actually passes
 * this argument today) — so before this fix, any authenticated user with
 * edit access could forge who approved/rejected/processed/paid a partner
 * withdrawal, corrupting both the wallet transaction's own attribution
 * field and the activity log.
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
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: { PARTNER_WALLET_TXNS: 'partner_wallet_transactions', CHANNEL_PARTNERS: 'channel_partners' },
}));

const mockLogActivity = vi.fn().mockResolvedValue(undefined);
vi.mock('../workflow', () => ({
  logActivity: (...args: any[]) => mockLogActivity(...args),
}));

vi.mock('../notifications', () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
  notifyRoleUsers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ user: { id: 'REAL-SIGNED-IN-USER' }, activeCompanyId: 'company-real-session', company: { id: 'company-real-session' } })) },
}));

describe('channelPartnerSettlement — withdrawal identity fields cannot be forged (Phase 11, OWNERSHIP-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOne.mockResolvedValue({
      id: 'WD-1', type: 'withdrawal_request', withdrawalStatus: 'pending', amount: -500, partnerId: 'PARTNER-1',
    });
  });

  it('approveWithdrawal ignores a forged metadata.approvedBy — always attributes to the real signed-in actor', async () => {
    const { approveWithdrawal } = await import('../channelPartnerSettlement');
    await approveWithdrawal('WD-1', { approvedBy: 'FORGED-VICTIM-USER' } as any);

    const [, , writtenUpdate] = mockUpdateDocById.mock.calls[0];
    expect(writtenUpdate.processedBy).toBe('REAL-SIGNED-IN-USER');
    expect(writtenUpdate.processedBy).not.toBe('FORGED-VICTIM-USER');

    const [, , , loggedMeta] = mockLogActivity.mock.calls[0];
    expect(loggedMeta.approvedBy).toBe('REAL-SIGNED-IN-USER');
  });

  it('rejectWithdrawal ignores a forged metadata.rejectedBy', async () => {
    const { rejectWithdrawal } = await import('../channelPartnerSettlement');
    await rejectWithdrawal('WD-1', 'not eligible', { rejectedBy: 'FORGED-VICTIM-USER' } as any);

    const [, , writtenUpdate] = mockUpdateDocById.mock.calls[0];
    expect(writtenUpdate.processedBy).toBe('REAL-SIGNED-IN-USER');
    expect(writtenUpdate.processedBy).not.toBe('FORGED-VICTIM-USER');
  });

  it('processWithdrawal ignores a forged metadata.processedBy', async () => {
    mockGetOne.mockResolvedValue({ id: 'WD-1', type: 'withdrawal_request', withdrawalStatus: 'approved', amount: -500, partnerId: 'PARTNER-1' });
    const { processWithdrawal } = await import('../channelPartnerSettlement');
    await processWithdrawal('WD-1', { processedBy: 'FORGED-VICTIM-USER' } as any);

    const [, , writtenUpdate] = mockUpdateDocById.mock.calls[0];
    expect(writtenUpdate.processedBy).toBe('REAL-SIGNED-IN-USER');
    expect(writtenUpdate.processedBy).not.toBe('FORGED-VICTIM-USER');
  });

  it('completeWithdrawal ignores a forged metadata.paidBy but still honors legitimate payment reference/method data', async () => {
    mockGetOne.mockResolvedValue({ id: 'WD-1', type: 'withdrawal_request', withdrawalStatus: 'processing', amount: -500, partnerId: 'PARTNER-1' });
    const { completeWithdrawal } = await import('../channelPartnerSettlement');
    await completeWithdrawal('WD-1', { paidBy: 'FORGED-VICTIM-USER', paymentReference: 'REF-123', paymentMethod: 'upi' });

    const [, , writtenUpdate] = mockUpdateDocById.mock.calls[0];
    expect(writtenUpdate.processedBy).toBe('REAL-SIGNED-IN-USER');
    expect(writtenUpdate.processedBy).not.toBe('FORGED-VICTIM-USER');
    // Non-identity data fields still pass through unchanged.
    expect(writtenUpdate.paymentReference).toBe('REF-123');
    expect(writtenUpdate.paymentMethod).toBe('upi');
  });
});
