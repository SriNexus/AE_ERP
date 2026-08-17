import { describe, expect, it } from 'vitest';
import { buildProjectStagePatch } from '../projectStageTransition';
describe('canonical project stage transitions', () => {
 it('advances append-only lifecycle history', () => { expect(buildProjectStagePatch({currentStage:'Installation',stageHistory:[]},'QC','U','check','NOW')).toMatchObject({currentStage:'QC',stageHistory:[{stage:'QC',changedAt:'NOW'}]}); });
 it('does not regress or duplicate the current stage', () => { expect(buildProjectStagePatch({currentStage:'Service',stageHistory:[]},'Handover','U','old','NOW')).toEqual({}); expect(buildProjectStagePatch({currentStage:'QC',stageHistory:[]},'QC','U','same','NOW')).toEqual({}); });
});