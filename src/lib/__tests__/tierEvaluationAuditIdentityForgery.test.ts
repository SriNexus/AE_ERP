/**
 * Final Gap Sweep (Master Plan Phase 13/14, item 3 — "any remaining raw
 * write path that can bypass the security protections implemented in
 * Phases 4, 9, or 11"): manualTierOverride() is an exported, client-side
 * (browser) function that previously let a caller-supplied
 * metadata.changedBy/metadata.changedByName win over the real signed-in
 * actor when recording who manually overrode a partner's commission tier —
 * the same forgery class Phase 11 (OWNERSHIP-001) fixed in
 * entityProjection.ts and channelPartnerSettlement.ts. Fixed to always
 * derive from the real session user.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdateDocById = vi.fn().mockResolvedValue(undefined);
const mockGetOne = vi.fn();
vi.mock('../firestore', () => ({
  getAll: vi.fn().mockResolvedValue([]),
  getOne: (...args: any[]) => mockGetOne(...args),
  updateDocById: (...args: any[]) => mockUpdateDocById(...args),
  resolveWriteCompanyId: vi.fn(() => 'company-real-session'),
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: { CHANNEL_PARTNERS: 'channel_partners' },
}));

const mockLogActivity = vi.fn().mockResolvedValue(undefined);
vi.mock('../workflow', () => ({
  logActivity: (...args: any[]) => mockLogActivity(...args),
}));

vi.mock('../notifications', () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
  notifyRoleUsers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../settlementAudit', () => ({
  recordSettlementAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tierRules', () => ({
  evaluatePartnerTier: vi.fn(),
}));

vi.mock('../../features/channel-partner/utils/analytics', () => ({
  buildPartnerScoreInput: vi.fn(),
  computePartnerScore: vi.fn(),
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ user: { id: 'REAL-SIGNED-IN-USER', name: 'Real Actor' }, activeCompanyId: 'company-real-session' })) },
}));

describe('tierEvaluation — manualTierOverride identity fields cannot be forged (Final Gap Sweep)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOne.mockResolvedValue({ id: 'PARTNER-1', tier: 'bronze', tierHistory: [], firmName: 'Acme Co' });
  });

  it('ignores a forged metadata.changedBy/changedByName — always attributes to the real signed-in actor', async () => {
    const { manualTierOverride } = await import('../tierEvaluation');
    await manualTierOverride('PARTNER-1', 'gold', 'VIP escalation', {
      changedBy: 'FORGED-VICTIM-USER',
      changedByName: 'Forged Display Name',
    });

    const [, , writtenUpdate] = mockUpdateDocById.mock.calls[0];
    const entry = writtenUpdate.tierHistory[writtenUpdate.tierHistory.length - 1];
    expect(entry.changedBy).toBe('REAL-SIGNED-IN-USER');
    expect(entry.changedByName).toBe('Real Actor');
    expect(entry.changedBy).not.toBe('FORGED-VICTIM-USER');
    expect(entry.changedByName).not.toBe('Forged Display Name');
  });
});
