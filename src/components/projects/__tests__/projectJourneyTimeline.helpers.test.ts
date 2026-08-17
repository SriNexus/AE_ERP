import { describe, expect, it } from 'vitest';
import { resolveJourneyStages, calculateJourneyProgress } from '../ProjectJourneyTimeline.helpers';

describe('resolveJourneyStages — Phase 5 canonical-order comparison', () => {
  it('marks every journey stage completed once the project is at a later stage, via real stageHistory', () => {
    const history = [
      { stage: 'Survey', changedAt: 'T1' },
      { stage: 'Engineering', changedAt: 'T2' },
      { stage: 'Quotation', changedAt: 'T3' },
      { stage: 'Order', changedAt: 'T4' },
      { stage: 'Procurement', changedAt: 'T5' },
      { stage: 'Dispatch', changedAt: 'T6' },
      { stage: 'Installation', changedAt: 'T7' },
      { stage: 'QC', changedAt: 'T8' },
      { stage: 'Commissioning', changedAt: 'T9' },
      { stage: 'NetMetering', changedAt: 'T10' },
      { stage: 'Subsidy', changedAt: 'T11' },
      { stage: 'Handover', changedAt: 'T12' },
    ];
    const stages = resolveJourneyStages('AMC', history, 'PRJ-1');
    expect(stages.every((s) => s.status === 'completed')).toBe(true);
    expect(calculateJourneyProgress(stages).percent).toBe(100);
  });

  it('Phase 5 bug fix: a project past the 12-stage journey window (AMC/Service/Monitoring) marks every journey stage completed by canonical position, even with incomplete stageHistory — previously this only worked via stageHistory, since AMC/Service/Monitoring have no position within the 12-item journey subset itself', () => {
    // Deliberately sparse/missing stageHistory — the old position-based
    // comparison (findIndex within the 12-item subset) returned -1 for any
    // currentStage not part of the subset, silently disabling the fallback.
    const stages = resolveJourneyStages('AMC', [], 'PRJ-2');
    expect(stages.every((s) => s.status === 'completed')).toBe(true);
  });

  it('does not mark a stage completed before the project has reached it', () => {
    const stages = resolveJourneyStages('Engineering', [{ stage: 'Survey', changedAt: 'T1' }], 'PRJ-3');
    const byId = Object.fromEntries(stages.map((s) => [s.id, s.status]));
    expect(byId.survey).toBe('completed');
    expect(byId.engineering).toBe('current');
    expect(byId.quotation).toBe('upcoming');
    expect(byId.handover).toBe('upcoming');
  });

  it('Archived always marks the full journey completed', () => {
    const stages = resolveJourneyStages('Archived', [], 'PRJ-4');
    expect(stages.every((s) => s.status === 'completed')).toBe(true);
  });
});
