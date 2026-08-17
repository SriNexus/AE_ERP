/**
 * ProjectDispatchWorkspace — the Dispatch stage's operational workspace,
 * embedded inside "Work on This Project" (Stage 6 — Dispatch mission; the
 * standalone DispatchManagementModal popup on the Dispatch list page was
 * retired). Built the same way ProjectSurveyWorkspace /
 * ProjectEngineeringWorkspace / ProjectQuotationWorkspace / ProjectOrderWorkspace /
 * ProjectProcurementWorkspace were: surfaces the EXISTING Dispatch system
 * verbatim, no parallel implementation.
 *
 * Reuse discipline:
 *   - Dispatches are read with the SAME query key the Dispatch list page uses
 *     (queryKeys.dispatchAll) — React Query dedupes them; never a second
 *     dispatch fetch. Orders/warehouses/products/users use the same keys/hooks
 *     the list page uses (useOrders / useSalesProducts / qkeys.warehouses /
 *     ['users']).
 *   - Every state change goes through the canonical lib/dispatchWorkflow
 *     services: requestDispatch, approveDispatch, executeAndVerifyDispatch,
 *     confirmDelivery (OTP), closeDispatch, validateDispatchIntegrity. The
 *     verification editor is the EXACT item editor the retired popup used —
 *     same verifiedQty / serials / barcodes semantics, same
 *     executeAndVerifyDispatch call. executeAndVerifyDispatch IS the real
 *     inventory-issue service (validates stock, decrements the stock summary,
 *     writes the STOCK_LEDGER OUT movement, updates order dispatchedQty /
 *     pendingQty, advances the project to Installation) — no inventory logic
 *     is duplicated or added here.
 *   - The logistics edit uses the identical updateDocById payload the list
 *     page's saveEdit mutation used (there is no separate updateDispatch
 *     service) — unchanged business behavior.
 *   - DispatchRequestModal (the existing creation form) is reused for the
 *     "no dispatch yet" flow, pre-scoped to this project.
 *
 * B2C serial/barcode rule (preserved exactly as the domain implements it):
 * items carry a product trackingType ('none' | 'barcode' | 'serial' |
 * 'barcode_serial'). When tracking IS captured, the actual serials/barcodes
 * are preserved on the dispatch record (dispatch.items[].serials/barcodes,
 * uniqueness-guarded by assertNoDuplicateSerials in dispatchWorkflow). When
 * skipped, the arrays stay empty and the item shows an explicit "tracking
 * pending for QC" state — no fabricated serials, no fake barcode values.
 * QC-side capture is a separate module (see the migration report's remaining
 * gaps); the dispatch record already carries everything QC would need.
 *
 * The workspace mirrors the popup's real OPERATIONAL content — item-level
 * view, logistics, approve, verify & execute, delivery OTP, close, challan,
 * integrity check, edit — as embedded sections instead of a modal. Generic
 * project context (Notes / Documents / Activity / Linked Records) is NOT
 * duplicated here: the Project Workspace owns exactly one authoritative
 * context layer at the bottom of the center panel (ProjectWorkspaceSections),
 * and this stage card carries only Dispatch-specific workflow content.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, ClipboardCheck, Printer, Search, Truck,
} from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { Select, FormSection, FormRow, Input, Textarea } from '../../../../../components/ui/Input';
import { statusBadge } from '../../../../../components/ui/Badge';
import { getAll, updateDocById, resolveWriteCompanyId } from '../../../../../lib/firestore';
import { fmtDate, fmtDateTime } from '../../../../../lib/firestore';
import { COLLECTIONS } from '../../../../../lib/firebase';
import { queryKeys } from '../../../../../lib/queryKeys';
import { useAppStore } from '../../../../../store/useAppStore';
import { usePermissions } from '../../../../../lib/permissions';
import { useOrders, useSalesProducts } from '../../../../sales/hooks/useSales';
import {
  approveDispatch, closeDispatch, confirmDelivery, executeAndVerifyDispatch,
  requestDispatch, validateDispatchIntegrity,
} from '../../../../../lib/dispatchWorkflow';
import { logActivity } from '../../../../../lib/workflow';
import { DispatchRequestModal } from '../../../../dispatch/components/DispatchRequestModal';
import {
  DEFAULT_FORM,
  dispatchDisplayNumber,
  dispatchErrorMessage,
  dispatchProgress,
  dispatchType,
  dispatchWarehouse,
  dispatchWorkflowState,
  formatNumber,
  type EditDraft,
} from '../../../../dispatch/utils/dispatchWorkspaceUtils';
import type { ProjectStageWorkspaceProps } from './types';

/** Item-level fulfillment + tracking status — real dispatch data. Items with a
 * product trackingType but no captured serials/barcodes are explicitly
 * "pending for QC" (skipped at dispatch, never fabricated). */
