import { useMemo } from 'react';

import type { StageCardStatus } from '../components/shared/StageCard';
import type { StageTimelineItem } from '../components/shared/StageTimeline';
import type { ProjectRecord, ProjectStage } from '../features/projects/types';
import { projectStageIndex } from '../lib/projectLifecycle';

export interface ProjectWorkspaceStage extends StageTimelineItem {
  projectStage: ProjectStage;
  shortLabel: string;
  emptyMessage?: string;
}

/** 12-stage Project Workspace lifecycle — Procurement and AMC are NOT
 * Project Workspace stages (they are separate business modules). This
 * is the single source of truth for stage rendering, numbering, progress
 * calculation, and auto-scroll in the Project Details page. */
const LIFECYCLE: Array<Omit<ProjectWorkspaceStage, 'status' | 'href'>> = [
  { id: 'registration', projectStage: 'SchemeRegistration', title: 'Registration', shortLabel: 'Registration', description: 'Scheme registration' },
  { id: 'survey', projectStage: 'Survey', title: 'Survey', shortLabel: 'Survey', description: 'Site survey and approval' },
  { id: 'engineering', projectStage: 'Engineering', title: 'Engineering', shortLabel: 'Design', description: 'System design and review' },
  { id: 'quotation', projectStage: 'Quotation', title: 'Quotation', shortLabel: 'Quote', description: 'Commercial proposal' },
  { id: 'order', projectStage: 'Order', title: 'Order', shortLabel: 'Order', description: 'Accepted sales order' },
  { id: 'dispatch', projectStage: 'Dispatch', title: 'Dispatch', shortLabel: 'Dispatch', description: 'Material movement' },
  { id: 'installation', projectStage: 'Installation', title: 'Installation', shortLabel: 'Install', description: 'On-site execution' },
  { id: 'qc', projectStage: 'QC', title: 'Quality Check', shortLabel: 'QC', description: 'Installation quality gate' },
  { id: 'commissioning', projectStage: 'Commissioning', title: 'Commissioning', shortLabel: 'Commission', description: 'Plant commissioning' },
  { id: 'net-metering', projectStage: 'NetMetering', title: 'Net Metering', shortLabel: 'Net Meter', description: 'DISCOM application' },
  { id: 'subsidy', projectStage: 'Subsidy', title: 'Subsidy', shortLabel: 'Subsidy', description: 'Government subsidy application' },
  { id: 'handover', projectStage: 'Handover', title: 'Handover', shortLabel: 'Handover', description: 'Customer handover package' },
];

function stageHref(stage: ProjectStage, project: ProjectRecord) {
  const projectId = encodeURIComponent(project.id);
  // The Registration (SchemeRegistration) operational workspace lives inside
  // the Project Workspace (Stage 2 — Registration workspace).
  if (stage === 'SchemeRegistration') return `/projects/${projectId}`;
  if (stage === 'Survey') return `/surveys?projectId=${projectId}`;
  if (stage === 'Engineering') return `/engineering-designs?projectId=${projectId}`;
  // The Quotation, Order, Procurement, Dispatch, Installation, QC,
  // Commissioning, Net Metering, Subsidy, Handover and AMC stages'
  // operational workspaces now live INSIDE the Project Workspace (Stage 3 —
  // Quotation workspace; Stage 5 — Order workspace; Stage 6 — Procurement
  // workspace; Stage 6 — Dispatch workspace; Stage 8 — Installation
  // workspace; Stage 9 — QC workspace; Stage 10 — Commissioning workspace;
  // Stage 11 — Net Metering workspace; Stage 12 — Subsidy workspace; Stage
  // 13 — Handover workspace; Stage 14 — AMC workspace; the standalone
  // Quotation popup, Order view popup, Purchase Order view popup, Dispatch
  // management popup, Installation detail modal, QC detail modal,
  // Commissioning detail modal, Net Metering detail modal, Subsidy detail
  // modal, Handover detail modal and AMC detail modal were retired), so
  // their "Open in full workspace" target is the Project.
  if (stage === 'Quotation') return `/projects/${projectId}`;
  if (stage === 'Order') return `/projects/${projectId}`;
  if (stage === 'Dispatch') return `/projects/${projectId}`;
  if (stage === 'Installation') return `/projects/${projectId}`;
  if (stage === 'QC') return `/projects/${projectId}`;
  if (stage === 'Commissioning') return `/projects/${projectId}`;
  if (stage === 'NetMetering') return `/projects/${projectId}`;
  if (stage === 'Subsidy') return `/projects/${projectId}`;
  if (stage === 'Handover') return `/projects/${projectId}`;
  return undefined;
}

export function resolveProjectWorkspaceStages(project: ProjectRecord): ProjectWorkspaceStage[] {
  // Phase 5: compared via the canonical stage order (projectStageIndex), not
  // position within this component's own 12-item LIFECYCLE subset — the two
  // scales aren't interchangeable, so both sides of every comparison
  // must resolve through the same canonical index.
  const archived = project.currentStage === 'Archived';
  // The workspace stage rail starts at Registration (SchemeRegistration) — it
  // has no entry for the vestigial pre-stage 'New'. A project whose stored
  // currentStage is 'New', empty, or an unrecognized value therefore has no
  // stage on the rail and every card resolves to 'upcoming'/locked, leaving no
  // place for work to begin. Surface Registration as the active stage for that
  // case: new projects are now created at 'SchemeRegistration' directly
  // (src/lib/projectWorkflow.ts), and this also repairs projects created
  // before that default — a read-time resolution only, the stored record is
  // never rewritten. Archived is untouched (index far past Registration).
  const effectiveCurrentStage: ProjectStage =
    projectStageIndex(project.currentStage) < projectStageIndex('SchemeRegistration')
      ? 'SchemeRegistration'
      : (project.currentStage as ProjectStage);
  const currentCanonicalIndex = projectStageIndex(effectiveCurrentStage);
  const completedStages = new Set((project.stageHistory || []).map((entry) => entry.stage));

  return LIFECYCLE.map((stage) => {
    let status: StageCardStatus = 'upcoming';
    if (archived || completedStages.has(stage.projectStage) || projectStageIndex(stage.projectStage) < currentCanonicalIndex) status = 'completed';
    if (!archived && stage.projectStage === effectiveCurrentStage) status = 'current';
    if (!archived && (effectiveCurrentStage === 'NetMetering' || effectiveCurrentStage === 'Subsidy')
      && (stage.projectStage === 'NetMetering' || stage.projectStage === 'Subsidy')
      && stage.projectStage !== effectiveCurrentStage
      && !completedStages.has(stage.projectStage)) status = 'attention';

    return { ...stage, status, href: stageHref(stage.projectStage, project) };
  });
}

export function useProjectStage(project?: ProjectRecord | null) {
  return useMemo(() => {
    const stages = project ? resolveProjectWorkspaceStages(project) : [];
    return {
      stages,
      activeStageId: stages.find((stage) => stage.status === 'current')?.id,
      completedCount: stages.filter((stage) => stage.status === 'completed').length,
    };
  }, [project]);
}
