/**
 * ProjectProcurementWorkspace — the Procurement stage's operational workspace,
 * embedded inside "Work on This Project" (Stage 6 — Procurement mission; the
 * standalone Purchase Order view popup was retired). Built the same way
 * ProjectSurveyWorkspace / ProjectEngineeringWorkspace / ProjectQuotationWorkspace /
 * ProjectOrderWorkspace were: surfaces the EXISTING Order → Inventory →
 * Procurement system verbatim, no parallel implementation.
 *
 * Reuse discipline:
 *   - useOrders() (features/sales/hooks/useSales.ts) is the exact hook the
 *     Orders list page and ProjectOrderWorkspace already use — the Order is
 *     the source of what material this project requires.
 *   - useStockSummary() (features/inventory/hooks/useInventory.ts) is the
 *     exact hook the Stock pages use — the stock summary documents carry the
 *     real per-product/per-warehouse availableQty. Availability here is a
 *     READ-ONLY comparison of those two real data sources: required quantity
 *     (order items) vs available quantity (sum of availableQty across the
 *     company's stock summaries for each product). The ERP has NO
 *     order→inventory reservation layer (reservedQty exists on the summary
 *     doc but is never incremented by any service), so "available" is exactly
 *     what the inventory system actually knows — nothing invented.
 *   - usePurchaseOrders() + useGoodsReceipts() (features/procurement/hooks)
 *     are the exact hooks the Purchase Orders / Goods Receipts pages use.
 *     This workspace only ORCHESTRATES the existing procurement workflow — it
 *     links out to the real Purchase Order creation form
 *     (/purchase-orders?create=1&projectId=…) and the real Goods Receipt
 *     creation form (/goods-receipts?create=1&purchaseOrderId=…). Creating a
 *     PO and receiving stock remain domain services (purchaseOrderWorkflow.ts
 *     / goodsReceiptWorkflow.ts); nothing here writes inventory.
 *   - advanceProjectStage() (lib/projectStageTransition.ts →
 *     buildProjectStageAdvancePatch in lib/projectLifecycle.ts) is the ONLY
 *     stage-advance mechanism — the "Skip Procurement" action reuses it to
 *     move the project to the next canonical stage (Dispatch) with an
 *     explicit "Procurement skipped — …" stageHistory note. No fake
 *     procurement record is ever created to skip, and the existing forward-
 *     only/no-regression patch rules apply untouched.
 *
 * Skip availability: Skip Procurement is offered whenever the project has not
 * yet passed Procurement (projectStageIndex(currentStage) <
 * projectStageIndex('Dispatch')) and the user can edit the project. It is
 * primary when stock is sufficient (the intended "no procurement required"
 * path) and a quiet, confirmed secondary path when a shortage exists (an
 * intentional bypass — never silent). After a successful skip the engine
 * marks Procurement completed (canonical position) and this workspace shows a
 * "Procurement skipped" banner from the real stageHistory note.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardList, PackagePlus, ShoppingCart,
  Truck, Warehouse,
} from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { ConfirmDialog } from '../../../../../components/ui';
import { Select, FormSection } from '../../../../../components/ui/Input';
import { statusBadge } from '../../../../../components/ui/Badge';
import { fmtCurrency, fmtDate } from '../../../../../lib/firestore';
import { queryKeys } from '../../../../../lib/queryKeys';
import { useAppStore } from '../../../../../store/useAppStore';
import { useOrders } from '../../../../sales/hooks/useSales';
import { useStockSummary } from '../../../../inventory/hooks/useInventory';
import { usePurchaseOrders } from '../../../../procurement/hooks/usePurchaseOrders';
import { useGoodsReceipts } from '../../../../procurement/hooks/useGoodsReceipts';
import { advanceProjectStage } from '../../../../../lib/projectStageTransition';
import { projectStageIndex } from '../../../../../lib/projectLifecycle';
import type { ProjectStageWorkspaceProps } from './types';

function poDisplayNumber(po: any): string {
  return String(po?.purchaseOrderId || po?.id || '—');
}

function orderDisplayNumber(order: any): string {
  return String(order?.orderNumber || order?.orderNo || '').trim() || String(order?.id || '—');
}

/** Real-data fulfillment comparison — required (order items) vs available
 * (sum of stock summary availableQty per product). Read-only: the ERP's
 * inventory model has no order reservation layer, so this reports exactly
 * what the stock summaries know. Items without a productId (custom lines)
 * cannot be matched to inventory and are reported as "not tracked". */