function TrackingCell({ item }: { item: any }) {
  const trackingType = String(item.trackingType || 'none');
  if (trackingType === 'none') {
    return <span className="text-[var(--color-text-muted)]">Qty only</span>;
  }
  const serials = Array.isArray(item.serials) ? item.serials : [];
  const barcodes = Array.isArray(item.barcodes) ? item.barcodes : [];
  const captured = serials.length > 0 || barcodes.length > 0;
  if (!captured) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-light)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warning-text)]">
        <ClipboardCheck className="h-3 w-3" /> Tracking pending for QC
      </span>
    );
  }
  return (
    <span className="font-mono text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
      {serials.length > 0 && <span className="block">S: {serials.join(', ')}</span>}
      {barcodes.length > 0 && <span className="block">B: {barcodes.join(', ')}</span>}
    </span>
  );
}

function DispatchItemsTable({ dispatch }: { dispatch: any }) {
  const items = Array.isArray(dispatch?.items) ? dispatch.items : [];
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
      {items.length ? (
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--color-bg-sunken)]">
            <tr>
              {['Product', 'Requested', 'Verified', 'Tracking Type', 'Tracking Data'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)]">
            {items.map((item: any, idx: number) => (
              <tr key={item.id || idx}>
                <td className="px-3 py-2 font-medium text-[var(--color-text)]">{item.product || item.productName || 'Item'}</td>
                <td className="px-3 py-2 text-[var(--color-text-secondary)]">{formatNumber(Number(item.requestedQty || item.qty || 0))}</td>
                <td className="px-3 py-2 font-semibold text-[var(--color-text-secondary)]">{formatNumber(Number(item.verifiedQty || 0))}</td>
                <td className="px-3 py-2 text-[var(--color-text-muted)]">{item.trackingType || 'none'}</td>
                <td className="px-3 py-2"><TrackingCell item={item} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex items-center gap-2 px-3 py-5 text-xs text-[var(--color-text-muted)]">
          <Truck className="h-4 w-4" /> No dispatch items.
        </div>
      )}
    </div>
  );
}

/** The verify & execute editor — the EXACT item editor the retired popup used
 * (same per-item verifiedQty for 'none' tracking, same barcode/serial inputs
 * for tracked items, same final-items computation). Skipping serial/barcode
 * capture keeps those arrays empty — explicitly represented as pending for QC
 * in DispatchItemsTable. Keyed by dispatch id so state resets per dispatch. */
