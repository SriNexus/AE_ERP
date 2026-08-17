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

const LIFECYCLE: Array<Omit<ProjectWorkspaceStage, 'status' | 'href'>> = [
  // Phase 6: the Registration stage (SchemeRegistration — user-facing label
  // exactly 'Registration', canonical index 1 between New and Survey). Its
  // operational workspace lives INSIDE the Project Workspace, so like the
  // Quotation→AMC in-workspace stages it opens at the Project.
  { id: 'registration', projectStage: 'SchemeRegistration', title: 'Registration', shortLabel: 'Registration', description: 'Scheme registration' },
  { id: 'survey', projectStage: 'Survey', title: 'Survey', shortLabel: 'Survey', description: 'Site survey and approval' },
  { id: 'engineering', projectStage: 'Engineering', title: 'Engineering', shortLabel: 'Design', description: 'System design and review' },
  { id: 'quotation', projectStage: 'Quotation', title: 'Quotation', shortLabel: 'Quote', description: 'Commercial proposal' },
  { id: 'order', projectStage: 'Order', title: 'Order', shortLabel: 'Order', description: 'Accepted sales order' },
  { id: 'procurement', projectStage: 'Procurement', title: 'Procurement', shortLabel: 'Procure', description: 'Material procurement' },
  { id: 'dispatch', projectStage: 'Dispatch', title: 'Dispatch', shortLabel: 'Dispatch', description: 'Material movement' },
  { id: 'installation', projectStage: 'Installation', title: 'Installation', shortLabel: 'Install', description: 'On-site execution' },
  { id: 'qc', projectStage: 'QC', title: 'Quality Check', shortLabel: 'QC', description: 'Installation quality gate' },
  { id: 'commissioning', projectStage: 'Commissioning', title: 'Commissioning', shortLabel: 'Commission', description: 'Plant commissioning' },
  { id: 'net-metering', projectStage: 'NetMetering', title: 'Net Metering', shortLabel: 'Net Meter', description: 'DISCOM application' },
  { id: 'subsidy', projectStage: 'Subsidy', title: 'Subsidy', shortLabel: 'Subsidy', description: 'Government subsidy application' },
  { id: 'handover', projectStage: 'Handover', title: 'Handover', shortLabel: 'Handover', description: 'Customer handover package' },
  { id: 'amc', projectStage: 'AMC', title: 'AMC / Service', shortLabel: 'AMC', description: 'Post-handover service' },
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
  if (stage === 'Procurement') return `/projects/${projectId}`;
  if (stage === 'Dispatch') return `/projects/${projectId}`;
  if (stage === 'Installation') return `/projects/${projectId}`;
  if (stage === 'QC') return `/projects/${projectId}`;
  if (stage === 'Commissioning') return `/projects/${projectId}`;
  if (stage === 'NetMetering') return `/projects/${projectId}`;
  if (stage === 'Subsidy') return `/projects/${projectId}`;
  if (stage === 'Handover') return `/projects/${projectId}`;
  if (stage === 'AMC') return `/projects/${projectId}`;
  return undefined;
}

export function resolveProjectWorkspaceStages(project: ProjectRecord): ProjectWorkspaceStage[] {
  // Phase 5: compared via the canonical stage order (projectStageIndex), not
  // position within this component's own 13-item LIFECYCLE subset — the two
  // scales aren't interchangeable (e.g. 'AMC' is last in LIFECYCLE but not
  // last in the real 17-stage lifecycle), so both sides of every comparison
  // must resolve through the same canonical index.
  const currentCanonicalIndex = projectStageIndex(project.currentStage);
  const completedStages = new Set((project.stageHistory || []).map((entry) => entry.stage));
  const archived = project.currentStage === 'Archived';

  return LIFECYCLE.map((stage) => {
    let status: StageCardStatus = 'upcoming';
    if (archived || completedStages.has(stage.projectStage) || projectStageIndex(stage.projectStage) < currentCanonicalIndex) status = 'completed';
    if (!archived && stage.projectStage === project.currentStage) status = 'current';
    if (!archived && (project.currentStage === 'NetMetering' || project.currentStage === 'Subsidy')
      && (stage.projectStage === 'NetMetering' || stage.projectStage === 'Subsidy')
      && stage.projectStage !== project.currentStage
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
