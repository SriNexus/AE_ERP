/**
 * InvoiceItemsDisplay — extracted from Invoices.tsx
 * Phase P1: Full semantic token compliance.
 */
import { fmtCurrency } from '../../../lib/firestore';

interface InvoiceItemsDisplayProps {
  items:            any[];
  currencySymbol:   string;
  subtotal:         number;
  taxAmount:        number;
  discount:         string;
  grandTotal:       number;
  onDiscountChange: (val: string) => void;
}

export function InvoiceItemsDisplay({
  items, currencySymbol, subtotal, taxAmount, discount, grandTotal, onDiscountChange,
}: InvoiceItemsDisplayProps) {
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--color-bg-sunken)]">
            <tr>
              {['Product','Qty','Unit Price','Tax %','Total'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-semibold text-[var(--color-text-muted)] uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)]">
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="px-3 py-2 font-medium text-[var(--color-text)]">{it.product}</td>
                <td className="px-3 py-2 text-[var(--color-text-secondary)]">{it.qty} {it.unit}</td>
                <td className="px-3 py-2 text-[var(--color-text-secondary)]">{fmtCurrency(it.price, currencySymbol)}</td>
                <td className="px-3 py-2 text-[var(--color-text-secondary)]">{it.tax}%</td>
                <td className="px-3 py-2 font-semibold text-[var(--color-text)]">{fmtCurrency(it.total, currencySymbol)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {items.length > 0 && (
        <div className="flex justify-end mt-2">
          <div className="w-64 space-y-1.5 text-sm bg-[var(--color-bg-sunken)] p-3 rounded-lg border border-[var(--color-border)]">
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Subtotal</span>
              <span className="font-medium text-[var(--color-text)]">{fmtCurrency(subtotal, currencySymbol)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Tax</span>
              <span className="font-medium text-[var(--color-text)]">{fmtCurrency(taxAmount, currencySymbol)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--color-text-muted)]">Discount</span>
              <input
                type="number"
                value={discount}
                onChange={e => onDiscountChange(e.target.value)}
                className="w-24 text-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text)] rounded px-2 py-1 text-right focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)]"
                placeholder="Optional"
              />
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
