/**
 * projectWorkspaceQCIntegration.test.ts — QC (Quality Check) Workspace
 * Migration (Stage 9 — QC card gets a real operational workspace; the QC
 * detail modal on the Quality Checks list page is retired; the workspace
 * runs the existing qc_checks workflow through the canonical
 * lib/qcWorkflow services).
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: STAGE_WORKSPACES registers the QC
 * workspace, the workspace reuses the EXISTING qcWorkflow services
 * (createQCCheck is the canonical create + advance-to-QC service and is
 * never duplicated; updateQCChecklistItem / submitQCDecision / resetQCCheck
 * drive the pass/fail/rework lifecycle), the B2C tracking rule preserves the
 * real dispatch captured serials/barcodes verbatim and shows skipped
 * tracking as explicitly pending, and completes the capture gap through the
 * REAL installation-engine services (captureInstallationSerial /
 * removeCapturedSerial — lead.capturedSerialNumbers + serial_numbers), with
 * nothing fabricated and B2B/non-tracked products never forced, the retired
 * popup's invocation paths are gone or rewired, the stage engine's "Open in
 * full workspace" target now points at the Project itself, and the
 * workspace carries no generic project context (Notes/Activity/Documents/
 * Linked Records stay at the Project Workspace level).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const qcWorkspace = read('../../features/projects/components/workspace/stages/ProjectQCWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageEngine = read('../../hooks/useProjectStage.ts');
const notificationRoutes = read('../../lib/notificationRoutes.ts');
const qcListPage = read('../QC.tsx');
const qcWorkflowSrc = read('../../lib/qcWorkflow.ts');

describe('QC stage — registered operational workspace (Stage 9)', () => {
  it('STAGE_WORKSPACES registers the qc workspace', () => {
    expect(stageRegistry).toContain('qc: ProjectQCWorkspace');
  });

  it('ProjectWorkOnThisProject mounts it through the shared ProjectStageCard shell and gives the card a real-data collapsed summary', () => {
    expect(workOnThisProject).toContain('const StageWorkspace = STAGE_WORKSPACES[stage.id]');
    expect(workOnThisProject).toContain("stage.id === 'qc' ? qcCardSummary : stage.id === 'commissioning' ? commissioningCardSummary : stage.id === 'net-metering' ? netMeteringCardSummary : stage.id === 'subsidy' ? subsidyCardSummary : stage.id === 'handover' ? handoverCardSummary : stage.id === 'amc' ? amcCardSummary : undefined");
    expect(workOnThisProject).toContain('function useQCCardSummary(projectId: string)');
    expect(workOnThisProject).toContain('queryKeys.forCompany(activeCompanyId).qcChecksAll');
    expect(workOnThisProject).toContain("import { normalizeQCRecord } from '../../../../lib/qcWorkflow'");
  });
});

describe('QC workspace reuses the existing qc_checks system verbatim (no parallel implementation)', () => {
  it('reads QC records with the SAME query key the Quality Checks list page uses — no second fetch or parallel entity', () => {
    expect(qcWorkspace).toContain('queryKey: keys.qcChecksAll');
    expect(qcWorkspace).toContain('getAll(COLLECTIONS.QC_CHECKS)');
    expect(qcWorkspace).toContain('normalizeQCRecord');
    expect(qcWorkspace).toContain('q.projectId === project.id && !q.isDeleted');
  });

  it('every state change goes through the canonical lib/qcWorkflow services — create/checklist/decision/reset — never a reimplementation', () => {
    expect(qcWorkspace).toContain("import {\n  createQCCheck, updateQCChecklistItem, submitQCDecision, resetQCCheck,\n  DEFAULT_QC_CHECKLIST, normalizeQCRecord,\n  type QCRecord, type QCChecklistItem,\n} from '../../../../../lib/qcWorkflow'");
    expect(qcWorkspace).toContain('await createQCCheck({');
    expect(qcWorkspace).toContain('await updateQCChecklistItem(qc.id, index, !checklist[index].passed)');
    expect(qcWorkspace).toContain('await submitQCDecision(qc.id)');
    expect(qcWorkspace).toContain('await resetQCCheck(qc.id)');
    // canonical services stay the source of truth in lib/qcWorkflow
    expect(qcWorkflowSrc).toContain('export async function createQCCheck');
    expect(qcWorkflowSrc).toContain('export async function submitQCDecision');
    expect(qcWorkflowSrc).toContain('export async function updateQCChecklistItem');
    expect(qcWorkflowSrc).toContain('export async function resetQCCheck');
  });

  it('createQCCheck is the only creation path — it guards duplicate open QC checks and advances the Project to QC; the workspace never mutates the project record directly', () => {
    expect(qcWorkflowSrc).toContain('openDuplicate');
    expect(qcWorkflowSrc).toContain('advanceProjectStage(input.projectId, \'QC\',');
    // the workspace never writes the project record itself — the only writes
    // are through the qcWorkflow services (which own the stage transitions)
    expect(qcWorkspace).not.toContain('updateDocById(COLLECTIONS.PROJECTS');
    expect(qcWorkspace).not.toMatch(/currentStage:\s*'/);
    expect(qcWorkspace).not.toMatch(/stageHistory:\s*\[/);
  });

  it('QC performs NO inventory mutation — it verifies installed material; dispatch already issued the stock', () => {
    expect(qcWorkspace).not.toContain('stockOut');
    expect(qcWorkspace).not.toContain('writeBatch');
    expect(qcWorkspace).not.toContain('increment(');
    expect(qcWorkspace).not.toContain('STOCK_LEDGER');
  });
});

describe('B2C serial/barcode rule — real Dispatch tracking preserved, skipped tracking explicitly pending, capture completed through the REAL installation-engine service, nothing fabricated', () => {
  it('shows the REAL dispatch tracking state — captured serials/barcodes verbatim, skipped items explicitly "Pending QC", non-tracked products "Tracking not applicable"', () => {
    expect(qcWorkspace).toContain('Array.isArray(item.serials) ? item.serials.map(String) : []');
    expect(qcWorkspace).toContain('Array.isArray(item.barcodes) ? item.barcodes.map(String) : []');
    expect(qcWorkspace).toContain('Pending QC — not captured at Dispatch');
    expect(qcWorkspace).toContain('Tracking not applicable');
    expect(qcWorkspace).toContain('S ${row.serials.join(\', \')}');
  });

  it('completes the B2C tracking gap by reusing the REAL installation-engine capture services (captureInstallationSerial / removeCapturedSerial → lead.capturedSerialNumbers + serial_numbers), never a new capture mechanism', () => {
    expect(qcWorkspace).toContain("import { isValidInstallation, captureInstallationSerial, removeCapturedSerial } from '../../../../../lib/installationEngine'");
    expect(qcWorkspace).toContain('await captureInstallationSerial(lead.id, serialInput.trim())');
    expect(qcWorkspace).toContain('await removeCapturedSerial(lead.id, index)');
    expect(qcWorkspace).toContain('lead?.capturedSerialNumbers');
    expect(qcWorkspace).toContain('queryKey: keys.leadsAll');
    expect(qcWorkspace).toContain('isValidInstallation(l) && String(l.projectId || \'\') === projectId');
    // the canonical services stay the source of truth in lib/installationEngine
    const engine = read('../../lib/installationEngine.ts');
    expect(engine).toContain('export async function captureInstallationSerial');
    expect(engine).toContain('export async function removeCapturedSerial');
  });

  it('never fabricates serials/barcodes and does not silently convert skipped into captured — the lead field is only ever written by the real service with real user input', () => {
    expect(qcWorkspace).not.toContain('Math.random');
    expect(qcWorkspace).not.toContain("'SN-'");
    expect(qcWorkspace).not.toContain("barcode: '");
    // capture is gated on the linked installation lead (B2C) + capture permission;
    // no lead (B2B) and non-tracked products are never forced
    expect(qcWorkspace).toContain('No linked installation lead');
    expect(qcWorkspace).toContain('disabled={!canCapture}');
  });
});

describe('Generic project context stays at the Project Workspace level — the QC stage workspace carries no Notes/Activity/Documents/Linked Records sections', () => {
  it('the embedded QC workspace has no Activity / Activity Feed / ActivityTimeline section', () => {
    expect(qcWorkspace).not.toContain('ActivityTimeline');
    expect(qcWorkspace).not.toContain('Activity Feed');
    expect(qcWorkspace).not.toMatch(/<FormSection title="Activity"/);
  });

  it('the embedded QC workspace has no generic Notes/Documents/Linked Records/History/Tasks FormSection — only QC-specific operational sections', () => {
    expect(qcWorkspace).not.toMatch(/<FormSection title="(Notes|Documents|Activity|Linked Records|History|Tasks)"/);
    // overallNotes is a real QC domain field displayed under "Overall Remarks",
    // not a generic Notes panel.
    expect(qcWorkspace).toContain('<FormSection title="Overall Remarks">');
  });

  it('the Project Workspace still owns the single authoritative context layer — Documents/Activity/Linked Records via ProjectWorkspaceSections', () => {
    const sections = read('../../features/projects/components/workspace/ProjectWorkspaceSections.tsx');
    expect(sections).toContain('label="Documents"');
    expect(sections).toContain('title="Activity"');
    expect(sections).toContain('Linked Records');
  });
});

describe('Old standalone QC detail modal — retired, invocation paths rewired', () => {
  it('the list page no longer mounts the QC detail modal (no viewQc, no QCChecklistView, no popup-only service imports)', () => {
    expect(qcListPage).not.toContain('viewQc');
    expect(qcListPage).not.toContain('QCChecklistView');
    expect(qcListPage).not.toContain('updateQCChecklistItem');
    expect(qcListPage).not.toContain('submitQCDecision');
    expect(qcListPage).not.toContain('resetQCCheck');
    expect(qcListPage).not.toContain('QC DETAIL MODAL');
  });

  it('row click / ID / View navigate to the /qc/:id record workspace page', () => {
    expect(qcListPage).toContain("navigate(`/qc/${encodeURIComponent(qc?.id || '')}`)");
    expect(qcListPage).toContain('function openQc(qc: QCRecord)');
  });

  it('the list page keeps its full list functionality — search, filters, KPIs, pagination, bulk assign/export/delete and the create modal all remain', () => {
    expect(qcListPage).toContain('showCreate');
    expect(qcListPage).toContain('createQCCheck(');
    expect(qcListPage).toContain('bulkAssignMutation');
    expect(qcListPage).toContain('deleteDocById(COLLECTIONS.QC_CHECKS, id)');
    expect(qcListPage).toContain('downloadQcCsv');
    expect(qcListPage).toContain('KPI_TILES');
  });

  it('QC notifications open the /qc/:id record page, not ?open=', () => {
    expect(notificationRoutes).toContain("`/qc/${encodeURIComponent(entityId)}`");
    expect(notificationRoutes).not.toContain("'/qc?open='");
  });

  it('the stage engine href for QC points at the Project (the workspace lives inside the Project Workspace), like Quotation/Order/Procurement/Dispatch/Installation', () => {
    expect(stageEngine).toContain("if (stage === 'QC') return `/projects/${projectId}`;");
  });
});
