/**
 * ProjectInstallationWorkspace — the Installation stage's operational workspace,
 * embedded inside "Work on This Project" (Stage 8 — Installation mission; the
 * read-only installation detail modal on the Installations list page was
 * retired). Built the same way ProjectDispatchWorkspace / ProjectOrderWorkspace
 * were: surfaces the EXISTING Installation system verbatim, no parallel
 * implementation.
 *
 * Installation data model (verified from the repository): Installation records
 * live on the LEAD document — lead.installationStatus (the canonical 10-stage
 * lifecycle from lib/installationEngine), lead.installationChecklist,
 * lead.capturedSerialNumbers, lead.assignedEngineerId/Name/Phone,
 * lead.scheduledDate/expectedCompletionDate — and installationEngine.ts
 * dual-writes a real Project-scoped COLLECTIONS.INSTALLATIONS mirror for
 * case/QC linkage. The list page, mobile workspace and this workspace ALL read
 * the leads collection (queryKeys.leadsAll — React Query dedupes them; never a
 * second fetch).
 *
 * Reuse discipline:
 *   - Stage advancement uses updateInstallationStatus (lib/partnerLeadIntegration)
 *     — the SAME canonical service the mobile Installations workspace and the
 *     partner portal call (it writes the lead, logs activity, notifies, and
 *     generates the commission record on completion). No second stage system.
 *   - Checklist toggles use toggleChecklistItem / resetChecklist; serials use
 *     captureInstallationSerial / removeCapturedSerial (which reuse the real
 *     serial_numbers collection); team uses assignEngineer; visits use
 *     scheduleVisit / updateVisitStatus / getLeadVisits — all from
 *     lib/installationEngine, the same services mobile + partner use.
 *   - Inventory: installation performs NO stock mutation — dispatch already
 *     issued the material (executeAndVerifyDispatch writes STOCK_LEDGER OUT and
 *     advances the project to Installation). Nothing is duplicated here.
 *   - Project stage transitions: executing a dispatch advances the project to
 *     Installation (projectInstallationPatch); creating a QC check from the QC
 *     module advances it to QC (qcWorkflow.createQCCheck → advanceProjectStage).
 *     This workspace does not invent a second advancement path.
 *   - Generic project context (Notes / Documents / Activity / Linked Records) is
 *     NOT duplicated here — the Project Workspace owns exactly one authoritative
 *     context layer below the stage cards. This card carries Installation-
 *     specific operational content only.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Calendar, CheckCircle2, ClipboardCheck, HardHat, Phone, User, Wrench,
} from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { Select, FormSection, FormRow, Input, Textarea } from '../../../../../components/ui/Input';
import { getAll } from '../../../../../lib/firestore';
import { fmtDate } from '../../../../../lib/firestore';
import { COLLECTIONS } from '../../../../../lib/firebase';
import { queryKeys } from '../../../../../lib/queryKeys';
import { useAppStore } from '../../../../../store/useAppStore';
import { usePermissions } from '../../../../../lib/permissions';
import {
  INSTALLATION_STAGES,
  isValidInstallation,
  stageBadgeColor,
  stageLabel,
  assignEngineer,
  captureInstallationSerial,
  removeCapturedSerial,
  scheduleVisit,
  toggleChecklistItem,
  updateVisitStatus,
  getLeadVisits,
  type InstallationVisit,
} from '../../../../../lib/installationEngine';
import { updateInstallationStatus } from '../../../../../lib/partnerLeadIntegration';
import type { ProjectStageWorkspaceProps } from './types';

const ENGINEER_ROLES = ['Engineer', 'Installer', 'Technician'];

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return fmtDate(value.toDate());
  if (typeof value === 'object' && value && 'seconds' in value) return fmtDate(new Date(Number((value as { seconds: number }).seconds) * 1000));
  return fmtDate(String(value));
}

/** Compact 10-stage timeline strip — the real INSTALLATION_STAGES order. */
function InstallationTimeline({ status }: { status: string }) {
  const currentIndex = INSTALLATION_STAGES.indexOf(status as any);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {INSTALLATION_STAGES.map((stage, i) => {
        const isPast = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <span
            key={stage}
            className={[
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
              isPast ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' :
                isCurrent ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 ring-1 ring-indigo-300 dark:ring-indigo-700' :
                  'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
            ].join(' ')}
          >
            {isPast ? '✓ ' : isCurrent ? '● ' : ''}{stageLabel(stage)}
          </span>
        );
      })}
    </div>
  );
}

