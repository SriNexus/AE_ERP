/**
 * ProjectQCWorkspace — the Quality Check stage's operational workspace,
 * embedded inside "Work on This Project" (Stage 9 — Quality Check mission;
 * the read-only QC detail modal on the Quality Checks list page was
 * retired). Built the same way ProjectDispatchWorkspace /
 * ProjectInstallationWorkspace were: surfaces the EXISTING QC system
 * verbatim, no parallel implementation. (Stage 9 — Quality Check; the next
 * stage after Installation in the canonical lifecycle.)
 *
 * QC data model (verified from the repository): QC records live in the
 * qc_checks collection (lib/qcWorkflow.ts) — QCRecord has projectId,
 * installationId/installationName, status (pending | in_progress | passed |
 * failed), boolean checklistItems, inspectorId/inspectorName, overallNotes,
 * and stats. The list page, mobile workspace and this workspace ALL read the
 * qc_checks collection (queryKeys.qcChecksAll — React Query dedupes them;
 * never a second fetch).
 *
 * Reuse discipline:
 *   - Creation uses createQCCheck — the SAME canonical service the QC list
 *     page and mobile workspace call. It guards duplicate open QC checks and
 *     advances the Project to QC via advanceProjectStage. No second create
 *     mechanism.
 *   - Checklist toggles use updateQCChecklistItem; the pass/fail decision
 *     uses submitQCDecision (all-pass → status passed + forward-only advance
 *     to Commissioning; any-fail → status failed + guarded loop-back to
 *     Installation); re-inspection uses resetQCCheck (failed-only). All from
 *     lib/qcWorkflow — never reimplemented here.
 *   - Project stage transitions stay canonical: createQCCheck advances to QC,
 *     submitQCDecision advances to Commissioning / loops back to
 *     Installation. This workspace never mutates project.currentStage
 *     directly.
 *   - Inventory: QC performs NO stock mutation (it verifies installed
 *     material; dispatch already issued the stock). Nothing is duplicated
 *     here.
 *   - B2C serial/barcode: QC completes the tracking gap the Dispatch stage
 *     deliberately left open. The Material Tracking section shows the REAL
 *     dispatch tracking state (serials/barcodes actually captured at Dispatch
 *     on dispatch.items[].serials/barcodes, displayed verbatim) AND surfaces
 *     the project's installation lead captured serials (lead.capturedSerial
 *     Numbers — the B2C tracking home). When Dispatch skipped tracking,
 *     items show "Pending QC — not captured at Dispatch" and the workspace
 *     offers capture through the SAME real service the installation engine
 *     uses — captureInstallationSerial / removeCapturedSerial
 *     (lib/installationEngine.ts, writes lead.capturedSerialNumbers + the
 *     serial_numbers collection). Nothing is fabricated, skipped tracking is
 *     never silently converted into captured, and tracking not applicable
 *     (B2B / non-tracked products) is never forced.
 *   - Generic project context (Notes / Documents / Activity / Linked Records)
 *     is NOT duplicated here — the Project Workspace owns exactly one
 *     authoritative context layer below the stage cards. This card carries
 *     QC-specific operational content only (overallNotes is a real QC domain
 *     field preserved through submitQCDecision, not a generic Notes panel).
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, CheckCircle2, ClipboardCheck, FolderKanban, User, XCircle,
} from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { FormSection } from '../../../../../components/ui/Input';
import { getAll } from '../../../../../lib/firestore';
import { fmtDate } from '../../../../../lib/firestore';
import { COLLECTIONS } from '../../../../../lib/firebase';
import { queryKeys } from '../../../../../lib/queryKeys';
import { useAppStore } from '../../../../../store/useAppStore';
import { usePermissions } from '../../../../../lib/permissions';
import {
  createQCCheck, updateQCChecklistItem, submitQCDecision, resetQCCheck,
  DEFAULT_QC_CHECKLIST, normalizeQCRecord,
  type QCRecord, type QCChecklistItem,
} from '../../../../../lib/qcWorkflow';
import { isValidInstallation, captureInstallationSerial, removeCapturedSerial } from '../../../../../lib/installationEngine';
import type { ProjectStageWorkspaceProps } from './types';

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return fmtDate(value.toDate());
  if (typeof value === 'object' && value && 'seconds' in value) return fmtDate(new Date(Number((value as { seconds: number }).seconds) * 1000));
  return fmtDate(String(value));
}

function QcStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'passed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' :
    status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
    status === 'in_progress' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  return (
    <span className={['inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold', tone].join(' ')}>
      {status === 'passed' && <CheckCircle2 className="h-3 w-3" />}
      {status === 'failed' && <XCircle className="h-3 w-3" />}
      {status}
    </span>
  );
}

/** Real checklist from the QC record — the same updateQCChecklistItem service
 * the QC list page and mobile workspace use. */