function useFulfillment(activeOrder: any, stockSummary: any[]) {
  return useMemo(() => {
    if (!activeOrder) return null;
    const requiredByProduct = new Map<string, { product: string; unit: string; required: number }>();
    const untrackedRows: Array<{
      productId: string; product: string; unit: string; required: number;
      available: null; shortage: null; tracked: false;
    }> = [];
    for (const item of activeOrder.items || []) {
      const pid = String(item.productId || '');
      const qty = Number(item.qty) || 0;
      if (!pid) {
        // Custom/unlinked line — no inventory matching possible; keep it
        // VISIBLE with a "not tracked" marker so the Required column never
        // silently understates the order.
        untrackedRows.push({
          productId: '',
          product: String(item.product || 'Custom item'),
          unit: String(item.unit || ''),
          required: qty,
          available: null,
          shortage: null,
          tracked: false,
        });
        continue;
      }
      const cur = requiredByProduct.get(pid) || {
        product: String(item.product || ''), unit: String(item.unit || ''), required: 0,
      };
      cur.required += qty;
      if (!cur.product) cur.product = String(item.product || pid);
      if (!cur.unit) cur.unit = String(item.unit || '');
      requiredByProduct.set(pid, cur);
    }
    const availableByProduct = new Map<string, number>();
    for (const row of stockSummary) {
      const pid = String(row.productId || '');
      if (!pid) continue;
      availableByProduct.set(pid, (availableByProduct.get(pid) || 0) + (Number(row.availableQty) || 0));
    }
    const trackedRows = Array.from(requiredByProduct.entries()).map(([pid, req]) => {
      const available = availableByProduct.get(pid) || 0;
      return {
        productId: pid,
        product: req.product || pid,
        unit: req.unit,
        required: req.required,
        available,
        shortage: Math.max(0, req.required - available),
        tracked: true as const,
      };
    });
    const rows = [...trackedRows, ...untrackedRows];
    const totalShortage = trackedRows.reduce((sum, row) => sum + row.shortage, 0);
    return {
      rows,
      totalShortage,
      insufficient: totalShortage > 0,
      // Nothing comparable (every line untracked) is NOT "sufficient" — it is
      // unknown, reported as such instead of a false green verdict.
      unknown: trackedRows.length === 0 && untrackedRows.length > 0,
    };
  }, [activeOrder, stockSummary]);
}

/** The latest (or selected) project Order + the material fulfillment table
 * that answers "does this Order require procurement, and what exactly?". */
