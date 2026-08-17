/**
 * P10-05 — Project Anomaly Detection Engine
 *
 * Detects unusual project behavior by comparing against historical norms.
 * Complements P10-03 Auto-Reminders (which detects threshold-based stuck stages).
 *
 * Key distinction:
 *   P10-03: "Has this record crossed a configured threshold?"
 *   P10-05: "Is this record behaving unusually compared with expected behavior?"
 *
 * Pure functions — no Firestore, no React, no side effects.
 *
 * BETA — Heuristic detection. Not ML.
 */

import { safeDate, daysBetween, safeNumber } from './analyticsCore';
import { projectStageIndex } from './projectLifecycle';
import type {
  AnomalyResult,
  AnomalySeverity,
  AnomalyType,
  AnomalyEvidence,
  AnomalyDetectionSummary,
  ForecastConfidence,
} from '../features/ai/types';

// ══════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════

export const DETECTION_VERSION = 'heuristic-v1';

// ══════════════════════════════════════════════════════════
//  INPUT TYPES
// ══════════════════════════════════════════════════════════

export interface StageEntry {
  stage: string;
  changedAt: string;
  changedBy?: string;
  note?: string;
}

export interface ProjectAnomalyInput {
  id: string;
  projectId: string;
  projectName?: string;
  currentStage: string;
  stageHistory: StageEntry[];
  createdAt: string;
  isDeleted?: boolean;
  assignedSurveyor?: string;
  assignedInstaller?: string;
  salesOwner?: string;
  /** Linked records */
  surveys?: Array<{ status: string; createdAt?: string }>;
  engineeringDesigns?: Array<{ status: string; createdAt?: string }>;
  quotations?: Array<{ status: string; total?: number }>;
  orders?: Array<{ status: string; total?: number; createdAt?: string }>;
  dispatches?: Array<{ status: string; createdAt?: string }>;
  installations?: Array<{ status: string; createdAt?: string }>;
  qcChecks?: Array<{ status: string; passed?: boolean }>;
  payments?: Array<{ status: string; amount?: number; createdAt?: string }>;
}

export interface AnomalyBenchmarkData {
  /** Average duration per stage in days (from historical projects) */
  avgStageDurationDays: Record<string, number>;
  /** Total projects analyzed for benchmark */
  sampleSize: number;
}

// ══════════════════════════════════════════════════════════
//  SEVERITY HELPERS
// ══════════════════════════════════════════════════════════

function severityFromDeviation(deviationRatio: number): AnomalySeverity {
  if (deviationRatio >= 4) return 'critical';
  if (deviationRatio >= 3) return 'high';
  if (deviationRatio >= 2) return 'medium';
  if (deviationRatio >= 1.5) return 'low';
  return 'info';
}

function confidenceFromBenchmark(sampleSize: number): ForecastConfidence {
  if (sampleSize >= 20) return 'high';
  if (sampleSize >= 10) return 'medium';
  if (sampleSize >= 3) return 'low';
  return 'insufficient_data';
}

// ══════════════════════════════════════════════════════════
//  DETECTION FUNCTIONS
// ══════════════════════════════════════════════════════════

