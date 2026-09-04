/**
 * INVENTORY-10 (§10c) — Bulk stock import / bulk adjust UI. A thin wrapper
 * over `previewBulkAdjust` / `applyBulkAdjust` (the authoritative workflow —
 * this component contains NO stock business logic, and no idempotency
 * logic of its own: `importRunId` is minted ONCE per uploaded file and held
 * in state, reused for both the preview and the apply call).
 *
 * CSV columns (case-insensitive, header order doesn't matter):
 *   sku (or product) | warehouse | qty | unit | reason | notes
 * `sku`/`warehouse` are resolved against the company's own products /
 * warehouses (by SKU or exact name) — never raw Firestore ids, so the file
 * stays human-editable. Reuses CSVImportModal's own CSV parser (one
 * implementation, not a second one).
 */
import { useRef, useState } from 'react';
import { UploadCloud, AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Modal } from '../../../components/ui';
import { genId } from '../../../lib/firestore';
import { parseCSV } from '../../../components/shared/CSVImportModal';
import { previewBulkAdjust, applyBulkAdjust, type BulkAdjustRow, type BulkAdjustReport } from '../services/bulkStockImportWorkflow';
import type { Product } from '../../../types';

interface WarehouseRef { id: string; name?: string; }

interface ResolvedRow extends BulkAdjustRow {
  productLabel: string;
  warehouseLabel: string;
}
interface UnresolvedRow { rowNumber: number; reason: string; raw: Record<string, string>; }

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function resolveRows(csvRows: Record<string, string>[], products: Product[], warehouses: WarehouseRef[]): { resolved: ResolvedRow[]; unresolved: UnresolvedRow[] } {
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [norm(String(p.sku)), p]));
  const byName = new Map(products.map((p) => [norm(String(p.name || '')), p]));
  const whByName = new Map(warehouses.map((w) => [norm(String(w.name || '')), w]));
  const whById = new Map(warehouses.map((w) => [w.id, w]));

  const resolved: ResolvedRow[] = [];
  const unresolved: UnresolvedRow[] = [];
  csvRows.forEach((raw, index) => {
    const rowNumber = index + 2; // header is row 1
    const skuOrName = String(raw.sku || raw.product || raw.productid || '').trim();
    const warehouseRef = String(raw.warehouse || raw.warehouseid || '').trim();
    const qtyRaw = String(raw.qty || raw.quantity || '').trim();
    const reasonCode = String(raw.reason || raw.reasoncode || '').trim();

    const product = bySku.get(norm(skuOrName)) || byName.get(norm(skuOrName));
    if (!product) { unresolved.push({ rowNumber, reason: `Unknown product "${skuOrName}"`, raw }); return; }
    const warehouse = whById.get(warehouseRef) || whByName.get(norm(warehouseRef));
    if (!warehouse) { unresolved.push({ rowNumber, reason: `Unknown warehouse "${warehouseRef}"`, raw }); return; }
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty === 0) { unresolved.push({ rowNumber, reason: `Invalid quantity "${qtyRaw}"`, raw }); return; }
    if (!reasonCode) { unresolved.push({ rowNumber, reason: 'Missing reason', raw }); return; }

    resolved.push({
      rowNumber, productId: product.id!, warehouseId: warehouse.id, qty, unit: String(raw.unit || product.unit || 'PCS'),
      reasonCode, notes: raw.notes, productLabel: product.name || product.id!, warehouseLabel: warehouse.name || warehouse.id,
    });
  });
  return { resolved, unresolved };
}

