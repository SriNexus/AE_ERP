/**
 * projectWorkspaceCommissioningIntegration.test.ts — Commissioning Workspace
 * Migration (Stage 10 — Commissioning card gets a real operational workspace;
 * the read-only commissioning detail modal on the Commissioning list page is
 * retired; the workspace runs the existing commissioning_records workflow
 * through the canonical lib/commissioningWorkflow services).
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: STAGE_WORKSPACES registers the
 * Commissioning workspace, the workspace reuses the EXISTING
 * createCommissioningRecord service (the single immutable sign-off: validates
 * the project is in the Commissioning stage + passed QC + generation reading
 * > 0 + customer signature, then advances to Net Metering via the canonical
 * buildProjectStageAdvancePatch — never duplicated), the workspace performs
 * no inventory mutation and no B2C serial/barcode capture (read-oriented:
 * tracking traceability lives in the Dispatch/Installation/QC records),
 * the retired popup's invocation paths are gone or rewired, the stage
 * engine's "Open in full workspace" target now points at the Project itself,
 * and the workspace carries no generic project context (Notes/Documents/
 * Activity/Linked Records stay at the Project Workspace level — the real
 * record.notes domain field is shown under "Sign-off Notes", not a generic
 * Notes panel).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const commissioningWorkspace = read('../../features/projects/components/workspace/stages/ProjectCommissioningWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageEngine = read('../../hooks/useProjectStage.ts');
const notificationRoutes = read('../../lib/notificationRoutes.ts');
const commissioningListPage = read('../Commissioning.tsx');
const commissioningWorkflowSrc = read('../../lib/commissioningWorkflow.ts');

describe('Commissioning stage — registered operational workspace (Stage 10)', () => {
  it('STAGE_WORKSPACES registers the commissioning workspace', () => {
    expect(stageRegistry).toContain('commissioning: ProjectCommissioningWorkspace');
  });

  it('ProjectWorkOnThisProject mounts it through the shared ProjectStageCard shell and gives the card a real-data collapsed summary', () => {
    expect(workOnThisProject).toContain('const StageWorkspace = STAGE_WORKSPACES[stage.id]');
    expect(workOnThisProject).toContain("stage.id === 'qc' ? qcCardSummary : stage.id === 'commissioning' ? commissioningCardSummary : stage.id === 'net-metering' ? netMeteringCardSummary : stage.id === 'subsidy' ? subsidyCardSummary : stage.id === 'handover' ? handoverCardSummary : stage.id === 'amc' ? amcCardSummary : undefined");
    expect(workOnThisProject).toContain('function useCommissioningCardSummary(projectId: string)');
    expect(workOnThisProject).toContain('queryKeys.forCompany(activeCompanyId).commissioningRecordsAll');
  });
});

describe('Commissioning workspace reuses the existing commissioning_records system verbatim (no parallel implementation)', () => {
  it('reads commissioning records with the SAME query key the Commissioning list page uses — no second fetch or parallel entity', () => {
    expect(commissioningWorkspace).toContain('queryKey: keys.commissioningRecordsAll');
    expect(commissioningWorkspace).toContain('getAll(COLLECTIONS.COMMISSIONING_RECORDS)');
    expect(commissioningWorkspace).toContain('r.projectId === project.id && !r.isDeleted');
  });

  it('completion uses the canonical createCommissioningRecord — the single immutable sign-off — never a reimplementation', () => {
    expect(commissioningWorkspace).toContain("import { createCommissioningRecord, type CommissioningRecord } from '../../../../../lib/commissioningWorkflow'");
    expect(commissioningWorkspace).toContain('await createCommissioningRecord({');
    // canonical service stays the source of truth in lib/commissioningWorkflow
    expect(commissioningWorkflowSrc).toContain('export async function createCommissioningRecord');
    expect(commissioningWorkflowSrc).toContain('export async function reassignCommissioning');
    expect(commissioningWorkflowSrc).toContain('export async function isProjectCommissioned');
  });

  it('createCommissioningRecord enforces the real business rules — Commissioning-stage guard, passed-QC requirement, generation reading > 0, customer signature, immutable isCompleted record — and advances to Net Metering through the canonical forward-only patch', () => {
    expect(commissioningWorkflowSrc).toContain("if (project.currentStage !== 'Commissioning')");
    expect(commissioningWorkflowSrc).toContain('input.generationTestKwh <= 0');
    expect(commissioningWorkflowSrc).toContain('if (!input.customerSignoffUrl)');
    expect(commissioningWorkflowSrc).toContain('isCompleted: true');
    expect(commissioningWorkflowSrc).toContain("buildProjectStageAdvancePatch(project, 'NetMetering'");
    // the workspace never writes the project record itself — only the
    // commissioningWorkflow service (which owns the stage transition)
    expect(commissioningWorkspace).not.toContain('updateDocById(COLLECTIONS.PROJECTS');
    expect(commissioningWorkspace).not.toMatch(/currentStage:\s*'/);
    expect(commissioningWorkspace).not.toMatch(/stageHistory:\s*\[/);
  });

  it('Commissioning performs NO inventory mutation and no B2C serial/barcode capture — it is a read-oriented sign-off; dispatch already issued the stock and tracking lives in Dispatch/Installation/QC records', () => {
    expect(commissioningWorkspace).not.toContain('stockOut');
    expect(commissioningWorkspace).not.toContain('writeBatch');
    expect(commissioningWorkspace).not.toContain('increment(');
    expect(commissioningWorkspace).not.toContain('STOCK_LEDGER');
    expect(commissioningWorkspace).not.toContain('captureInstallationSerial');
    expect(commissioningWorkspace).not.toContain('Math.random');
    expect(commissioningWorkspace).not.toContain("'SN-'");
  });

  it('the immutable record view surfaces the real sign-off data — generation test, warranty, customer, signature — and the shared SignatureCapture component is used for the sign-off upload', () => {
    expect(commissioningWorkspace).toContain('{record.generationTestKwh} kWh');
    expect(commissioningWorkspace).toContain('record.warrantyMonths');
    expect(commissioningWorkspace).toContain('record.customerName');
    expect(commissioningWorkspace).toContain('record.customerSignoffUrl');
    expect(commissioningWorkspace).toContain("import { SignatureCapture } from '../../../../../components/commissioning/SignatureCapture'");
    expect(commissioningWorkspace).toContain('<SignatureCapture');
  });
});

describe('Generic project context stays at the Project Workspace level — the Commissioning stage workspace carries no Notes/Activity/Documents/Linked Records sections', () => {
  it('the embedded Commissioning workspace has no Activity / Activity Feed / ActivityTimeline section', () => {
    expect(commissioningWorkspace).not.toContain('ActivityTimeline');
    expect(commissioningWorkspace).not.toContain('Activity Feed');
    expect(commissioningWorkspace).not.toMatch(/<FormSection title="Activity"/);
  });

  it('the embedded Commissioning workspace has no generic Notes/Documents/Linked Records/History/Tasks FormSection — the real record.notes domain field appears only under the domain-specific "Sign-off Notes" title', () => {
    expect(commissioningWorkspace).not.toMatch(/<FormSection title="(Notes|Documents|Activity|Linked Records|History|Tasks)"/);
    expect(commissioningWorkspace).toContain('<FormSection title="Sign-off Notes">');
  });

  it('the Project Workspace still owns the single authoritative context layer — Documents/Activity/Linked Records via ProjectWorkspaceSections', () => {
    const sections = read('../../features/projects/components/workspace/ProjectWorkspaceSections.tsx');
    expect(sections).toContain('label="Documents"');
    expect(sections).toContain('title="Activity"');
    expect(sections).toContain('Linked Records');
  });
});

describe('Old standalone Commissioning detail modal — retired, invocation paths rewired', () => {
  it('the list page no longer mounts the detail modal (no viewRecord, no popup-only DETAIL MODAL JSX)', () => {
    expect(commissioningListPage).not.toContain('viewRecord');
    expect(commissioningListPage).not.toContain('DETAIL MODAL');
  });

  it('row click / ID / View navigate to the /commissioning/:id record workspace page', () => {
    expect(commissioningListPage).toContain("navigate(`/commissioning/${encodeURIComponent(record?.id || '')}`)");
  });

  it('the list page keeps its full list functionality — search, filters, KPIs, pagination, bulk assign and the create (sign-off) modal with SignatureCapture all remain', () => {
    expect(commissioningListPage).toContain('showCreate');
    expect(commissioningListPage).toContain('createCommissioningRecord(');
    expect(commissioningListPage).toContain('<SignatureCapture');
    expect(commissioningListPage).toContain('reassignCommissioning');
    expect(commissioningListPage).toContain('KPI_TILES');
  });

  it('Commissioning notifications open the /commissioning/:id record page, not ?open=', () => {
    expect(notificationRoutes).toContain("`/commissioning/${encodeURIComponent(entityId)}`");
    expect(notificationRoutes).not.toContain("'/commissioning?open='");
  });

  it('the search engine links Commissioning records to the /commissioning/:id page (unchanged)', () => {
    const searchEngine = read('../../engines/WorkspaceSearchEngine.ts');
    expect(searchEngine).toContain("`/commissioning/${encodeURIComponent(doc.id)}`");
  });

  it('the stage engine href for Commissioning points at the Project (the workspace lives inside the Project Workspace), like Quotation/Order/Procurement/Dispatch/Installation/QC', () => {
    expect(stageEngine).toContain("if (stage === 'Commissioning') return `/projects/${projectId}`;");
  });
});