function VerifyExecuteSection({
  dispatch,
  onExecute,
  executing,
  onIntegrity,
  checkingIntegrity,
}: {
  dispatch: any;
  onExecute: (items: any[]) => void;
  executing: boolean;
  onIntegrity: () => void;
  checkingIntegrity: boolean;
}) {
  const [executionItems, setExecutionItems] = useState<any[]>(() =>
    (dispatch?.items || []).map((item: any) => ({
      ...item,
      verifiedQty: Number(item.verifiedQty || item.requestedQty || 0),
      serialInput: Array.isArray(item.serials) ? item.serials.join(', ') : '',
      barcodeInput: Array.isArray(item.barcodes) ? item.barcodes.join(', ') : '',
    })),
  );

  return (
    <FormSection title="Verify & Execute">
      {dispatch.approvalStatus === 'Approved' && dispatch.status === 'Pending Verification' ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5 text-xs text-[var(--color-text-muted)]">
            Warehouse verification — review quantities and captured tracking values, then execute the dispatch.
            Serial/barcode capture is optional for B2C at this stage; skipped tracking stays pending for QC.
          </div>
          {executionItems.map((item: any, index: number) => (
            <div key={item.id || index} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--color-text)]">{item.product || item.productName || 'Item'}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Tracking: {item.trackingType || 'none'}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[var(--color-text-muted)]">Requested</p>
                  <p className="text-lg font-bold text-[var(--color-text)]">{formatNumber(Number(item.requestedQty || item.qty || 0))}</p>
                </div>
              </div>

              {item.trackingType === 'none' && (
                <div className="mt-3 w-36">
                  <Input
                    label="Verified Qty"
                    type="number"
                    min="0"
                    max={Number(item.requestedQty || item.qty || 0)}
                    value={item.verifiedQty ?? item.requestedQty ?? item.qty ?? 0}
                    onChange={(e) => {
                      const value = Math.max(0, Number(e.target.value));
                      setExecutionItems((prev) => prev.map((x, i) => (i === index ? { ...x, verifiedQty: value } : x)));
                    }}
                  />
                </div>
              )}

              {item.trackingType !== 'none' && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Input
                    label="Barcode"
                    value={item.barcodeInput || ''}
                    onChange={(e) => setExecutionItems((prev) => prev.map((x, i) => (i === index ? { ...x, barcodeInput: e.target.value } : x)))}
                    placeholder="Scan barcode (optional — skip for QC)"
                  />
                  <Input
                    label="Serials"
                    value={item.serialInput || ''}
                    onChange={(e) => setExecutionItems((prev) => prev.map((x, i) => (i === index ? { ...x, serialInput: e.target.value } : x)))}
                    placeholder="Comma separated serials (optional — skip for QC)"
                  />
                </div>
              )}

              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-[var(--color-text-muted)]">Verified</span>
                <span className="font-semibold text-[var(--color-text)]">
                  {formatNumber(Number(item.verifiedQty || item.requestedQty || 0))} / {formatNumber(Number(item.requestedQty || item.qty || 0))}
                </span>
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onIntegrity} loading={checkingIntegrity} icon={<Search className="h-3.5 w-3.5" />}>
              Verify Integrity
            </Button>
            <Button
              type="button"
              loading={executing}
              onClick={() => {
                const finalItems = executionItems.map((item) => {
                  const serials = item.serialInput ? String(item.serialInput).split(',').map((s: string) => s.trim()).filter(Boolean) : (item.serials || []);
                  const barcodes = item.barcodeInput ? String(item.barcodeInput).split(',').map((s: string) => s.trim()).filter(Boolean) : (item.barcodes || []);
                  let verifiedQty = Number(item.verifiedQty || item.requestedQty || 0);
                  if (item.trackingType === 'serial' && serials.length > 0) verifiedQty = serials.length;
                  if (item.trackingType === 'barcode' && barcodes.length > 0) verifiedQty = barcodes.length;
                  if (item.trackingType === 'barcode_serial' && serials.length > 0) verifiedQty = Math.max(serials.length, barcodes.length);
                  return { ...item, serials, barcodes, verifiedQty };
                });
                onExecute(finalItems);
              }}
            >
              Execute Dispatch
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-3 py-4 text-xs text-[var(--color-text-muted)]">
          Dispatch is not ready for verification yet.
        </div>
      )}
    </FormSection>
  );
}

/** Logistics edit — identical fields + updateDocById payload the retired popup
 * used (vehicle, driver, phone, transporter, LR, assignment, priority, date,
 * notes). Keyed by dispatch id so the draft resets per dispatch. */