function detectStageDurationAnomaly(
  project: ProjectAnomalyInput,
  benchmarks: AnomalyBenchmarkData,
): AnomalyResult | null {
  const stage = project.currentStage;
  if (!stage || stage === 'Archived' || stage === 'New') return null;

  const avgDuration = benchmarks.avgStageDurationDays[stage];
  if (!avgDuration || avgDuration <= 0) return null;

  // Find how long project has been in current stage
  const history = project.stageHistory || [];
  const stageEntry = [...history].reverse().find((h) => h.stage === stage);
  const enteredAt = stageEntry ? safeDate(stageEntry.changedAt) : null;
  if (!enteredAt) return null;

  const currentDuration = daysBetween(enteredAt, new Date());
  if (currentDuration < avgDuration) return null; // Within normal range

  const deviationRatio = currentDuration / avgDuration;
  const severity = severityFromDeviation(deviationRatio);
  if (severity === 'info') return null; // Only flag significant deviations

  const confidence = confidenceFromBenchmark(benchmarks.sampleSize);
  const evidence: AnomalyEvidence[] = [
    { metric: 'Stage duration', expected: `${avgDuration} days (historical avg)`, observed: `${currentDuration} days (${deviationRatio.toFixed(1)}x normal)` },
    { metric: 'Benchmark sample size', expected: '≥ 10 projects for medium confidence', observed: `${benchmarks.sampleSize} project(s)` },
  ];

  const id = `anomaly-${project.projectId}-stage-duration-${Date.now()}`;
  return {
    id,
    projectId: project.projectId,
    projectName: project.projectName || project.projectId,
    anomalyType: 'stage_duration_above_historical_norm',
    severity,
    confidence,
    evidence,
    explanation: `Project has been in '${stage}' for ${currentDuration} days, which is ${deviationRatio.toFixed(1)}x the historical average of ${avgDuration} days.`,
    recommendedAction: `Review why ${stage} is taking longer than similar projects. Consider reassigning resources or investigating blockers.`,
    detectedAt: new Date().toISOString(),
    detectionVersion: DETECTION_VERSION,
  };
}

function detectBackwardStageMovement(
  project: ProjectAnomalyInput,
): AnomalyResult | null {
  const history = project.stageHistory || [];
  if (history.length < 2) return null;

  // Check for stage going backwards (e.g., from 'QC' back to 'Installation')
  const stageIndex = (stage: string) => projectStageIndex(stage);

  let backwardMoves = 0;
  for (let i = 1; i < history.length; i++) {
    const prevIdx = stageIndex(history[i - 1].stage);
    const currIdx = stageIndex(history[i].stage);
    if (prevIdx > currIdx && prevIdx >= 0 && currIdx >= 0) {
      backwardMoves++;
    }
  }

  if (backwardMoves === 0) return null;

  const severity = backwardMoves >= 3 ? 'high' : backwardMoves >= 2 ? 'medium' : 'low';

  const evidence: AnomalyEvidence[] = [
    { metric: 'Backward stage movements', expected: '0 (forward progression expected)', observed: `${backwardMoves} backward movement(s)` },
  ];

  const id = `anomaly-${project.projectId}-backward-movement-${Date.now()}`;
  return {
    id,
    projectId: project.projectId,
    projectName: project.projectName || project.projectId,
    anomalyType: 'unexpected_backward_stage_movement',
    severity,
    confidence: 'medium',
    evidence,
    explanation: `Project has experienced ${backwardMoves} backward stage movement(s), indicating possible quality issues or scope changes requiring rework.`,
    recommendedAction: `Review stage history to determine root cause of backward movements. May indicate quality issues, incomplete work, or scope changes.`,
    detectedAt: new Date().toISOString(),
    detectionVersion: DETECTION_VERSION,
  };
}

function detectRepeatedStatusChanges(
  project: ProjectAnomalyInput,
): AnomalyResult | null {
  const history = project.stageHistory || [];
  if (history.length < 6) return null; // Need enough history

  // Check if same stage appears multiple times (indicating flapping)
  const stageCounts = new Map<string, number>();
  history.forEach((h) => {
    stageCounts.set(h.stage, (stageCounts.get(h.stage) || 0) + 1);
  });

  let repeatedStages = 0;
  stageCounts.forEach((count, stage) => {
    if (count >= 3) repeatedStages++;
  });

  if (repeatedStages === 0) return null;

  const severity = repeatedStages >= 2 ? 'medium' : 'low';
  const evidence: AnomalyEvidence[] = [
    { metric: 'Stages with ≥3 transitions', expected: '0 (linear progression)', observed: `${repeatedStages} stage(s)` },
    { metric: 'Total stage transitions', expected: `${Math.min(history.length, 10)} (typical linear progression)`, observed: `${history.length} transitions` },
  ];

  const id = `anomaly-${project.projectId}-repeated-changes-${Date.now()}`;
  return {
    id,
    projectId: project.projectId,
    projectName: project.projectName || project.projectId,
    anomalyType: 'repeated_status_changes',
    severity,
    confidence: 'medium',
    evidence,
    explanation: `Project has ${history.length} stage transitions with ${repeatedStages} stage(s) appearing 3+ times, suggesting instability or repeated rework.`,
    recommendedAction: `Review repeated stage transitions for patterns. Consider whether process changes could reduce rework.`,
    detectedAt: new Date().toISOString(),
    detectionVersion: DETECTION_VERSION,
  };
}

