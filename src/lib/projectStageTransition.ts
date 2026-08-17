import { COLLECTIONS } from './firebase';
import { getOne, updateDocById } from './firestore';
import type { ProjectStage } from '../types';
import { PROJECT_STAGE_ORDER, buildProjectStageAdvancePatch } from './projectLifecycle';

// Phase 5: re-exported (not redeclared) so this module's 5 existing
// consumers (monitoringWorkflow.ts, serviceTicketWorkflow.ts, amcWorkflow.ts,
// projectHandoverWorkflow.ts, qcWorkflow.ts) keep working against the same
// public API — the canonical order and patch logic now live in
// projectLifecycle.ts.
export { PROJECT_STAGE_ORDER };
export function buildProjectStagePatch(project: any, stage: ProjectStage, userId: string, note: string, now = new Date().toISOString()) {
  return buildProjectStageAdvancePatch(project, stage, userId, note, now);
}
export async function advanceProjectStage(projectId: string, stage: ProjectStage, userId: string, note: string, now = new Date().toISOString()) {
  const project = await getOne<any>(COLLECTIONS.PROJECTS, projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const patch = buildProjectStagePatch(project, stage, userId, note, now);
  if (Object.keys(patch).length) await updateDocById(COLLECTIONS.PROJECTS, projectId, patch);
  return patch;
}