/**
 * Canonical Project/EPC stage lifecycle — the single source of truth for
 * stage order, comparison, and forward-only advancement. Blueprint Phase 5.
 *
 * Before this phase, eight separate files independently declared the same
 * (or a slightly-drifted subset of the same) 17-stage list:
 * projectStageTransition.ts, analyticsCore.ts, anomalyDetection.ts,
 * quotationWorkflow.ts, dispatchWorkflow.ts, purchaseOrderWorkflow.ts, plus
 * two smaller UI-metadata subsets (useProjectStage.ts's 13-stage LIFECYCLE,
 * ProjectJourneyTimeline.helpers.ts's 12-stage JOURNEY_STAGE_DEFINITIONS)
 * that computed their own position-in-array as a proxy for stage order.
 * Every one of those now derives its ordering/comparison from here.
 */
import type { ProjectStage } from '../types';

// Phase 0 (Channel Partner): 'SchemeRegistration' inserted between 'New' and
// 'Survey' (17 → 18 stages). User-facing stage label is exactly "Registration"
// (Vendor Lock / Portal Registration); the value stays 'SchemeRegistration' to
// keep it distinct from the loan `registrations` module and the
// `scheme_registrations` collection it writes to.
export const PROJECT_STAGE_ORDER: ProjectStage[] = [
  'New', 'SchemeRegistration', 'Survey', 'Engineering', 'Quotation', 'Order', 'Procurement', 'Dispatch',
  'Installation', 'QC', 'Commissioning', 'NetMetering', 'Subsidy', 'Handover',
  'AMC', 'Service', 'Monitoring', 'Archived',
];

export interface ProjectStageHistoryEntry {
  stage: ProjectStage;
  changedAt: string;
  changedBy?: string;
  note?: string;
}

export interface ProjectLifecycleRecord {
  currentStage?: string | null;
  stageHistory?: ProjectStageHistoryEntry[];
}

/** Index of a stage in the canonical order; -1 if not a recognized stage. Defaults an empty/missing stage to 'New'. */
export function projectStageIndex(stage: string | null | undefined): number {
  return PROJECT_STAGE_ORDER.indexOf((stage || 'New') as ProjectStage);
}

/** True when `currentStage` has already reached or passed `target` in the canonical order. */
export function isProjectStageAtOrPast(currentStage: string | null | undefined, target: ProjectStage): boolean {
  return projectStageIndex(currentStage) >= projectStageIndex(target);
}

/**
 * Data-migration check (Blueprint Phase 5): the canonical order is the
 * widest (18-stage after the Channel Partner 'SchemeRegistration' insertion)
 * of every list it replaces, so any `currentStage` value valid under one of
 * the old 12/13/16-stage arrays is automatically valid here too — this only
 * flags a genuinely unrecognized value (e.g. a typo or a value that predates
 * all prior arrays), never a false positive from the consolidation itself.
 * Read-only — never writes.
 */
export function findOrphanProjectStages(
  projects: Array<{ id: string; currentStage?: string | null }>,
): Array<{ id: string; currentStage: string }> {
  return projects
    .filter((project) => projectStageIndex(project.currentStage) < 0)
    .map((project) => ({ id: project.id, currentStage: String(project.currentStage) }));
}

/**
 * Build a forward-only stage-advance patch: append-only stageHistory, no
 * regression, no duplicate re-entry of the current stage. Returns `{}` when
 * `stage` would not move the project forward (already at or past it, or an
 * unrecognized stage name) — the established convention every prior call
 * site already followed, preserved here rather than changed.
 */
export function buildProjectStageAdvancePatch(
  project: ProjectLifecycleRecord | null | undefined,
  stage: ProjectStage,
  userId: string,
  note: string,
  now = new Date().toISOString(),
): Record<string, unknown> {
  const currentIndex = projectStageIndex(project?.currentStage);
  const nextIndex = PROJECT_STAGE_ORDER.indexOf(stage);
  if (nextIndex < 0 || currentIndex >= nextIndex) return {};
  return {
    currentStage: stage,
    stageHistory: [...(project?.stageHistory || []), { stage, changedAt: now, changedBy: userId, note }],
    updatedBy: userId,
    updatedAt: now,
  };
}
