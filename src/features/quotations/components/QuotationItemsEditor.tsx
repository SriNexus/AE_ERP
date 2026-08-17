/**
 * QuotationItemsEditor — extracted from Quotations.tsx (Phase 2 of the
 * Customer Workspace rebuild), mirroring the existing OrderItemsEditor
 * pattern exactly (src/features/orders/components/OrderItemsEditor.tsx) so
 * both the standalone Quotations page and the Customer Workspace's embedded
 * Quotation workflow share one implementation — not two divergent copies.
 *
 * Field set, calculations, and markup are a verbatim lift from the page's
 * previous inline item table (PRE-EXISTING BEHAVIOR, unchanged): Product,
 * Specs/Model, Qty, Unit Price, Tax %, Warranty, computed line Total.
 * Quotation's discount/charges model differs from Order's — extra charges
 * and the special discount are separate form fields on the Quotation form
 * itself (installationCharges/transportCharges/specialDiscount), not an
 * item-editor concept, so unlike OrderItemsEditor this component has no
 * onDiscountChange — it renders whatever extra-charge/discount lines the
 * caller already computed into the totals summary.
 */
import { Plus } from 'lucide-react';
import { fmtCurrency } from '../../../lib/firestore';

interface QuotationItemsEditorProps {
  items: any[];
  products: any[];
  currencySymbol: string;
  subtotal: number;
  taxTotal: number;
  installationCharges: number;
  transportCharges: number;
  specialDiscount: number;
  grandTotal: number;
  onAddItem: () => void;
  onRemoveItem: (idx: number) => void;
  onUpdateItem: (idx: number, key: string, val: any) => void;
}

const FIELD_CLS = 'w-full text-xs border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text)] rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)]';

export function QuotationItemsEditor({
  items, products, currencySymbol,
  subtotal, taxTotal, installationCharges, transportCharges, specialDiscount, grandTotal,
  onAddItem, onRemoveItem, onUpdateItem,
}: QuotationItemsEditorProps) {
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--color-bg-sunken)]">
            <tr>
              {['Product', 'Specs/Model', 'Qty', 'Unit Price', 'Tax %', 'Warranty', 'Total', ''].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)]">
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="px-2 py-2 min-w-44">
                  <select value={it.productId} onChange={(e) => onUpdateItem(idx, 'productId', e.target.value)} className={FIELD_CLS}>
                    <option value="">Custom</option>
                    {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {!it.productId && (
                    <input className={`${FIELD_CLS} mt-1`} placeholder="Product name" value={it.product} onChange={(e) => onUpdateItem(idx, 'product', e.target.value)} />
                  )}
                </td>
                <td className="px-2 py-2 min-w-40">
                  <input className={FIELD_CLS} placeholder="Make/Model/Specs" value={it.specs || ''} onChange={(e) => onUpdateItem(idx, 'specs', e.target.value)} />
                </td>
                <td className="px-2 py-2 w-16">
                  <input type="number" min="1" value={it.qty} onChange={(e) => onUpdateItem(idx, 'qty', e.target.value)} className={`${FIELD_CLS} text-right`} />
                </td>
                <td className="px-2 py-2 w-28">
                  <input type="number" min="0" value={it.price} onChange={(e) => onUpdateItem(idx, 'price', e.target.value)} className={`${FIELD_CLS} text-right`} />
                </td>
                <td className="px-2 py-2 w-16">
                  <input type="number" min="0" max="100" value={it.tax} onChange={(e) => onUpdateItem(idx, 'tax', e.target.value)} className={`${FIELD_CLS} text-right`} />
                </td>
                <td className="px-2 py-2 min-w-32">
                  <input className={FIELD_CLS} placeholder="e.g. 30 Years" value={it.warranty || ''} onChange={(e) => onUpdateItem(idx, 'warranty', e.target.value)} />
                </td>
                <td className="px-2 py-2 w-28 text-right font-semibold text-[var(--color-text)]">
                  {fmtCurrency((Number(it.qty) || 0) * (Number(it.price) || 0), currencySymbol)}
                </td>
                <td className="px-2 py-2">
                  <button type="button" onClick={() => onRemoveItem(idx)} className="text-[var(--color-danger)] hover:opacity-80 p-1">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={onAddItem} className="text-xs text-[var(--color-primary-text)] hover:opacity-80 font-medium flex items-center gap-1 mt-1">
        <Plus className="h-3.5 w-3.5" /> Add Item
      </button>

      {items.length > 0 && (
        <div className="flex justify-end mt-3">
          <div className="w-72 space-y-1.5 text-sm bg-[var(--color-primary-light)] border border-[var(--color-primary-muted)] rounded-xl p-4">
            <div className="flex justify-between text-[var(--color-text-secondary)]"><span>Subtotal</span><span>{fmtCurrency(subtotal, currencySymbol)}</span></div>
            <div className="flex justify-between text-[var(--color-text-secondary)]"><span>GST / Tax</span><span>{fmtCurrency(taxTotal, currencySymbol)}</span></div>
            {installationCharges > 0 && <div className="flex justify-between text-[var(--color-text-secondary)]"><span>Installation</span><span>{fmtCurrency(installationCharges, currencySymbol)}</span></div>}
            {transportCharges > 0 && <div className="flex justify-between text-[var(--color-text-secondary)]"><span>Transport</span><span>{fmtCurrency(transportCharges, currencySymbol)}</span></div>}
            {specialDiscount > 0 && <div className="flex justify-between text-[var(--color-success-text)]"><span>Discount</span><span>- {fmtCurrency(specialDiscount, currencySymbol)}</span></div>}
            <div className="flex justify-between font-bold border-t border-[var(--color-primary-muted)] pt-2 text-base text-[var(--color-text)]">
              <span>Grand Total</span><span>{fmtCurrency(grandTotal, currencySymbol)}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
