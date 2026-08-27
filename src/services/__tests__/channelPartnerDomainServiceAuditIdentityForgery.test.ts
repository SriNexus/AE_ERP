/**
 * Final Gap Sweep (Master Plan Phase 13/14, item 3 — "any remaining raw
 * write path that can bypass the security protections implemented in
 * Phases 4, 9, or 11"): ChannelPartnerDomainService.transitionStatus() is an
 * exported static method that previously wrote its caller-supplied
 * `changedBy` positional argument directly into the partner's statusHistory
 * audit trail with no server-side verification — every current UI call site
 * happens to pass its own user.id, but nothing stopped a direct call (e.g.
 * devtools) from forging who approved/suspended/reactivated a partner. Same
 * forgery class Phase 11 (OWNERSHIP-001) fixed in entityProjection.ts/
 * channelPartnerSettlement.ts. Fixed to always derive from the real session
 * user.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdateDocById = vi.fn().mockResolvedValue(undefined);
const mockGetOne = vi.fn();
vi.mock('../../lib/firestore', () => ({
  createDocWithId: vi.fn().mockResolvedValue(undefined),
  genId: { generic: vi.fn(() => 'GEN-1') },
  getOne: (...args: any[]) => mockGetOne(...args),
  softDelete: vi.fn().mockResolvedValue(undefined),
  updateDocById: (...args: any[]) => mockUpdateDocById(...args),
  getAll: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../lib/firebase', () => ({
  COLLECTIONS: { CHANNEL_PARTNERS: 'channel_partners' },
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ user: { id: 'REAL-SIGNED-IN-USER' } })) },
}));

describe('ChannelPartnerDomainService.transitionStatus — changedBy cannot be forged (Final Gap Sweep)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOne.mockResolvedValue({ id: 'PARTNER-1', statusHistory: [] });
  });

  it('ignores a forged changedBy argument — always attributes the status-history entry to the real signed-in actor', async () => {
    const { ChannelPartnerDomainService } = await import('../ChannelPartnerDomainService');
    await ChannelPartnerDomainService.transitionStatus('PARTNER-1', 'active', 'FORGED-VICTIM-USER', 'reactivated');

    const [, , writtenUpdate] = mockUpdateDocById.mock.calls[0];
    const entry = writtenUpdate.statusHistory[writtenUpdate.statusHistory.length - 1];
    expect(entry.changedBy).toBe('REAL-SIGNED-IN-USER');
    expect(entry.changedBy).not.toBe('FORGED-VICTIM-USER');
    expect(writtenUpdate.status).toBe('active');
  });
});
