import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 7: approveDesign() used to unconditionally set Project.currentStage
// to 'Quotation' and unconditionally append a new stageHistory entry,
// regardless of how far the project had already progressed — the same bug
// category found and fixed in surveyWorkflow.ts during Phase 6. This locks
// in the fix using the shared buildProjectStageAdvancePatch() guard.
const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  getAll: vi.fn(),
  softDelete: vi.fn(),
  genId: { generic: vi.fn((prefix: string) => `${prefix}-001`) },
  canDo: vi.fn(() => true),
  getState: vi.fn(),
  logActivity: vi.fn(),
  notifyUsers: vi.fn(),
  usersByRole: vi.fn(() => Promise.resolve([])),
  resolveWorkflowCompanyId: vi.fn(() => 'comp-1'),
  propagateCaseIdFromChain: vi.fn(),
  createCaseDocument: vi.fn(),
}));

vi.mock('../../../lib/firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  getAll: mocks.getAll,
  softDelete: mocks.softDelete,
  genId: mocks.genId,
}));

vi.mock('../../../lib/firebase', () => ({
  COLLECTIONS: { ENGINEERING_DESIGNS: 'engineering_designs', PROJECTS: 'projects' },
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

vi.mock('../../../lib/casePropagation', () => ({
  propagateCaseIdFromChain: mocks.propagateCaseIdFromChain,
}));

vi.mock('../../../lib/caseDocuments', () => ({
  createCaseDocument: mocks.createCaseDocument,
}));

import { approveDesign } from './engineeringWorkflow';

describe('approveDesign — Phase 7 forward-only Project stage guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({ user: { id: 'user-1' } });
  });

  it('advances an Engineering-stage project to Quotation on approval', async () => {
    mocks.getOne
      .mockResolvedValueOnce({ id: 'ENG-1', designId: 'ENG-1', status: 'InReview', projectId: 'PRJ-1' })
      .mockResolvedValueOnce({ id: 'PRJ-1', currentStage: 'Engineering', stageHistory: [] });
    await approveDesign('ENG-1');
    expect(mocks.updateDocById).toHaveBeenCalledWith('projects', 'PRJ-1', expect.objectContaining({ currentStage: 'Quotation' }));
  });

  it('does not regress a project already past Quotation when a design is (re-)approved against it', async () => {
    mocks.getOne
      .mockResolvedValueOnce({ id: 'ENG-1', designId: 'ENG-1', status: 'InReview', projectId: 'PRJ-1' })
      .mockResolvedValueOnce({ id: 'PRJ-1', currentStage: 'Order', stageHistory: [{ stage: 'Order', changedAt: 'T1' }] });
    await approveDesign('ENG-1');
    expect(mocks.updateDocById).toHaveBeenCalledWith('projects', 'PRJ-1', {});
  });
});