function EditDispatchForm({
  dispatch,
  users,
  onSave,
  saving,
}: {
  dispatch: any;
  users: any[];
  onSave: (draft: EditDraft) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<EditDraft>({
    id: dispatch?.id,
    vehicleNo: dispatch?.vehicleNo || '',
    driverName: dispatch?.driverName || '',
    driverPhone: dispatch?.driverPhone || '',
    transporterId: dispatch?.transporterId || '',
    lrNumber: dispatch?.lrNumber || '',
    notes: dispatch?.notes || '',
    assignedToId: dispatch?.assignedToId || '',
    assignedToName: dispatch?.assignedToName || '',
    priority: dispatch?.priority || 'Normal',
    date: String(dispatch?.date || dispatch?.createdAt || new Date().toISOString()).slice(0, 10),
  });
  const activeUsers = useMemo(() => (users || []).filter((u) => u?.isDeleted !== true), [users]);
  const usersById = useMemo(() => new Map(activeUsers.map((user) => [String(user.id), user])), [activeUsers]);
  const assignedOptions = useMemo(() => activeUsers.map((user) => ({ label: user.name || user.email || 'System', value: user.id })), [activeUsers]);

  return (
    <FormSection title="Edit Dispatch">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <FormRow>
          <Input label="Vehicle No" value={draft.vehicleNo} onChange={(e) => setDraft({ ...draft, vehicleNo: e.target.value })} />
          <Input label="Driver Name" value={draft.driverName} onChange={(e) => setDraft({ ...draft, driverName: e.target.value })} />
        </FormRow>
        <FormRow>
          <Input label="Driver Phone" value={draft.driverPhone} onChange={(e) => setDraft({ ...draft, driverPhone: e.target.value })} />
          <Input label="LR Number" value={draft.lrNumber} onChange={(e) => setDraft({ ...draft, lrNumber: e.target.value })} />
        </FormRow>
        <FormRow>
          <Select
            label="Assigned User"
            value={draft.assignedToId}
            onChange={(e) => {
              const next = e.target.value;
              const user = usersById.get(next);
              setDraft({ ...draft, assignedToId: next, assignedToName: user?.name || user?.email || next });
            }}
            options={[{ label: 'Unassigned', value: '' }, ...assignedOptions]}
          />
          <Select
            label="Priority"
            value={draft.priority}
            onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
            options={[
              { label: 'Low', value: 'Low' },
              { label: 'Normal', value: 'Normal' },
              { label: 'High', value: 'High' },
              { label: 'Urgent', value: 'Urgent' },
            ]}
          />
        </FormRow>
        <FormRow>
          <Input label="Dispatch Date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          <div />
        </FormRow>
        <Textarea label="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={3} />
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>Save Changes</Button>
        </div>
      </form>
    </FormSection>
  );
}

/** The real dispatch state/result for one dispatch — summary, item-level view,
 * workflow actions, verify/execute, edit, delivery. No generic project context
 * (Notes/Activity/Documents/Linked Records) — that lives once at the Project
 * Workspace level, not inside this stage card. */
function DispatchStateView({
  dispatch,
  orderNumberById,
  users,
  perms,
  companyId,
  userRole,
  navigate,
}: {
  dispatch: any;
  orderNumberById: Map<string, string>;
  users: any[];
  perms: ReturnType<typeof usePermissions>;
  companyId: string;
  userRole: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const qc = useQueryClient();
  const keys = queryKeys.forCompany(companyId);
  const invalidateDispatch = () => qc.invalidateQueries({ queryKey: keys.dispatchRoot });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveDispatch(id),
    onSuccess: () => { invalidateDispatch(); qc.invalidateQueries({ queryKey: keys.projectsRoot }); toast.success('Dispatch approved'); },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });
  const executeMut = useMutation({
    mutationFn: ({ d, vItems }: { d: any; vItems: any[] }) => executeAndVerifyDispatch(d, vItems),
    onSuccess: () => {
      invalidateDispatch();
      qc.invalidateQueries({ queryKey: keys.ordersRoot });
      qc.invalidateQueries({ queryKey: keys.stock });
      qc.invalidateQueries({ queryKey: keys.stockLedger });
      qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success('Dispatch verified and executed');
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });
  const closeMut = useMutation({
    mutationFn: (id: string) => closeDispatch(id),
    onSuccess: () => { invalidateDispatch(); qc.invalidateQueries({ queryKey: keys.ordersRoot }); toast.success('Dispatch closed'); },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });
  const confirmDeliveryMut = useMutation({
    mutationFn: ({ dispatchId, otp }: { dispatchId: string; otp: string }) => confirmDelivery(dispatchId, otp),
    onSuccess: () => { invalidateDispatch(); qc.invalidateQueries({ queryKey: keys.ordersRoot }); toast.success('Delivery confirmed'); },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });
  const integrityMut = useMutation({
    mutationFn: (id: string) => validateDispatchIntegrity(id),
    onSuccess: (result) => {
      if (result.valid) toast.success('Dispatch integrity check passed');
      else toast.error(result.issues.join('\n'));
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });
  // The logistics edit — the IDENTICAL updateDocById payload the retired
  // popup's save mutation used (there is no separate updateDispatch service).
  const saveEditMut = useMutation({
    mutationFn: async (draft: EditDraft) => {
      await updateDocById(COLLECTIONS.DISPATCH, draft.id, {
        vehicleNo: draft.vehicleNo,
        driverName: draft.driverName,
        driverPhone: draft.driverPhone,
        transporterId: draft.transporterId,
        lrNumber: draft.lrNumber,
        notes: draft.notes,
        assignedToId: draft.assignedToId || null,
        assignedToName: draft.assignedToName || '',
        priority: draft.priority || 'Normal',
        date: draft.date || undefined,
        updatedAt: new Date().toISOString(),
        updatedBy: useAppStore.getState().user?.id || 'system',
      });
      await logActivity('Dispatch', 'Updated Dispatch', draft.id, {
        entityName: draft.id,
        actionLabel: 'Updated dispatch',
        vehicleNo: draft.vehicleNo,
        driverName: draft.driverName,
        driverPhone: draft.driverPhone,
        lrNumber: draft.lrNumber,
        priority: draft.priority,
        assignedToId: draft.assignedToId || undefined,
        assignedToName: draft.assignedToName || undefined,
      });
    },
    onSuccess: () => {
      invalidateDispatch();
      toast.success('Dispatch updated');
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });

  const readOnly = dispatch?.status === 'Delivered' || dispatch?.status === 'Closed';
  const deliveryStatus = dispatch?.deliveryConfirmed || readOnly ? 'Delivered' : 'Delivery Pending';
  const workflowState = dispatchWorkflowState(dispatch);
  const resolvedOrderNumber = orderNumberById?.get?.(String(dispatch?.orderId || '')) || '—';

  const [otp, setOtp] = useState('');
  const canConfirmDelivery = Boolean(userRole && /(sales|dispatch|account)/i.test(userRole) && !['Delivered', 'Closed'].includes(dispatch?.status));

  async function printChallan() {
    const toastId = toast.loading('Generating challan...');
    try {
      const { getOne } = await import('../../../../../lib/firestore');
      const { company } = useAppStore.getState();
      const fullCompany = await getOne(COLLECTIONS.COMPANIES, dispatch.companyId || company.id) || company;
      const { DocumentTemplateResolver, triggerPrint } = await import('../../../../../templates/documents/resolver');
      const html = DocumentTemplateResolver(fullCompany as any, 'DISPATCH CHALLAN', dispatch);
      triggerPrint(html);
      toast.success('Challan ready', { id: toastId });
    } catch {
      toast.error('Failed to generate challan', { id: toastId });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{dispatchDisplayNumber(dispatch)}</p>
            {statusBadge(dispatch.status || 'Pending')}
            {statusBadge(dispatch.approvalStatus || 'Pending')}
            {statusBadge(deliveryStatus)}
            {readOnly && <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Read Only</span>}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {dispatch.customer || '—'} · {dispatchWarehouse(dispatch)} · Order {resolvedOrderNumber} · Progress {dispatchProgress(dispatch)}%
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="xs" variant="outline" icon={<Printer className="h-3.5 w-3.5" />} onClick={printChallan}>Challan</Button>
          <Button size="xs" variant="outline" icon={<Search className="h-3.5 w-3.5" />} loading={integrityMut.isPending} onClick={() => integrityMut.mutate(dispatch.id)}>Integrity</Button>
          <Button size="xs" variant="outline" icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => navigate(`/dispatch/${encodeURIComponent(dispatch.id)}`)}>
            Full workspace
          </Button>
        </div>
      </div>

      {/* Workflow actions — status-driven, canonical services only */}
      {dispatch.approvalStatus === 'Pending' && perms.canApprove('dispatch') && !readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-light)] px-3 py-2.5">
          <p className="text-xs font-semibold text-[var(--color-warning-text)]">Requires Accounts/Credit approval to proceed.</p>
          <Button variant="success" size="sm" onClick={() => approveMut.mutate(dispatch.id)} loading={approveMut.isPending}>Approve Dispatch</Button>
        </div>
      )}
      {canConfirmDelivery && !readOnly && deliveryStatus !== 'Delivered' && (
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <p className="text-xs font-semibold text-[var(--color-text)]">Confirm delivery</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">Enter the customer OTP to mark the dispatch delivered.</p>
            </div>
            <Input label="Delivery OTP" value={otp} maxLength={6} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 digit OTP" className="w-40" />
          </div>
          <Button type="button" disabled={otp.length !== 6} loading={confirmDeliveryMut.isPending} onClick={() => confirmDeliveryMut.mutate({ dispatchId: dispatch.id, otp })}>
            Confirm Delivery
          </Button>
        </div>
      )}
      {!readOnly && (dispatch.status === 'Dispatched' || dispatch.status === 'Delivered') && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
          <p className="text-xs text-[var(--color-text-muted)]">Dispatch is {dispatch.status.toLowerCase()} — close it to complete the logistics workflow and trigger reconciliation.</p>
          <Button variant="danger" size="sm" loading={closeMut.isPending} onClick={() => closeMut.mutate(dispatch.id)}>Close Dispatch</Button>
        </div>
      )}

      <FormSection title="Items">
        <DispatchItemsTable dispatch={dispatch} />
        <p className="text-[11px] text-[var(--color-text-disabled)]">
          Verified quantities came from executeAndVerifyDispatch, which also issues the stock (STOCK_LEDGER OUT) and updates the order's dispatched/pending quantities.
        </p>
      </FormSection>

      <FormSection title="Logistics">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            ['Vehicle', dispatch.vehicleNo || '—'],
            ['Driver', dispatch.driverName || '—'],
            ['Driver Phone', dispatch.driverPhone || '—'],
            ['LR Number', dispatch.lrNumber || '—'],
            ['Type', dispatchType(dispatch)],
            ['Created', fmtDate(dispatch.createdAt || dispatch.date)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
              <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{value}</p>
            </div>
          ))}
        </div>
        {workflowState === 'closed' && dispatch.closedAt && (
          <p className="text-[11px] text-[var(--color-text-muted)]">Closed {fmtDateTime(dispatch.closedAt)}</p>
        )}
      </FormSection>

      {perms.canEdit('dispatch') && !readOnly && (
        <EditDispatchForm
          dispatch={dispatch}
          users={users}
          onSave={(draft) => saveEditMut.mutate(draft)}
          saving={saveEditMut.isPending}
        />
      )}

      {perms.canApprove('dispatch') && (
        <VerifyExecuteSection
          dispatch={dispatch}
          onExecute={(vItems) => executeMut.mutate({ d: dispatch, vItems })}
          executing={executeMut.isPending}
          onIntegrity={() => integrityMut.mutate(dispatch.id)}
          checkingIntegrity={integrityMut.isPending}
        />
      )}

    </div>
  );
}

