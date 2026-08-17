/**
 * projectWorkspaceNetMeteringIntegration.test.ts — Net Metering Workspace
 * Migration (Stage 11 — Net Metering card gets a real operational workspace;
 * the net metering detail modal on the Net Metering list page is retired;
 * the workspace runs the existing net_metering_applications workflow through
 * the canonical lib/netMeteringWorkflow services and their hook wrappers).
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: STAGE_WORKSPACES registers the Net
 * Metering workspace, the workspace reuses the EXISTING
 * useCreateNetMetering / useTransitionNetMetering hooks (→
 * createNetMeteringApplication / transitionNetMeteringStatus — the same
 * canonical services the list page and mobile workspace call), the
 * MeterInstalled transition advances the project to the Subsidy stage via
 * the canonical buildProjectStageAdvancePatch (never duplicated), the
 * workspace performs no inventory mutation and no B2C serial/barcode capture
 * (read-oriented: tracking traceability lives in the Dispatch/Installation/
 * QC records), the retired popup's invocation paths are gone or rewired, the
 * stage engine's "Open in full workspace" target now points at the Project
 * itself, and the workspace carries no generic project context (Notes/
 * Documents/Activity/Linked Records stay at the Project Workspace level —
 * the real application.notes domain field is shown under "Application
 * Notes", not a generic Notes panel).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const netMeteringWorkspace = read('../../features/projects/components/workspace/stages/ProjectNetMeteringWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageEngine = read('../../hooks/useProjectStage.ts');
const notificationRoutes = read('../../lib/notificationRoutes.ts');
const netMeteringListPage = read('../NetMetering.tsx');
const netMeteringWorkflowSrc = read('../../lib/netMeteringWorkflow.ts');

describe('Net Metering stage — registered operational workspace (Stage 11)', () => {
  it('STAGE_WORKSPACES registers the net-metering workspace', () => {
    expect(stageRegistry).toContain("'net-metering': ProjectNetMeteringWorkspace");
  });

  it('ProjectWorkOnThisProject mounts it through the shared ProjectStageCard shell and gives the card a real-data collapsed summary', () => {
    expect(workOnThisProject).toContain('const StageWorkspace = STAGE_WORKSPACES[stage.id]');
    expect(workOnThisProject).toContain("stage.id === 'commissioning' ? commissioningCardSummary : stage.id === 'net-metering' ? netMeteringCardSummary : stage.id === 'subsidy' ? subsidyCardSummary : stage.id === 'handover' ? handoverCardSummary : stage.id === 'amc' ? amcCardSummary : undefined");
    expect(workOnThisProject).toContain('function useNetMeteringCardSummary(projectId: string)');
    expect(workOnThisProject).toContain('queryKeys.forCompany(activeCompanyId).netMeteringAll');
  });
});

describe('Net Metering workspace reuses the existing net_metering_applications system verbatim (no parallel implementation)', () => {
  it('reads applications with the SAME query key the Net Metering list page uses — no second fetch or parallel entity', () => {
    expect(netMeteringWorkspace).toContain('queryKey: keys.netMeteringAll');
    expect(netMeteringWorkspace).toContain('getAll(COLLECTIONS.NET_METERING_APPLICATIONS)');
    expect(netMeteringWorkspace).toContain('app.projectId === project.id && !app.isDeleted');
  });

  it('creation and status changes go through the canonical hook wrappers the list page + mobile use (useCreateNetMetering / useTransitionNetMetering), never a reimplementation', () => {
    expect(netMeteringWorkspace).toContain("import {\n  useCreateNetMetering, useTransitionNetMetering,\n} from '../../../../net-metering/hooks/useNetMetering'");
    expect(netMeteringWorkspace).toContain('const createMutation = useCreateNetMetering();');
    expect(netMeteringWorkspace).toContain('const transitionMutation = useTransitionNetMetering();');
    // canonical services stay the source of truth in lib/netMeteringWorkflow
    expect(netMeteringWorkflowSrc).toContain('export async function createNetMeteringApplication');
    expect(netMeteringWorkflowSrc).toContain('export async function transitionNetMeteringStatus');
    expect(netMeteringWorkflowSrc).toContain('export function isValidTransition');
  });

  it('the canonical engine owns the lifecycle — stage guard via isProjectStageAtOrPast on create, VALID_TRANSITIONS map, and MeterInstalled advances to Subsidy via the forward-only buildProjectStageAdvancePatch; the workspace never mutates the project record directly', () => {
    expect(netMeteringWorkflowSrc).toContain('isProjectStageAtOrPast(project.currentStage, \'NetMetering\')');
    expect(netMeteringWorkflowSrc).toContain('VALID_TRANSITIONS');
    expect(netMeteringWorkflowSrc).toContain("buildProjectStageAdvancePatch(project, 'Subsidy',");
    expect(netMeteringWorkspace).not.toContain('updateDocById(COLLECTIONS.PROJECTS');
    expect(netMeteringWorkspace).not.toMatch(/currentStage:\s*'/);
    expect(netMeteringWorkspace).not.toMatch(/stageHistory:\s*\[/);
  });

  it('Net Metering performs NO inventory mutation and no B2C serial/barcode capture — it is a read-oriented DISCOM compliance track; dispatch already issued the stock and tracking lives in Dispatch/Installation/QC records', () => {
    expect(netMeteringWorkspace).not.toContain('stockOut');
    expect(netMeteringWorkspace).not.toContain('writeBatch');
    expect(netMeteringWorkspace).not.toContain('increment(');
    expect(netMeteringWorkspace).not.toContain('STOCK_LEDGER');
    expect(netMeteringWorkspace).not.toContain('captureInstallationSerial');
    expect(netMeteringWorkspace).not.toContain('Math.random');
    expect(netMeteringWorkspace).not.toContain("'SN-'");
  });

  it('the workspace surfaces the real application data — DISCOM, application number, status dates, rejection reason, the application\'s own statusHistory timeline, and the shared transition action', () => {
    expect(netMeteringWorkspace).toContain('{app.discomName}');
    expect(netMeteringWorkspace).toContain('{app.applicationNumber}');
    expect(netMeteringWorkspace).toContain('app.rejectionReason');
    expect(netMeteringWorkspace).toContain('app.statusHistory');
    expect(netMeteringWorkspace).toContain('<FormSection title="Status Timeline">');
    expect(netMeteringWorkspace).toContain('transitionMutation.mutate({ id: app.id, status: next');
  });
});

describe('Generic project context stays at the Project Workspace level — the Net Metering stage workspace carries no Notes/Activity/Documents/Linked Records sections', () => {
  it('the embedded Net Metering workspace has no Activity / Activity Feed / ActivityTimeline section', () => {
    expect(netMeteringWorkspace).not.toContain('ActivityTimeline');
    expect(netMeteringWorkspace).not.toContain('Activity Feed');
    expect(netMeteringWorkspace).not.toMatch(/<FormSection title="Activity"/);
  });

  it('the embedded Net Metering workspace has no generic Notes/Documents/Linked Records/History/Tasks FormSection — the real application.notes domain field appears only under the domain-specific "Application Notes" title', () => {
    expect(netMeteringWorkspace).not.toMatch(/<FormSection title="(Notes|Documents|Activity|Linked Records|History|Tasks)"/);
    expect(netMeteringWorkspace).toContain('<FormSection title="Application Notes">');
  });

  it('the Project Workspace still owns the single authoritative context layer — Documents/Activity/Linked Records via ProjectWorkspaceSections', () => {
    const sections = read('../../features/projects/components/workspace/ProjectWorkspaceSections.tsx');
    expect(sections).toContain('label="Documents"');
    expect(sections).toContain('title="Activity"');
    expect(sections).toContain('Linked Records');
  });
});

describe('Old standalone Net Metering detail modal — retired, invocation paths rewired', () => {
  it('the list page no longer mounts the detail modal (no viewItem, no detailTab, no openDetails/handleTransition/transitionsForStatus, no modal-only helpers)', () => {
    expect(netMeteringListPage).not.toContain('viewItem');
    expect(netMeteringListPage).not.toContain('setViewItem');
    expect(netMeteringListPage).not.toContain('detailTab');
    expect(netMeteringListPage).not.toContain('openDetails');
    expect(netMeteringListPage).not.toContain('handleTransition');
    expect(netMeteringListPage).not.toContain('transitionsForStatus');
    expect(netMeteringListPage).not.toContain('formatCreatedDate');
    expect(netMeteringListPage).not.toContain("'/projects?open='");
  });

  it('row click / View navigate to the /net-metering/:id record workspace page', () => {
    expect(netMeteringListPage).toContain("navigate(`/net-metering/${encodeURIComponent(app.id)}`)");
    expect(netMeteringListPage).toContain('function openRecord(app: NetMeteringApplication)');
  });

  it('the list page keeps its full list functionality — search, filters, KPIs, pagination, create modal, bulk status/delete and CSV export all remain', () => {
    expect(netMeteringListPage).toContain('showForm');
    expect(netMeteringListPage).toContain('createMutation.mutate(');
    expect(netMeteringListPage).toContain('KPI_TILES');
    expect(netMeteringListPage).toContain('bulkStatusMutation');
    expect(netMeteringListPage).toContain('bulkDeleteMutation');
    expect(netMeteringListPage).toContain('downloadCsv');
    expect(netMeteringListPage).toContain('deleteDocById(COLLECTIONS.NET_METERING_APPLICATIONS, id)');
  });

  it('Net Metering notifications open the /net-metering/:id record page, not ?open=', () => {
    expect(notificationRoutes).toContain("`/net-metering/${encodeURIComponent(entityId)}`");
    expect(notificationRoutes).not.toContain("'/net-metering?open='");
  });

  it('the search engine links Net Metering applications to the /net-metering/:id page (unchanged)', () => {
    const searchEngine = read('../../engines/WorkspaceSearchEngine.ts');
    expect(searchEngine).toContain("`/net-metering/${encodeURIComponent(doc.id)}`");
  });

  it('the stage engine href for Net Metering points at the Project (the workspace lives inside the Project Workspace), like Quotation/Order/Procurement/Dispatch/Installation/QC/Commissioning', () => {
    expect(stageEngine).toContain("if (stage === 'NetMetering') return `/projects/${projectId}`;");
  });
});