function QCInspection({
  qc,
  canApprove,
}: {
  qc: QCRecord;
  canApprove: boolean;
}) {
  const qcClient = useQueryClient();
  const keys = queryKeys.forCompany(useAppStore.getState().activeCompanyId);
  const [checklist, setChecklist] = useState<QCChecklistItem[]>(qc?.checklistItems || []);
  const [updatingIndex, setUpdatingIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setChecklist(qc?.checklistItems || []); }, [qc]);

  const isComplete = qc.status === 'passed' || qc.status === 'failed';
  const allChecked = checklist.length > 0 && checklist.every((i) => i.passed !== undefined);
  const passedCount = checklist.filter((i) => i.passed).length;

  async function handleToggle(index: number) {
    if (!canApprove || isComplete) return;
    setUpdatingIndex(index);
    try {
      const updated = await updateQCChecklistItem(qc.id, index, !checklist[index].passed);
      setChecklist(updated.checklistItems);
      qcClient.invalidateQueries({ queryKey: keys.qcChecksAll });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update checklist item');
    } finally {
      setUpdatingIndex(null);
    }
  }

  async function handleSubmit(passed: boolean) {
    setSubmitting(true);
    try {
      const result = await submitQCDecision(qc.id);
      toast.success(passed ? 'QC passed — project advancing to Commissioning' : 'QC failed — project returned to Installation');
      qcClient.invalidateQueries({ queryKey: keys.qcChecksAll });
      qcClient.invalidateQueries({ queryKey: keys.projectsRoot });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit QC decision');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset() {
    try {
      await resetQCCheck(qc.id);
      toast.success('QC check reset for re-inspection');
      qcClient.invalidateQueries({ queryKey: keys.qcChecksAll });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to reset QC check');
    }
  }

  return (
    <FormSection title="Inspection Checklist">
      <div className="space-y-1.5">
        {checklist.map((item, index) => (
          <div
            key={index}
            className={[
              'flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
              item.passed === true ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/10' :
                item.passed === false ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10' :
                  'border-[var(--color-border-subtle)] bg-[var(--color-bg)]',
              isComplete ? 'opacity-80' : '',
            ].join(' ')}
          >
            <button
              type="button"
              disabled={!canApprove || isComplete || updatingIndex === index}
              onClick={() => handleToggle(index)}
              aria-label={item.passed ? `Mark "${item.item}" failed` : `Mark "${item.item}" passed`}
              className={[
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                item.passed === true ? 'border-emerald-500 bg-emerald-500 text-white' :
                  item.passed === false ? 'border-red-400 bg-red-100 text-red-600 dark:bg-red-900/40' :
                    'border-[var(--color-border-strong)] bg-[var(--color-surface)]',
                !canApprove || isComplete ? 'cursor-not-allowed opacity-60' : 'hover:border-[var(--color-primary)]',
              ].join(' ')}
            >
              {item.passed === true && <CheckCircle2 className="h-3 w-3" />}
              {item.passed === false && <XCircle className="h-3 w-3" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={['text-xs font-medium', item.passed === true ? 'text-emerald-700 dark:text-emerald-300 line-through' : item.passed === false ? 'text-red-700 dark:text-red-300' : 'text-[var(--color-text)]'].join(' ')}>
                {item.item}
              </p>
              {item.notes && <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{item.notes}</p>}
            </div>
            {item.inspectedAt && (
              <span className="shrink-0 text-[10px] text-[var(--color-text-disabled)]">{fmtDateSafe(item.inspectedAt)}</span>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {!isComplete && (
          <>
            {allChecked && canApprove ? (
              <>
                <Button size="sm" loading={submitting} className="!bg-emerald-600 hover:!bg-emerald-700"
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => handleSubmit(true)}>
                  Approve & Pass
                </Button>
                <Button size="sm" variant="outline" loading={submitting}
                  icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => handleSubmit(false)}>
                  Fail & Send Back
                </Button>
              </>
            ) : (
              <p className="text-[11px] text-[var(--color-text-muted)]">
                Complete all {checklist.length} checklist items before submitting the QC decision.
              </p>
            )}
          </>
        )}
        {qc.status === 'failed' && canApprove && (
          <Button size="sm" variant="outline" onClick={handleReset}>Reset for re-inspection</Button>
        )}
        {isComplete && (
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {qc.status === 'passed' ? `${passedCount}/${checklist.length} passed — QC complete` : `QC failed — awaiting rework`}
          </p>
        )}
      </div>
    </FormSection>
  );
}

/** Material Tracking — the B2C tracking handoff, completed here.
 *
 * Two real data surfaces:
 *   1. Dispatch reference (read-only): serials/barcodes actually captured at
 *      Dispatch (dispatch.items[].serials/barcodes) shown verbatim; items
 *      where Dispatch skipped tracking show "Pending QC — not captured at
 *      Dispatch"; non-tracked products show "Tracking not applicable".
 *   2. QC capture (real service): the project's installation lead
 *      (lead.capturedSerialNumbers — the B2C tracking home) with capture /
 *      remove wired through the SAME services the Installation workspace
 *      uses — captureInstallationSerial / removeCapturedSerial
 *      (lib/installationEngine.ts, dual-writes lead + serial_numbers
 *      collection). Capture is offered only while a linked installation lead
 *      exists (B2C); no lead (B2B) and non-tracked products are never
 *      forced. Nothing is fabricated and skipped tracking is never silently
 *      converted into captured. */
function MaterialTracking({ project, canCapture }: { project: any; canCapture: boolean }) {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const qcClient = useQueryClient();
  const projectId = project.id;

  const { data: dispatches = [] } = useQuery({
    queryKey: keys.dispatchAll,
    queryFn: () => getAll(COLLECTIONS.DISPATCH),
    staleTime: 30_000,
  });

  const { data: leads = [] } = useQuery({
    queryKey: keys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 30_000,
  });

  // The project's installation lead — the B2C serial tracking home. Resolved
  // exactly like ProjectInstallationWorkspace / the Installations list page
  // resolve it (queryKeys.leadsAll + isValidInstallation + projectId).
  const lead = useMemo(
    () => (leads as any[])
      .filter((l) => isValidInstallation(l) && String(l.projectId || '') === projectId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())[0],
    [leads, projectId],
  );

  const capturedSerials: Array<{ serialNumber: string; product?: string; capturedAt?: string }> =
    Array.isArray(lead?.capturedSerialNumbers) ? lead.capturedSerialNumbers : [];

  const dispatchRows = useMemo(() => {
    const projectDispatches = (dispatches as any[])
      .filter((d) => d.projectId === projectId && d.status !== 'cancelled')
      .sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
    const items: Array<{ product: string; qty: number; serials: string[]; barcodes: string[]; trackingType?: string }> = [];
    for (const d of projectDispatches) {
      for (const item of Array.isArray(d.items) ? d.items : []) {
        items.push({
          product: String(item.productName || item.product || item.item || 'Item'),
          qty: Number(item.verifiedQty ?? item.qty ?? 0),
          serials: Array.isArray(item.serials) ? item.serials.map(String) : [],
          barcodes: Array.isArray(item.barcodes) ? item.barcodes.map(String) : [],
          trackingType: String(item.trackingType || d.trackingType || ''),
        });
      }
    }
    return items;
  }, [dispatches, projectId]);

  const [serialInput, setSerialInput] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCapture() {
    if (!lead?.id || !serialInput.trim()) return;
    setSaving(true);
    try {
      await captureInstallationSerial(lead.id, serialInput.trim());
      toast.success('Serial captured');
      setSerialInput('');
      qcClient.invalidateQueries({ queryKey: keys.leadsAll });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to capture serial');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(index: number) {
    if (!lead?.id) return;
    try {
      await removeCapturedSerial(lead.id, index);
      qcClient.invalidateQueries({ queryKey: keys.leadsAll });
      toast.success('Serial removed');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove serial');
    }
  }

  const hasAnyMaterial = dispatchRows.length > 0 || capturedSerials.length > 0;

  return (
    <FormSection title="Material Tracking">
      {dispatchRows.length > 0 && (
        <div className="space-y-1.5">
          {dispatchRows.map((row, index) => {
            const captured = row.serials.length > 0 || row.barcodes.length > 0;
            return (
              <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--color-text)]">{row.product}</span>
                <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">×{row.qty}</span>
                <span className={[
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                  captured ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' :
                    row.trackingType === 'none' ? 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]' :
                      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                ].join(' ')}>
                  {captured
                    ? `Captured: S ${row.serials.join(', ')}${row.barcodes.length ? ` · B ${row.barcodes.join(', ')}` : ''}`
                    : row.trackingType === 'none'
                      ? 'Tracking not applicable'
                      : 'Pending QC — not captured at Dispatch'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* QC capture — the real B2C tracking handoff via the installation
          engine's captureInstallationSerial / removeCapturedSerial services
          (lead.capturedSerialNumbers + serial_numbers collection). Only when a
          linked installation lead exists; never forced for B2B or
          non-tracked products. */}
      {lead ? (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Capture Serial</label>
              <input
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                placeholder="Scan or enter serial (pending from Dispatch)"
                disabled={!canCapture}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-60"
              />
            </div>
            <Button type="button" size="sm" disabled={!canCapture || !serialInput.trim()} loading={saving} onClick={handleCapture}>
              Capture
            </Button>
          </div>
          {capturedSerials.length === 0 ? (
            <p className="text-[11px] text-[var(--color-text-muted)]">
              No serials captured yet — capture values here or at Installation; skipped tracking stays pending until captured.
            </p>
          ) : (
            <div className="space-y-1.5">
              {capturedSerials.map((s, index) => (
                <div key={index} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
                  <span className="font-mono text-xs text-[var(--color-text-secondary)]">{s.serialNumber}</span>
                  <div className="flex items-center gap-2">
                    {s.product && <span className="text-[10px] text-[var(--color-text-muted)]">{s.product}</span>}
                    {canCapture && (
                      <button type="button" onClick={() => handleRemove(index)} className="text-[10px] font-semibold text-[var(--color-danger)] hover:underline">
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {hasAnyMaterial
            ? 'No linked installation lead — serial capture at QC is available once the installation lead is linked to this project.'
            : 'No dispatched material found for this project.'}
        </p>
      )}
    </FormSection>
  );
}

/** The real QC state for one project — status header, inspection checklist,
 * pass/fail decision, reset, material-tracking reference. No generic project
 * context (Documents/Activity/Linked Records live at the Project Workspace
 * level). */
export default function ProjectQCWorkspace({ project }: ProjectStageWorkspaceProps) {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const user = useAppStore((s) => s.user);
  const qcClient = useQueryClient();

  const { data: qcData = [], isLoading } = useQuery({
    queryKey: keys.qcChecksAll,
    queryFn: () => getAll(COLLECTIONS.QC_CHECKS),
    staleTime: 15_000,
  });

  const projectQCs = useMemo(
    () => (qcData as any[])
      .map((q) => normalizeQCRecord(q as any))
      .filter((q: QCRecord) => q.projectId === project.id && !q.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [qcData, project.id],
  );

  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      await createQCCheck({
        projectId: project.id,
        inspectorId: user?.id || 'system',
        inspectorName: user?.name || 'System',
      });
      toast.success('QC check created');
      qcClient.invalidateQueries({ queryKey: keys.qcChecksAll });
      qcClient.invalidateQueries({ queryKey: keys.projectsRoot });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create QC check');
    } finally {
      setCreating(false);
    }
  }

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  const activeQc = projectQCs[0];
  const canApprove = perms.can('qc', 'approve');

  // ── No QC check yet — offer the canonical createQCCheck flow ──
  if (!activeQc) {
  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
          <ClipboardCheck className="h-4 w-4 text-[var(--color-text-muted)]" />
          No quality check has been initiated for this project yet.
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          Creating a QC check initializes the standard {DEFAULT_QC_CHECKLIST.length}-item inspection checklist and
          advances the project to the Quality Check stage (createQCCheck). Once it exists, the checklist, pass/fail
          decision and rework reset all run from this workspace.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {perms.can('qc', 'create') ? (
            <Button size="sm" icon={<ClipboardCheck className="h-3.5 w-3.5" />} loading={creating} onClick={handleCreate}>
              Create QC Check
            </Button>
          ) : (
            <p className="text-[11px] text-[var(--color-text-muted)]">You do not have permission to create QC checks.</p>
          )}
          <Button size="xs" variant="outline" icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => navigate('/qc')}>
            Quality Checks list
          </Button>
        </div>
      </div>
      <MaterialTracking project={project} canCapture={canApprove} />
    </div>
  );
}

  return (
    <div className="space-y-3">
      {/* Status header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FolderKanban className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">#{activeQc.id.slice(-8)}</span>
            <QcStatusBadge status={activeQc.status} />
            {projectQCs.length > 1 && (
              <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
                {projectQCs.length} checks
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{activeQc.inspectorName || '—'}</span>
            <span>Created {fmtDateSafe(activeQc.createdAt)}</span>
            {activeQc.installationName && <span>{activeQc.installationName}</span>}
            {activeQc.completedAt && <span>Completed {fmtDateSafe(activeQc.completedAt)}</span>}
          </div>
        </div>
        <Button size="xs" variant="outline" icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => navigate(`/qc/${encodeURIComponent(activeQc.id)}`)}>
          Full workspace
        </Button>
      </div>

      <QCInspection qc={activeQc} canApprove={canApprove} />

      {activeQc.overallNotes && (
        <FormSection title="Overall Remarks">
          <p className="text-xs text-[var(--color-text)]">{activeQc.overallNotes}</p>
        </FormSection>
      )}

      <MaterialTracking project={project} canCapture={canApprove} />
    </div>
  );
}
