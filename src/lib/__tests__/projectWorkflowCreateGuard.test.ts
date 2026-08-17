import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 4: defense-in-depth guard in createProject() — "B2B customers must
// NEVER have a Project" is a locked business rule; this is the true
// lowest-level enforcement (see projectWorkflow.ts's createProject()).
// Mocking convention mirrors quotationWorkflow.test.ts's established pattern.
const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  genId: { project: vi.fn(() => 'PRJ-001') },
  logActivity: vi.fn(),
  resolveWorkflowCompanyId: vi.fn(() => 'comp-1'),
  getState: vi.fn(),
  sendNotification: vi.fn(),
  notifyRoleUsers: vi.fn(),
  propagateCaseId: vi.fn(),
  canDo: vi.fn(() => true),
}));

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  genId: mocks.genId,
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: { PROJECTS: 'projects', CUSTOMERS: 'customers' },
}));

vi.mock('../workflow', () => ({
  logActivity: mocks.logActivity,
  resolveWorkflowCompanyId: mocks.resolveWorkflowCompanyId,
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: mocks.getState },
}));

vi.mock('../notifications', () => ({
  sendNotification: mocks.sendNotification,
  notifyRoleUsers: mocks.notifyRoleUsers,
}));

vi.mock('../casePropagation', () => ({
  propagateCaseId: mocks.propagateCaseId,
}));

vi.mock('../permissions', () => ({
  canDo: mocks.canDo,
}));

import { createProject } from '../projectWorkflow';
import { PROJECT_FORM_DEFAULT } from '../../features/projects/types';

describe('createProject — Phase 4 B2B/Project guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({ user: { id: 'user-1' } });
    mocks.notifyRoleUsers.mockResolvedValue(undefined);
    mocks.createDocWithId.mockResolvedValue(undefined);
    mocks.logActivity.mockResolvedValue(undefined);
  });

  const form = {
    ...PROJECT_FORM_DEFAULT,
    customerId: 'CUST-1',
    capacityKw: '5',
    projectType: 'Residential',
  };

  it('rejects creating a Project for a B2B customer — Projects are B2C-exclusive', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'CUST-1', type: 'B2B' });
    await expect(createProject(form)).rejects.toThrow('B2C-exclusive');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('allows creating a Project for a B2C customer', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'CUST-1', type: 'B2C' });
    await expect(createProject(form)).resolves.toMatchObject({ projectId: 'PRJ-001' });
    expect(mocks.createDocWithId).toHaveBeenCalledWith('projects', 'PRJ-001', expect.objectContaining({ customerId: 'CUST-1' }));
  });

  it('allows creation when the customer record has no type set yet (never guesses, never blocks on ambiguity)', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'CUST-1' });
    await expect(createProject(form)).resolves.toMatchObject({ projectId: 'PRJ-001' });
    expect(mocks.createDocWithId).toHaveBeenCalled();
  });

  it('rejects creation for a role with no create permission on projects — RBAC is enforced at the service layer, not only via UI/route gating', async () => {
    mocks.canDo.mockReturnValueOnce(false);
    mocks.getOne.mockResolvedValueOnce({ id: 'CUST-1', type: 'B2C' });
    await expect(createProject(form)).rejects.toThrow('permission');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });
});
