import { describe, expect, it } from 'vitest';
import {
  PROJECT_STAGE_ORDER,
  projectStageIndex,
  isProjectStageAtOrPast,
  buildProjectStageAdvancePatch,
  findOrphanProjectStages,
} from '../projectLifecycle';

describe('PROJECT_STAGE_ORDER — the single canonical Project/EPC stage list (Blueprint Phase 5)', () => {
  it('has exactly the 18 locked stages in order, New first and Archived last', () => {
    expect(PROJECT_STAGE_ORDER).toEqual([
      'New', 'SchemeRegistration', 'Survey', 'Engineering', 'Quotation', 'Order', 'Procurement', 'Dispatch',
      'Installation', 'QC', 'Commissioning', 'NetMetering', 'Subsidy', 'Handover',
      'AMC', 'Service', 'Monitoring', 'Archived',
    ]);
  });
});

describe('projectStageIndex', () => {
  it('resolves a real stage to its position', () => {
    expect(projectStageIndex('SchemeRegistration')).toBe(1);
    expect(projectStageIndex('Survey')).toBe(2);
    expect(projectStageIndex('Archived')).toBe(17);
  });
  it('defaults an empty/missing stage to New (index 0)', () => {
    expect(projectStageIndex(undefined)).toBe(0);
    expect(projectStageIndex(null)).toBe(0);
    expect(projectStageIndex('')).toBe(0);
  });
  it('returns -1 for an unrecognized stage name', () => {
    expect(projectStageIndex('NotAStage')).toBe(-1);
  });
});

describe('isProjectStageAtOrPast', () => {
  it('is true when current has reached or passed target', () => {
    expect(isProjectStageAtOrPast('QC', 'Installation')).toBe(true);
    expect(isProjectStageAtOrPast('QC', 'QC')).toBe(true);
  });
  it('is false when current has not yet reached target', () => {
    expect(isProjectStageAtOrPast('Survey', 'QC')).toBe(false);
  });
});

describe('buildProjectStageAdvancePatch', () => {
  it('advances append-only lifecycle history', () => {
    expect(buildProjectStageAdvancePatch({ currentStage: 'Installation', stageHistory: [] }, 'QC', 'U', 'check', 'NOW')).toMatchObject({
      currentStage: 'QC',
      stageHistory: [{ stage: 'QC', changedAt: 'NOW', changedBy: 'U', note: 'check' }],
      updatedBy: 'U',
      updatedAt: 'NOW',
    });
  });
  it('does not regress or duplicate the current stage', () => {
    expect(buildProjectStageAdvancePatch({ currentStage: 'Service', stageHistory: [] }, 'Handover', 'U', 'old', 'NOW')).toEqual({});
    expect(buildProjectStageAdvancePatch({ currentStage: 'QC', stageHistory: [] }, 'QC', 'U', 'same', 'NOW')).toEqual({});
  });
  it('appends to existing history rather than replacing it', () => {
    const existing = [{ stage: 'New' as const, changedAt: 'T0' }];
    const patch = buildProjectStageAdvancePatch({ currentStage: 'New', stageHistory: existing }, 'Survey', 'U', 'started', 'NOW');
    const stageHistory = patch.stageHistory as typeof existing;
    expect(stageHistory).toHaveLength(2);
    expect(stageHistory[0]).toBe(existing[0]);
  });
});

describe('findOrphanProjectStages — Phase 5 data-migration verification (read-only)', () => {
  it('flags only genuinely unrecognized currentStage values, never a normal/empty one', () => {
    const result = findOrphanProjectStages([
      { id: 'P1', currentStage: 'QC' },
      { id: 'P2', currentStage: undefined },
      { id: 'P3', currentStage: 'TotallyMadeUpStage' },
    ]);
    expect(result).toEqual([{ id: 'P3', currentStage: 'TotallyMadeUpStage' }]);
  });

  it('finds zero orphans against the current demo dataset', async () => {
    const { buildBusinessGraphPlan } = await import('../../../scripts/demo/datasets/businessGraph.ts');
    const projects = buildBusinessGraphPlan().documents.filter((d) => d.collection === 'projects');
    expect(findOrphanProjectStages(projects.map((p) => ({ id: p.id, currentStage: p.data.currentStage as string })))).toEqual([]);
  });
});
