import type { ComponentType } from 'react';
import ProjectSchemeRegistrationWorkspace from './ProjectSchemeRegistrationWorkspace';
import ProjectSurveyWorkspace from './ProjectSurveyWorkspace';
import ProjectEngineeringWorkspace from './ProjectEngineeringWorkspace';
import ProjectQuotationWorkspace from './ProjectQuotationWorkspace';
import ProjectOrderWorkspace from './ProjectOrderWorkspace';
import ProjectProcurementWorkspace from './ProjectProcurementWorkspace';
import ProjectDispatchWorkspace from './ProjectDispatchWorkspace';
import ProjectInstallationWorkspace from './ProjectInstallationWorkspace';
import ProjectQCWorkspace from './ProjectQCWorkspace';
import ProjectCommissioningWorkspace from './ProjectCommissioningWorkspace';
import ProjectNetMeteringWorkspace from './ProjectNetMeteringWorkspace';
import ProjectSubsidyWorkspace from './ProjectSubsidyWorkspace';
import ProjectHandoverWorkspace from './ProjectHandoverWorkspace';
import ProjectAmcWorkspace from './ProjectAmcWorkspace';
import type { ProjectStageWorkspaceProps } from './types';

export type { ProjectStageWorkspaceProps };

/**
 * STAGE_WORKSPACES — registry mapping a lifecycle stage's `id` (the same id
 * resolveProjectWorkspaceStages() returns, src/hooks/useProjectStage.ts) to
 * its full operational workspace component.
 *
 * 'survey', 'engineering', 'quotation', 'order', 'procurement', 'dispatch',
 * 'installation', 'qc', 'commissioning', 'net-metering', 'subsidy',
 * 'handover' and 'amc' are implemented (Card 1/2/3/5/6/6/8/9/10/11/12/13/14
 * — the dispatch workspace replaced the retired DispatchManagementModal
 * popup, the installation workspace replaced the retired read-only
 * installation detail modal on the Installations list page, the QC
 * workspace replaced the retired QC detail modal on the Quality Checks list
 * page, the commissioning workspace replaced the retired read-only
 * commissioning detail modal on the Commissioning list page, the
 * net-metering workspace replaced the retired net metering detail modal on
 * the Net Metering list page, the subsidy workspace replaced the retired
 * subsidy detail modal on the Subsidy list page, the handover workspace
 * replaced the retired handover detail modal on the Project Handover list
 * page, and the AMC workspace replaced the retired AMC detail modal on the
 * AMC Contracts list page). Every stage now has a registered operational
 * workspace. A stage with no entry here falls back to
 * ProjectWorkOnThisProject's generic read-only stage detail — never an
 * invented workspace.
 */
export const STAGE_WORKSPACES: Partial<Record<string, ComponentType<ProjectStageWorkspaceProps>>> = {
  // Phase 6: Registration (SchemeRegistration — Vendor Lock / Scheme
  // Registration) is a real in-workspace stage between New and Survey.
  registration: ProjectSchemeRegistrationWorkspace,
  survey: ProjectSurveyWorkspace,
  engineering: ProjectEngineeringWorkspace,
  quotation: ProjectQuotationWorkspace,
  order: ProjectOrderWorkspace,
  procurement: ProjectProcurementWorkspace,
  dispatch: ProjectDispatchWorkspace,
  installation: ProjectInstallationWorkspace,
  qc: ProjectQCWorkspace,
  commissioning: ProjectCommissioningWorkspace,
  'net-metering': ProjectNetMeteringWorkspace,
  subsidy: ProjectSubsidyWorkspace,
  handover: ProjectHandoverWorkspace,
  amc: ProjectAmcWorkspace,
};
