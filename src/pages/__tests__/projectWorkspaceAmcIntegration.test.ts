/**
 * projectWorkspaceAmcIntegration.test.ts — AMC / Service Workspace Migration
 * (Stage 14 — AMC card gets a real operational workspace; the AMC detail
 * modal on the AMC Contracts list page is retired; the workspace runs the
 * existing amc_contracts workflow through the canonical lib/amcWorkflow
 * services and their hook wrappers).
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: STAGE_WORKSPACES registers the AMC
 * workspace, the workspace reuses the EXISTING useCreateAmcContract /
 * useTransitionAmcContract hooks (→ createAmcContract /
 * transitionAmcStatus — the same canonical services the list page and
 * /amc-contracts/:id record workspace call), the AMC stage advance stays
 * exclusively in the canonical advanceProjectStage flow (createAmcContract
 * guards isProjectStageAtOrPast('Handover') and advances to AMC — the
 * workspace never mutates the project record), the workspace performs no
 * inventory mutation and no B2C serial/barcode capture (post-handover
 * maintenance contract — physical traceability stays in Dispatch →
 * Installation → QC), the retired modal's invocation paths are gone or
 * rewired, the stage engine's "Open in full workspace" target now points at
 * the Project itself, and the workspace carries no generic project context
 * (Notes/Documents/Activity/Linked Records stay at the Project Workspace
 * level — the real contract notes field appears under "Contract Notes",
 * genuine AMC domain data, not a generic Notes panel).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const amcWorkspace = read('../../features/projects/components/workspace/stages/ProjectAmcWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageEngine = read('../../hooks/useProjectStage.ts');
const notificationRoutes = read('../../lib/notificationRoutes.ts');
const amcListPage = read('../AmcContracts.tsx');
const amcWorkflowSrc = read('../../lib/amcWorkflow.ts');

describe('AMC stage — registered operational workspace (Stage 14)', () => {
  it('STAGE_WORKSPACES registers the amc workspace', () => {
    expect(stageRegistry).toContain('amc: ProjectAmcWorkspace');
  });

  it('ProjectWorkOnThisProject mounts it through the shared ProjectStageCard shell and gives the card a real-data collapsed summary', () => {
    expect(workOnThisProject).toContain('const StageWorkspace = STAGE_WORKSPACES[stage.id]');
    expect(workOnThisProject).toContain("stage.id === 'handover' ? handoverCardSummary : stage.id === 'amc' ? amcCardSummary : undefined");
    expect(workOnThisProject).toContain('function useAmcCardSummary(projectId: string)');
    expect(workOnThisProject).toContain('queryKeys.forCompany(activeCompanyId).amcContracts');
  });
});

describe('AMC workspace reuses the existing amc_contracts system verbatim (no parallel implementation)', () => {
  it('reads contracts with the SAME query key the AMC Contracts list page uses — no second fetch or parallel entity', () => {
    expect(amcWorkspace).toContain('queryKey: keys.amcContracts');
    expect(amcWorkspace).toContain('getAll(COLLECTIONS.AMC_CONTRACTS)');
    expect(amcWorkspace).toContain('c.projectId === project.id && !c.isDeleted');
  });

  it('creation and status changes go through the canonical hook wrappers the list page + record workspace use (useCreateAmcContract / useTransitionAmcContract), never a reimplementation', () => {
    expect(amcWorkspace).toContain('useCreateAmcContract, useTransitionAmcContract');
    expect(amcWorkspace).toContain('const createMutation = useCreateAmcContract();');
    expect(amcWorkspace).toContain('const transitionMutation = useTransitionAmcContract();');
    // canonical services stay the source of truth in lib/amcWorkflow
    expect(amcWorkflowSrc).toContain('export async function createAmcContract');
    expect(amcWorkflowSrc).toContain('export async function transitionAmcStatus');
    expect(amcWorkflowSrc).toContain('export function isValidTransition');
  });

  it('the canonical engine owns the lifecycle — Handover-stage guard via isProjectStageAtOrPast on create, VALID_TRANSITIONS map, and the AMC stage advance happens inside createAmcContract via the canonical advanceProjectStage; the workspace never mutates the project record directly', () => {
    expect(amcWorkflowSrc).toContain("isProjectStageAtOrPast(project.currentStage, 'Handover')");
    expect(amcWorkflowSrc).toContain('VALID_TRANSITIONS');
    expect(amcWorkflowSrc).toContain("advanceProjectStage(input.projectId, 'AMC',");
    expect(amcWorkspace).not.toContain('updateDocById(COLLECTIONS.PROJECTS');
    expect(amcWorkspace).not.toMatch(/currentStage:\s*'/);
    expect(amcWorkspace).not.toMatch(/stageHistory:\s*\[/);
  });

  it('the workspace surfaces the real contract fields (customer, project, period, value, visits, owner, cancellation reason), operational Draft → Active → Expired / Cancelled actions, and the record\'s own status timeline', () => {
    expect(amcWorkspace).toContain('Contract Overview');
    expect(amcWorkspace).toContain('record.customerName');
    expect(amcWorkspace).toContain('record.contractNumber');
    expect(amcWorkspace).toContain('Activate Contract');
    expect(amcWorkspace).toContain('Mark Expired');
    expect(amcWorkspace).toContain('Cancel Contract');
    expect(amcWorkspace).toContain('Status Timeline');
    expect(amcWorkspace).toContain('record.statusHistory');
  });

  it('a Cancelled or Expired contract is a real domain outcome — the workspace surfaces the cancellation reason AND re-opens the create form (the canonical createAmcContract guards only duplicate OPEN records, and its docs state an Expired or Cancelled contract can be legitimately renewed)', () => {
    expect(amcWorkspace).toContain('record.cancellationReason');
    expect(amcWorkspace).toContain('A fresh AMC contract can be created for this project once the open record is resolved.');
    expect(amcWorkspace).toContain("(!latest || latest.status === 'Cancelled' || latest.status === 'Expired') && <AmcCreateForm project={project} />");
  });

  it('AMC performs NO inventory mutation and no B2C serial/barcode capture — it is a post-handover maintenance contract; physical traceability stays in Dispatch/Installation/QC records', () => {
    expect(amcWorkspace).not.toContain('stockOut');
    expect(amcWorkspace).not.toContain('writeBatch');
    expect(amcWorkspace).not.toContain('increment(');
    expect(amcWorkspace).not.toContain('STOCK_LEDGER');
    expect(amcWorkspace).not.toContain('serialNumber');
    expect(amcWorkspace).not.toContain('Math.random');
    expect(amcWorkspace).not.toContain("'SN-'");
  });
});

describe('Generic project context stays at the Project Workspace level — the AMC stage workspace carries no Notes/Activity/Documents/Linked Records sections', () => {
  it('the embedded AMC workspace has no Activity / Activity Feed / ActivityTimeline section', () => {
    expect(amcWorkspace).not.toContain('ActivityTimeline');
    expect(amcWorkspace).not.toContain('Activity Feed');
    expect(amcWorkspace).not.toMatch(/<FormSection title="Activity"/);
  });

  it('the embedded AMC workspace has no generic Notes/Documents/Linked Records/History/Tasks FormSection — the real contract notes field appears under "Contract Notes" (genuine AMC domain data, not a generic panel)', () => {
    expect(amcWorkspace).not.toMatch(/<FormSection title="(Notes|Documents|Activity|Linked Records|History|Tasks)"/);
    expect(amcWorkspace).toContain('<FormSection title="Contract Notes">');
  });

  it('the Project Workspace still owns the single authoritative context layer — Documents/Activity/Linked Records via ProjectWorkspaceSections', () => {
    const sections = read('../../features/projects/components/workspace/ProjectWorkspaceSections.tsx');
    expect(sections).toContain('label="Documents"');
    expect(sections).toContain('title="Activity"');
    expect(sections).toContain('Linked Records');
  });
});

describe('Old standalone AMC detail modal — retired, invocation paths rewired', () => {
  it('the list page no longer mounts the detail modal (no viewItem, no setViewItem, no detailsTab, no openParam, no closeContractDetails, no prompt()-based handleTransition)', () => {
    expect(amcListPage).not.toContain('viewItem');
    expect(amcListPage).not.toContain('setViewItem');
    expect(amcListPage).not.toContain('detailsTab');
    expect(amcListPage).not.toContain('openParam');
    expect(amcListPage).not.toContain('closeContractDetails');
    expect(amcListPage).not.toContain('openContractDetails');
    expect(amcListPage).not.toContain('handleTransition');
    expect(amcListPage).not.toContain('userClosedRef');
    expect(amcListPage).not.toContain("'/amc-contracts?open='");
  });

  it('row click / View navigate to the /amc-contracts/:id record workspace page', () => {
    expect(amcListPage).toContain("navigate(`/amc-contracts/${encodeURIComponent(c.id)}`)");
  });

  it('the list page keeps its full list functionality — search, filters, KPIs, pagination, create modal, bulk status/assign/delete and CSV export all remain', () => {
    expect(amcListPage).toContain('showForm');
    expect(amcListPage).toContain('createMut.mutateAsync(');
    expect(amcListPage).toContain('bulkStatusMutation');
    expect(amcListPage).toContain('bulkAssignMutation');
    expect(amcListPage).toContain('downloadCsv');
    expect(amcListPage).toContain('reassignAmcContract');
    // bulk status still uses the canonical transition service + validity map
    expect(amcListPage).toContain('useTransitionAmcContract');
    expect(amcListPage).toContain('isValidTransition');
  });

  it('AMC notifications open the /amc-contracts/:id record page, not ?open=', () => {
    expect(notificationRoutes).toContain("`/amc-contracts/${encodeURIComponent(entityId)}`");
    expect(notificationRoutes).not.toContain("'/amc-contracts?open='");
  });

  it('the search engine links AMC contracts to the /amc-contracts/:id page (unchanged)', () => {
    const searchEngine = read('../../engines/WorkspaceSearchEngine.ts');
    expect(searchEngine).toContain("`/amc-contracts/${encodeURIComponent(doc.id)}`");
  });

  it('the stage engine href for AMC points at the Project (the workspace lives inside the Project Workspace), like Quotation/Order/Procurement/Dispatch/Installation/QC/Commissioning/Net Metering/Subsidy/Handover', () => {
    expect(stageEngine).toContain("if (stage === 'AMC') return `/projects/${projectId}`;");
  });
});
