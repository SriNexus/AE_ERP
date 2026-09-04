/**
 * INVENTORY-10 (§10e) — Customer Return / RMA entry point. A thin UI over
 * `createCustomerReturn` (the authoritative workflow — this component
 * contains NO stock business logic of its own, matching every other
 * inventory modal in this codebase).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Button, Modal, Input, Select } from '../../../components/ui';
import { genId } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { createCustomerReturn, type CustomerReturnItemInput, type ReturnCondition } from '../services/customerReturnWorkflow';
import { DAMAGE_REASON_CODES, DAMAGE_REASON_LABELS, type DamageReasonCode } from '../services/stockOperationsWorkflow';

export interface ReturnableDispatchLine {
  productId: string;
  product?: string;
  unit?: string;
  /** Actually-dispatched quantity — the return ceiling for this line. */
  verifiedQty?: number;
}

interface RowState {
  productId: string;
  product: string;
  unit: string;
  maxQty: number;
  include: boolean;
  qty: string;
  condition: ReturnCondition;
  damageReasonCode: DamageReasonCode | '';
}

function rowsFromItems(items: ReturnableDispatchLine[]): RowState[] {
  return items
    .filter((it) => (Number(it.verifiedQty) || 0) > 0)
    .map((it) => ({
      productId: it.productId, product: it.product || it.productId, unit: it.unit || 'PCS',
      maxQty: Number(it.verifiedQty) || 0, include: false, qty: '', condition: 'resellable', damageReasonCode: '',
    }));
}

export function ProcessReturnModal({ open, onClose, orderId, dispatchId, items }: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  dispatchId: string;
  items: ReturnableDispatchLine[];
}) {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const [rows, setRows] = useState<RowState[]>(() => rowsFromItems(items));

  // Re-seed the row set every time the modal is opened for a (possibly
  // different) dispatch — never carry a stale selection across dispatches.
  useEffect(() => {
    if (open) setRows(rowsFromItems(items));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dispatchId]);

  function updateRow(index: number, patch: Partial<RowState>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const selected = rows.filter((r) => r.include);
      if (!selected.length) throw new Error('Select at least one item to return');
      const returnItems: CustomerReturnItemInput[] = selected.map((r) => {
        const qty = Number(r.qty);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Enter a valid quantity for ${r.product}`);
        if (qty > r.maxQty) throw new Error(`${r.product}: quantity exceeds the dispatched amount (${r.maxQty})`);
        if (r.condition === 'damaged' && !r.damageReasonCode) throw new Error(`${r.product}: a damage reason is required`);
        return {
          productId: r.productId, qty, condition: r.condition,
          ...(r.condition === 'damaged' ? { damageReasonCode: r.damageReasonCode as DamageReasonCode } : {}),
        };
      });
      const returnId = genId.generic('RET');
      return createCustomerReturn({ orderId, dispatchId, items: returnItems }, returnId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.stock });
      qc.invalidateQueries({ queryKey: keys.stockLedger });
      toast.success('Return processed');
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to process return'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Process Customer Return" size="lg">
      <div className="space-y-4">
        {rows.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">This dispatch has no returnable lines.</p>
        )}
        {rows.map((row, idx) => (
          <div key={row.productId} className="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={row.include}
                onChange={(event) => updateRow(idx, { include: event.target.checked })}
                className="h-4 w-4"
              />
              {row.product}
              <span className="text-xs font-normal text-[var(--color-text-muted)]">(dispatched {row.maxQty} {row.unit})</span>
            </label>
            {row.include && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <Input
                  label="Quantity" type="number" min="0" max={row.maxQty} required
                  value={row.qty}
                  onChange={(event) => updateRow(idx, { qty: event.target.value })}
                />
                <Select
                  label="Condition"
                  value={row.condition}
                  onChange={(event) => updateRow(idx, { condition: event.target.value as ReturnCondition, damageReasonCode: '' })}
                  options={[{ label: 'Resellable', value: 'resellable' }, { label: 'Damaged', value: 'damaged' }]}
                />
                {row.condition === 'damaged' && (
                  <Select
                    label="Damage Reason" required
                    value={row.damageReasonCode}
                    onChange={(event) => updateRow(idx, { damageReasonCode: event.target.value as DamageReasonCode })}
                    options={[{ label: 'Select reason...', value: '' }, ...DAMAGE_REASON_CODES.map((code) => ({ label: DAMAGE_REASON_LABELS[code], value: code }))]}
                  />
                )}
              </div>
            )}
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" loading={mutation.isPending} onClick={() => mutation.mutate()}>Process Return</Button>
        </div>
      </div>
    </Modal>
  );
}
