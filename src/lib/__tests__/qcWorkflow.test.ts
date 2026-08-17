/**
 * qcWorkflow.test.ts — Phase 10 coverage.
 *
 * submitQCDecision() previously wrote currentStage/stageHistory to the
 * Project unconditionally, regardless of whether the transition was
 * actually forward — the same stage-regression anti-pattern found and
 * fixed in Survey (Phase 6) and Engineering (Phase 7), except QC's fail
 * path has a legitimate backward exception (loop back to Installation for
 * rework) that the canonical forward-only guard would refuse outright.
 * Fixed: PASS uses buildProjectStageAdvancePatch (forward-only,
 * regression-proof); FAIL still writes manually but only when the project
 * is CURRENTLY at QC, so a stale/duplicate QC record can never regress a
 * project that already legitimately moved past QC via a later QC check.
 *
 * Also covers createQCCheck()'s new duplicate-open-check guard — the
 * contributing risk factor behind an ambiguous "which QC governs the
 * transition" scenario.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  getAll: vi.fn(),
  logActivity: vi.fn(),
  notifyRoleUsers: vi.fn(),
  propagateCaseIdFromChain: vi.fn(),
  advanceProjectStage: vi.fn(),
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
    const s = mocks.getState() as any;
    return s.activeCompanyId || s.company?.id || s.user?.companyId || '';
  },
}));

vi.mock('../workflow', () => ({
  logActivity: mocks.logActivity,
}));

vi.mock('../notifications', () => ({
  notifyRoleUsers: mocks.notifyRoleUsers,
}));

vi.mock('../casePropagation', () => ({
  propagateCaseIdFromChain: mocks.propagateCaseIdFromChain,
}));

vi.mock('../projectStageTransition', () => ({
  advanceProjectStage: mocks.advanceProjectStage,
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: mocks.getState },
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: {
    QC_CHECKS: 'qc_checks',
    PROJECTS: 'projects',
  },
}));

import { createQCCheck, submitQCDecision, type QCRecord } from '../qcWorkflow';

function baseQC(overrides: Partial<QCRecord> = {}): QCRecord {
  return {
    id: 'QC-1',
    companyId: 'comp-1',
    projectId: 'PRJ-1',
    status: 'in_progress',
    checklistItems: [{ item: 'Earthing', passed: true }, { item: 'Isolation', passed: true }],
    inspectorId: 'USR-1',
    inspectorName: 'Inspector',
    createdBy: 'USR-1',
    createdAt: 'NOW',
    updatedAt: 'NOW',
    isDeleted: false,
    ...overrides,
  };
}

describe('createQCCheck — duplicate open check guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({ activeCompanyId: 'comp-1', user: { id: 'user-1' } });
    mocks.createDocWithId.mockResolvedValue(undefined);
    mocks.advanceProjectStage.mockResolvedValue(undefined);
    mocks.notifyRoleUsers.mockResolvedValue(undefined);
    mocks.getAll.mockResolvedValue([]);
  });

  it('rejects a new QC check when an open (pending/in_progress) one already exists for the project', async () => {
    mocks.getAll.mockResolvedValueOnce([baseQC({ id: 'QC-OPEN', status: 'pending' })]);
    await expect(createQCCheck({ projectId: 'PRJ-1', inspectorId: 'USR-1', inspectorName: 'Inspector' })).rejects.toThrow(/already exists/);
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('allows a new QC check when the prior one for the project already resolved (passed/failed)', async () => {
    mocks.getAll.mockResolvedValueOnce([baseQC({ id: 'QC-DONE', status: 'failed' })]);
    await createQCCheck({ projectId: 'PRJ-1', inspectorId: 'USR-1', inspectorName: 'Inspector' });
    expect(mocks.createDocWithId).toHaveBeenCalled();
  });

  it('allows a new QC check when no open one exists for a different project', async () => {
    mocks.getAll.mockResolvedValueOnce([baseQC({ id: 'QC-OTHER', projectId: 'PRJ-2', status: 'pending' })]);
    await createQCCheck({ projectId: 'PRJ-1', inspectorId: 'USR-1', inspectorName: 'Inspector' });
    expect(mocks.createDocWithId).toHaveBeenCalled();
  });
});

describe('submitQCDecision — forward-only PASS, guarded backward FAIL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({ activeCompanyId: 'comp-1', user: { id: 'user-1' } });
    mocks.updateDocById.mockResolvedValue(undefined);
    mocks.logActivity.mockResolvedValue(undefined);
    mocks.notifyRoleUsers.mockResolvedValue(undefined);
  });

  it('PASS: advances a Project currently at QC to Commissioning', async () => {
    mocks.getOne
      .mockResolvedValueOnce(baseQC({ status: 'in_progress', checklistItems: [{ item: 'A', passed: true }] }))
      .mockResolvedValueOnce({ id: 'PRJ-1', currentStage: 'QC', stageHistory: [] });

    await submitQCDecision('QC-1');

    expect(mocks.updateDocById).toHaveBeenCalledWith('projects', 'PRJ-1', expect.objectContaining({ currentStage: 'Commissioning' }));
  });

  it('PASS: never regresses a Project that has already moved past Commissioning (stale QC record)', async () => {
    mocks.getOne
      .mockResolvedValueOnce(baseQC({ status: 'in_progress', checklistItems: [{ item: 'A', passed: true }] }))
      .mockResolvedValueOnce({ id: 'PRJ-1', currentStage: 'NetMetering', stageHistory: [] });

    await submitQCDecision('QC-1');

    expect(mocks.updateDocById).not.toHaveBeenCalledWith('projects', 'PRJ-1', expect.anything());
  });

  it('FAIL: loops a Project currently at QC back to Installation for rework', async () => {
    mocks.getOne
      .mockResolvedValueOnce(baseQC({ status: 'in_progress', checklistItems: [{ item: 'A', passed: false }] }))
      .mockResolvedValueOnce({ id: 'PRJ-1', currentStage: 'QC', stageHistory: [] });

    await submitQCDecision('QC-1');

    expect(mocks.updateDocById).toHaveBeenCalledWith('projects', 'PRJ-1', expect.objectContaining({ currentStage: 'Installation' }));
  });

  it('FAIL: never regresses a Project that has already moved past QC via a later, different QC check', async () => {
    mocks.getOne
      .mockResolvedValueOnce(baseQC({ status: 'in_progress', checklistItems: [{ item: 'A', passed: false }] }))
      .mockResolvedValueOnce({ id: 'PRJ-1', currentStage: 'Commissioning', stageHistory: [] });

    await submitQCDecision('QC-1');

    expect(mocks.updateDocById).not.toHaveBeenCalledWith('projects', 'PRJ-1', expect.anything());
  });
});