function detectMissingDownstreamActivity(
  project: ProjectAnomalyInput,
): AnomalyResult | null {
  const stage = project.currentStage;
  const anomalies: string[] = [];

  // Survey completed but no engineering
  if (stage === 'Engineering' || stage === 'Survey') {
    const surveys = (project.surveys || []).filter((s) => s.status === 'Approved' || s.status === 'Completed');
    if (surveys.length > 0 && stage === 'Survey') {
      anomalies.push('Survey completed but project not advancing to Engineering');
    }
  }

  // Engineering completed but no procurement activity
  if (stage === 'Procurement' || stage === 'Engineering') {
    const designs = (project.engineeringDesigns || []).filter((s) => s.status === 'Approved');
    if (designs.length > 0 && stage === 'Engineering') {
      anomalies.push('Engineering approved but project not advancing to Procurement/Order');
    }
  }

  // Procurement complete but installation not started
  if (stage === 'Installation' || stage === 'Procurement') {
    const pos = (project.quotations || []).filter((s) => s.status === 'Converted to Order' || s.status === 'Accepted');
    if (pos.length > 0 && stage === 'Procurement') {
      anomalies.push('Order/Agreement completed but project not advancing to Dispatch/Installation');
    }
  }

  // Installation completed but no QC
  if (stage === 'QC' || stage === 'Installation') {
    const installs = (project.installations || []).filter((s) => s.status === 'Completed');
    if (installs.length > 0 && stage === 'Installation') {
      anomalies.push('Installation completed but QC not initiated');
    }
  }

  if (anomalies.length === 0) return null;

  const evidence: AnomalyEvidence[] = anomalies.map((desc, i) => ({
    metric: `Missing downstream activity #${i + 1}`,
    expected: 'Expected downstream stage progression',
    observed: desc,
  }));

  const id = `anomaly-${project.projectId}-missing-downstream-${Date.now()}`;
  return {
    id,
    projectId: project.projectId,
    projectName: project.projectName || project.projectId,
    anomalyType: 'missing_downstream_activity',
    severity: 'medium',
    confidence: 'medium',
    evidence,
    explanation: `${anomalies.length} expected downstream activity(ies) not yet initiated despite upstream work being completed.`,
    recommendedAction: `Review ${anomalies.map((a) => a.toLowerCase()).join('; ')}. Ensure the next responsible team is assigned and aware.`,
    detectedAt: new Date().toISOString(),
    detectionVersion: DETECTION_VERSION,
  };
}

