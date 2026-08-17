/**
 * projectWorkspaceProcurementIntegration.test.ts — Procurement Workspace
 * Migration (Stage 6 — Procurement card gets a real operational workspace; the
 * standalone Purchase Order view popup is retired; the stage orchestrates the
 * existing Order → Inventory → Purchase Order → Goods Receipt workflow and
 * offers the intentional Skip Procurement action).
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: STAGE_WORKSPACES registers the procurement
 * workspace, the workspace reuses the EXISTING order/stock/purchase-order/
 * goods-receipt hooks (no parallel inventory or procurement logic), the
 * availability comparison is a READ-ONLY view of real data, Skip reuses the
 * canonical stage-advance service (advanceProjectStage) and never fabricates a
 * procurement record, the retired popup's invocation paths are gone or
 * rewired, and the stage engine's "Open in full workspace" target now points
 * at the Project itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const procurementWorkspace = read('../../features/projects/components/workspace/stages/ProjectProcurementWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageEngine = read('../../hooks/useProjectStage.ts');
const notificationRoutes = read('../../lib/notificationRoutes.ts');
const purchaseOrdersPage = read('../PurchaseOrders.tsx');
const purchaseOrdersWorkspacePage = read('../PurchaseOrdersWorkspace.tsx');

describe('Procurement stage — registered operational workspace (Stage 6)', () => {
  it('STAGE_WORKSPACES registers the procurement workspace', () => {
    expect(stageRegistry).toContain('procurement: ProjectProcurementWorkspace');
  });

  it('ProjectWorkOnThisProject mounts it through the shared ProjectStageCard shell and gives the card a real-data collapsed summary', () => {
    expect(workOnThisProject).toContain('const StageWorkspace = STAGE_WORKSPACES[stage.id]');
    expect(workOnThisProject).toContain("stage.id === 'procurement' ? procurementCardSummary : stage.id === 'dispatch' ? dispatchCardSummary : stage.id === 'installation' ? installationCardSummary : stage.id === 'qc' ? qcCardSummary : stage.id === 'commissioning' ? commissioningCardSummary : stage.id === 'net-metering' ? netMeteringCardSummary : stage.id === 'subsidy' ? subsidyCardSummary : stage.id === 'handover' ? handoverCardSummary : stage.id === 'amc' ? amcCardSummary : undefined");
    expect(workOnThisProject).toContain('function useProcurementCardSummary(projectId: string)');
    expect(workOnThisProject).toContain("import { usePurchaseOrders } from '../../../procurement/hooks/usePurchaseOrders'");
  });
});

describe('Procurement workspace reuses the existing Order → Inventory → Procurement system verbatim (no parallel implementation)', () => {
  it('uses the exact same hooks as the Orders / Stock / Purchase Orders / Goods Receipts pages, scoped to THIS project', () => {
    expect(procurementWorkspace).toContain("import { useOrders } from '../../../../sales/hooks/useSales'");
    expect(procurementWorkspace).toContain("import { useStockSummary } from '../../../../inventory/hooks/useInventory'");
    expect(procurementWorkspace).toContain("import { usePurchaseOrders } from '../../../../procurement/hooks/usePurchaseOrders'");
    expect(procurementWorkspace).toContain("import { useGoodsReceipts } from '../../../../procurement/hooks/useGoodsReceipts'");
    expect(procurementWorkspace).toContain('o.projectId === project.id');
    expect(procurementWorkspace).toContain('po.projectId === project.id');
  });

  it('computes availability as a READ-ONLY comparison of real data — required (order items) vs available (sum of stock summary availableQty) — never inventing reservation/commitment fields', () => {
    expect(procurementWorkspace).toContain('Number(row.availableQty) || 0');
    expect(procurementWorkspace).toContain('Math.max(0, req.required - available)');
    expect(procurementWorkspace).not.toContain('createPurchaseOrder');
    expect(procurementWorkspace).not.toContain('createGoodsReceipt');
    expect(procurementWorkspace).not.toContain('stockIn');
    // Untracked (no productId) lines stay visible with a marker instead of being
    // silently dropped, so the Required column never understates the order.
    expect(procurementWorkspace).toContain('linked to inventory products');
    expect(procurementWorkspace).toContain('not tracked');
  });

  it('orchestrates the existing procurement workflow with links to the real PO / GR creation forms instead of duplicating them', () => {
    expect(procurementWorkspace).toContain('navigate(`/purchase-orders?create=1&projectId=${encodeURIComponent(project.id)}`)');
    expect(procurementWorkspace).toContain('navigate(`/goods-receipts?create=1&purchaseOrderId=${encodeURIComponent(po.id)}`)');
  });
});

describe('Skip Procurement — the intentional bypass, built on the canonical stage-transition system', () => {
  it('reuses advanceProjectStage (the ONLY stage-advance mechanism) with an explicit skipped note — no fake procurement record', () => {
    expect(procurementWorkspace).toContain("import { advanceProjectStage } from '../../../../../lib/projectStageTransition'");
    expect(procurementWorkspace).toContain('await advanceProjectStage(project.id, \'Dispatch\'');
    expect(procurementWorkspace).toContain("'Procurement skipped — stock sufficient, no procurement required'");
    expect(procurementWorkspace).not.toContain('createDocWithId');
  });

  it('offers Skip only while the project has not passed Procurement, gated on project-edit permission, with a confirmation step', () => {
    expect(procurementWorkspace).toContain("const canSkip = canEdit && projectStageIndex(project.currentStage) < projectStageIndex('Dispatch')");
    expect(procurementWorkspace).toContain('title="Skip Procurement?"');
    expect(procurementWorkspace).toContain('move the workflow to the next applicable stage');
  });

  it('reflects the skipped state from the REAL stageHistory note, not local UI', () => {
    expect(procurementWorkspace).toContain("entry.stage === 'Procurement' && String(entry.note || '').startsWith('Procurement skipped')");
  });
});

describe('Old standalone Purchase Order popup — retired, invocation paths rewired', () => {
  it('PurchaseOrders.tsx no longer has the view popup (no PODetail, no viewItem, no ?open= machinery)', () => {
    expect(purchaseOrdersPage).not.toContain('PODetail');
    expect(purchaseOrdersPage).not.toContain('viewItem');
    expect(purchaseOrdersPage).not.toContain('openPo');
    expect(purchaseOrdersPage).not.toContain('closePoDetails');
    expect(purchaseOrdersPage).not.toContain('openParam');
    expect(purchaseOrdersPage).not.toContain('detailsTab');
  });

  it('row click / View navigates to the /purchase-orders/:id workspace page', () => {
    expect(purchaseOrdersPage).toContain("navigate(`/purchase-orders/${encodeURIComponent(o.id)}`)");
  });

  it('the /purchase-orders/:id workspace deep-links edits via ?edit=, and Approve/Cancel now use the real transitionPurchaseOrder service', () => {
    expect(purchaseOrdersPage).toContain("const editParam = searchParams.get('edit') || ''");
    expect(purchaseOrdersWorkspacePage).toContain("navigate(`/purchase-orders?edit=${encodeURIComponent(id || '')}`)");
    expect(purchaseOrdersWorkspacePage).toContain('usePurchaseOrderActions');
    expect(purchaseOrdersWorkspacePage).toContain("transitionPo.mutate({ id: po.id, status: 'Sent' }");
    expect(purchaseOrdersWorkspacePage).toContain("transitionPo.mutate({ id: po.id, status: 'Cancelled' }");
    expect(purchaseOrdersWorkspacePage).not.toContain('?open=');
    expect(purchaseOrdersWorkspacePage).not.toContain('&tab=edit');
  });

  it('the embedded workspace pre-scopes PO creation to this project (?create=1&projectId=), handled by the list page', () => {
    expect(purchaseOrdersPage).toContain("const projectIdParam = searchParams.get('projectId') || ''");
    expect(purchaseOrdersPage).toContain('if (projectIdParam) next.projectId = projectIdParam;');
  });

  it('purchase order notifications route to the full PO workspace, not ?open=', () => {
    expect(notificationRoutes).toContain("`/purchase-orders/${encodeURIComponent(entityId)}`");
  });

  it('the stage engine href for Procurement points at the Project (the workspace lives inside the Project Workspace), like Quotation and Order', () => {
    expect(stageEngine).toContain("if (stage === 'Procurement') return `/projects/${projectId}`;");
  });
});
