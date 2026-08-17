/**
 * ProjectCommissioningWorkspace — the Commissioning stage's operational
 * workspace, embedded inside "Work on This Project" (Stage 10 — Commissioning
 * mission; the read-only commissioning detail modal on the Commissioning list
 * page was retired). Built the same way ProjectQCWorkspace /
 * ProjectInstallationWorkspace were: surfaces the EXISTING Commissioning
 * system verbatim, no parallel implementation.
 *
 * Commissioning data model (verified from the repository): commissioning
 * records live in the commissioning_records collection
 * (lib/commissioningWorkflow.ts) — CommissioningRecord has projectId, qcId
 * (the passed QC check), status ('completed' — created complete and
 * IMMUTABLE), generationTestKwh, commissionedDate/By/ByName, customerName,
 * customerSignoff (+ URL of the captured signature), warrantyStartDate/
 * warrantyMonths, notes, isCompleted. The list page, mobile workspace and
 * this workspace ALL read the commissioning_records collection
 * (queryKeys.commissioningRecordsAll — React Query dedupes them; never a
 * second fetch).
 *
 * Reuse discipline:
 *   - Completion uses createCommissioningRecord — the SAME canonical service
 *     the Commissioning list page and mobile workspace call. It validates the
 *     project is in Commissioning stage, requires a PASSED QC check, requires
 *     a generation test reading > 0 and a customer signature, writes the
 *     immutable record, and advances the Project to Net Metering via
 *     buildProjectStageAdvancePatch (the canonical forward-only guard). No
 *     second completion/transition mechanism.
 *   - Customer signature uses the shared SignatureCapture component exactly
 *     like the list/mobile create flows (upload → URL → the service).
 *   - Project stage transitions stay canonical: createCommissioningRecord is
 *     the only path that advances Commissioning → NetMetering. This workspace
 *     never mutates project.currentStage directly.
 *   - Inventory: Commissioning performs NO stock mutation — it is a sign-off
 *     that consumes/read-references the dispatched + installed + QC-verified
 *     material; dispatch already issued the stock. Nothing is duplicated.
 *   - B2C serial/barcode: Commissioning is read-oriented for tracking — the
 *     serial/barcode traceability established in Dispatch → Installation →
 *     QC is preserved in those stages' records; this workspace does not
 *     fabricate or re-capture tracking data.
 *   - Generic project context (Notes / Documents / Activity / Linked Records)
 *     is NOT duplicated here — the Project Workspace owns exactly one
 *     authoritative context layer below the stage cards. This card carries
 *     Commissioning-specific operational content only (notes is a real
 *     Commissioning domain field captured at sign-off, not a generic Notes
 *     panel).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Calendar, CheckCircle2, ExternalLink, ShieldCheck, User, Zap,
} from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { FormSection, Input } from '../../../../../components/ui/Input';
import { isLoadableUrl } from '../../../../../lib/url';
import { getAll, resolveWriteCompanyId } from '../../../../../lib/firestore';
import { fmtDate } from '../../../../../lib/firestore';
import { COLLECTIONS } from '../../../../../lib/firebase';
import { queryKeys } from '../../../../../lib/queryKeys';
import { useAppStore } from '../../../../../store/useAppStore';
import { usePermissions } from '../../../../../lib/permissions';
import { createCommissioningRecord, type CommissioningRecord } from '../../../../../lib/commissioningWorkflow';
import { SignatureCapture } from '../../../../../components/commissioning/SignatureCapture';
import type { ProjectStageWorkspaceProps } from './types';

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return fmtDate(value.toDate());
  if (typeof value === 'object' && value && 'seconds' in value) return fmtDate(new Date(Number((value as { seconds: number }).seconds) * 1000));
  return fmtDate(String(value));
}

/** Real Commissioning record view — the sign-off is IMMUTABLE after creation,
 * so this is a read-only operational view (per the existing business rule). */
function CommissioningRecordView({
  record,
  navigate,
}: {
  record: CommissioningRecord;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Zap className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">#{record.id.slice(-8)}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" /> Completed
            </span>
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">
              Read Only — immutable sign-off
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{record.commissionedByName || '—'}</span>
            <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtDateSafe(record.commissionedDate)}</span>
            {record.qcId && <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" />QC {record.qcId.slice(-8)}</span>}
          </div>
        </div>
        <Button size="xs" variant="outline" icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => navigate(`/commissioning/${encodeURIComponent(record.id)}`)}>
          Full workspace
        </Button>
      </div>

      <FormSection title="System Sign-off">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Generation Test</p>
            <p className="mt-0.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">{record.generationTestKwh} kWh</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Warranty</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">
              {record.warrantyMonths ? `${record.warrantyMonths} months` : '—'}
              {record.warrantyStartDate ? ` · from ${fmtDateSafe(record.warrantyStartDate)}` : ''}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Customer</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{record.customerName || '—'}</p>
          </div>
        </div>
        {record.customerSignoff && (
          <div className="mt-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Customer Sign-off Confirmed
            </p>
            {record.customerSignoffUrl && isLoadableUrl(record.customerSignoffUrl) && (
              <a href={record.customerSignoffUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-[var(--color-primary)] hover:underline">
                <ExternalLink className="h-3 w-3" /> Open Signature
              </a>
            )}
          </div>
        )}
      </FormSection>

      {record.notes && (
        <FormSection title="Sign-off Notes">
          <p className="text-xs text-[var(--color-text)]">{record.notes}</p>
        </FormSection>
      )}
    </div>
  );
}

