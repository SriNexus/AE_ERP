/**
 * OrderItemsEditor — extracted from Orders.tsx
 * Phase P1: Full semantic token compliance.
 */
import { Plus } from 'lucide-react';
import { fmtCurrency } from '../../../lib/firestore';

interface OrderItemsEditorProps {
  items:            any[];
  products:         any[];
  currencySymbol:   string;
  subtotal:         number;
  taxTotal:         number;
  discount:         number;
  grandTotal:       number;
  onAddItem:        () => void;
  onRemoveItem:     (idx: number) => void;
  onUpdateItem:     (idx: number, key: string, val: any) => void;
  onDiscountChange: (val: string) => void;
}

const FIELD_CLS = 'w-full text-xs border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text)] rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)]';

export function OrderItemsEditor({
  items, products, currencySymbol,
  subtotal, taxTotal, discount, grandTotal,
  onAddItem, onRemoveItem, onUpdateItem, onDiscountChange,
}: OrderItemsEditorProps) {
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--color-bg-sunken)]">
            <tr>
              {['Product','Qty','Unit Price','Tax %','Total',''].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)]">
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="px-2 py-2 min-w-48">
                  <select
                    value={it.productId}
                    onChange={e => onUpdateItem(idx, 'productId', e.target.value)}
                    className={FIELD_CLS}
                  >
                    <option value="">Select product</option>
                    {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {it.historyText && <div className="text-[9px] text-[var(--color-success-text)] mt-0.5 font-medium">{it.historyText}</div>}
                </td>
                <td className="px-2 py-2 w-20">
                  <input type="number" min="1" value={it.qty} onChange={e => onUpdateItem(idx, 'qty', e.target.value)}
                    className={`${FIELD_CLS} text-right`}/>
                </td>
                <td className="px-2 py-2 w-28">
                  <input type="number" min="0" value={it.price} onChange={e => onUpdateItem(idx, 'price', e.target.value)}
                    className={`${FIELD_CLS} text-right`}/>
                </td>
                <td className="px-2 py-2 w-20">
                  <input type="number" min="0" max="100" value={it.tax} onChange={e => onUpdateItem(idx, 'tax', e.target.value)}
                    className={`${FIELD_CLS} text-right`}/>
                </td>
                <td className="px-2 py-2 w-28 text-right font-semibold text-[var(--color-text)]">
                  {fmtCurrency((Number(it.qty)||0)*(Number(it.price)||0), currencySymbol)}
                </td>
                <td className="px-2 py-2">
                  <button type="button" onClick={() => onRemoveItem(idx)} className="text-[var(--color-danger)] hover:opacity-80 p-1">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={onAddItem}
        className="text-xs text-[var(--color-primary-text)] hover:opacity-80 font-medium flex items-center gap-1 mt-1">
        <Plus className="h-3.5 w-3.5"/> Add Item
      </button>

      {items.length > 0 && (
        <div className="flex justify-end">
          <div className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Subtotal</span>
              <span className="font-medium text-[var(--color-text)]">{fmtCurrency(subtotal, currencySymbol)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Tax</span>
              <span className="font-medium text-[var(--color-text)]">{fmtCurrency(taxTotal, currencySymbol)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--color-text-muted)]">Discount</span>
              <input type="number" value={discount}
                onChange={e => onDiscountChange(e.target.value)}
                className="w-24 text-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text)] rounded px-2 py-1 text-right focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)]"/>
            </div>
            <div className="flex justify-between border-t border-[var(--color-border)] pt-2 font-bold">
              <span className="text-[var(--color-text)]">Grand Total</span>
              <span className="text-[var(--color-primary-text)]">{fmtCurrency(grandTotal, currencySymbol)}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
