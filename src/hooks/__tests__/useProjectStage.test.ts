import { describe, expect, it } from 'vitest';
import { resolveProjectWorkspaceStages } from '../useProjectStage';
import type { ProjectRecord } from '../../features/projects/types';

function project(overrides: Partial<ProjectRecord>): ProjectRecord {
  return {
    id: 'PRJ-1', projectId: 'PRJ-1', companyId: 'C', customerId: 'CUS-1',
    capacityKw: 5, currentStage: 'Survey', stageHistory: [], projectType: 'Residential',
    siteAddress: {}, linkedQuotationIds: [], linkedOrderIds: [], linkedDispatchIds: [],
    createdAt: '', updatedAt: '', isDeleted: false,
    ...overrides,
  } as ProjectRecord;
}

describe('resolveProjectWorkspaceStages — Phase 5 canonical-order comparison', () => {
  it('does not mark a stage completed before the project has reached it', () => {
    const stages = resolveProjectWorkspaceStages(project({ currentStage: 'Engineering', stageHistory: [{ stage: 'Survey', changedAt: 'T1' } as any] }));
    const byStage = Object.fromEntries(stages.map((s) => [s.projectStage, s.status]));
    expect(byStage.Survey).toBe('completed');
    expect(byStage.Engineering).toBe('current');
    expect(byStage.Quotation).toBe('upcoming');
    expect(byStage.AMC).toBe('upcoming');
  });

  it('Phase 5 bug fix: a project past this 13-stage subset (Service/Monitoring, beyond AMC) marks every subset stage completed by canonical position, even with incomplete stageHistory', () => {
    const stages = resolveProjectWorkspaceStages(project({ currentStage: 'Service', stageHistory: [] }));
    expect(stages.every((s) => s.status === 'completed')).toBe(true);
  });

  it('Archived marks every stage completed', () => {
    const stages = resolveProjectWorkspaceStages(project({ currentStage: 'Archived', stageHistory: [] }));
    expect(stages.every((s) => s.status === 'completed')).toBe(true);
  });
});
