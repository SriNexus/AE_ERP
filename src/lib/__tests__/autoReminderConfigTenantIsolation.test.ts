/**
 * Phase 11 (OWNERSHIP-001, Master Plan "Record Ownership / Business
 * Authorization Audit") — auto-reminder configuration must be per-company,
 * not a single document shared across every company.
 *
 * Root cause: loadReminderConfig()/saveReminderConfig() used to read/write
 * a FIXED document id ('auto_reminder_config') regardless of which company
 * was active. Firestore rules correctly deny any OTHER company from
 * reading/overwriting whichever company happened to create the doc first
 * (this was never a cross-tenant data LEAK), but every other company was
 * permanently locked into DEFAULT_REMINDER_CONFIG — their own save attempts
 * would hit PERMISSION_DENIED against the first company's stamped
 * companyId, and their own reads would silently fail closed to the
 * defaults. Fixed by keying the document per company
 * (`auto_reminder_config_{companyId}`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateDocWithId = vi.fn().mockResolvedValue(undefined);
const mockUpdateDocById = vi.fn().mockResolvedValue(undefined);
const mockGetOne = vi.fn();
const mockResolveWriteCompanyId = vi.fn();
vi.mock('../firestore', () => ({
  getAll: vi.fn().mockResolvedValue([]),
  getOne: (...args: any[]) => mockGetOne(...args),
  createDocWithId: (...args: any[]) => mockCreateDocWithId(...args),
  genId: { generic: vi.fn(() => 'GEN-1') },
  updateDocById: (...args: any[]) => mockUpdateDocById(...args),
  resolveWriteCompanyId: (...args: any[]) => mockResolveWriteCompanyId(...args),
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: { ENTITIES: 'entities' },
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ user: { id: 'user-1' } })) },
}));

vi.mock('../workflow', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../notifications', () => ({ sendNotification: vi.fn().mockResolvedValue(undefined), notifyRoleUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../tasks', () => ({ createTask: vi.fn().mockResolvedValue(undefined) }));

describe('auto-reminder config — per-company document isolation (Phase 11, OWNERSHIP-001)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetOne.mockResolvedValue(null); });

  it('saveReminderConfig for two different companies writes to two DISTINCT document ids, never the same shared doc', async () => {
    const { saveReminderConfig } = await import('../autoReminderWorkflow');

    mockResolveWriteCompanyId.mockReturnValue('COMPANY-A');
    await saveReminderConfig({ enabled: true } as any);
    const [, docIdA] = mockCreateDocWithId.mock.calls[0];

    mockResolveWriteCompanyId.mockReturnValue('COMPANY-B');
    await saveReminderConfig({ enabled: false } as any);
    const [, docIdB] = mockCreateDocWithId.mock.calls[1];

    expect(docIdA).not.toBe(docIdB);
    expect(docIdA).toContain('COMPANY-A');
    expect(docIdB).toContain('COMPANY-B');
  });

  it('loadReminderConfig for Company B never reads Company A\'s document id', async () => {
    const { loadReminderConfig } = await import('../autoReminderWorkflow');

    mockResolveWriteCompanyId.mockReturnValue('COMPANY-A');
    await loadReminderConfig();
    const docIdReadForA = mockGetOne.mock.calls[0][1];

    mockResolveWriteCompanyId.mockReturnValue('COMPANY-B');
    await loadReminderConfig();
    const docIdReadForB = mockGetOne.mock.calls[1][1];

    expect(docIdReadForA).not.toBe(docIdReadForB);
  });

  it('Company B saving its own config does not attempt to update Company A\'s existing document (create branch runs for B, not an update against A\'s doc)', async () => {
    // Company A already has a saved config (existing=truthy for A's own id).
    mockResolveWriteCompanyId.mockReturnValue('COMPANY-A');
    mockGetOne.mockResolvedValueOnce({ config: { enabled: true } });
    const { saveReminderConfig: saveA } = await import('../autoReminderWorkflow');
    await saveA({ enabled: true } as any);
    expect(mockUpdateDocById).toHaveBeenCalledTimes(1);
    const [, updatedDocId] = mockUpdateDocById.mock.calls[0];
    expect(updatedDocId).toContain('COMPANY-A');

    // Company B has never saved before (existing=null for B's own id) —
    // must go through createDocWithId for ITS OWN doc, never updateDocById
    // against Company A's doc.
    mockResolveWriteCompanyId.mockReturnValue('COMPANY-B');
    mockGetOne.mockResolvedValueOnce(null);
    await saveA({ enabled: false } as any);
    expect(mockCreateDocWithId).toHaveBeenCalledTimes(1);
    const [, createdDocId] = mockCreateDocWithId.mock.calls[0];
    expect(createdDocId).toContain('COMPANY-B');
    expect(createdDocId).not.toBe(updatedDocId);
  });
});
