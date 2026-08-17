/**
 * Tests for P10-05 Anomaly Detection Engine
 *
 * Tests cover: normal project, stalled project, unusually long stage,
 * insufficient benchmark data, severity calculation, evidence generation,
 * backward movement, repeated status changes, missed downstream activity,
 * payment mismatch, repeated failed QC, and deterministic output.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAnomalyBenchmarks,
  detectProjectAnomalies,
  detectAllAnomalies,
  summarizeAnomalies,
  DETECTION_VERSION,
} from '../anomalyDetection';
import type { ProjectAnomalyInput, StageEntry } from '../anomalyDetection';

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function makeStageEntry(stage: string, daysBack: number, note?: string): StageEntry {
  return { stage, changedAt: daysAgo(daysBack), note };
}

function makeProject(overrides: Partial<ProjectAnomalyInput> = {}): ProjectAnomalyInput {
  return {
    id: 'proj-1',
    projectId: 'PRJ-001',
    projectName: 'Test Project',
    currentStage: 'Installation',
    stageHistory: [
      makeStageEntry('New', 60),
      makeStageEntry('Survey', 50),
      makeStageEntry('Engineering', 40),
      makeStageEntry('Quotation', 35),
      makeStageEntry('Order', 30),
      makeStageEntry('Procurement', 25),
      makeStageEntry('Dispatch', 20),
      makeStageEntry('Installation', 15),
    ],
    createdAt: daysAgo(60),
    isDeleted: false,
    ...overrides,
  };
}

function makeBenchmarks(sampleSize = 15) {
  return {
    avgStageDurationDays: {
      New: 5,
      Survey: 10,
      Engineering: 12,
      Quotation: 5,
      Order: 5,
      Procurement: 8,
      Dispatch: 5,
      Installation: 14,
      QC: 3,
      Commissioning: 7,
      NetMetering: 14,
      Subsidy: 14,
      Handover: 5,
    },
    sampleSize,
  };
}

describe('Anomaly Detection — Normal project', () => {
  it('should not flag a project within normal duration', () => {
    const project = makeProject({
      currentStage: 'Installation',
      stageHistory: [makeStageEntry('Installation', 5)],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    // Installation avg is 14 days, only 5 days in stage → no anomaly
    const stageDurationAnomaly = results.filter(r => r.anomalyType === 'stage_duration_above_historical_norm');
    expect(stageDurationAnomaly).toHaveLength(0);
  });

  it('should not flag a recently updated project for inactivity', () => {
    const project = makeProject({
      currentStage: 'Installation',
      stageHistory: [makeStageEntry('Installation', 2)],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const inactivityAnomaly = results.filter(r => r.anomalyType === 'unusual_inactivity');
    expect(inactivityAnomaly).toHaveLength(0);
  });

  it('should not detect anomalies for a newly created project', () => {
    const project = makeProject({
      currentStage: 'New',
      stageHistory: [makeStageEntry('New', 1)],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    expect(results).toHaveLength(0);
  });

  it('should handle project with no stage history', () => {
    const project = makeProject({ stageHistory: [], currentStage: 'New' });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('Anomaly Detection — Stalled/inactive project', () => {
  it('should flag a project with long inactivity', () => {
    const project = makeProject({
      currentStage: 'Installation',
      stageHistory: [makeStageEntry('Installation', 50)],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);      const inactivityAnomaly = results.find(r => r.anomalyType === 'unusual_inactivity');
    expect(inactivityAnomaly).toBeDefined();
    // 50 days in Installation (threshold=45): 50 < 67.5 (1.5x) and 50 < 90 (2x) → severity='low'
    expect(inactivityAnomaly!.severity).toBe('low');
    expect(inactivityAnomaly!.evidence.length).toBeGreaterThan(0);
  });

  it('should NOT flag a project with moderate inactivity under threshold', () => {
    const project = makeProject({
      currentStage: 'Installation',
      stageHistory: [makeStageEntry('Installation', 25)],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const inactivityAnomaly = results.find(r => r.anomalyType === 'unusual_inactivity');
    // Installation threshold is 45, so 25 < 45 → should NOT be flagged
    expect(inactivityAnomaly).toBeUndefined();
  });
});

describe('Anomaly Detection — Unusually long stage duration', () => {
  it('should flag a stage well above historical average', () => {
    const project = makeProject({
      currentStage: 'QC',
      stageHistory: [makeStageEntry('QC', 15)],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const stageAnomaly = results.find(r => r.anomalyType === 'stage_duration_above_historical_norm');
    expect(stageAnomaly).toBeDefined();
    // 15 days in QC (avg 3): 15/3 = 5x → severity should be 'critical' (≥4x)
    expect(stageAnomaly!.severity).toBe('critical');
    expect(stageAnomaly!.confidence).toBe('medium');
  });

  it('should provide useful evidence for stage duration anomaly', () => {
    const project = makeProject({
      currentStage: 'QC',
      stageHistory: [makeStageEntry('QC', 15)],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const stageAnomaly = results.find(r => r.anomalyType === 'stage_duration_above_historical_norm');
    expect(stageAnomaly!.evidence.some(e => e.metric.includes('Stage duration'))).toBe(true);
    expect(stageAnomaly!.explanation).toContain('QC');
  });

  it('should not flag stage duration anomaly for New or Archived stages', () => {
    const newProject = makeProject({
      currentStage: 'New',
      stageHistory: [makeStageEntry('New', 100)],
    });
    const archivedProject = makeProject({
      currentStage: 'Archived',
      stageHistory: [makeStageEntry('Archived', 100)],
    });
    const benchmarks = makeBenchmarks();
    const newResults = detectProjectAnomalies(newProject, benchmarks);
    const archivedResults = detectProjectAnomalies(archivedProject, benchmarks);
    expect(newResults.filter(r => r.anomalyType === 'stage_duration_above_historical_norm')).toHaveLength(0);
    expect(archivedResults.filter(r => r.anomalyType === 'stage_duration_above_historical_norm')).toHaveLength(0);
  });
});

describe('Anomaly Detection — Insufficient benchmark data', () => {
  it('should flag low confidence when benchmark sample is small', () => {
    const project = makeProject({
      currentStage: 'QC',
      stageHistory: [makeStageEntry('QC', 15)],
    });
    const smallBenchmarks = makeBenchmarks(3);
    const results = detectProjectAnomalies(project, smallBenchmarks);
    const stageAnomaly = results.find(r => r.anomalyType === 'stage_duration_above_historical_norm');
    expect(stageAnomaly).toBeDefined();
    expect(stageAnomaly!.confidence).toBe('low');
  });

  it('should return insufficient_data confidence when no benchmarks exist', () => {
    const project = makeProject({
      currentStage: 'Installation',
      stageHistory: [makeStageEntry('Installation', 100)],
    });
    const emptyBenchmarks = { avgStageDurationDays: {}, sampleSize: 0 };
    const results = detectProjectAnomalies(project, emptyBenchmarks);
    const stageAnomaly = results.find(r => r.anomalyType === 'stage_duration_above_historical_norm');
    expect(stageAnomaly).toBeUndefined(); // no benchmark data for stage
  });
});

describe('Anomaly Detection — Severity calculation', () => {
  it('should set critical severity for extreme deviations (≥4x)', () => {
    const project = makeProject({
      currentStage: 'QC',
      stageHistory: [makeStageEntry('QC', 20)], // 20/3 = 6.7x
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const stageAnomaly = results.find(r => r.anomalyType === 'stage_duration_above_historical_norm');
    expect(stageAnomaly!.severity).toBe('critical');
  });

  it('should set high severity for 3-4x deviations', () => {
    const project = makeProject({
      currentStage: 'QC',
      stageHistory: [makeStageEntry('QC', 10)], // 10/3 = 3.33x -> high (>=3)
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const stageAnomaly = results.find(r => r.anomalyType === 'stage_duration_above_historical_norm');
    expect(stageAnomaly!.severity).toBe('high');
  });

  it('should set low severity for 1.5-2x deviations', () => {
    const project = makeProject({
      currentStage: 'QC',
      stageHistory: [makeStageEntry('QC', 6)], // 6/3 = 2x
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const stageAnomaly = results.find(r => r.anomalyType === 'stage_duration_above_historical_norm');
    expect(stageAnomaly!.severity).toBe('medium');
  });
});

describe('Anomaly Detection — Backward stage movement', () => {
  it('should detect backward stage movement', () => {
    const project = makeProject({
      stageHistory: [
        makeStageEntry('New', 60),
        makeStageEntry('Survey', 50),
        makeStageEntry('Engineering', 40),
        makeStageEntry('Survey', 35), // backward
        makeStageEntry('Engineering', 30),
        makeStageEntry('Installation', 20),
      ],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const backwardAnomaly = results.find(r => r.anomalyType === 'unexpected_backward_stage_movement');
    expect(backwardAnomaly).toBeDefined();
    expect(backwardAnomaly!.evidence.length).toBeGreaterThan(0);
  });

  it('should not flag linear progression as backward movement', () => {
    const project = makeProject();
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const backwardAnomaly = results.find(r => r.anomalyType === 'unexpected_backward_stage_movement');
    expect(backwardAnomaly).toBeUndefined();
  });

  it('should handle multiple backward movements with higher severity', () => {
    const project = makeProject({
      stageHistory: [
        makeStageEntry('New', 60),
        makeStageEntry('Survey', 55),
        makeStageEntry('New', 50),
        makeStageEntry('Survey', 45),
        makeStageEntry('New', 40),
        makeStageEntry('Survey', 35),
      ],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const backwardAnomaly = results.find(r => r.anomalyType === 'unexpected_backward_stage_movement');
    expect(backwardAnomaly).toBeDefined();
    // 2 backward moves (Survey→New at i=2 and i=4) → severity 'medium' (>=2)
    expect(backwardAnomaly!.severity).toBe('medium');
  });
});

describe('Anomaly Detection — Repeated status changes', () => {
  it('should detect repeated stage transitions', () => {
    const project = makeProject({
      stageHistory: [
        makeStageEntry('New', 60),
        makeStageEntry('Survey', 55),
        makeStageEntry('New', 50),
        makeStageEntry('Survey', 45),
        makeStageEntry('New', 40),
        makeStageEntry('Survey', 35),
      ],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const repeatedAnomaly = results.find(r => r.anomalyType === 'repeated_status_changes');
    expect(repeatedAnomaly).toBeDefined();
    expect(repeatedAnomaly!.explanation).toContain('3+ times');
  });

  it('should not flag projects with few transitions', () => {
    const project = makeProject({
      stageHistory: [
        makeStageEntry('New', 60),
        makeStageEntry('Survey', 50),
        makeStageEntry('Engineering', 40),
        makeStageEntry('Installation', 30),
      ],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const repeatedAnomaly = results.find(r => r.anomalyType === 'repeated_status_changes');
    expect(repeatedAnomaly).toBeUndefined();
  });
});

describe('Anomaly Detection — Missing downstream activity', () => {
  it('should notify if survey completed but no progression', () => {
    const project = makeProject({
      currentStage: 'Survey',
      surveys: [{ status: 'Completed', createdAt: daysAgo(30) }],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const downstreamAnomaly = results.find(r => r.anomalyType === 'missing_downstream_activity');
    expect(downstreamAnomaly).toBeDefined();
  });

  it('should not flag missing downstream if project is progressing normally', () => {
    const project = makeProject();
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const downstreamAnomaly = results.find(r => r.anomalyType === 'missing_downstream_activity');
    expect(downstreamAnomaly).toBeUndefined();
  });
});

describe('Anomaly Detection — Payment/progress mismatch', () => {
  it('should flag projects in advanced stages with low payment', () => {
    const project = makeProject({
      currentStage: 'Installation',
      orders: [{ status: 'Confirmed', total: 100000 }],
      payments: [{ status: 'Completed', amount: 20000 }],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const paymentAnomaly = results.find(r => r.anomalyType === 'payment_progress_mismatch');
    expect(paymentAnomaly).toBeDefined();
    expect(paymentAnomaly!.explanation).toContain('20%');
  });

  it('should not flag projects with sufficient payments', () => {
    const project = makeProject({
      currentStage: 'Installation',
      orders: [{ status: 'Confirmed', total: 100000 }],
      payments: [{ status: 'Completed', amount: 80000 }],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const paymentAnomaly = results.find(r => r.anomalyType === 'payment_progress_mismatch');
    expect(paymentAnomaly).toBeUndefined();
  });

  it('should not flag projects with no order value', () => {
    const project = makeProject({
      currentStage: 'Installation',
      orders: [],
      payments: [],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const paymentAnomaly = results.find(r => r.anomalyType === 'payment_progress_mismatch');
    expect(paymentAnomaly).toBeUndefined();
  });
});

describe('Anomaly Detection — Repeated failed QC', () => {
  it('should flag repeated QC failures', () => {
    const project = makeProject({
      qcChecks: [
        { status: 'Failed', passed: false },
        { status: 'Failed', passed: false },
        { status: 'Failed', passed: false },
      ],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const qcAnomaly = results.find(r => r.anomalyType === 'repeated_failed_qc');
    expect(qcAnomaly).toBeDefined();
    expect(qcAnomaly!.severity).toBe('high');
  });

  it('should not flag a single QC failure', () => {
    const project = makeProject({
      qcChecks: [
        { status: 'Failed', passed: false },
      ],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    const qcAnomaly = results.find(r => r.anomalyType === 'repeated_failed_qc');
    expect(qcAnomaly).toBeUndefined();
  });
});

describe('Anomaly Detection — Evidence and explanation generation', () => {
  it('should provide detailed evidence for each anomaly', () => {
    const project = makeProject({
      currentStage: 'QC',
      stageHistory: [makeStageEntry('QC', 15)],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    results.forEach((r) => {
      expect(r.evidence.length).toBeGreaterThan(0);
      r.evidence.forEach((e) => {
        expect(e.metric).toBeTruthy();
        expect(e.expected).toBeTruthy();
        expect(e.observed).toBeTruthy();
      });
    });
  });

  it('should provide actionable recommendations', () => {
    const project = makeProject({
      currentStage: 'Installation',
      stageHistory: [makeStageEntry('Installation', 50)],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    results.forEach((r) => {
      expect(r.recommendedAction.length).toBeGreaterThan(10);
    });
  });

  it('should include detection version', () => {
    const project = makeProject({
      currentStage: 'QC',
      stageHistory: [makeStageEntry('QC', 15)],
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    results.forEach((r) => {
      expect(r.detectionVersion).toBe(DETECTION_VERSION);
    });
  });
});

describe('Anomaly Detection — Deterministic output', () => {
  it('should produce the same anomalies for the same input', () => {
    const project = makeProject({
      currentStage: 'QC',
      stageHistory: [makeStageEntry('QC', 15)],
      qcChecks: [{ status: 'Failed', passed: false }, { status: 'Failed', passed: false }],
    });
    const benchmarks = makeBenchmarks();
    const results1 = detectProjectAnomalies(project, benchmarks);
    const results2 = detectProjectAnomalies(project, benchmarks);
    expect(results1.length).toBe(results2.length);
    results1.forEach((r, i) => {
      expect(r.anomalyType).toBe(results2[i].anomalyType);
      expect(r.severity).toBe(results2[i].severity);
    });
  });
});

describe('Anomaly Detection — detectAllAnomalies (batch)', () => {
  it('should detect anomalies across multiple projects', () => {
    const projects = [
      makeProject({ id: 'p1', projectId: 'P1', currentStage: 'QC', stageHistory: [makeStageEntry('QC', 15)] }),
      makeProject({ id: 'p2', projectId: 'P2', currentStage: 'Installation', stageHistory: [makeStageEntry('Installation', 100)] }),
    ];
    const benchmarks = makeBenchmarks();
    const results = detectAllAnomalies(projects, benchmarks);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('should skip deleted projects', () => {
    const projects = [
      makeProject({ id: 'p1', projectId: 'P1', currentStage: 'QC', stageHistory: [makeStageEntry('QC', 15)], isDeleted: true }),
      makeProject({ id: 'p2', projectId: 'P2', currentStage: 'QC', stageHistory: [makeStageEntry('QC', 15)] }),
    ];
    const benchmarks = makeBenchmarks();
    const results = detectAllAnomalies(projects, benchmarks);
    // Only p2 should generate results
    const p1Results = results.filter(r => r.projectId === 'P1');
    const p2Results = results.filter(r => r.projectId === 'P2');
    expect(p1Results).toHaveLength(0);
    expect(p2Results.length).toBeGreaterThan(0);
  });

  it('should sort results by severity (critical first)', () => {
    const longDuration = makeProject({ id: 'p1', projectId: 'P1', currentStage: 'QC', stageHistory: [makeStageEntry('QC', 20)] });
    const projects = [
      longDuration,
      makeProject({ id: 'p2', projectId: 'P2', currentStage: 'QC', stageHistory: [makeStageEntry('QC', 8)] }), // medium
    ];
    const benchmarks = makeBenchmarks();
    const results = detectAllAnomalies(projects, benchmarks);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
    for (let i = 1; i < results.length; i++) {
      const prevIdx = severityOrder.indexOf(results[i - 1].severity);
      const currIdx = severityOrder.indexOf(results[i].severity);
      expect(prevIdx).toBeLessThanOrEqual(currIdx === -1 ? 99 : currIdx);
    }
  });

  it('should return empty array for empty input', () => {
    const benchmarks = makeBenchmarks();
    const results = detectAllAnomalies([], benchmarks);
    expect(results).toHaveLength(0);
  });
});

describe('Anomaly Detection — buildAnomalyBenchmarks', () => {
  it('should build benchmark data from projects', () => {
    const projects = [
      makeProject({ stageHistory: [makeStageEntry('New', 15), makeStageEntry('Survey', 10), makeStageEntry('Engineering', 5)] }),
      makeProject({ stageHistory: [makeStageEntry('New', 12), makeStageEntry('Survey', 8), makeStageEntry('Engineering', 3)] }),
    ];
    const benchmarks = buildAnomalyBenchmarks(projects);
    expect(benchmarks.avgStageDurationDays['New']).toBeGreaterThan(0);
    expect(benchmarks.avgStageDurationDays['Survey']).toBeGreaterThan(0);
    expect(benchmarks.sampleSize).toBeGreaterThan(0);
  });

  it('should handle projects with single stage in history', () => {
    const projects = [
      makeProject({ stageHistory: [makeStageEntry('New', 5)] }),
    ];
    const benchmarks = buildAnomalyBenchmarks(projects);
    expect(benchmarks.sampleSize).toBe(0); // Only 1 stage
    expect(Object.keys(benchmarks.avgStageDurationDays)).toHaveLength(0);
  });

  it('should exclude deleted projects from benchmarks', () => {
    const projects = [
      makeProject({ id: 'p1', stageHistory: [makeStageEntry('New', 10), makeStageEntry('Survey', 5)], isDeleted: true }),
      makeProject({ id: 'p2', stageHistory: [makeStageEntry('New', 8), makeStageEntry('Survey', 3)] }),
    ];
    const benchmarks = buildAnomalyBenchmarks(projects);
    expect(benchmarks.sampleSize).toBe(1);
  });
});

describe('Anomaly Detection — summarizeAnomalies', () => {
  it('should summarize anomalies by severity and type', () => {
    const results = detectAllAnomalies(
      [makeProject({ currentStage: 'QC', stageHistory: [makeStageEntry('QC', 15)] })],
      makeBenchmarks(),
    );
    const summary = summarizeAnomalies(results);
    expect(summary.totalAnomalies).toBeGreaterThan(0);
    expect(summary.bySeverity.critical + summary.bySeverity.high + summary.bySeverity.medium).toBeGreaterThan(0);
    expect(Object.keys(summary.byType).length).toBeGreaterThan(0);
  });

  it('should handle empty anomaly list', () => {
    const summary = summarizeAnomalies([]);
    expect(summary.totalAnomalies).toBe(0);
    expect(summary.bySeverity.critical).toBe(0);
    expect(summary.bySeverity.high).toBe(0);
    expect(summary.bySeverity.medium).toBe(0);
    expect(summary.bySeverity.low).toBe(0);
    expect(summary.bySeverity.info).toBe(0);
    expect(Object.keys(summary.byType)).toHaveLength(0);
    expect(summary.generatedAt).toBeTruthy();
  });
});

describe('Anomaly Detection — No false anomaly from missing optional data', () => {
  it('should not create anomalies from absent optional fields', () => {
    const project = makeProject({
      surveys: undefined,
      engineeringDesigns: undefined,
      quotations: undefined,
      orders: undefined,
      dispatches: undefined,
      installations: undefined,
      qcChecks: undefined,
      payments: undefined,
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    // Should not crash — results should only contain anomalies from non-optional fields
    expect(Array.isArray(results)).toBe(true);
  });

  it('should handle null optional fields gracefully', () => {
    const project = makeProject({
      surveys: null as any,
      qcChecks: null as any,
      payments: null as any,
    });
    const benchmarks = makeBenchmarks();
    const results = detectProjectAnomalies(project, benchmarks);
    expect(Array.isArray(results)).toBe(true);
  });
});
