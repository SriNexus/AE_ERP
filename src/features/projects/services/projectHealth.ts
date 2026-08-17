/**
 * projectHealth — Project Health calculation (Project Workspace Phase 2
 * Completion & Structure Fix mission).
 *
 * Mirrors relationshipHealth.ts's exact architecture (pure function, derived
 * at render time from real, already-loaded fields, never stored on the
 * project document, a 3-tier level not a numeric score) — the Project-
 * appropriate question is "is this project actively progressing, or
 * stalled/needs attention?", not a relabeled copy of Customer Relationship
 * Health.
 *
 * Signals used (every one sourced from real, already-existing data):
 *   - daysSinceLastStageChange: the most recent project.stageHistory[]
 *     entry's changedAt, falling back to project.createdAt when the
 *     project has no history yet (brand new).
 *   - hasAttentionStage: whether any of the real 13 lifecycle stages
 *     currently resolve to the 'attention' status — reuses
 *     resolveProjectWorkspaceStages() (src/hooks/useProjectStage.ts)
 *     unchanged, never a reimplemented lifecycle check.
 *   - isArchived: project.currentStage === 'Archived' — an archived
 *     project is a deliberately closed-out state, not "at risk" just
 *     because nothing has changed recently.
 *
 * Calculation rule (documented exactly, not left implicit):
 *   if archived: level = 'healthy' (closed out deliberately)
 *   else:
 *     riskPoints = 0
 *     + 2 if hasAttentionStage
 *     + 2 if daysSinceLastStageChange > 30
 *     + 1 if 14 < daysSinceLastStageChange <= 30
 *     level = riskPoints === 0 ? 'healthy' : riskPoints <= 2 ? 'attention' : 'risk'
 */
import { resolveProjectWorkspaceStages } from '../../../hooks/useProjectStage';
import type { ProjectRecord } from '../types';

export type ProjectHealthLevel = 'healthy' | 'attention' | 'risk';

export interface ProjectHealthSignals {
  daysSinceLastStageChange: number | null;
  hasAttentionStage: boolean;
  isArchived: boolean;
}

export interface ProjectHealthResult {
  level: ProjectHealthLevel;
  riskPoints: number;
  signals: ProjectHealthSignals;
}

function daysSince(value: unknown, now: number): number | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((now - d.getTime()) / 86400000));
}

export function calculateProjectHealth(project: ProjectRecord, now: number = Date.now()): ProjectHealthResult {
  const isArchived = project.currentStage === 'Archived';

  const stages = resolveProjectWorkspaceStages(project);
  const hasAttentionStage = stages.some((s) => s.status === 'attention');

  const history = project.stageHistory || [];
  const lastEntry = history.length ? history[history.length - 1] : null;
  const daysSinceLastStageChange = daysSince(lastEntry?.changedAt || project.createdAt, now);

  if (isArchived) {
    return {
      level: 'healthy',
      riskPoints: 0,
      signals: { daysSinceLastStageChange, hasAttentionStage, isArchived },
    };
  }

  let riskPoints = 0;
  if (hasAttentionStage) riskPoints += 2;
  if (daysSinceLastStageChange !== null) {
    if (daysSinceLastStageChange > 30) riskPoints += 2;
    else if (daysSinceLastStageChange > 14) riskPoints += 1;
  }

  const level: ProjectHealthLevel = riskPoints === 0 ? 'healthy' : riskPoints <= 2 ? 'attention' : 'risk';

  return {
    level,
    riskPoints,
    signals: { daysSinceLastStageChange, hasAttentionStage, isArchived },
  };
}