export function BulkStockAdjustModal({ open, onClose, products, warehouses, onApplied }: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  warehouses: WarehouseRef[];
  onApplied: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importRunId, setImportRunId] = useState<string | null>(null);
  const [resolvedRows, setResolvedRows] = useState<ResolvedRow[]>([]);
  const [unresolvedRows, setUnresolvedRows] = useState<UnresolvedRow[]>([]);
  const [report, setReport] = useState<BulkAdjustReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  function reset() {
    setImportRunId(null); setResolvedRows([]); setUnresolvedRows([]); setReport(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const csvRows = parseCSV(String(reader.result || ''));
      if (!csvRows.length) { toast.error('No CSV rows found'); return; }
      const { resolved, unresolved } = resolveRows(csvRows, products, warehouses);
      setResolvedRows(resolved);
      setUnresolvedRows(unresolved);
      setReport(null);
      if (!resolved.length) {
        toast.error('No rows could be matched to a product + warehouse');
        return;
      }
      const runId = genId.generic('IMPORT');
      setImportRunId(runId);
      setLoading(true);
      try {
        const preview = await previewBulkAdjust(resolved, runId);
        setReport(preview);
      } catch (err: any) {
        toast.error(err?.message || 'Preview failed');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  }

  async function handleApply() {
    if (!importRunId || !resolvedRows.length) return;
    setApplying(true);
    try {
      const result = await applyBulkAdjust(resolvedRows, importRunId);
      setReport(result);
      const applied = result.rows.filter((r) => r.ok && r.applied).length;
      toast.success(`Applied ${applied} of ${result.totalRows} row${result.totalRows === 1 ? '' : 's'}`);
      onApplied();
    } catch (err: any) {
      toast.error(err?.message || 'Bulk import failed');
    } finally {
      setApplying(false);
    }
  }

  const okCount = report?.rows.filter((r) => r.ok).length || 0;
  const errCount = report?.rows.filter((r) => !r.ok).length || 0;
  const alreadyAppliedAny = report?.rows.some((r) => r.alreadyApplied) || false;

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Bulk Stock Adjust (CSV Import)"
      size="xl"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-center">
          <UploadCloud className="mx-auto h-6 w-6 text-[var(--color-text-muted)]" />
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            CSV columns: <code>sku</code> (or <code>product</code> name), <code>warehouse</code> (name), <code>qty</code> (signed — positive adds, negative removes), <code>unit</code>, <code>reason</code>, <code>notes</code>.
          </p>
          <input
            ref={fileInputRef}
            type="file" accept=".csv,text/csv"
            onChange={(event) => void handleFile(event.target.files?.[0])}
            className="mt-3 text-xs"
          />
        </div>

        {unresolvedRows.length > 0 && (
          <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger-light)] p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-danger)]">
              <AlertTriangle className="h-3.5 w-3.5" /> {unresolvedRows.length} row(s) could not be matched — never guessed, reported here:
            </p>
            <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
              {unresolvedRows.slice(0, 10).map((row) => (
                <li key={row.rowNumber}>Row {row.rowNumber}: {row.reason}</li>
              ))}
              {unresolvedRows.length > 10 && <li>…and {unresolvedRows.length - 10} more</li>}
            </ul>
          </div>
        )}

        {loading && <p className="text-xs text-[var(--color-text-muted)]">Running dry-run preview…</p>}

        {report && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {okCount} OK</span>
              {errCount > 0 && <span className="flex items-center gap-1 font-semibold text-[var(--color-danger)]"><AlertTriangle className="h-3.5 w-3.5" /> {errCount} error(s)</span>}
              {alreadyAppliedAny && <span className="text-[var(--color-text-muted)]">Some rows were already applied by a prior attempt of this run — they will not be double-applied.</span>}
            </div>
            <div className="max-h-72 overflow-auto rounded-lg border border-[var(--color-border)]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[var(--color-bg-sunken)]">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Row</th>
                    <th className="px-2 py-1.5 text-left">Product</th>
                    <th className="px-2 py-1.5 text-left">Warehouse</th>
                    <th className="px-2 py-1.5 text-right">Qty</th>
                    <th className="px-2 py-1.5 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => {
                    const source = resolvedRows.find((r) => r.rowNumber === row.rowNumber);
                    return (
                      <tr key={row.rowNumber} className="border-t border-[var(--color-border-subtle)]">
                        <td className="px-2 py-1.5">{row.rowNumber}</td>
                        <td className="px-2 py-1.5">{source?.productLabel || row.productId}</td>
                        <td className="px-2 py-1.5">{source?.warehouseLabel || row.warehouseId}</td>
                        <td className="px-2 py-1.5 text-right">{row.qty}</td>
                        <td className="px-2 py-1.5">
                          {row.ok
                            ? (row.alreadyApplied ? <span className="text-[var(--color-text-muted)]">Already applied</span> : <span className="text-emerald-600">OK</span>)
                            : <span className="text-[var(--color-danger)]">{row.error}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" type="button" onClick={() => { reset(); onClose(); }}>Close</Button>
          <Button
            type="button"
            loading={applying}
            disabled={!report || okCount === 0}
            onClick={() => void handleApply()}
          >
            Apply {okCount > 0 ? `${okCount} Row${okCount === 1 ? '' : 's'}` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