/** Complete Commissioning — the single sign-off action, pre-scoped to this
 * project. Calls the canonical createCommissioningRecord (validates project
 * stage + passed QC + generation reading + signature; advances to Net
 * Metering). Mirrors the list-page create modal's real fields exactly. */
function CommissioningSignoffForm({
  project,
}: {
  project: any;
}) {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const qcClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const perms = usePermissions();

  const [generationTestKwh, setGenerationTestKwh] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [warrantyStartDate, setWarrantyStartDate] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState('60');
  const [notes, setNotes] = useState('');
  const [signatureUrl, setSignatureUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const canCreate = perms.can('commissioning', 'create');

  async function handleSubmit() {
    if (!canCreate) return;
    const kwh = parseFloat(generationTestKwh);
    if (!kwh || kwh <= 0) { toast.error('Generation test reading must be > 0'); return; }
    if (!signatureUrl) { toast.error('Please upload customer signature'); return; }
    setSaving(true);
    try {
      await createCommissioningRecord({
        projectId: project.id,
        projectName: project.projectId || project.id,
        generationTestKwh: kwh,
        commissionedByName: user?.name || 'System',
        customerName: customerName || undefined,
        customerSignoff: true,
        customerSignoffUrl: signatureUrl,
        warrantyStartDate: warrantyStartDate || undefined,
        warrantyMonths: warrantyMonths ? parseInt(warrantyMonths) : undefined,
        notes: notes || undefined,
      });
      toast.success('Commissioning completed successfully');
      qcClient.invalidateQueries({ queryKey: keys.commissioningRecordsAll });
      qcClient.invalidateQueries({ queryKey: keys.projectsRoot });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to complete commissioning');
    } finally {
      setSaving(false);
    }
  }

  if (!canCreate) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
        <p className="text-xs text-[var(--color-text-muted)]">
          This project has not been commissioned yet. You do not have permission to complete the commissioning sign-off.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          <Zap className="h-3.5 w-3.5" /> Project ready for commissioning — {project.projectId || project.id}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          Requires a passed QC check and a customer signature. This is a single sign-off action — the record is immutable after creation and the project advances to Net Metering.
        </p>
      </div>

      <FormSection title="System & Sign-off Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Generation Test (kWh) *"
            type="number"
            min="0.1"
            step="0.1"
            value={generationTestKwh}
            onChange={(e) => setGenerationTestKwh(e.target.value)}
            placeholder="e.g. 5.2"
          />
          <Input
            label="Customer Name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Customer name for sign-off"
          />
          <Input
            label="Warranty Start"
            type="date"
            value={warrantyStartDate}
            onChange={(e) => setWarrantyStartDate(e.target.value)}
          />
          <Input
            label="Warranty (months)"
            type="number"
            min="0"
            value={warrantyMonths}
            onChange={(e) => setWarrantyMonths(e.target.value)}
          />
        </div>
        <Input
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any additional notes"
        />
      </FormSection>

      <FormSection title="Customer Signature *">
        <SignatureCapture
          companyId={resolveWriteCompanyId()}
          onUploadComplete={setSignatureUrl}
          onUploadError={(err) => toast.error(err?.message || 'Signature upload failed')}
        />
        <p className="text-[10px] text-[var(--color-text-muted)]">⚠️ Commissioning is a single sign-off action and cannot be modified after creation.</p>
      </FormSection>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" loading={saving} disabled={!signatureUrl} onClick={handleSubmit}>
          Complete Commissioning
        </Button>
        <span className="text-[11px] text-[var(--color-text-muted)]">Advances the project to Net Metering.</span>
      </div>
    </div>
  );
}

/** The real Commissioning state for one project — sign-off form when not yet
 * commissioned, immutable record view after. No generic project context
 * (Documents/Activity/Linked Records live at the Project Workspace level). */
export default function ProjectCommissioningWorkspace({ project }: ProjectStageWorkspaceProps) {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  const { data: records = [], isLoading } = useQuery({
    queryKey: keys.commissioningRecordsAll,
    queryFn: () => getAll(COLLECTIONS.COMMISSIONING_RECORDS),
    staleTime: 15_000,
  });

  const projectRecords = useMemo(
    () => (records as CommissioningRecord[])
      .filter((r) => r.projectId === project.id && !r.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [records, project.id],
  );

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  // Commissioning is a single immutable sign-off — at most one completed
  // record exists per project (createCommissioningRecord guards stage + QC).
  const record = projectRecords.find((r) => r.isCompleted) || projectRecords[0];

  return record
    ? <CommissioningRecordView record={record} navigate={navigate} />
    : <CommissioningSignoffForm project={project} />;
}
