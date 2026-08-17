/**
 * projectWorkspaceOrderIntegration.test.ts — Order Workspace Migration
 * (Stage 5 — Order card gets a real operational workspace; the standalone
 * Order view popup is retired; project orders are now placed inside the
 * Project Workspace via the existing quotation → order conversion service).
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: STAGE_WORKSPACES registers the order
 * workspace, the workspace reuses the EXISTING order/quotation hooks and the
 * exact convertQuotationToOrder mutation (no parallel Order-creation logic,
 * no manual item entry — the quotation is the source), the retired popup's
 * invocation paths are gone or rewired, and the stage engine's "Open in full
 * workspace" target now points at the Project itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const orderWorkspace = read('../../features/projects/components/workspace/stages/ProjectOrderWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageEngine = read('../../hooks/useProjectStage.ts');
const notificationRoutes = read('../../lib/notificationRoutes.ts');
const ordersPage = read('../Orders.tsx');
const ordersWorkspacePage = read('../OrdersWorkspace.tsx');

describe('Order stage — registered operational workspace (Stage 5)', () => {
  it('STAGE_WORKSPACES registers the order workspace', () => {
    expect(stageRegistry).toContain('order: ProjectOrderWorkspace');
  });

  it('ProjectWorkOnThisProject mounts it through the shared ProjectStageCard shell and gives the card a real-data collapsed summary', () => {
    expect(workOnThisProject).toContain('const StageWorkspace = STAGE_WORKSPACES[stage.id]');
    expect(workOnThisProject).toContain("stage.id === 'order' ? orderCardSummary : stage.id === 'procurement' ? procurementCardSummary : stage.id === 'dispatch' ? dispatchCardSummary : stage.id === 'installation' ? installationCardSummary : stage.id === 'qc' ? qcCardSummary : stage.id === 'commissioning' ? commissioningCardSummary : stage.id === 'net-metering' ? netMeteringCardSummary : stage.id === 'subsidy' ? subsidyCardSummary : stage.id === 'handover' ? handoverCardSummary : stage.id === 'amc' ? amcCardSummary : undefined");
    expect(workOnThisProject).toContain('function useOrderCardSummary(projectId: string)');
    expect(workOnThisProject).toContain('useOrders()');
  });
});

describe('Order workspace reuses the existing Order system verbatim (no parallel implementation)', () => {
  it('uses the exact same useOrders() hook as the Orders list page, scoped to THIS project', () => {
    expect(orderWorkspace).toContain("import { useOrders, useQuotations } from '../../../../sales/hooks/useSales'");
    expect(orderWorkspace).toContain('o.projectId === project.id');
  });

  it('places the Order through the exact convertQuotationToOrder mutation (useConvertQuotationToOrder) — no createOrder call, no manual item entry', () => {
    expect(orderWorkspace).toContain("import { useConvertQuotationToOrder } from '../../../../quotations/hooks/useQuotations'");
    expect(orderWorkspace).toContain('convertToOrder.mutate(quote, {');
    expect(orderWorkspace).not.toContain('createOrder');
    expect(orderWorkspace).not.toContain('OrderItemsEditor');
  });

  it('only non-converted quotations are offered for placement — the real lock state, so a second Order can never be placed from the same quotation', () => {
    expect(orderWorkspace).toContain("import { isQuotationLocked } from '../../../../../lib/quotationWorkflow'");
    expect(orderWorkspace).toContain('!isQuotationLocked(q)');
  });

  it('guards the creation flow against a pagination gap — no creation surface while the project has linked orders that have not loaded (no duplicate records)', () => {
    expect(orderWorkspace).toContain('const hasLinkedOrders = (project.linkedOrderIds || []).length > 0;');
  });

  it('keeps the workspace focused — the retired popup Notes/Documents sections are not carried in', () => {
    expect(orderWorkspace).not.toContain('EntityDocumentsPanel');
    expect(orderWorkspace).not.toContain('Activity Timeline');
  });
});

describe('Old standalone Order popup — retired, invocation paths rewired', () => {
  it('Orders.tsx no longer has the view popup (no View Modal, no OrderDetail, no viewItem, no ?open= machinery)', () => {
    expect(ordersPage).not.toContain('View Modal');
    expect(ordersPage).not.toContain('OrderDetail');
    expect(ordersPage).not.toContain('viewItem');
    expect(ordersPage).not.toContain('openOrder');
    expect(ordersPage).not.toContain('closeOrderDetails');
    expect(ordersPage).not.toContain('openParam');
  });

  it('row click / View navigates to the /orders/:id detail page', () => {
    expect(ordersPage).toContain("navigate(`/orders/${encodeURIComponent(order.id)}`)");
    expect(ordersPage).toContain("navigate(`/orders/${encodeURIComponent(o.id)}`)");
  });

  it('the /orders/:id detail page deep-links edits via ?edit= instead of the popup, and the popup-only Assign Team quick action is dropped', () => {
    expect(ordersPage).toContain("const editParam = searchParams.get('edit') || ''");
    expect(ordersWorkspacePage).toContain("navigate(`/orders?edit=${encodeURIComponent(id || '')}`)");
    expect(ordersWorkspacePage).not.toContain('&tab=assign');
    expect(ordersWorkspacePage).not.toContain('onAssignTeam');
  });

  it('order notifications route to the detail page, not ?open=', () => {
    expect(notificationRoutes).toContain("`/orders/${encodeURIComponent(entityId)}`");
  });

  it('the stage engine href for Order points at the Project (the workspace lives inside the Project Workspace), like Quotation', () => {
    expect(stageEngine).toContain("if (stage === 'Order') return `/projects/${projectId}`;");
  });
});