/** Real checklist from the lead — same toggleChecklistItem service mobile uses. */
function InstallationChecklist({
  lead,
  canEdit,
}: {
  lead: any;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [updatingIndex, setUpdatingIndex] = useState<number | null>(null);
  const [checklist, setChecklist] = useState<any[]>(lead?.installationChecklist || []);

  useEffect(() => { setChecklist(lead?.installationChecklist || []); }, [lead]);

  if (!Array.isArray(checklist) || checklist.length === 0) return null;

  async function handleToggle(index: number) {
    if (!lead?.id) return;
    setUpdatingIndex(index);
    try {
      const updated = await toggleChecklistItem(lead.id, index);
      setChecklist(updated);
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(useAppStore.getState().activeCompanyId).leadsAll });
      toast.success('Checklist updated');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update checklist');
    } finally {
      setUpdatingIndex(null);
    }
  }

  return (
    <FormSection title="Installation Checklist">
      <div className="space-y-1.5">
        {checklist.map((item: any, index: number) => (
          <div key={index} className="flex items-center gap-2.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <button
              type="button"
              disabled={!canEdit || updatingIndex === index}
              onClick={() => handleToggle(index)}
              aria-label={item.completed ? `Mark "${item.item}" incomplete` : `Mark "${item.item}" complete`}
              className={[
                'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                item.completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-[var(--color-border-strong)] bg-[var(--color-surface)]',
                !canEdit ? 'cursor-not-allowed opacity-60' : 'hover:border-[var(--color-primary)]',
              ].join(' ')}
            >
              {item.completed && <CheckCircle2 className="h-3 w-3" />}
            </button>
            <span className={['min-w-0 flex-1 text-xs', item.completed ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'].join(' ')}>
              {item.item}
            </span>
            {item.completedAt && (
              <span className="shrink-0 text-[10px] text-[var(--color-text-disabled)]">{fmtDateSafe(item.completedAt)}</span>
            )}
          </div>
        ))}
      </div>
    </FormSection>
  );
}

/** Real captured serials — captureInstallationSerial / removeCapturedSerial (serial_numbers collection). */
function InstallationSerials({
  lead,
  canEdit,
}: {
  lead: any;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [serialInput, setSerialInput] = useState('');
  const [saving, setSaving] = useState(false);
  const serials: any[] = Array.isArray(lead?.capturedSerialNumbers) ? lead.capturedSerialNumbers : [];

  async function handleCapture() {
    if (!lead?.id || !serialInput.trim()) return;
    setSaving(true);
    try {
      await captureInstallationSerial(lead.id, serialInput.trim());
      toast.success('Serial captured');
      setSerialInput('');
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(useAppStore.getState().activeCompanyId).leadsAll });
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
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(useAppStore.getState().activeCompanyId).leadsAll });
      toast.success('Serial removed');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove serial');
    }
  }

  return (
    <FormSection title="Captured Serials">
      {canEdit && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Serial Number"
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              placeholder="Scan or enter serial (B2C optional — QC captures later if skipped)"
            />
          </div>
          <Button type="button" size="sm" disabled={!serialInput.trim()} loading={saving} onClick={handleCapture}>Capture</Button>
        </div>
      )}
      {serials.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          No serials captured yet — serial/barcode capture is optional at this stage and can be done during QC.
        </p>
      ) : (
        <div className="space-y-1.5">
          {serials.map((s: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
              <span className="font-mono text-xs text-[var(--color-text-secondary)]">{s.serialNumber}</span>
              <div className="flex items-center gap-2">
                {s.product && <span className="text-[10px] text-[var(--color-text-muted)]">{s.product}</span>}
                {canEdit && (
                  <button type="button" onClick={() => handleRemove(index)} className="text-[10px] font-semibold text-[var(--color-danger)] hover:underline">
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </FormSection>
  );
}

/** Engineer assignment — the same assignEngineer service the list/mobile/partner use. */
function InstallationTeam({
  lead,
  users,
  canEdit,
}: {
  lead: any;
  users: any[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const engineers = useMemo(
    () => (users || []).filter((u: any) => ENGINEER_ROLES.includes(u.role) && u.isDeleted !== true),
    [users],
  );
  const [engineerId, setEngineerId] = useState(lead?.assignedEngineerId || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setEngineerId(lead?.assignedEngineerId || ''); }, [lead]);

  async function handleAssign() {
    if (!lead?.id || !engineerId) return;
    setSaving(true);
    try {
      const user = engineers.find((u: any) => u.id === engineerId);
      await assignEngineer(lead.id, engineerId, user?.name || user?.email || engineerId, user?.phone || undefined, note || undefined);
      toast.success('Engineer assigned');
      setNote('');
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(useAppStore.getState().activeCompanyId).leadsAll });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to assign engineer');
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormSection title="Field Team">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Team Lead / Engineer</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-[var(--color-text)]">
            <User className="h-3 w-3 text-[var(--color-text-muted)]" />
            {lead?.assignedEngineerName || '—'}
          </p>
          {lead?.assignedEngineerPhone && (
            <a href={`tel:${lead.assignedEngineerPhone}`} className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--color-primary)] hover:underline">
              <Phone className="h-3 w-3" />{lead.assignedEngineerPhone}
            </a>
          )}
        </div>
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Scheduled</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-[var(--color-text)]">
            <Calendar className="h-3 w-3 text-[var(--color-text-muted)]" />
            {fmtDateSafe(lead?.scheduledDate)}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Expected Completion</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-[var(--color-text)]">
            <ClipboardCheck className="h-3 w-3 text-[var(--color-text-muted)]" />
            {fmtDateSafe(lead?.expectedCompletionDate)}
          </p>
        </div>
      </div>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Select
              label="Assign Engineer"
              value={engineerId}
              onChange={(e) => setEngineerId(e.target.value)}
              options={[{ label: 'Select engineer', value: '' }, ...engineers.map((u: any) => ({ label: u.name || u.email, value: u.id }))]}
            />
          </div>
          <div className="min-w-[160px] flex-1">
            <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Assignment note" />
          </div>
          <Button type="button" size="sm" disabled={!engineerId} loading={saving} onClick={handleAssign}>
            {lead?.assignedEngineerId ? 'Reassign' : 'Assign'}
          </Button>
        </div>
      )}
    </FormSection>
  );
}