function detectPaymentProgressMismatch(
  project: ProjectAnomalyInput,
): AnomalyResult | null {
  const payments = (project.payments || []).filter((p) => p.status !== 'Cancelled');
  const orders = (project.orders || []).filter((o) => o.status !== 'Cancelled');
  const totalOrderValue = orders.reduce((sum, o) => sum + safeNumber(o.total), 0);
  const totalPaid = payments.reduce((sum, p) => sum + safeNumber(p.amount), 0);

  if (totalOrderValue <= 0) return null;

  const paidRatio = totalPaid / totalOrderValue;
  const stage = project.currentStage;

  // Projects in advanced stages should have significant payments
  const advancedStages = ['Installation', 'QC', 'Commissioning', 'NetMetering', 'Subsidy', 'Handover'];
  if (advancedStages.includes(stage) && paidRatio < 0.5) {
    const evidence: AnomalyEvidence[] = [
      { metric: 'Payment-to-order ratio', expected: '≥ 50% (advanced stage)', observed: `${Math.round(paidRatio * 100)}%` },
      { metric: 'Current stage', expected: 'Milestone-based payment expected', observed: stage },
    ];

    const id = `anomaly-${project.projectId}-payment-mismatch-${Date.now()}`;
    return {
      id,
      projectId: project.projectId,
      projectName: project.projectName || project.projectId,
      anomalyType: 'payment_progress_mismatch',
      severity: 'medium',
      confidence: 'medium',
      evidence,
      explanation: `Project is at '${stage}' stage but only ${Math.round(paidRatio * 100)}% of order value (₹${totalPaid.toLocaleString('en-IN')} of ₹${totalOrderValue.toLocaleString('en-IN')}) has been received.`,
      recommendedAction: `Review payment milestones for this project. Consider pausing further dispatch until outstanding payments are cleared.`,
      detectedAt: new Date().toISOString(),
      detectionVersion: DETECTION_VERSION,
    };
  }

  return null;
}

function detectUnusualInactivity(
  project: ProjectAnomalyInput,
): AnomalyResult | null {
  const history = project.stageHistory || [];
  if (history.length === 0) return null;

  const lastChange = history[history.length - 1];
  const lastChangeDate = safeDate(lastChange.changedAt);
  if (!lastChangeDate) return null;

  const daysSinceChange = daysBetween(lastChangeDate, new Date());
  const stage = project.currentStage;

  // Skip archived projects
  if (stage === 'Archived') return null;

  // Different thresholds per stage
  const inactivityThresholds: Record<string, number> = {
    New: 14,
    Survey: 21,
    Engineering: 30,
    Quotation: 30,
    Order: 14,
    Procurement: 30,
    Dispatch: 7,
    Installation: 45,
    QC: 14,
    Commissioning: 21,
    NetMetering: 45,
    Subsidy: 45,
    Handover: 21,
    AMC: 60,
    Service: 30,
    Monitoring: 90,
  };

  const threshold = inactivityThresholds[stage] || 30;
  if (daysSinceChange < threshold) return null;

  const severity = daysSinceChange >= threshold * 2 ? 'high' : daysSinceChange >= threshold * 1.5 ? 'medium' : 'low';
  const evidence: AnomalyEvidence[] = [
    { metric: 'Days since last activity', expected: `< ${threshold} days (stage-appropriate)`, observed: `${daysSinceChange} days` },
    { metric: 'Current stage', expected: 'Stage-appropriate activity', observed: `${stage} (no activity for ${daysSinceChange}d)` },
  ];

  const id = `anomaly-${project.projectId}-inactivity-${Date.now()}`;
  return {
    id,
    projectId: project.projectId,
    projectName: project.projectName || project.projectId,
    anomalyType: 'unusual_inactivity',
    severity,
    confidence: 'medium',
    evidence,
    explanation: `Project has been inactive for ${daysSinceChange} days at '${stage}' stage (threshold: ${threshold}d).`,
    recommendedAction: `Review project status. Assign responsible team member or determine if project should be placed on hold.`,
    detectedAt: new Date().toISOString(),
    detectionVersion: DETECTION_VERSION,
  };
}

function detectRepeatedFailedQc(
  project: ProjectAnomalyInput,
): AnomalyResult | null {
  if (!project.qcChecks || project.qcChecks.length === 0) return null;

  const failedQcs = project.qcChecks.filter((qc) => qc.passed === false).length;
  if (failedQcs < 2) return null;

  const severity = failedQcs >= 4 ? 'critical' : failedQcs >= 3 ? 'high' : 'medium';
  const evidence: AnomalyEvidence[] = [
    { metric: 'Failed QC attempts', expected: '0–1 (minor issues)', observed: `${failedQcs} failed attempt(s)` },
    { metric: 'Total QC checks', expected: '1–2 (typical)', observed: `${project.qcChecks.length} check(s)` },
  ];

  const id = `anomaly-${project.projectId}-failed-qc-${Date.now()}`;
  return {
    id,
    projectId: project.projectId,
    projectName: project.projectName || project.projectId,
    anomalyType: 'repeated_failed_qc',
    severity,
    confidence: 'medium',
    evidence,
    explanation: `Project has ${failedQcs} failed QC attempt(s) out of ${project.qcChecks.length} total, indicating persistent quality issues.`,
    recommendedAction: `Investigate root cause of repeated QC failures. Consider re-assigning installation team or reviewing installation procedures.`,
    detectedAt: new Date().toISOString(),
    detectionVersion: DETECTION_VERSION,
  };
}