function FulfillmentView({
  activeOrder,
  fulfillment,
  currencySymbol,
  onOpenOrder,
}: {
  activeOrder: any;
  fulfillment: NonNullable<ReturnType<typeof useFulfillment>>;
  currencySymbol: string;
  onOpenOrder: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{orderDisplayNumber(activeOrder)}</p>
            {statusBadge(activeOrder.status || 'Pending')}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {activeOrder.customer || '—'} · {fmtCurrency(Number(activeOrder.total) || 0, currencySymbol)} · {activeOrder.orderType || '—'}
          </p>
        </div>
        <Button size="xs" variant="outline" icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={onOpenOrder}>
          Open order
        </Button>
      </div>

      {/* Verdict — the actual situation, from real inventory data */}
      {fulfillment.unknown ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
          <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
          <div className="text-xs">
            <p className="font-semibold text-[var(--color-text)]">Availability not comparable</p>
            <p className="mt-0.5 text-[var(--color-text-muted)]">
              None of this order's items are linked to inventory products (productId) — availability cannot be compared for custom lines.
            </p>
          </div>
        </div>
      ) : fulfillment.insufficient ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger-light)] px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" />
          <div className="text-xs">
            <p className="font-semibold text-[var(--color-text)]">Procurement required — {fulfillment.totalShortage} item{fulfillment.totalShortage > 1 ? 's' : ''} short</p>
            <p className="mt-0.5 text-[var(--color-text-muted)]">
              Warehouse stock is insufficient for the order above. Create a Purchase Order to procure the shortage; receiving goods updates inventory through the existing Goods Receipt workflow.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" />
          <div className="text-xs">
            <p className="font-semibold text-[var(--color-text)]">Stock sufficient — no procurement required</p>
            <p className="mt-0.5 text-[var(--color-text-muted)]">
              Every item on this order is covered by available warehouse stock. You can skip Procurement and continue the workflow.
            </p>
          </div>
        </div>
      )}

      <FormSection title="Required vs Available Inventory">
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="min-w-full text-xs">
            <thead className="bg-[var(--color-bg-sunken)]">
              <tr>
                {['Product', 'Required', 'Available', 'Shortage', 'Unit'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {fulfillment.rows.map((row) => (
                <tr key={row.tracked ? row.productId : `custom-${row.product}-${row.required}`}>
                  <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                    {row.product}
                    {!row.tracked && (
                      <span className="ml-1.5 rounded bg-[var(--color-bg-sunken)] px-1 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">not tracked</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{row.required}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{row.tracked ? row.available : '—'}</td>
                  <td className="px-3 py-2">
                    {row.tracked ? (
                      row.shortage > 0 ? (
                        <span className="font-semibold text-[var(--color-danger)]">{row.shortage}</span>
                      ) : (
                        <span className="text-[var(--color-success-text)]">—</span>
                      )
                    ) : (
                      <span className="text-[var(--color-text-disabled)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{row.unit || '—'}</td>
                </tr>
              ))}
              {fulfillment.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-5 text-center text-[var(--color-text-muted)]">
                    No line items on this order.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-[var(--color-text-disabled)]">
          Available = sum of available stock across all warehouses for each product. The ERP does not reserve order quantities against inventory.
        </p>
      </FormSection>
    </div>
  );
}

/** The project's real Purchase Orders + their Goods Receipt progress — the
 * existing procurement workflow, orchestrated (links out to the real PO / GR
 * creation forms; never writes here). */
function ProcurementStatus({
  projectPOs,
  goodsReceipts,
  onOpenPO,
  onCreatePO,
}: {
  projectPOs: any[];
  goodsReceipts: any[];
  onOpenPO: (id: string) => void;
  onCreatePO: () => void;
}) {
  const navigate = useNavigate();
  return (
    <FormSection title={`Procurement Status (${projectPOs.length})`}>
      <div className="flex items-center justify-between gap-2 pb-1">
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Existing purchase orders for this project — receiving goods updates inventory through the Goods Receipt workflow.
        </p>
        <Button size="xs" variant="outline" icon={<PackagePlus className="h-3.5 w-3.5" />} onClick={onCreatePO}>
          Create Purchase Order
        </Button>
      </div>
      {projectPOs.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-3 py-4 text-xs text-[var(--color-text-muted)]">
          <ClipboardList className="h-4 w-4" />
          No purchase orders yet for this project. Create one to procure the required material.
        </div>
      ) : (
        <div className="space-y-2">
          {projectPOs.map((po) => {
            const totalQty = (po.items || []).reduce((s: number, i: any) => s + (Number(i.qty) || 0), 0);
            const receivedQty = (po.items || []).reduce((s: number, i: any) => s + (Number(i.receivedQty) || 0), 0);
            const poGRs = goodsReceipts.filter((gr) => gr.purchaseOrderId === po.id);
            return (
              <div key={po.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{poDisplayNumber(po)}</p>
                    {statusBadge(po.status || 'Draft')}
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {po.vendorName || '—'} · {receivedQty}/{totalQty} received{poGRs.length > 0 ? ` · ${poGRs.length} goods receipt${poGRs.length > 1 ? 's' : ''}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {po.status === 'Sent' || po.status === 'PartiallyReceived' ? (
                    <Button size="xs" variant="outline" icon={<Truck className="h-3.5 w-3.5" />}
                      onClick={() => navigate(`/goods-receipts?create=1&purchaseOrderId=${encodeURIComponent(po.id)}`)}>
                      Receive goods
                    </Button>
                  ) : null}
                  <Button size="xs" variant="outline" onClick={() => onOpenPO(po.id)}>
                    Open
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </FormSection>
  );
}

export default function ProjectProcurementWorkspace({ project, canEdit }: ProjectStageWorkspaceProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const keys = queryKeys.forCompany(useAppStore((s) => s.activeCompanyId));
  const user = useAppStore((s) => s.user);
  const { company } = useAppStore();
  const currencySymbol = company.currencySymbol;

  const { data: orders = [], isLoading: ordersLoading } = useOrders();
  const { data: stockSummary = [], isLoading: stockLoading } = useStockSummary();
  const { data: purchaseOrders = [], isLoading: poLoading } = usePurchaseOrders();
  const { data: goodsReceipts = [] } = useGoodsReceipts();

  const projectOrders = useMemo(
    () => (orders as any[])
      .filter((o) => o.projectId === project.id)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()),
    [orders, project.id],
  );
  const projectPOs = useMemo(
    () => (purchaseOrders as any[])
      .filter((po) => po.projectId === project.id)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()),
    [purchaseOrders, project.id],
  );

  const [activeOrderId, setActiveOrderId] = useState<string | undefined>(undefined);
  const activeOrder = projectOrders.find((o) => o.id === activeOrderId) || projectOrders[0];
  const fulfillment = useFulfillment(activeOrder, stockSummary as any[]);

  // Skipped state — the REAL stageHistory note written by the skip action
  // (advanceProjectStage with a "Procurement skipped — …" note), not local UI.
  const skipEntry = useMemo(
    () => [...(project.stageHistory || [])].reverse().find(
      (entry) => entry.stage === 'Procurement' && String(entry.note || '').startsWith('Procurement skipped'),
    ),
    [project.stageHistory],
  );

  const [confirmSkip, setConfirmSkip] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);

  // Skip is the intentional bypass of this stage: reuse the ONLY stage-advance
  // mechanism (advanceProjectStage → buildProjectStageAdvancePatch) to move the
  // project to the next canonical stage (Dispatch) with an explicit note. No
  // procurement record is created; the engine then marks Procurement completed.
  const canSkip = canEdit && projectStageIndex(project.currentStage) < projectStageIndex('Dispatch');

  async function handleSkip() {
    setIsSkipping(true);
    try {
      const note = fulfillment && (fulfillment.insufficient || fulfillment.unknown)
        ? 'Procurement skipped — intentionally bypassed without confirmed material coverage'
        : 'Procurement skipped — stock sufficient, no procurement required';
      await advanceProjectStage(project.id, 'Dispatch', user?.id || 'system', note);
      toast.success('Procurement skipped — project moved to the next stage');
      qc.invalidateQueries({ queryKey: keys.projectsRoot });
      setConfirmSkip(false);
    } catch (error: any) {
      toast.error(error?.message || 'Could not skip Procurement');
    } finally {
      setIsSkipping(false);
    }
  }

  if (ordersLoading || stockLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  // Pagination-gap guard (same as the Order/Quotation workspaces): if the
  // project HAS linked orders but none are in the loaded page of useOrders(),
  // never show a misleading empty state.
  const hasLinkedOrders = (project.linkedOrderIds || []).length > 0;
  if (projectOrders.length === 0 && hasLinkedOrders) {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">
        This project has linked orders, but they have not finished loading in this view. Open the Orders list to view them.
      </p>
    );
  }

  // ── No order yet — no required material is defined ──
  if (projectOrders.length === 0) {
    return (
      <div className="space-y-3">
        {skipEntry && (
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            Procurement was skipped{skipEntry.changedAt ? ` on ${fmtDate(skipEntry.changedAt)}` : ''}{skipEntry.note ? ` — ${skipEntry.note}` : ''}.
          </div>
        )}
        <div className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
            <ShoppingCart className="h-4 w-4 text-[var(--color-text-muted)]" />
            No order has been placed for this project yet.
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Required material is defined by the Order at Stage 5. Place the Order first, then return here to check warehouse availability
            and procure any shortage.
          </p>
          <Button size="xs" variant="outline" onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}>
            Open Order stage
          </Button>
        </div>
        {canSkip && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
            <p className="text-xs text-[var(--color-text-muted)]">If this project does not require procurement, you can bypass the stage explicitly.</p>
            <Button size="xs" variant="outline" onClick={() => setConfirmSkip(true)}>Skip Procurement</Button>
          </div>
        )}
        <ConfirmDialog
          open={confirmSkip}
          onClose={() => setConfirmSkip(false)}
          onConfirm={handleSkip}
          loading={isSkipping}
          title="Skip Procurement?"
          message="This will bypass Procurement for this project and move the workflow to the next applicable stage. No purchase order will be created."
        />
      </div>
    );
  }

  // ── Order exists — the material fulfillment view ──
  return (
    <div className="space-y-3">
      {skipEntry && (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          Procurement was skipped{skipEntry.changedAt ? ` on ${fmtDate(skipEntry.changedAt)}` : ''}{skipEntry.note ? ` — ${skipEntry.note}` : ''}.
        </div>
      )}

      {projectOrders.length > 1 && (
        <Select
          label="Order"
          value={activeOrder.id}
          onChange={(e) => setActiveOrderId(e.target.value)}
          options={projectOrders.map((o) => ({ label: `${orderDisplayNumber(o)} · ${o.status || 'Pending'}`, value: o.id }))}
        />
      )}

      {fulfillment && (
        <FulfillmentView
          activeOrder={activeOrder}
          fulfillment={fulfillment}
          currencySymbol={currencySymbol}
          onOpenOrder={() => navigate(`/orders/${encodeURIComponent(activeOrder.id)}`)}
        />
      )}

      <ProcurementStatus
        projectPOs={projectPOs}
        goodsReceipts={goodsReceipts as any[]}
        onOpenPO={(id) => navigate(`/purchase-orders/${encodeURIComponent(id)}`)}
        onCreatePO={() => navigate(`/purchase-orders?create=1&projectId=${encodeURIComponent(project.id)}`)}
      />

      {canSkip && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--color-text)]">
              {fulfillment?.insufficient || fulfillment?.unknown ? 'Skip Procurement anyway?' : 'Ready to move on?'}
            </p>
            <p className="text-[11px] text-[var(--color-text-muted)]">
              {fulfillment?.insufficient
                ? 'A material shortage is currently identified — skipping bypasses required procurement intentionally.'
                : fulfillment?.unknown
                  ? 'Availability cannot be compared for this order — skipping bypasses the stage without confirmation of coverage.'
                  : 'Stock is sufficient — skip Procurement and continue to the next applicable stage.'}
            </p>
          </div>
          <Button
            size="xs"
            variant={fulfillment?.insufficient ? 'danger' : 'primary'}
            onClick={() => setConfirmSkip(true)}
          >
            Skip Procurement
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmSkip}
        onClose={() => setConfirmSkip(false)}
        onConfirm={handleSkip}
        loading={isSkipping}
        title="Skip Procurement?"
        message={fulfillment?.insufficient
          ? 'A material shortage is currently identified for this project. Skipping will bypass required procurement and move the workflow to the next applicable stage. No purchase order will be created.'
          : fulfillment?.unknown
            ? 'This order cannot be compared against inventory. Skipping will bypass Procurement and move the workflow to the next applicable stage. No purchase order will be created.'
            : 'This will bypass Procurement for this project and move the workflow to the next applicable stage. No purchase order will be created.'}
      />

      {!poLoading && projectPOs.length === 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-disabled)]">
          <Warehouse className="h-3.5 w-3.5" /> Procurement stays in its current state until a purchase order is created or the stage is skipped.
        </p>
      )}
    </div>
  );
}
