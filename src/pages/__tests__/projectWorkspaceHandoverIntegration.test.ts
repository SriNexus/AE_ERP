/**
 * projectWorkspaceHandoverIntegration.test.ts — Handover Workspace Migration
 * (Stage 13 — Handover card gets a real operational workspace; the handover
 * detail modal on the Project Handover list page is retired; the workspace
 * runs the existing project_handovers workflow through the canonical
 * lib/projectHandoverWorkflow services and their hook wrappers).
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: STAGE_WORKSPACES registers the Handover
 * workspace, the workspace reuses the EXISTING useCreateHandover /
 * useTransitionHandover hooks (→ createHandover /
 * transitionHandoverStatus — the same canonical services the list page and
 * mobile workspace call), the Handover stage advance stays exclusively in
 * the canonical advanceProjectStage flow (createHandover guards
 * isProjectStageAtOrPast('Subsidy') and advances to Handover; the
 * Handover → AMC/Service transition is gated on stage >= Handover elsewhere
 * via amcWorkflow.createAmcContract — the workspace never mutates the
 * project record), the workspace performs no inventory mutation and no B2C
 * serial/barcode capture (read-oriented final delivery stage — the material
 * was already issued at Dispatch and verified through Installation/QC), the
 * retired modal's invocation paths are gone or rewired, the stage engine's
 * "Open in full workspace" target now points at the Project itself, and the
 * workspace carries no generic project context (Notes/Documents/Activity/
 * Linked Records stay at the Project Workspace level — the real handover
 * notes field appears under "Handover Notes", genuine Handover domain data,
 * not a generic Notes panel).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const handoverWorkspace = read('../../features/projects/components/workspace/stages/ProjectHandoverWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageEngine = read('../../hooks/useProjectStage.ts');
const notificationRoutes = read('../../lib/notificationRoutes.ts');
const handoverListPage = read('../ProjectHandover.tsx');
const handoverWorkflowSrc = read('../../lib/projectHandoverWorkflow.ts');

describe('Handover stage — registered operational workspace (Stage 13)', () => {
  it('STAGE_WORKSPACES registers the handover workspace', () => {
    expect(stageRegistry).toContain('handover: ProjectHandoverWorkspace');
  });

  it('ProjectWorkOnThisProject mounts it through the shared ProjectStageCard shell and gives the card a real-data collapsed summary', () => {
    expect(workOnThisProject).toContain('const StageWorkspace = STAGE_WORKSPACES[stage.id]');
    expect(workOnThisProject).toContain("stage.id === 'subsidy' ? subsidyCardSummary : stage.id === 'handover' ? handoverCardSummary : stage.id === 'amc' ? amcCardSummary : undefined");
    expect(workOnThisProject).toContain('function useHandoverCardSummary(projectId: string)');
    expect(workOnThisProject).toContain('queryKeys.forCompany(activeCompanyId).projectHandovers');
  });
});

describe('Handover workspace reuses the existing project_handovers system verbatim (no parallel implementation)', () => {
  it('reads handover records with the SAME query key the Project Handover list page uses — no second fetch or parallel entity', () => {
    expect(handoverWorkspace).toContain('queryKey: keys.projectHandovers');
    expect(handoverWorkspace).toContain('getAll(COLLECTIONS.PROJECT_HANDOVERS)');
    expect(handoverWorkspace).toContain('h.projectId === project.id && !h.isDeleted');
  });

  it('creation and status changes go through the canonical hook wrappers the list page + mobile use (useCreateHandover / useTransitionHandover), never a reimplementation', () => {
    expect(handoverWorkspace).toContain('useCreateHandover, useTransitionHandover');
    expect(handoverWorkspace).toContain('const createMutation = useCreateHandover();');
    expect(handoverWorkspace).toContain('const transitionMutation = useTransitionHandover();');
    // canonical services stay the source of truth in lib/projectHandoverWorkflow
    expect(handoverWorkflowSrc).toContain('export async function createHandover');
    expect(handoverWorkflowSrc).toContain('export async function transitionHandoverStatus');
    expect(handoverWorkflowSrc).toContain('export function isValidTransition');
  });

  it('the canonical engine owns the lifecycle — Subsidy-stage guard via isProjectStageAtOrPast on create, VALID_TRANSITIONS map, and the Handover stage advance happens inside createHandover via the canonical advanceProjectStage; the workspace never mutates the project record directly', () => {
    expect(handoverWorkflowSrc).toContain("isProjectStageAtOrPast(project.currentStage, 'Subsidy')");
    expect(handoverWorkflowSrc).toContain('VALID_TRANSITIONS');
    expect(handoverWorkflowSrc).toContain("advanceProjectStage(input.projectId, 'Handover',");
    expect(handoverWorkspace).not.toContain('updateDocById(COLLECTIONS.PROJECTS');
    expect(handoverWorkspace).not.toMatch(/currentStage:\s*'/);
    expect(handoverWorkspace).not.toMatch(/stageHistory:\s*\[/);
  });

  it('the workspace surfaces the real Handover fields (customer, project, handover date, scheduled date, engineer, completed date, cancellation reason), operational Draft → Scheduled → Completed / Cancelled actions, and the record\'s own status timeline', () => {
    expect(handoverWorkspace).toContain('Handover Overview');
    expect(handoverWorkspace).toContain('record.customerName');
    expect(handoverWorkspace).toContain('record.handoverNumber');
    expect(handoverWorkspace).toContain('Schedule Handover');
    expect(handoverWorkspace).toContain('Complete Handover');
    expect(handoverWorkspace).toContain('Cancel Handover');
    expect(handoverWorkspace).toContain('Status Timeline');
    expect(handoverWorkspace).toContain('record.statusHistory');
  });

  it('a Cancelled handover is a real domain outcome — the workspace surfaces the cancellation reason AND re-opens the create form (the canonical createHandover guards only duplicate OPEN records, so a fresh record can be filed after cancellation)', () => {
    expect(handoverWorkspace).toContain('record.cancellationReason');
    expect(handoverWorkspace).toContain('A fresh handover can be created for this project once the open record is resolved.');
    expect(handoverWorkspace).toContain("(!latest || latest.status === 'Cancelled') && <HandoverCreateForm project={project} />");
  });

  it('Handover performs NO inventory mutation and no B2C serial/barcode capture — it is the final customer/project delivery stage; the material was already issued at Dispatch and verified through Installation/QC', () => {
    expect(handoverWorkspace).not.toContain('stockOut');
    expect(handoverWorkspace).not.toContain('writeBatch');
    expect(handoverWorkspace).not.toContain('increment(');
    expect(handoverWorkspace).not.toContain('STOCK_LEDGER');
    expect(handoverWorkspace).not.toContain('serialNumber');
    expect(handoverWorkspace).not.toContain('Math.random');
    expect(handoverWorkspace).not.toContain("'SN-'");
  });
});

describe('Generic project context stays at the Project Workspace level — the Handover stage workspace carries no Notes/Activity/Documents/Linked Records sections', () => {
  it('the embedded Handover workspace has no Activity / Activity Feed / ActivityTimeline section', () => {
    expect(handoverWorkspace).not.toContain('ActivityTimeline');
    expect(handoverWorkspace).not.toContain('Activity Feed');
    expect(handoverWorkspace).not.toMatch(/<FormSection title="Activity"/);
  });

  it('the embedded Handover workspace has no generic Notes/Documents/Linked Records/History/Tasks FormSection — the real handover notes field appears under "Handover Notes" (genuine Handover domain data, not a generic panel)', () => {
    expect(handoverWorkspace).not.toMatch(/<FormSection title="(Notes|Documents|Activity|Linked Records|History|Tasks)"/);
    expect(handoverWorkspace).toContain('<FormSection title="Handover Notes">');
  });

  it('the Project Workspace still owns the single authoritative context layer — Documents/Activity/Linked Records via ProjectWorkspaceSections', () => {
    const sections = read('../../features/projects/components/workspace/ProjectWorkspaceSections.tsx');
    expect(sections).toContain('label="Documents"');
    expect(sections).toContain('title="Activity"');
    expect(sections).toContain('Linked Records');
  });
});

describe('Old standalone Handover detail modal — retired, invocation paths rewired', () => {
  it('the list page no longer mounts the detail modal (no viewItem, no setViewItem, no handleTransition, no modal-only helpers, no prompt()-based transitions)', () => {
    expect(handoverListPage).not.toContain('viewItem');
    expect(handoverListPage).not.toContain('setViewItem');
    expect(handoverListPage).not.toContain('handleTransition');
    expect(handoverListPage).not.toContain('useTransitionHandover');
    expect(handoverListPage).not.toContain('isValidTransition');
    expect(handoverListPage).not.toContain("'/handovers?open='");
  });

  it('row click / View navigate to the /handovers/:id record workspace page', () => {
    expect(handoverListPage).toContain("navigate(`/handovers/${encodeURIComponent(record.id)}`)");
    expect(handoverListPage).toContain("navigate(`/handovers/${encodeURIComponent(h.id)}`)");
  });

  it('the list page keeps its full list functionality — search, filters, KPIs, pagination, create modal, bulk assign/delete and CSV export all remain', () => {
    expect(handoverListPage).toContain('showForm');
    expect(handoverListPage).toContain('createMut.mutate(');
    expect(handoverListPage).toContain('bulkAssignMutation');
    expect(handoverListPage).toContain('bulkDeleteMutation');
    expect(handoverListPage).toContain('downloadCsv');
    expect(handoverListPage).toContain('reassignHandoverEngineer');
  });

  it('Handover notifications open the /handovers/:id record page, not ?open=', () => {
    expect(notificationRoutes).toContain("`/handovers/${encodeURIComponent(entityId)}`");
    expect(notificationRoutes).not.toContain("'/handovers?open='");
  });

  it('the stage engine href for Handover points at the Project (the workspace lives inside the Project Workspace), like Quotation/Order/Procurement/Dispatch/Installation/QC/Commissioning/Net Metering/Subsidy', () => {
    expect(stageEngine).toContain("if (stage === 'Handover') return `/projects/${projectId}`;");
  });
});
