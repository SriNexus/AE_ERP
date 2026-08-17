/**
 * InstallationDetailDrawer — Full installation management drawer
 *
 * Displays:
 *   - Customer summary, partner info, lead info
 *   - Installation timeline with stage history
 *   - Engineer assignment + reassignment
 *   - Visit history + scheduling
 *   - Uploaded documents + material status
 *   - Commission eligibility
 *   - Audit timeline
 *
 * Actions:
 *   - Assign/reassign engineer
 *   - Change stage
 *   - Reschedule
 *   - Add notes
 *   - Mark completed
 *
 * Reuses: Drawer, Badge, existing partnerLeadIntegration for mutations.
 * No Firestore SDK in UI.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  HardHat,
  ListChecks,
  MapPin,
  Phone,
  QrCode,
  User,
  UserPlus,
  X,
  FileText,
  Award,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getAll, fmtDate } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../../components/ui/Button';
import {
  stageLabel,
  stageBadgeColor,
  calculateCompletion,
  isInstallationDelayed,
  delayDays,
  INSTALLATION_STAGES,
  assignEngineer,
  getLeadVisits,
  DEFAULT_INSTALLATION_CHECKLIST,
  toggleChecklistItem,
  captureInstallationSerial,
  removeCapturedSerial,
} from '../../lib/installationEngine';
import { updateInstallationStatus } from '../../lib/partnerLeadIntegration';
import { cn } from '../../utils/cn';
import type { InstallationVisit } from '../../lib/installationEngine';

interface Props {
  installation: any;
  open: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

function DetailRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xs font-semibold text-[var(--color-text)]">{value}</div>
    </div>
  );
}

export function InstallationDetailDrawer({ installation, open, onClose, onUpdate }: Props) {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const userRole = useAppStore((s) => s.user?.role || '');
  const isAdmin = userRole === 'Admin' || userRole === 'Director';

  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'visits' | 'checklist' | 'documents'>('overview');
  const [visits, setVisits] = useState<InstallationVisit[]>([]);
  const [loadingVisits, setLoadingVisits] = useState(false);
  const [selectedStage, setSelectedStage] = useState('');
  const [engineerModal, setEngineerModal] = useState(false);
  const [engineerName, setEngineerName] = useState('');
  const [engineerPhone, setEngineerPhone] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [visitTime, setVisitTime] = useState('');
  const [visitNote, setVisitNote] = useState('');
  const [showScheduleVisit, setShowScheduleVisit] = useState(false);
  const [serialInput, setSerialInput] = useState('');
  const [savingSerial, setSavingSerial] = useState(false);
  const [checklistUpdating, setChecklistUpdating] = useState<number | null>(null);

  const delayed = isInstallationDelayed(
    installation?.installationStatus,
    installation?.expectedCompletionDate,
    installation?.scheduledDate,
  );
  const delayDaysCount = delayed ? delayDays(
    installation?.installationStatus,
    installation?.expectedCompletionDate,
    installation?.scheduledDate,
  ) : 0;
  const completionPct = calculateCompletion(installation?.installationStatus);

  // Load visits
  useEffect(() => {
    if (!installation?.id) return;
    setLoadingVisits(true);
    getLeadVisits(installation.id).then(setVisits).catch(() => setVisits([])).finally(() => setLoadingVisits(false));
  }, [installation?.id]);

  // Stage change mutation
  const stageMutation = useMutation({
    mutationFn: async ({ leadId, status }: { leadId: string; status: string }) => {
      await updateInstallationStatus(leadId, status as any);
    },
    onSuccess: () => {
      toast.success('Stage updated');
      qc.invalidateQueries({ queryKey: ['leads'] });
      onUpdate?.();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Engineer assignment mutation
  const engineerMutation = useMutation({
    mutationFn: async () => {
      if (!installation?.id || !engineerName) throw new Error('Engineer name required');
      await assignEngineer(installation.id, engineerName, engineerName, engineerPhone || undefined);
    },
    onSuccess: () => {
      toast.success('Engineer assigned');
      qc.invalidateQueries({ queryKey: ['leads'] });
      setEngineerModal(false);
      setEngineerName('');
      setEngineerPhone('');
      onUpdate?.();
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!open || !installation) return null;

  const currentStageIdx = INSTALLATION_STAGES.indexOf(installation.installationStatus);
  const isCompleted = installation.installationStatus === 'completed';
  const partnerName = installation.partnerName || installation._partnerName || '—';
  const location = [installation.city, installation.state].filter(Boolean).join(', ') || '—';

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'visits', label: `Visits${visits.length > 0 ? ` (${visits.length})` : ''}` },
    { key: 'checklist', label: 'Checklist' },
    { key: 'documents', label: 'Documents' },
  ] as const;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-[var(--color-surface)] shadow-xl border-l border-[var(--color-border)] flex flex-col">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400">
              <HardHat className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--color-text)] truncate">{installation.name || 'Installation'}</p>
              <p className="text-[10px] text-[var(--color-text-muted)]">{partnerName}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stage Badge + Progress */}
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', stageBadgeColor(installation.installationStatus))}>
              {stageLabel(installation.installationStatus)}
            </span>
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)]">{completionPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--color-bg-sunken)] overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', completionPct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500')}
              style={{ width: `${completionPct}%` }}
            />
          </div>
          {delayed && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-3 w-3" />
              <span>Delayed by {delayDaysCount} day{delayDaysCount !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-3 pb-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors',
                activeTab === tab.key
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-sunken)]'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable Content ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview' && (
          <div className="p-4 space-y-4">
            {/* Customer Info */}
            <section className="rounded-xl border border-[var(--color-border)] p-3 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Customer Details</p>
              <DetailRow label="Name" value={installation.name || '—'} />
              <DetailRow label="Phone" value={installation.phone || '—'} icon={<Phone className="h-3 w-3" />} />
              <DetailRow label="Location" value={location} icon={<MapPin className="h-3 w-3" />} />
              {installation.value ? (
                <DetailRow label="Deal Value" value={`₹${Number(installation.value).toLocaleString('en-IN')}`} />
              ) : null}
            </section>

            {/* Project Details */}
            <section className="rounded-xl border border-[var(--color-border)] p-3 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Project Details</p>
              <DetailRow label="Partner" value={partnerName} icon={<Award className="h-3 w-3" />} />
              <DetailRow label="System Size" value={installation.systemSizeKW ? `${installation.systemSizeKW} kW` : '—'} />
              <DetailRow label="Source" value={installation.source || '—'} />
              <DetailRow label="Created" value={installation.createdAt ? fmtDate(installation.createdAt) : '—'} icon={<Calendar className="h-3 w-3" />} />
              <DetailRow label="Last Updated" value={installation.updatedAt ? fmtDate(installation.updatedAt) : '—'} />
            </section>

            {/* Engineer */}
            <section className="rounded-xl border border-[var(--color-border)] p-3 space-y-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Engineer</p>
                {isAdmin && (
                  <button
                    onClick={() => setEngineerModal(true)}
                    className="flex items-center gap-1 text-[10px] font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    <UserPlus className="h-3 w-3" />
                    {installation.assignedEngineerName ? 'Reassign' : 'Assign'}
                  </button>
                )}
              </div>
              {installation.assignedEngineerName ? (
                <>
                  <DetailRow label="Name" value={installation.assignedEngineerName} icon={<User className="h-3 w-3" />} />
                  {installation.assignedEngineerPhone && (
                    <DetailRow label="Phone" value={installation.assignedEngineerPhone || '—'} icon={<Phone className="h-3 w-3" />} />
                  )}
                </>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">No engineer assigned</p>
              )}
            </section>

            {/* Schedule */}
            <section className="rounded-xl border border-[var(--color-border)] p-3 space-y-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Schedule</p>
                {isAdmin && !isCompleted && (
                  <button
                    onClick={() => setShowScheduleVisit(true)}
                    className="flex items-center gap-1 text-[10px] font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    <Calendar className="h-3 w-3" />
                    Schedule Visit
                  </button>
                )}
              </div>
              <DetailRow label="Scheduled" value={installation.scheduledDate ? fmtDate(installation.scheduledDate) : '—'} icon={<Calendar className="h-3 w-3" />} />
              <DetailRow label="Expected Completion" value={installation.expectedCompletionDate ? fmtDate(installation.expectedCompletionDate) : '—'} />
              {installation.installationCompletedAt && (
                <DetailRow label="Completed At" value={fmtDate(installation.installationCompletedAt)} icon={<CheckCircle2 className="h-3 w-3" />} />
              )}
            </section>

            {/* Commission Status */}
            <section className="rounded-xl border border-[var(--color-border)] p-3 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Commission</p>
              <DetailRow label="Status" value={installation.commissionStatus?.replace(/_/g, ' ') || '—'} />
              <DetailRow label="Payout" value={installation.payoutStatus?.replace(/_/g, ' ') || '—'} />
              {installation.commissionAmount ? (
                <DetailRow label="Amount" value={`₹${Number(installation.commissionAmount).toLocaleString('en-IN')}`} />
              ) : null}
            </section>

            {/* Stage Change (admin action) */}
            {isAdmin && !isCompleted && (
              <section className="rounded-xl border border-[var(--color-border)] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Change Stage</p>
                <div className="flex gap-2">
                  <select
                    value={selectedStage || installation.installationStatus || ''}
                    onChange={(e) => setSelectedStage(e.target.value)}
                    className="flex-1 h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                  >
                    {INSTALLATION_STAGES.map((s) => (
                      <option key={s} value={s}>{stageLabel(s)}</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!selectedStage || selectedStage === installation.installationStatus) return;
                      stageMutation.mutate({ leadId: installation.id, status: selectedStage });
                    }}
                    loading={stageMutation.isPending}
                    disabled={!selectedStage || selectedStage === installation.installationStatus}
                  >
                    Update
                  </Button>
                </div>
              </section>
            )}

            {installation.notes && (
              <section className="rounded-xl border border-[var(--color-border)] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Notes</p>
                <p className="text-xs text-[var(--color-text)] whitespace-pre-wrap">{installation.notes}</p>
              </section>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="p-4 space-y-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-4">Installation Timeline</p>
            {INSTALLATION_STAGES.map((stage, i) => {
              const isCurrent = i === currentStageIdx;
              const isPast = i < currentStageIdx;
              const isFutureStage = i > currentStageIdx;
              return (
                <div key={stage} className="flex gap-3 pb-3 last:pb-0">
                  <div className="flex flex-col items-center">
                    <div className={cn(
                      'h-6 w-6 rounded-full flex items-center justify-center shrink-0',
                      isPast ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' :
                      isCurrent ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-200 dark:ring-indigo-800' :
                      'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]'
                    )}>
                      {isPast ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                    </div>
                    {i < INSTALLATION_STAGES.length - 1 && (
                      <div className={cn('w-px flex-1 min-h-[16px] mt-0.5', isPast ? 'bg-emerald-200 dark:bg-emerald-800' : 'bg-[var(--color-border-subtle)]')} />
                    )}
                  </div>
                  <div className="flex-1 pb-1">
                    <p className={cn(
                      'text-xs font-semibold',
                      isCurrent ? 'text-[var(--color-text)]' :
                      isPast ? 'text-emerald-700 dark:text-emerald-300' :
                      'text-[var(--color-text-muted)]'
                    )}>
                      {stageLabel(stage)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'visits' && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Visit History</p>
              {isAdmin && !isCompleted && (
                <button
                  onClick={() => setShowScheduleVisit(true)}
                  className="flex items-center gap-1 text-[10px] font-semibold text-[var(--color-primary)] hover:underline"
                >
                  <Calendar className="h-3 w-3" />
                  Schedule
                </button>
              )}
            </div>
            {loadingVisits ? (
              <p className="text-xs text-[var(--color-text-muted)]">Loading visits...</p>
            ) : visits.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Calendar className="h-6 w-6 text-[var(--color-text-muted)] mb-2" />
                <p className="text-xs text-[var(--color-text-muted)]">No visits scheduled</p>
              </div>
            ) : (
              visits.map((visit) => (
                <div key={visit.id} className="rounded-xl border border-[var(--color-border)] p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-[var(--color-text)]">
                      {visit.scheduledDate ? new Date(visit.scheduledDate).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }) : '—'}
                    </span>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                      visit.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' :
                      visit.status === 'scheduled' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30' :
                      visit.status === 'missed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30' :
                      visit.status === 'cancelled' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800' :
                      'bg-amber-100 text-amber-700 dark:bg-amber-900/30'
                    )}>
                      {visit.status.charAt(0).toUpperCase() + visit.status.slice(1)}
                    </span>
                  </div>
                  {visit.scheduledTime && (
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {visit.scheduledTime}{visit.engineerName ? ` · ${visit.engineerName}` : ''}
                    </p>
                  )}
                  {visit.outcome && (
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Outcome: {visit.outcome}</p>
                  )}
                  {visit.notes && (
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Note: {visit.notes}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'checklist' && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Installation Checklist</p>
              {isAdmin && (
                <button
                  onClick={async () => {
                    try {
                      const { resetChecklist: reset } = await import('../../lib/installationEngine');
                      await reset(installation.id);
                      toast.success('Checklist reset');
                      onUpdate?.();
                    } catch (e: any) {
                      toast.error(e?.message || 'Failed to reset checklist');
                    }
                  }}
                  className="text-[10px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                >
                  Reset
                </button>
              )}
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mb-2">
              Track progress of key installation tasks
            </p>
            {(installation.installationChecklist || DEFAULT_INSTALLATION_CHECKLIST).map((item: any, i: number) => (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3 transition-all',
                  item.completed
                    ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10'
                    : 'border-[var(--color-border)] bg-[var(--color-bg)]'
                )}
              >
                <button
                  disabled={!isAdmin || checklistUpdating === i}
                  onClick={async () => {
                    setChecklistUpdating(i);
                    try {
                      await toggleChecklistItem(installation.id, i);
                      onUpdate?.();
                    } catch (e: any) {
                      toast.error(e.message);
                    } finally {
                      setChecklistUpdating(null);
                    }
                  }}
                  className={cn(
                    'h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-all',
                    item.completed
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-[var(--color-border)] hover:border-[var(--color-primary)]',
                    !isAdmin && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  {item.completed && <CheckCircle2 className="h-3.5 w-3.5" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-xs font-medium',
                    item.completed ? 'text-emerald-700 dark:text-emerald-300 line-through' : 'text-[var(--color-text)]'
                  )}>
                    {item.item}
                  </p>
                  {item.completedAt && (
                    <p className="text-[9px] text-[var(--color-text-muted)] mt-0.5">
                      Completed {fmtDate(item.completedAt)}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {/* Serial Number Capture */}
            <div className="border-t border-[var(--color-border-subtle)] pt-4 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <QrCode className="h-4 w-4 text-[var(--color-text-muted)]" />
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Captured Serials</p>
              </div>

              {isAdmin && (
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={serialInput}
                    onChange={(e) => setSerialInput(e.target.value)}
                    placeholder="Enter serial number..."
                    className="flex-1 h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                  />
                  <Button
                    size="sm"
                    loading={savingSerial}
                    disabled={!serialInput.trim()}
                    onClick={async () => {
                      setSavingSerial(true);
                      try {
                        await captureInstallationSerial(installation.id, serialInput.trim());
                        toast.success('Serial captured');
                        setSerialInput('');
                        onUpdate?.();
                      } catch (e: any) {
                        toast.error(e.message);
                      } finally {
                        setSavingSerial(false);
                      }
                    }}
                  >
                    Capture
                  </Button>
                </div>
              )}

              {(installation.capturedSerialNumbers || []).length > 0 ? (
                <div className="space-y-1.5">
                  {(installation.capturedSerialNumbers as any[]).map((s: any, i: number) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <QrCode className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                        <span className="text-xs font-mono font-medium text-[var(--color-text)]">{s.serialNumber}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.product && <span className="text-[10px] text-[var(--color-text-muted)]">{s.product}</span>}
                        {isAdmin && (
                          <button
                            onClick={async () => {
                              await removeCapturedSerial(installation.id, i);
                              onUpdate?.();
                            }}
                            className="text-[10px] text-rose-500 hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <QrCode className="h-5 w-5 text-[var(--color-text-muted)] mb-1.5" />
                  <p className="text-xs text-[var(--color-text-muted)]">No serial numbers captured</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Documents & Materials</p>
            {installation.uploadedDocuments?.length > 0 ? (
              (installation.uploadedDocuments as string[]).map((doc: string, i: number) => (
                <div key={i} className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] p-3">
                  <FileText className="h-4 w-4 text-[var(--color-text-muted)]" />
                  <span className="text-xs text-[var(--color-text)]">{doc}</span>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <FileText className="h-6 w-6 text-[var(--color-text-muted)] mb-2" />
                <p className="text-xs text-[var(--color-text-muted)]">No documents uploaded</p>
              </div>
            )}
            {installation.documentVerifications?.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Verification Status</p>
                {installation.documentVerifications.map((ver: any, i: number) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-[var(--color-border)] p-2.5">
                    <span className="text-xs text-[var(--color-text)]">{ver.documentName}</span>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                      ver.status === 'verified' ? 'bg-emerald-100 text-emerald-700' :
                      ver.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    )}>
                      {ver.status.charAt(0).toUpperCase() + ver.status.slice(1)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Engineer Assignment Modal (inline) ──────────────── */}
      {engineerModal && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={() => setEngineerModal(false)}>
          <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-t-2xl p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--color-text)]">
                {installation.assignedEngineerName ? 'Reassign Engineer' : 'Assign Engineer'}
              </h3>
              <button onClick={() => setEngineerModal(false)} className="p-1 text-[var(--color-text-muted)]" aria-label="Close assign engineer"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] mb-1.5">Engineer Name</p>
                <input
                  type="text"
                  value={engineerName}
                  onChange={(e) => setEngineerName(e.target.value)}
                  placeholder="Enter engineer name"
                  className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] mb-1.5">Phone (optional)</p>
                <input
                  type="text"
                  value={engineerPhone}
                  onChange={(e) => setEngineerPhone(e.target.value)}
                  placeholder="Engineer phone"
                  className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
              </div>
              <Button
                className="w-full"
                onClick={() => engineerMutation.mutate()}
                loading={engineerMutation.isPending}
                disabled={!engineerName}
              >
                {installation.assignedEngineerName ? 'Update Engineer' : 'Assign Engineer'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Schedule Visit Modal (inline) ─────────────────── */}
      {showScheduleVisit && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={() => setShowScheduleVisit(false)}>
          <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-t-2xl p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--color-text)]">Schedule Visit</h3>
              <button onClick={() => setShowScheduleVisit(false)} className="p-1 text-[var(--color-text-muted)]" aria-label="Close schedule visit"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] mb-1.5">Date</p>
                <input
                  type="date"
                  value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)}
                  className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] mb-1.5">Time (optional)</p>
                <input
                  type="time"
                  value={visitTime}
                  onChange={(e) => setVisitTime(e.target.value)}
                  className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] mb-1.5">Notes (optional)</p>
                <input
                  type="text"
                  value={visitNote}
                  onChange={(e) => setVisitNote(e.target.value)}
                  placeholder="Visit purpose"
                  className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
              </div>
              <Button
                className="w-full"
                onClick={async () => {
                  if (!visitDate) return toast.error('Date is required');
                  const { scheduleVisit } = await import('../../lib/installationEngine');
                  await scheduleVisit(installation.id, visitDate, undefined, undefined, visitTime || undefined, visitNote || undefined);
                  toast.success('Visit scheduled');
                  setShowScheduleVisit(false);
                  setVisitDate('');
                  setVisitTime('');
                  setVisitNote('');
                  onUpdate?.();
                  // Reload visits
                  const updatedVisits = await getLeadVisits(installation.id);
                  setVisits(updatedVisits);
                }}
                disabled={!visitDate}
              >
                Schedule Visit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InstallationDetailDrawer;
