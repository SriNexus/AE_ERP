/**
 * StockReconciliationReport — INVENTORY-06 (P2-1)
 *
 * READ-ONLY diagnostic surface: `Stock -> Reconciliation Report ->
 * StockReconciliationEngine -> stock + stock_ledger`. Opening / filtering the
 * report performs ZERO writes (regression F4). A mismatch can be corrected only
 * by a deliberate, reason-required "Apply Correction" action gated by
 * `canDo('edit','stock')`, which goes through the movement engine as a
 * `RECONCILE_ADJUST` movement (audit-logged, idempotent per run-id). The engine
 * remains the only stock writer.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import {
  Button, Card, CardBody, CardHeader, EmptyState, Input, Modal,
  SkeletonRows, Table, Tbody, Td, Th, Thead, Tr, Textarea,
} from '../../../components/ui';
import { canDo } from '../../../lib/permissions';
import { useAppStore } from '../../../store/useAppStore';
import {
  generateStockHealthReport, applyReconciliationCorrection,
  type SummaryReconciliation,
} from '../../../engines/StockReconciliationEngine';

const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '—');
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '—');

export function StockReconciliationReport({ onClose }: { onClose?: () => void }) {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const canCorrect = canDo('edit', 'stock');

  // One reconciliation run id per opened report — the correction idempotency key.
  const [runId] = useState(() => `RECON-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [correcting, setCorrecting] = useState<SummaryReconciliation | null>(null);
  const [reason, setReason] = useState('');
  const [physicalCount, setPhysicalCount] = useState('');

  const report = useQuery({
    queryKey: ['stock-reconciliation-report', activeCompanyId],
    queryFn: () => generateStockHealthReport(),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const correction = useMutation({
    mutationFn: async (row: SummaryReconciliation) => {
      const trimmed = physicalCount.trim();
      const target = trimmed === '' ? undefined : Number(trimmed);
      if (target !== undefined && !Number.isFinite(target)) throw new Error('Physical count must be a number');
      return applyReconciliationCorrection({
        summaryId: row.summaryId,
        targetOnHand: target,
        reasonCode: reason.trim(),
        reconciliationRunId: runId,
      });
    },
    onSuccess: (res) => {
      toast.success(res.applied ? `Corrected by ${res.correctionQty > 0 ? '+' : ''}${res.correctionQty}` : 'Already reconciled — no correction needed');
      setCorrecting(null); setReason(''); setPhysicalCount('');
      void qc.invalidateQueries({ queryKey: ['stock-reconciliation-report'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void report.refetch();
    },
    onError: (e: any) => toast.error(e?.message || 'Correction failed'),
  });

  const data = report.data;
  const mismatches = useMemo(() => (data?.mismatches ?? []).slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)), [data]);

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="text-sm font-semibold">Stock ↔ Ledger Reconciliation</span>
          <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={report.isFetching} onClick={() => report.refetch()}>
            Re-run
          </Button>
        </CardHeader>
        <CardBody>
          {report.isLoading ? (
            <div className="text-sm text-[var(--color-text-secondary)]">Reconciling…</div>
          ) : report.isError ? (
            <div className="text-sm text-[var(--color-danger)]">Failed to reconcile: {(report.error as any)?.message}</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label="Summaries checked" value={data?.totalSummariesChecked ?? 0} />
              <Stat label="Reconciled" value={data?.reconciledCount ?? 0} tone="ok" />
              <Stat label="Mismatches" value={data?.mismatchCount ?? 0} tone={data?.mismatchCount ? 'warn' : 'ok'} />
              <Stat label="Total abs. drift" value={fmt(data?.totalAbsoluteDrift ?? 0)} />
              <Stat label="Real drift (post-engine)" value={data?.realDriftCount ?? 0} tone={data?.realDriftCount ? 'danger' : 'ok'} />
              <Stat label="Likely opening balance" value={data?.likelyOpeningBalanceCount ?? 0} />
              <Stat label="Net drift" value={fmt(data?.netDrift ?? 0)} />
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            <code>computed</code> is derived from the stock ledger (operational movements only) and may be incomplete for a product
            whose opening balance predates the movement engine. Review each mismatch against a physical count before correcting.
          </p>
        </CardBody>
      </Card>

      {!report.isLoading && mismatches.length === 0 && (
        <EmptyState icon={<CheckCircle2 className="h-8 w-8" />} title="Everything reconciles" description="Every stock summary agrees with its ledger history." />
      )}

      {mismatches.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <Thead>
              <Tr>
                <Th>Product</Th><Th>Warehouse</Th>
                <Th className="text-right">Stored</Th><Th className="text-right">Computed</Th><Th className="text-right">Delta</Th>
                <Th className="text-right">Ledger rows</Th><Th>First move</Th><Th>Last move</Th><Th>Assessment</Th>
                {canCorrect && <Th />}
              </Tr>
            </Thead>
            <Tbody>
              {report.isLoading && <SkeletonRows rows={4} cols={canCorrect ? 10 : 9} />}
              {mismatches.map((r) => (
                <Tr key={r.summaryId}>
                  <Td className="font-medium">{r.productName}</Td>
                  <Td>{r.warehouseName}</Td>
                  <Td className="text-right">{fmt(r.stored)}</Td>
                  <Td className="text-right">{fmt(r.computed)}</Td>
                  <Td className={`text-right font-semibold ${r.delta > 0 ? 'text-[var(--color-warning)]' : 'text-[var(--color-danger)]'}`}>
                    {r.delta > 0 ? '+' : ''}{fmt(r.delta)}
                  </Td>
                  <Td className="text-right">{r.ledgerRowCount}{r.reconcileAdjustTotal ? ` (${r.reconcileAdjustTotal > 0 ? '+' : ''}${fmt(r.reconcileAdjustTotal)} adj)` : ''}</Td>
                  <Td>{fmtDate(r.firstMovementAt)}</Td>
                  <Td>{fmtDate(r.lastMovementAt)}</Td>
                  <Td>
                    <span className={`inline-flex items-center gap-1 text-xs ${r.ledgerComplete ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-secondary)]'}`}>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {r.ledgerComplete ? 'Post-engine drift' : 'Likely opening balance'}
                    </span>
                    {r.note && <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">{r.note}</p>}
                  </Td>
                  {canCorrect && (
                    <Td>
                      <Button size="sm" variant="outline" onClick={() => { setCorrecting(r); setReason(''); setPhysicalCount(String(Math.round(r.computed * 1000) / 1000)); }}>
                        Apply Correction
                      </Button>
                    </Td>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}

      {onClose && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
        </div>
      )}

      <Modal
        open={!!correcting}
        onClose={() => { if (!correction.isPending) { setCorrecting(null); setReason(''); setPhysicalCount(''); } }}
        title="Apply reconciliation correction"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" disabled={correction.isPending} onClick={() => { setCorrecting(null); setReason(''); setPhysicalCount(''); }}>Cancel</Button>
            <Button
              size="sm"
              loading={correction.isPending}
              disabled={!reason.trim()}
              onClick={() => { if (correcting && reason.trim()) correction.mutate(correcting); else toast.error('A reason is required'); }}
            >
              Apply correction
            </Button>
          </div>
        }
      >
        {correcting && (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              <b>{correcting.productName}</b> @ {correcting.warehouseName}
            </p>
            <p className="text-[var(--color-text-secondary)]">
              Stored on-hand <b>{fmt(correcting.stored)}</b>, ledger-computed <b>{fmt(correcting.computed)}</b>
              {' '}(delta {correcting.delta > 0 ? '+' : ''}{fmt(correcting.delta)}). {correcting.ledgerRowCount} ledger row(s),
              last movement {fmtDate(correcting.lastMovementAt)}.
            </p>
            <label className="text-xs font-medium">Physical on-hand to set (defaults to ledger-computed)</label>
            <Input type="number" value={physicalCount} onChange={(e) => setPhysicalCount(e.target.value)} placeholder={fmt(correcting.computed)} />
            <label className="text-xs font-medium">Reason <span className="text-[var(--color-danger)]">*</span></label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. physical stock count on 2026-09-04, 3 units found missing" rows={2} />
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              A <code>RECONCILE_ADJUST</code> movement is recorded in the ledger (audit trail); the movement engine writes the stock summary.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'ok' | 'warn' | 'danger' }) {
  const c = tone === 'danger' ? 'text-[var(--color-danger)]' : tone === 'warn' ? 'text-[var(--color-warning)]' : tone === 'ok' ? 'text-[var(--color-success)]' : '';
  return (
    <div className="rounded-md border border-[var(--color-border)] px-2 py-1.5">
      <div className="text-[11px] text-[var(--color-text-secondary)]">{label}</div>
      <div className={`text-base font-semibold ${c}`}>{value}</div>
    </div>
  );
}

export default StockReconciliationReport;