export default function ProjectDispatchWorkspace({ project }: ProjectStageWorkspaceProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const user = useAppStore((s) => s.user);

  const { data: dispatches = [], isLoading } = useQuery({
    queryKey: keys.dispatchAll,
    queryFn: () => getAll(COLLECTIONS.DISPATCH),
    staleTime: 30_000,
  });
  const { data: orders = [] } = useOrders();
  const { data: warehouses = [] } = useQuery({
    queryKey: keys.warehouses,
    queryFn: () => getAll(COLLECTIONS.WAREHOUSES),
    staleTime: 300_000,
  });
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300_000,
  });
  const { data: products = [] } = useSalesProducts();

  const projectDispatches = useMemo(
    () => (dispatches as any[])
      .filter((d) => d.projectId === project.id)
      .sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime()),
    [dispatches, project.id],
  );
  const projectOrders = useMemo(
    () => (orders as any[]).filter((o) => o.projectId === project.id),
    [orders, project.id],
  );
  const orderNumberById = useMemo(() => {
    const map = new Map<string, string>();
    (orders as any[]).forEach((order: any) => map.set(String(order.id), order.orderNumber || order.orderNo || order.id || '—'));
    return map;
  }, [orders]);

  const [activeDispatchId, setActiveDispatchId] = useState<string | undefined>(undefined);
  const activeDispatch = projectDispatches.find((d) => d.id === activeDispatchId) || projectDispatches[0];

  // ── Request Dispatch flow (reuses DispatchRequestModal + requestDispatch) ──
  const [showRequest, setShowRequest] = useState(false);
  const [form, setForm] = useState<any>({ ...DEFAULT_FORM, projectId: project.id, projectName: project.projectId || project.id });
  const [items, setItems] = useState<any[]>([]);
  const [createdDispatch, setCreatedDispatch] = useState<{ dispatchId: string; deliveryOTP: string } | null>(null);

  const createReq = useMutation({
    mutationFn: (payload: any) => requestDispatch(payload),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: keys.dispatchRoot });
      qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success('Dispatch request submitted');
      setShowRequest(false);
      setForm({ ...DEFAULT_FORM, projectId: project.id, projectName: project.projectId || project.id });
      setItems([]);
      setCreatedDispatch(result);
      if (result?.dispatchId) setActiveDispatchId(result.dispatchId);
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });

  function loadOrderForDispatch(orderId: string) {
    const order = (orders as any[]).find((row: any) => row.id === orderId);
    if (!order) return;
    setForm((prev: any) => ({ ...prev, orderId, customerId: order.customerId || '', customer: order.customer || '' }));
    const pendingItems = (order.items || [])
      .map((item: any, idx: number) => ({ item, idx }))
      .filter(({ item }: any) => (item.pendingQty || item.qty) > 0)
      .map(({ item, idx }: any) => {
        const product = (products as any[]).find((row: any) => row.id === item.productId);
        return {
          orderLineId: item.lineId || item.id || `idx:${idx}`,
          orderLineIndex: idx,
          productId: item.productId,
          product: item.product,
          requestedQty: item.pendingQty || item.qty,
          maxQty: item.pendingQty || item.qty,
          trackingType: product?.trackingType || 'none',
          unit: item.unit || 'PCS',
        };
      });
    setItems(pendingItems);
  }

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  // ── No dispatch yet — the request flow (existing DispatchRequestModal) ──
  if (projectDispatches.length === 0) {
    return (
      <div className="space-y-3">
        <div className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
            <Truck className="h-4 w-4 text-[var(--color-text-muted)]" />
            No dispatch has been requested for this project yet.
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            {projectOrders.length === 0
              ? 'A dispatch is raised against an Order — place an Order at Stage 5 first, then request the dispatch here.'
              : 'Request a dispatch against the project order below — the full dispatch workflow (approval, warehouse verification, execution, delivery, close) runs here.'}
          </p>
          {perms.canCreate('dispatch') && projectOrders.length > 0 && (
            <Button size="xs" icon={<Truck className="h-3.5 w-3.5" />} onClick={() => setShowRequest(true)}>Request Dispatch</Button>
          )}
        </div>

        {createdDispatch && (
          <div className="space-y-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
            <p className="text-xs font-semibold text-[var(--color-text)]">Dispatch {createdDispatch.dispatchId} created</p>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[11px] text-[var(--color-text-muted)]">Delivery OTP</p>
              <p className="font-mono text-lg font-bold tracking-widest text-[var(--color-text)]">{createdDispatch.deliveryOTP}</p>
              <Button size="xs" variant="outline" onClick={() => { void navigator.clipboard?.writeText(createdDispatch.deliveryOTP); toast.success('OTP copied'); }}>Copy</Button>
            </div>
          </div>
        )}

        <DispatchRequestModal
          open={showRequest}
          onClose={() => setShowRequest(false)}
          form={form}
          setForm={setForm}
          items={items}
          setItems={setItems}
          orders={projectOrders}
          warehouses={warehouses as any[]}
          projects={[project]}
          onOrderSelect={loadOrderForDispatch}
          onSubmit={() => {
            if (createReq.isPending) return;
            createReq.mutate({ ...form, items: items.filter((item) => item.requestedQty > 0) });
          }}
          submitting={createReq.isPending}
        />
      </div>
    );
  }

  // ── Dispatch(es) exist — the full operational workspace ──
  return (
    <div className="space-y-3">
      {createdDispatch && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
          <p className="text-xs font-semibold text-[var(--color-text)]">Dispatch {createdDispatch.dispatchId} created</p>
          <p className="text-[11px] text-[var(--color-text-muted)]">Delivery OTP</p>
          <p className="font-mono text-base font-bold tracking-widest text-[var(--color-text)]">{createdDispatch.deliveryOTP}</p>
          <Button size="xs" variant="outline" onClick={() => { void navigator.clipboard?.writeText(createdDispatch.deliveryOTP); toast.success('OTP copied'); }}>Copy</Button>
        </div>
      )}

      {projectDispatches.length > 1 && (
        <Select
          label="Dispatch"
          value={activeDispatch.id}
          onChange={(e) => setActiveDispatchId(e.target.value)}
          options={projectDispatches.map((d) => ({ label: `${dispatchDisplayNumber(d)} · ${d.status || 'Pending'}`, value: d.id }))}
        />
      )}

      {perms.canCreate('dispatch') && (
        <div className="flex justify-end">
          <Button size="xs" variant="outline" icon={<Truck className="h-3.5 w-3.5" />} onClick={() => setShowRequest(true)}>Request Another Dispatch</Button>
        </div>
      )}

      <DispatchStateView
        key={activeDispatch.id}
        dispatch={activeDispatch}
        orderNumberById={orderNumberById}
        users={users as any[]}
        perms={perms}
        companyId={resolveWriteCompanyId()}
        userRole={String(user?.role || '')}
        navigate={navigate}
      />

      <DispatchRequestModal
        open={showRequest}
        onClose={() => setShowRequest(false)}
        form={form}
        setForm={setForm}
        items={items}
        setItems={setItems}
        orders={projectOrders}
        warehouses={warehouses as any[]}
        projects={[project]}
        onOrderSelect={loadOrderForDispatch}
        onSubmit={() => {
          if (createReq.isPending) return;
          createReq.mutate({ ...form, items: items.filter((item) => item.requestedQty > 0) });
        }}
        submitting={createReq.isPending}
      />
    </div>
  );
}