// ══════════════════════════════════════════════════════════
//  MAIN DETECTION FUNCTION
// ══════════════════════════════════════════════════════════

/**
 * Detect all anomalies for a single project.
 * Pure function — no side effects.
 *
 * BETA — Heuristic detection. Not ML.
 */
export function detectProjectAnomalies(
  project: ProjectAnomalyInput,
  benchmarks: AnomalyBenchmarkData,
): AnomalyResult[] {
  const results: AnomalyResult[] = [];

  const detectors = [
    detectStageDurationAnomaly,
    detectBackwardStageMovement,
    detectRepeatedStatusChanges,
    detectMissingDownstreamActivity,
    detectPaymentProgressMismatch,
    detectUnusualInactivity,
    detectRepeatedFailedQc,
  ];

  detectors.forEach((detect) => {
    try {
      const result = detect(project, benchmarks);
      if (result) results.push(result);
    } catch {
      // Individual detector failure should not block other detectors
    }
  });

  return results;
}

/**
 * Detect anomalies across multiple projects.
 */
export function detectAllAnomalies(
  projects: ProjectAnomalyInput[],
  benchmarks: AnomalyBenchmarkData,
): AnomalyResult[] {
  const all: AnomalyResult[] = [];
  projects.forEach((project) => {
    if (project.isDeleted) return;
    const anomalies = detectProjectAnomalies(project, benchmarks);
    all.push(...anomalies);
  });

  return all.sort((a, b) => {
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
  });
}

/**
 * Build benchmark data from a set of projects.
 */
export function buildAnomalyBenchmarks(
  projects: ProjectAnomalyInput[],
): AnomalyBenchmarkData {
  const stageDurations = new Map<string, number[]>();

  projects.forEach((p) => {
    if (p.isDeleted) return;
    const history = p.stageHistory || [];

    for (let i = 0; i < history.length - 1; i++) {
      const current = history[i];
      const next = history[i + 1];
      const startDate = safeDate(current.changedAt);
      const endDate = safeDate(next.changedAt);
      if (startDate && endDate) {
        const duration = daysBetween(startDate, endDate);
        if (duration >= 0) {
          if (!stageDurations.has(current.stage)) stageDurations.set(current.stage, []);
          stageDurations.get(current.stage)!.push(duration);
        }
      }
    }
  });

  const avgStageDurationDays: Record<string, number> = {};
  stageDurations.forEach((durations, stage) => {
    avgStageDurationDays[stage] = Math.round(
      durations.reduce((sum, d) => sum + d, 0) / durations.length,
    );
  });

  return {
    avgStageDurationDays,
    sampleSize: projects.filter((p) => !p.isDeleted && (p.stageHistory?.length || 0) > 1).length,
  };
}

/**
 * Build a summary of all anomalies.
 */
export function summarizeAnomalies(anomalies: AnomalyResult[]): AnomalyDetectionSummary {
  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byType: Record<string, number> = {};

  anomalies.forEach((a) => {
    bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
    byType[a.anomalyType] = (byType[a.anomalyType] || 0) + 1;
  });

  return {
    totalAnomalies: anomalies.length,
    bySeverity: bySeverity as AnomalyDetectionSummary['bySeverity'],
    byType,
    anomalies,
    generatedAt: new Date().toISOString(),
  };
}
