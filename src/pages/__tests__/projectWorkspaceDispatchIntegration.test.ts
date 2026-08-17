/**
 * projectWorkspaceDispatchIntegration.test.ts — Dispatch Workspace Migration
 * (Stage 6 — Dispatch card gets a real operational workspace; the standalone
 * Dispatch management popup is retired; the workspace runs the existing
 * Order → Dispatch → Inventory → Delivery workflow through the canonical
 * lib/dispatchWorkflow services).
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: STAGE_WORKSPACES registers the dispatch
 * workspace, the workspace reuses the EXISTING dispatch/order hooks and
 * DispatchRequestModal (no parallel dispatch logic), every state change goes
 * through the canonical lib/dispatchWorkflow services — executeAndVerifyDispatch
 * is the real inventory-issue service and is never duplicated — the B2C
 * serial/barcode rule preserves real captured values and explicitly marks
 * skipped tracking as pending for QC (no fabricated values), the retired
 * popup's invocation paths are gone or rewired, and the stage engine's "Open
 * in full workspace" target now points at the Project itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const dispatchWorkspace = read('../../features/projects/components/workspace/stages/ProjectDispatchWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageEngine = read('../../hooks/useProjectStage.ts');
const notificationRoutes = read('../../lib/notificationRoutes.ts');
const searchEngine = read('../../engines/WorkspaceSearchEngine.ts');
const dispatchListPage = read('../DispatchWorkspace.tsx');
const dispatchDetailPage = read('../DispatchDetail.tsx');
const dispatchWorkflowSrc = read('../../lib/dispatchWorkflow.ts');

describe('Dispatch stage — registered operational workspace (Stage 6)', () => {
  it('STAGE_WORKSPACES registers the dispatch workspace', () => {
    expect(stageRegistry).toContain('dispatch: ProjectDispatchWorkspace');
  });

  it('ProjectWorkOnThisProject mounts it through the shared ProjectStageCard shell and gives the card a real-data collapsed summary', () => {
    expect(workOnThisProject).toContain('const StageWorkspace = STAGE_WORKSPACES[stage.id]');
    expect(workOnThisProject).toContain("stage.id === 'dispatch' ? dispatchCardSummary : stage.id === 'installation' ? installationCardSummary : stage.id === 'qc' ? qcCardSummary : stage.id === 'commissioning' ? commissioningCardSummary : stage.id === 'net-metering' ? netMeteringCardSummary : stage.id === 'subsidy' ? subsidyCardSummary : stage.id === 'handover' ? handoverCardSummary : stage.id === 'amc' ? amcCardSummary : undefined");
    expect(workOnThisProject).toContain('function useDispatchCardSummary(projectId: string)');
    expect(workOnThisProject).toContain('queryKeys.forCompany(activeCompanyId).dispatchAll');
  });
});

describe('Dispatch workspace reuses the existing Order → Dispatch → Inventory system verbatim (no parallel implementation)', () => {
  it('reads dispatches with the SAME query key the Dispatch list page uses, and the same sales hooks — no second dispatch fetch or parallel business logic', () => {
    expect(dispatchWorkspace).toContain('queryKey: keys.dispatchAll');
    expect(dispatchWorkspace).toContain("import { useOrders, useSalesProducts } from '../../../../sales/hooks/useSales'");
    expect(dispatchWorkspace).toContain("import { DispatchRequestModal } from '../../../../dispatch/components/DispatchRequestModal'");
    expect(dispatchWorkspace).toContain('d.projectId === project.id');
  });

  it('every state change goes through the canonical lib/dispatchWorkflow services — request/approve/execute/confirm/close/integrity — never a reimplementation', () => {
    expect(dispatchWorkspace).toContain("import {\n  approveDispatch, closeDispatch, confirmDelivery, executeAndVerifyDispatch,\n  requestDispatch, validateDispatchIntegrity,\n} from '../../../../../lib/dispatchWorkflow'");
    expect(dispatchWorkspace).toContain('approveDispatch(id)');
    expect(dispatchWorkspace).toContain('executeAndVerifyDispatch(d, vItems)');
    expect(dispatchWorkspace).toContain('confirmDelivery(dispatchId, otp)');
    expect(dispatchWorkspace).toContain('closeDispatch(id)');
    expect(dispatchWorkspace).toContain('validateDispatchIntegrity(id)');
    expect(dispatchWorkspace).toContain('requestDispatch(payload)');
  });

  it('executeAndVerifyDispatch stays the single inventory-issue path — the workspace issues no stock of its own', () => {
    // The domain service is the real stock-issue implementation (validates
    // stock, decrements the stock summary, writes the STOCK_LEDGER OUT
    // movement, updates order dispatched/pending quantities) — the workspace
    // only CALLS it, and never reimplements a stock movement.
    expect(dispatchWorkflowSrc).toContain('export async function executeAndVerifyDispatch');
    expect(dispatchWorkspace).not.toContain('stockOut');
    expect(dispatchWorkspace).not.toContain('writeBatch');
    expect(dispatchWorkspace).not.toContain('increment(\'availableQty\'');
  });

  it('the logistics edit uses the IDENTICAL updateDocById payload the retired popup used (there is no separate updateDispatch service)', () => {
    expect(dispatchWorkspace).toContain('updateDocById(COLLECTIONS.DISPATCH, draft.id, {');
    expect(dispatchWorkspace).toContain('vehicleNo: draft.vehicleNo');
    expect(dispatchWorkspace).toContain('assignedToId: draft.assignedToId || null');
  });
});

describe('B2C serial/barcode rule — real values preserved, skipped tracking explicitly pending for QC, nothing fabricated', () => {
  it('captured serials/barcodes are preserved on the dispatch items; skipped tracking shows an explicit pending-for-QC state', () => {
    expect(dispatchWorkspace).toContain('Tracking pending for QC');
    expect(dispatchWorkspace).toContain("S: {serials.join(', ')}");
    expect(dispatchWorkspace).toContain('const serials = Array.isArray(item.serials) ? item.serials : []');
    expect(dispatchWorkspace).toContain('barcodeInput');
  });

  it('never fabricates serial/barcode values or marks tracked items as captured when they were not', () => {
    expect(dispatchWorkspace).not.toContain('Math.random');
    expect(dispatchWorkspace).not.toContain("'SN-'");
    expect(dispatchWorkspace).toContain("const captured = serials.length > 0 || barcodes.length > 0;");
  });

  it('the item-level view shows requested vs verified quantities and real tracking data per item', () => {
    expect(dispatchWorkspace).toContain('Requested');
    expect(dispatchWorkspace).toContain('Verified');
    expect(dispatchWorkspace).toContain('requestedQty');
    expect(dispatchWorkspace).toContain('verifiedQty');
  });
});

describe('Generic project context stays at the Project Workspace level — the Dispatch stage workspace carries no Notes/Activity/Documents/Linked Records sections', () => {
  it('the embedded Dispatch workspace has no Activity / Activity Feed / ActivityTimeline section', () => {
    expect(dispatchWorkspace).not.toContain('ActivityTimeline');
    expect(dispatchWorkspace).not.toContain('Activity Feed');
    expect(dispatchWorkspace).not.toContain('<FormSection title="Activity"');
  });

  it('the embedded Dispatch workspace has no read-only Notes display block or any Documents/Linked Records/Activity FormSection (the dispatch.notes field itself stays editable in the logistics editor — dispatch-specific record data, not generic context)', () => {
    expect(dispatchWorkspace).not.toContain('dispatch.notes && (');
    expect(dispatchWorkspace).not.toMatch(/<FormSection title="(Notes|Documents|Activity|Linked Records)"/);
    // the real dispatch.notes field is still an editable logistics control
    expect(dispatchWorkspace).toContain('label="Notes"');
  });

  it('the Project Workspace still owns the single authoritative context layer — Documents/Activity/Linked Records via ProjectWorkspaceSections', () => {
    const sections = read('../../features/projects/components/workspace/ProjectWorkspaceSections.tsx');
    expect(sections).toContain('label="Documents"');
    expect(sections).toContain('title="Activity"');
    expect(sections).toContain('Linked Records');
  });
});

describe('Old standalone Dispatch management popup — retired, invocation paths rewired', () => {
  it('the list page no longer mounts the popup (no management modal, no viewItem, no ?open= machinery)', () => {
    expect(dispatchListPage).not.toContain('DispatchManagementModal');
    expect(dispatchListPage).not.toContain('DispatchModalBoundary');
    expect(dispatchListPage).not.toContain('viewItem');
    expect(dispatchListPage).not.toContain('openParam');
    expect(dispatchListPage).not.toContain('viewMode');
  });

  it('row click / ID / View navigate to the /dispatch/:id record workspace page', () => {
    expect(dispatchListPage).toContain("navigate(`/dispatch/${encodeURIComponent(row?.id || '')}`)");
  });

  it('the list page keeps only the create flow (DispatchRequestModal + requestDispatch) and the bulk close/delete actions', () => {
    expect(dispatchListPage).toContain('<DispatchRequestModal');
    expect(dispatchListPage).toContain('requestDispatch(payload)');
    expect(dispatchListPage).toContain('closeDispatch(id)');
    expect(dispatchListPage).toContain('deleteDocById(COLLECTIONS.DISPATCH, id)');
  });

  it('bulk Assign/Verify/Execute send the user to the Project Workspace (the Dispatch stage operational workspace) when the dispatch is project-linked', () => {
    expect(dispatchListPage).toContain("navigate(`/projects/${encodeURIComponent(row.projectId)}`)");
  });

  it('the /dispatch/:id record page no longer deep-links back into the retired popup — operational actions target the Project Workspace, and the challan prints inline', () => {
    expect(dispatchDetailPage).not.toContain('/dispatch?open=');
    expect(dispatchDetailPage).toContain("const operationalTarget = projectId ? `/projects/${encodeURIComponent(projectId)}`");
    expect(dispatchDetailPage).toContain('onDownloadChallan: () => void printChallan()');
    expect(dispatchDetailPage).toContain("'DISPATCH CHALLAN', dispatch");
    expect(dispatchDetailPage).toContain('triggerPrint(html)');
  });

  it('dispatch notifications and search results open the /dispatch/:id record page, not ?open=', () => {
    expect(notificationRoutes).toContain("`/dispatch/${encodeURIComponent(entityId)}`");
    expect(searchEngine).toContain('link: `/dispatch/${encodeURIComponent(doc.id)}`');
  });

  it('the stage engine href for Dispatch points at the Project (the workspace lives inside the Project Workspace), like Quotation/Order/Procurement', () => {
    expect(stageEngine).toContain("if (stage === 'Dispatch') return `/projects/${projectId}`;");
  });
});
