import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 6: scheduleSurvey()/approveSurvey() both used to unconditionally set
// Project.currentStage regardless of how far the project had already
// progressed — a genuine regression risk this test locks in the fix for,
// using the same buildProjectStageAdvancePatch() guard Phase 5 introduced.
const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  softDelete: vi.fn(),
  // Phase 6: scheduleSurvey() now consults the project's Scheme Registration
  // (Vendor Lock) for the Survey gate; these tests simulate projects with no
  // registration, so the gate is vacuous (getAll → []).
  getAll: vi.fn(async () => []),
  genId: { generic: vi.fn((prefix: string) => `${prefix}-001`) },
  canDo: vi.fn(() => true),
  getState: vi.fn(),
  logActivity: vi.fn(),
  notifyUsers: vi.fn(),
  usersByRole: vi.fn(() => Promise.resolve([])),
  resolveWorkflowCompanyId: vi.fn(() => 'comp-1'),
  createEngineeringDraftFromSurvey: vi.fn(),
  propagateCaseIdFromChain: vi.fn(),
  createCaseDocument: vi.fn(),
}));

vi.mock('../../../lib/firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  softDelete: mocks.softDelete,
  getAll: mocks.getAll,
  genId: mocks.genId,
}));

vi.mock('../../../lib/firebase', () => ({
  COLLECTIONS: { SURVEYS: 'surveys', PROJECTS: 'projects', SCHEME_REGISTRATIONS: 'scheme_registrations' },
}));

vi.mock('../../../lib/permissions', () => ({
  canDo: mocks.canDo,
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: mocks.getState },
}));

vi.mock('../../../lib/workflow', () => ({
  logActivity: mocks.logActivity,
  notifyUsers: mocks.notifyUsers,
  usersByRole: mocks.usersByRole,
  resolveWorkflowCompanyId: mocks.resolveWorkflowCompanyId,
}));

vi.mock('../../engineering/services/engineeringWorkflow', () => ({
  createEngineeringDraftFromSurvey: mocks.createEngineeringDraftFromSurvey,
}));

vi.mock('../../../lib/casePropagation', () => ({
  propagateCaseIdFromChain: mocks.propagateCaseIdFromChain,
}));

vi.mock('../../../lib/caseDocuments', () => ({
  createCaseDocument: mocks.createCaseDocument,
}));

import { scheduleSurvey, approveSurvey } from './surveyWorkflow';

describe('scheduleSurvey — Phase 6 forward-only Project stage guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({ user: { id: 'user-1' } });
    mocks.createDocWithId.mockResolvedValue({ id: 'SRV-001' });
  });

  it('advances a New project to Survey when scheduling its first survey', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'PRJ-1', currentStage: 'New', stageHistory: [] });
    await scheduleSurvey({ projectId: 'PRJ-1', surveyorId: 'USR-1', scheduledDate: '2026-01-01T00:00:00.000Z' });
    expect(mocks.updateDocById).toHaveBeenCalledWith('projects', 'PRJ-1', expect.objectContaining({
      assignedSurveyor: 'USR-1', currentStage: 'Survey',
    }));
  });

  it('does not regress a project already past Survey when a second survey is scheduled against it', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'PRJ-1', currentStage: 'Order', stageHistory: [{ stage: 'Order', changedAt: 'T1' }] });
    await scheduleSurvey({ projectId: 'PRJ-1', surveyorId: 'USR-2', scheduledDate: '2026-01-01T00:00:00.000Z' });
    const [, , patch] = mocks.updateDocById.mock.calls[0];
    expect(patch.assignedSurveyor).toBe('USR-2');
    expect(patch).not.toHaveProperty('currentStage');
    expect(patch).not.toHaveProperty('stageHistory');
  });
});

describe('approveSurvey — Phase 6 forward-only Project stage guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({ user: { id: 'user-1' } });
    mocks.createEngineeringDraftFromSurvey.mockResolvedValue({ id: 'ENG-1', handoffCreatedAt: 'T2' });
  });

  it('advances a Survey-stage project to Engineering on approval', async () => {
    mocks.getOne
      .mockResolvedValueOnce({ id: 'SRV-1', status: 'Completed', approvalStatus: 'Pending', projectId: 'PRJ-1' })
      .mockResolvedValueOnce({ id: 'PRJ-1', currentStage: 'Survey', stageHistory: [] });
    await approveSurvey('SRV-1');
    expect(mocks.updateDocById).toHaveBeenCalledWith('projects', 'PRJ-1', expect.objectContaining({ currentStage: 'Engineering' }));
  });

  it('does not regress a project already past Engineering when an old survey is (re-)approved', async () => {
    mocks.getOne
      .mockResolvedValueOnce({ id: 'SRV-1', status: 'Completed', approvalStatus: 'Pending', projectId: 'PRJ-1' })
      .mockResolvedValueOnce({ id: 'PRJ-1', currentStage: 'Order', stageHistory: [{ stage: 'Order', changedAt: 'T1' }] });
    await approveSurvey('SRV-1');
    expect(mocks.updateDocById).toHaveBeenCalledWith('projects', 'PRJ-1', {});
  });
});
