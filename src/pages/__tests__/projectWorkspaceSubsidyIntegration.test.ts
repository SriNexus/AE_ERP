/**
 * projectWorkspaceSubsidyIntegration.test.ts — Subsidy Workspace Migration
 * (Stage 12 — Subsidy card gets a real operational workspace; the subsidy
 * detail modal AND its disbursement modal on the Subsidy list page are
 * retired; the workspace runs the existing subsidy_applications workflow
 * through the canonical lib/subsidyWorkflow services and their hook
 * wrappers).
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: STAGE_WORKSPACES registers the Subsidy
 * workspace, the workspace reuses the EXISTING useCreateSubsidy /
 * useTransitionSubsidy / useRecordDisbursement hooks (→
 * createSubsidyApplication / transitionSubsidyStatus / recordDisbursement —
 * the same canonical services the list page and mobile workspace call), the
 * Subsidy stage advance stays exclusively in the canonical
 * buildProjectStageAdvancePatch flow (createSubsidyApplication advances to
 * Subsidy; handover itself is gated on stage >= Subsidy elsewhere — the
 * workspace never mutates the project record), the append-only immutable
 * disbursement ledger is surfaced through recordDisbursement, the workspace
 * performs no inventory mutation and no B2C serial/barcode capture
 * (read-oriented compliance/financial process), the retired modals'
 * invocation paths are gone or rewired, the stage engine's "Open in full
 * workspace" target now points at the Project itself, and the workspace
 * carries no generic project context (Notes/Documents/Activity/Linked
 * Records stay at the Project Workspace level — the real application.notes
 * field appears under "Application Notes" and the real documentsSubmitted
 * field under "Submitted Documents", both genuine Subsidy domain data, not
 * generic panels).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const subsidyWorkspace = read('../../features/projects/components/workspace/stages/ProjectSubsidyWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageEngine = read('../../hooks/useProjectStage.ts');
const notificationRoutes = read('../../lib/notificationRoutes.ts');
const subsidyListPage = read('../Subsidy.tsx');
const subsidyWorkflowSrc = read('../../lib/subsidyWorkflow.ts');
const firestoreSrc = read('../../lib/firestore.ts');

describe('Subsidy stage — registered operational workspace (Stage 12)', () => {
  it('STAGE_WORKSPACES registers the subsidy workspace', () => {
    expect(stageRegistry).toContain('subsidy: ProjectSubsidyWorkspace');
  });

  it('ProjectWorkOnThisProject mounts it through the shared ProjectStageCard shell and gives the card a real-data collapsed summary', () => {
    expect(workOnThisProject).toContain('const StageWorkspace = STAGE_WORKSPACES[stage.id]');
    expect(workOnThisProject).toContain("stage.id === 'net-metering' ? netMeteringCardSummary : stage.id === 'subsidy' ? subsidyCardSummary : stage.id === 'handover' ? handoverCardSummary : stage.id === 'amc' ? amcCardSummary : undefined");
    expect(workOnThisProject).toContain('function useSubsidyCardSummary(projectId: string)');
    expect(workOnThisProject).toContain('queryKeys.forCompany(activeCompanyId).subsidyAll');
  });
});

describe('Subsidy workspace reuses the existing subsidy_applications system verbatim (no parallel implementation)', () => {
  it('reads applications with the SAME query key the Subsidy list page uses — no second fetch or parallel entity', () => {
    expect(subsidyWorkspace).toContain('queryKey: keys.subsidyAll');
    expect(subsidyWorkspace).toContain('getAll(COLLECTIONS.SUBSIDY_APPLICATIONS)');
    expect(subsidyWorkspace).toContain('app.projectId === project.id && !app.isDeleted');
  });

  it('creation, status changes and disbursements go through the canonical hook wrappers the list page + mobile use (useCreateSubsidy / useTransitionSubsidy / useRecordDisbursement), never a reimplementation', () => {
    expect(subsidyWorkspace).toContain("import {\n  useCreateSubsidy, useTransitionSubsidy, useRecordDisbursement,\n} from '../../../../subsidy/hooks/useSubsidy'");
    expect(subsidyWorkspace).toContain('const createMutation = useCreateSubsidy();');
    expect(subsidyWorkspace).toContain('const transitionMutation = useTransitionSubsidy();');
    expect(subsidyWorkspace).toContain('const disburseMutation = useRecordDisbursement();');
    // canonical services stay the source of truth in lib/subsidyWorkflow
    expect(subsidyWorkflowSrc).toContain('export async function createSubsidyApplication');
    expect(subsidyWorkflowSrc).toContain('export async function transitionSubsidyStatus');
    expect(subsidyWorkflowSrc).toContain('export async function recordDisbursement');
    expect(subsidyWorkflowSrc).toContain('export function isValidTransition');
  });

  it('the canonical engine owns the lifecycle — stage guard via isProjectStageAtOrPast on create, VALID_TRANSITIONS map, and the Subsidy stage advance happens inside createSubsidyApplication via the forward-only buildProjectStageAdvancePatch; the workspace never mutates the project record directly', () => {
    expect(subsidyWorkflowSrc).toContain('isProjectStageAtOrPast(project.currentStage, \'NetMetering\')');
    expect(subsidyWorkflowSrc).toContain('VALID_TRANSITIONS');
    expect(subsidyWorkflowSrc).toContain("buildProjectStageAdvancePatch(project, 'Subsidy',");
    expect(subsidyWorkspace).not.toContain('updateDocById(COLLECTIONS.PROJECTS');
    expect(subsidyWorkspace).not.toMatch(/currentStage:\s*'/);
    expect(subsidyWorkspace).not.toMatch(/stageHistory:\s*\[/);
  });

  it('the disbursement ledger is surfaced through the canonical append-only recordDisbursement (positive amount guard; approved-only guard; auto-transition to Disbursed)', () => {
    expect(subsidyWorkflowSrc).toContain("if (app.status !== 'Approved' && app.status !== 'Disbursed')");
    expect(subsidyWorkflowSrc).toContain("if (input.amount <= 0) throw new Error('Disbursement amount must be positive');");
    expect(subsidyWorkflowSrc).toContain('disbursements: [...previousDisbursements, entry]');
    expect(subsidyWorkspace).toContain('Record Disbursement');
    expect(subsidyWorkspace).toContain('Disbursement Ledger');
    expect(subsidyWorkspace).toContain('Immutable ledger');
  });

  it('the workspace uses the SHARED fmtDateSafe helper from lib/firestore instead of a fourth local copy', () => {
    expect(subsidyWorkspace).toContain("fmtDateSafe } from '../../../../../lib/firestore'");
    expect(firestoreSrc).toContain('export function fmtDateSafe');
    expect(subsidyWorkspace).not.toMatch(/function fmtDateSafe/);
  });

  it('Subsidy performs NO inventory mutation and no B2C serial/barcode capture — it is a compliance/financial government process; dispatch already issued the stock and tracking lives in Dispatch/Installation/QC records', () => {
    expect(subsidyWorkspace).not.toContain('stockOut');
    expect(subsidyWorkspace).not.toContain('writeBatch');
    expect(subsidyWorkspace).not.toContain('increment(');
    expect(subsidyWorkspace).not.toContain('STOCK_LEDGER');
    expect(subsidyWorkspace).not.toContain('captureInstallationSerial');
    expect(subsidyWorkspace).not.toContain('Math.random');
    expect(subsidyWorkspace).not.toContain("'SN-'");
  });
});

describe('Generic project context stays at the Project Workspace level — the Subsidy stage workspace carries no Notes/Activity/Documents/Linked Records sections', () => {
  it('the embedded Subsidy workspace has no Activity / Activity Feed / ActivityTimeline section', () => {
    expect(subsidyWorkspace).not.toContain('ActivityTimeline');
    expect(subsidyWorkspace).not.toContain('Activity Feed');
    expect(subsidyWorkspace).not.toMatch(/<FormSection title="Activity"/);
  });

  it('the embedded Subsidy workspace has no generic Notes/Documents/Linked Records/History/Tasks FormSection — the real application.notes field appears under "Application Notes" and the real documentsSubmitted field under "Submitted Documents" (genuine Subsidy domain data)', () => {
    expect(subsidyWorkspace).not.toMatch(/<FormSection title="(Notes|Documents|Activity|Linked Records|History|Tasks)"/);
    expect(subsidyWorkspace).toContain('<FormSection title="Application Notes">');
    expect(subsidyWorkspace).toContain('<FormSection title="Submitted Documents">');
  });

  it('the Project Workspace still owns the single authoritative context layer — Documents/Activity/Linked Records via ProjectWorkspaceSections', () => {
    const sections = read('../../features/projects/components/workspace/ProjectWorkspaceSections.tsx');
    expect(sections).toContain('label="Documents"');
    expect(sections).toContain('title="Activity"');
    expect(sections).toContain('Linked Records');
  });
});

describe('Old standalone Subsidy detail + disbursement modals — retired, invocation paths rewired', () => {
  it('the list page no longer mounts the detail or disbursement modals (no viewItem, no detailTab, no openDetails/handleTransition/transitionsForStatus, no showDisburseForm, no modal-only helpers)', () => {
    expect(subsidyListPage).not.toContain('viewItem');
    expect(subsidyListPage).not.toContain('setViewItem');
    expect(subsidyListPage).not.toContain('detailTab');
    expect(subsidyListPage).not.toContain('openDetails');
    expect(subsidyListPage).not.toContain('handleTransition');
    expect(subsidyListPage).not.toContain('transitionsForStatus');
    expect(subsidyListPage).not.toContain('showDisburseForm');
    expect(subsidyListPage).not.toContain('formatCreatedDate');
    expect(subsidyListPage).not.toContain("'/projects?open='");
  });

  it('row click / View navigate to the /subsidy/:id record workspace page', () => {
    expect(subsidyListPage).toContain("navigate(`/subsidy/${encodeURIComponent(app.id)}`)");
    expect(subsidyListPage).toContain('function openRecord(app: SubsidyApplication)');
  });

  it('the list page keeps its full list functionality — search, filters, KPIs, pagination, create modal, bulk status/delete and CSV export all remain', () => {
    expect(subsidyListPage).toContain('showForm');
    expect(subsidyListPage).toContain('createMutation.mutate(');
    expect(subsidyListPage).toContain('KPI_TILES');
    expect(subsidyListPage).toContain('bulkStatusMutation');
    expect(subsidyListPage).toContain('bulkDeleteMutation');
    expect(subsidyListPage).toContain('downloadCsv');
    expect(subsidyListPage).toContain('deleteDocById(COLLECTIONS.SUBSIDY_APPLICATIONS, id)');
  });

  it('Subsidy notifications open the /subsidy/:id record page, not ?open=', () => {
    expect(notificationRoutes).toContain("`/subsidy/${encodeURIComponent(entityId)}`");
    expect(notificationRoutes).not.toContain("'/subsidy?open='");
  });

  it('the search engine links Subsidy applications to the /subsidy/:id page (unchanged)', () => {
    const searchEngine = read('../../engines/WorkspaceSearchEngine.ts');
    expect(searchEngine).toContain("`/subsidy/${encodeURIComponent(doc.id)}`");
  });

  it('the stage engine href for Subsidy points at the Project (the workspace lives inside the Project Workspace), like Quotation/Order/Procurement/Dispatch/Installation/QC/Commissioning/Net Metering', () => {
    expect(stageEngine).toContain("if (stage === 'Subsidy') return `/projects/${projectId}`;");
  });
});