/** Visits — scheduleVisit / updateVisitStatus / getLeadVisits (the same services mobile uses). */
function InstallationVisits({
  lead,
  canEdit,
}: {
  lead: any;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [visits, setVisits] = useState<InstallationVisit[]>([]);
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [visitTime, setVisitTime] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!lead?.id) { setVisits([]); return; }
    let alive = true;
    getLeadVisits(lead.id)
      .then((rows) => { if (alive) setVisits(rows); })
      .catch(() => {});
    return () => { alive = false; };
  }, [lead]);

  async function handleSchedule() {
    if (!lead?.id || !visitDate) return;
    setSaving(true);
    try {
      await scheduleVisit(lead.id, visitDate, lead.assignedEngineerId || undefined, lead.assignedEngineerName || undefined, visitTime || undefined, visitNotes || undefined);
      toast.success('Visit scheduled');
      setVisitNotes('');
      setVisits(await getLeadVisits(lead.id));
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(useAppStore.getState().activeCompanyId).leadsAll });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to schedule visit');
    } finally {
      setSaving(false);
    }
  }

  async function handleVisitStatus(visit: InstallationVisit, status: InstallationVisit['status']) {
    try {
      await updateVisitStatus(visit.id, status);
      setVisits(await getLeadVisits(lead.id));
      toast.success(`Visit ${status}`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update visit');
    }
  }

  return (
    <FormSection title="Visits">
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Date" type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} className="w-44" />
          <Input label="Time (optional)" type="time" value={visitTime} onChange={(e) => setVisitTime(e.target.value)} className="w-36" />
          <div className="min-w-[180px] flex-1">
            <Input label="Notes (optional)" value={visitNotes} onChange={(e) => setVisitNotes(e.target.value)} placeholder="Visit notes" />
          </div>
          <Button type="button" size="sm" disabled={!visitDate} loading={saving} onClick={handleSchedule}>Schedule Visit</Button>
        </div>
      )}
      {visits.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">No visits scheduled yet.</p>
      ) : (
        <div className="space-y-1.5">
          {visits.map((visit) => (
            <div key={visit.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--color-text)]">
                  {fmtDateSafe(visit.scheduledDate)}{visit.scheduledTime ? ` · ${visit.scheduledTime}` : ''}
                  {visit.engineerName ? ` · ${visit.engineerName}` : ''}
                </p>
                {visit.notes && <p className="text-[10px] text-[var(--color-text-muted)]">{visit.notes}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className={['rounded-full px-2 py-0.5 text-[10px] font-semibold', visit.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : visit.status === 'scheduled' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]'].join(' ')}>
                  {visit.status}
                </span>
                {canEdit && visit.status === 'scheduled' && (
                  <button type="button" onClick={() => handleVisitStatus(visit, 'completed')} className="text-[10px] font-semibold text-emerald-600 hover:underline">Complete</button>
                )}
                {canEdit && visit.status === 'scheduled' && (
                  <button type="button" onClick={() => handleVisitStatus(visit, 'cancelled')} className="text-[10px] font-semibold text-[var(--color-text-muted)] hover:underline">Cancel</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </FormSection>
  );
}

/** The real installation state/result for one lead — status, timeline, stage advance,
 * checklist, serials, team, visits. No generic project context. */
function InstallationLeadView({
  lead,
  users,
  perms,
  navigate,
}: {
  lead: any;
  users: any[];
  perms: ReturnType<typeof usePermissions>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const qc = useQueryClient();
  const keys = queryKeys.forCompany(useAppStore.getState().activeCompanyId);
  const status = String(lead?.installationStatus || '');
  const isCompleted = status === 'completed';
  const canEdit = perms.canEdit('installations') && !isCompleted;
  const [selectedStage, setSelectedStage] = useState(status);
  const [updatingStage, setUpdatingStage] = useState(false);

  useEffect(() => { setSelectedStage(status); }, [status]);

  async function handleStageChange() {
    if (!lead?.id || !selectedStage || selectedStage === status) return;
    setUpdatingStage(true);
    try {
      // updateInstallationStatus is the canonical stage-advance service (same
      // one the mobile workspace + partner portal call): writes the lead,
      // logs activity, notifies, generates commission on completion.
      await updateInstallationStatus(lead.id, selectedStage as any);
      toast.success('Installation stage updated');
      qc.invalidateQueries({ queryKey: keys.leadsAll });
      qc.invalidateQueries({ queryKey: keys.projectsRoot });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update stage');
    } finally {
      setUpdatingStage(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--color-text)]">{lead?.name || 'Installation'}</p>
            <span className={['rounded-full px-2 py-0.5 text-[10px] font-semibold', stageBadgeColor(status)].join(' ')}>{stageLabel(status)}</span>
            {isCompleted && <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Read Only</span>}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {lead?.city || '—'}
            {lead?.systemSizeKW ? ` · ${lead.systemSizeKW} kW` : ''}
            {lead?.projectId ? ` · Project ${String(lead.projectId).slice(-8)}` : ''}
            {lead?.dispatchId ? ` · Dispatch ${String(lead.dispatchId).slice(-8)}` : ''}
            {lead?.assignedEngineerName ? ` · ${lead.assignedEngineerName}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {lead?.phone && (
            <Button size="xs" variant="outline" icon={<Phone className="h-3.5 w-3.5" />} onClick={() => { window.location.href = `tel:${lead.phone}`; }}>Call</Button>
          )}
          <Button size="xs" variant="outline" icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => navigate(`/installations/${encodeURIComponent(lead.id)}`)}>
            Full workspace
          </Button>
        </div>
      </div>

      <FormSection title="Installation Timeline">
        <InstallationTimeline status={status} />
      </FormSection>

      {canEdit && (
        <FormSection title="Change Stage">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <Select
                label="Stage"
                value={selectedStage}
                onChange={(e) => setSelectedStage(e.target.value)}
                options={INSTALLATION_STAGES.map((s) => ({ label: stageLabel(s), value: s }))}
              />
            </div>
            <Button type="button" size="sm" disabled={!selectedStage || selectedStage === status} loading={updatingStage} onClick={handleStageChange}>
              Update Stage
            </Button>
          </div>
        </FormSection>
      )}

      <InstallationChecklist lead={lead} canEdit={canEdit} />
      <InstallationSerials lead={lead} canEdit={canEdit} />
      <InstallationTeam lead={lead} users={users} canEdit={canEdit} />
      <InstallationVisits lead={lead} canEdit={canEdit} />
    </div>
  );
}

export default function ProjectInstallationWorkspace({ project, users }: ProjectStageWorkspaceProps) {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();

  const { data: leads = [], isLoading } = useQuery({
    queryKey: keys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 30_000,
  });

  // Installation records live on LEADS (lead.installationStatus) — the same
  // source the Installations list page and getProjectInstallations() use.
  const projectInstallations = useMemo(
    () => (leads as any[])
      .filter((l) => isValidInstallation(l) && String(l.projectId || '') === project.id)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()),
    [leads, project.id],
  );

  const [activeLeadId, setActiveLeadId] = useState<string | undefined>(undefined);
  const activeLead = projectInstallations.find((l) => l.id === activeLeadId) || projectInstallations[0];

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  // ── No installation yet — lead-driven lifecycle; nothing to create here ──
  if (projectInstallations.length === 0) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
          <HardHat className="h-4 w-4 text-[var(--color-text-muted)]" />
          No installation has started for this project yet.
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          Installation is lead-driven: when the dispatch for this project is executed, the project advances to
          Installation (Stage 8) and the linked lead's installation work appears here — checklist, stage progression,
          engineer assignment and site visits all run from this workspace.
        </p>
        <Button size="xs" variant="outline" icon={<Wrench className="h-3.5 w-3.5" />} onClick={() => navigate('/projects/' + encodeURIComponent(project.id))}>
          Back to project stages
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {projectInstallations.length > 1 && (
        <Select
          label="Installation"
          value={activeLead.id}
          onChange={(e) => setActiveLeadId(e.target.value)}
          options={projectInstallations.map((l) => ({ label: `${l.name || l.id} · ${stageLabel(l.installationStatus)}`, value: l.id }))}
        />
      )}

      <InstallationLeadView
        key={activeLead.id}
        lead={activeLead}
        users={users}
        perms={perms}
        navigate={navigate}
      />
    </div>
  );
}
