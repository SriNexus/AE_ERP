import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(), updateDocById: vi.fn(), getOne: vi.fn(), getAll: vi.fn(),
  logActivity: vi.fn(), notifyRoleUsers: vi.fn(), getState: vi.fn(),
  genId: { generic: vi.fn(() => 'COM-001') },
}));
vi.mock('../firestore', () => ({ createDocWithId: mocks.createDocWithId, updateDocById: mocks.updateDocById, getOne: mocks.getOne, getAll: mocks.getAll, genId: mocks.genId, resolveWriteCompanyId: () => { const s = mocks.getState() as any; return s.activeCompanyId || s.company?.id || s.user?.companyId || ''; } }));
vi.mock('../workflow', () => ({ logActivity: mocks.logActivity }));
vi.mock('../notifications', () => ({ notifyRoleUsers: mocks.notifyRoleUsers }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: { getState: mocks.getState } }));
vi.mock('../firebase', () => ({ COLLECTIONS: { PROJECTS: 'projects', QC_CHECKS: 'qc_checks', COMMISSIONING_RECORDS: 'commissioning_records' } }));

import { createCommissioningRecord, reassignCommissioning } from '../commissioningWorkflow';
const input = { projectId: 'PRJ-1', projectName: 'Project One', generationTestKwh: 18.4, commissionedByName: 'Demo Operator', customerSignoff: true, customerSignoffUrl: 'companies/company-demo-neozy/commissioning-signatures/signature.png' };

describe('createCommissioningRecord QC linkage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({ activeCompanyId: 'company-demo-neozy', user: { id: 'U-1', companyId: 'company-demo-neozy' } });
    mocks.getOne.mockResolvedValue({ id: 'PRJ-1', projectId: 'PRJ-1', currentStage: 'Commissioning', stageHistory: [] });
    mocks.getAll.mockResolvedValue([{ id: 'QC-PASSED', companyId: 'company-demo-neozy', projectId: 'PRJ-1', status: 'passed', completedAt: '2026-07-13T10:00:00.000Z' }]);
    mocks.notifyRoleUsers.mockResolvedValue(undefined);
  });
  it('persists the exact passed QC relationship before advancing the project', async () => {
    await expect(createCommissioningRecord(input)).resolves.toMatchObject({ id: 'COM-001', qcId: 'QC-PASSED', status: 'completed' });
    expect(mocks.createDocWithId).toHaveBeenCalledWith('commissioning_records', 'COM-001', expect.objectContaining({ companyId: 'company-demo-neozy', projectId: 'PRJ-1', qcId: 'QC-PASSED' }));
    expect(mocks.updateDocById).toHaveBeenCalledWith('projects', 'PRJ-1', expect.objectContaining({ currentStage: 'NetMetering' }));
  });
  it('rejects commissioning without a passed QC before creating an immutable record', async () => {
    mocks.getAll.mockResolvedValue([{ id: 'QC-FAILED', companyId: 'company-demo-neozy', projectId: 'PRJ-1', status: 'failed' }]);
    await expect(createCommissioningRecord(input)).rejects.toThrow('A passed QC check is required before commissioning');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });
  it('validates the project stage before creating an immutable record', async () => {
    mocks.getOne.mockResolvedValue({ id: 'PRJ-1', currentStage: 'QC', stageHistory: [] });
    await expect(createCommissioningRecord(input)).rejects.toThrow('Project must be in Commissioning stage');
    expect(mocks.getAll).not.toHaveBeenCalled();
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });
});

describe('reassignCommissioning', () => {
  // Phase 11: Commissioning.tsx's bulk-assign previously wrote a field
  // called commissionedById directly via a raw updateDocById — a typo
  // against the real schema field (commissionedBy), so bulk-reassignment
  // silently did nothing any reader (entityRegistry.ts's ownerFields) could
  // see. Fixed by routing through this real service function.
  it('writes the real commissionedBy/commissionedByName fields, not a mistyped commissionedById', async () => {
    vi.clearAllMocks();
    await reassignCommissioning('COM-1', 'USR-9', 'Reassigned Engineer');
    expect(mocks.updateDocById).toHaveBeenCalledWith('commissioning_records', 'COM-1', {
      commissionedBy: 'USR-9',
      commissionedByName: 'Reassigned Engineer',
    });
  });
});