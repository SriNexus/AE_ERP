/**
 * installationEngineDualWrite.test.ts — Phase 10 coverage.
 *
 * installationEngine.ts's mutators still write to the Lead document
 * (unchanged, for backward compatibility with existing UI) but now ALSO
 * mirror onto a real, Project-scoped COLLECTIONS.INSTALLATIONS document —
 * created lazily the first time a Lead with a linked Project is mutated.
 * A Lead with no projectId yet cannot have a Project-scoped record, so the
 * mirror write must be skipped without failing the caller.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  getAll: vi.fn(),
  logActivity: vi.fn(),
  notifyRoleUsers: vi.fn(),
  sendNotification: vi.fn(),
  propagateCaseIdFromChain: vi.fn(),
  getState: vi.fn(),
  genId: {
    generic: vi.fn((prefix: string = 'GEN') => `${prefix}-001`),
  },
}));

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  getAll: mocks.getAll,
  genId: mocks.genId,
  resolveWriteCompanyId: () => {
    const s = mocks.getState();
    return s.activeCompanyId || s.company?.id || s.user?.companyId || '';
  },
}));

vi.mock('../workflow', () => ({
  logActivity: mocks.logActivity,
}));

vi.mock('../notifications', () => ({
  notifyRoleUsers: mocks.notifyRoleUsers,
  sendNotification: mocks.sendNotification,
}));

vi.mock('../casePropagation', () => ({
  propagateCaseIdFromChain: mocks.propagateCaseIdFromChain,
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: mocks.getState },
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: {
    LEADS: 'leads',
    INSTALLATIONS: 'installations',
    SERIAL_NUMBERS: 'serial_numbers',
  },
}));

import { toggleChecklistItem, assignEngineer, captureInstallationSerial, linkInstallationToProject } from '../installationEngine';

describe('installationEngine dual-write — mirrors onto the real installations collection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({ activeCompanyId: 'comp-1', user: { id: 'user-1' } });
    mocks.notifyRoleUsers.mockResolvedValue(undefined);
    mocks.updateDocById.mockResolvedValue(undefined);
    mocks.createDocWithId.mockResolvedValue(undefined);
    mocks.getAll.mockResolvedValue([]);
  });

  it('toggleChecklistItem mirrors onto a newly-created installations doc when the Lead has a linked Project', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'LEAD-1', projectId: 'PRJ-1' });
    mocks.getAll.mockResolvedValueOnce([]); // no existing installations doc yet

    await toggleChecklistItem('LEAD-1', 0);

    expect(mocks.updateDocById).toHaveBeenCalledWith('leads', 'LEAD-1', expect.objectContaining({ installationChecklist: expect.any(Array) }));
    // The installations-side mirror is deliberately fire-and-forget (must
    // never block or fail the already-successful Lead write) — wait for it.
    await vi.waitFor(() => {
      expect(mocks.createDocWithId).toHaveBeenCalledWith('installations', 'INST-001', expect.objectContaining({ projectId: 'PRJ-1', leadId: 'LEAD-1' }));
      expect(mocks.updateDocById).toHaveBeenCalledWith('installations', 'INST-001', expect.objectContaining({ checklist: expect.any(Array) }));
    });
  });

  it('toggleChecklistItem skips the mirror write when the Lead has no linked Project (nothing lost on the Lead side)', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'LEAD-2' });

    await toggleChecklistItem('LEAD-2', 0);

    expect(mocks.updateDocById).toHaveBeenCalledWith('leads', 'LEAD-2', expect.any(Object));
    expect(mocks.getAll).not.toHaveBeenCalled();
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
    expect(mocks.updateDocById).toHaveBeenCalledTimes(1);
  });

  it('toggleChecklistItem mirrors onto an existing installations doc without creating a duplicate', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'LEAD-3', projectId: 'PRJ-3' });
    mocks.getAll.mockResolvedValueOnce([{ id: 'INST-EXISTING', projectId: 'PRJ-3', isDeleted: false }]);

    await toggleChecklistItem('LEAD-3', 0);

    await vi.waitFor(() => {
      expect(mocks.updateDocById).toHaveBeenCalledWith('installations', 'INST-EXISTING', expect.any(Object));
    });
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('assignEngineer mirrors the engineer fields onto the installations doc', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'LEAD-4', projectId: 'PRJ-4', engineerAssignmentHistory: [] });
    mocks.getAll.mockResolvedValueOnce([{ id: 'INST-4', projectId: 'PRJ-4', isDeleted: false }]);

    await assignEngineer('LEAD-4', 'USR-1', 'Ravi', '9999999999');

    await vi.waitFor(() => {
      expect(mocks.updateDocById).toHaveBeenCalledWith('installations', 'INST-4', expect.objectContaining({ assignedEngineerId: 'USR-1', assignedEngineerName: 'Ravi' }));
    });
  });

  it('captureInstallationSerial writes the real installation id onto the serial_numbers record, not the Lead id', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'LEAD-5', projectId: 'PRJ-5', capturedSerialNumbers: [] });
    mocks.getAll.mockResolvedValueOnce([{ id: 'INST-5', projectId: 'PRJ-5', isDeleted: false }]);

    await captureInstallationSerial('LEAD-5', 'SN-100', 'PRD-1', 'Inverter');

    expect(mocks.createDocWithId).toHaveBeenCalledWith('serial_numbers', expect.any(String), expect.objectContaining({ installationId: 'INST-5' }));
  });

  it('captureInstallationSerial falls back to the Lead id when no Project is linked yet', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'LEAD-6', capturedSerialNumbers: [] });

    await captureInstallationSerial('LEAD-6', 'SN-200', 'PRD-1', 'Inverter');

    expect(mocks.createDocWithId).toHaveBeenCalledWith('serial_numbers', expect.any(String), expect.objectContaining({ installationId: 'LEAD-6' }));
  });

  it('linkInstallationToProject creates the installations doc using the just-linked projectId, not the stale pre-link lead', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'LEAD-7' }); // no projectId yet
    mocks.getAll.mockResolvedValueOnce([]); // no existing installations doc

    await linkInstallationToProject('LEAD-7', 'PRJ-7', 'Demo Project');

    expect(mocks.createDocWithId).toHaveBeenCalledWith('installations', 'INST-001', expect.objectContaining({ projectId: 'PRJ-7', leadId: 'LEAD-7' }));
  });
});
