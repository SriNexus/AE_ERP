/**
 * PartnerMobileInstallationWorkspace — Mobile Installation Tracking for Partners
 *
 * Displays each lead's installation progress as a card with stage timeline,
 * scheduled dates, completion status, delay indicators, and engineer info.
 *
 * Reuses same data layer as desktop — all filtering by partnerId.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FolderKanban,
  HardHat,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import { getAll, fmtDate } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePartnerSelf } from '../../../features/channel-partner/hooks/usePartnerSelf';
import { cn } from '../../../utils/cn';
import type { ChannelPartner } from '../../../features/channel-partner/types';

/** Installation stage ordered progression */
const INSTALLATION_STAGES = [
  'pending',
  'documentation',
  'survey',
  'proposal',
  'design',
  'material_procurement',
  'installation',
  'installation_complete',
  'inspection',
  'closed',
] as const;

type InstallationStage = (typeof INSTALLATION_STAGES)[number];

const STAGE_LABELS: Record<string, string> = {
  pending: 'Pending',
  documentation: 'Documentation',
  survey: 'Site Survey',
  proposal: 'Proposal',
  design: 'Design',
  material_procurement: 'Material Procurement',
  installation: 'Installation',
  installation_complete: 'Installation Complete',
  inspection: 'Inspection',
  closed: 'Closed',
};

const STAGE_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4" />,
  documentation: <Wrench className="h-4 w-4" />,
  survey: <HardHat className="h-4 w-4" />,
  proposal: <Calendar className="h-4 w-4" />,
  design: <Wrench className="h-4 w-4" />,
  material_procurement: <Wrench className="h-4 w-4" />,
  installation: <HardHat className="h-4 w-4" />,
  installation_complete: <CheckCircle2 className="h-4 w-4" />,
  inspection: <Wrench className="h-4 w-4" />,
  closed: <CheckCircle2 className="h-4 w-4" />,
};

function currentStageIndex(installationStatus?: string): number {
  if (!installationStatus) return 0;
  const idx = INSTALLATION_STAGES.indexOf(installationStatus as InstallationStage);
  return idx >= 0 ? idx : 0;
}

function isDelayed(scheduledDate?: string | null): boolean {
  if (!scheduledDate) return false;
  const d = new Date(scheduledDate);
  return !isNaN(d.getTime()) && d < new Date();
}

function fmtDateShort(value: unknown): string {
  if (!value) return '—';
  const d = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value instanceof Date ? value : null;
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function InstallationSkeleton() {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-lg bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-36 bg-[var(--color-bg-sunken)] rounded" />
          <div className="h-3 w-24 bg-[var(--color-bg-sunken)] rounded" />
        </div>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-1.5 flex-1 rounded-full bg-[var(--color-bg-sunken)]" />
        ))}
      </div>
    </div>
  );
}

function StatusChip({ label, color }: { label: string; color: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      color === 'amber' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      color === 'emerald' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      color === 'blue' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      color === 'red' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
      color === 'purple' && 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      color === 'slate' && 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    )}>
      {label}
    </span>
  );
}

export function PartnerMobileInstallationWorkspace() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);

  const { data: partnerSelf, isLoading: partnersLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  const { data: projects = [] } = useQuery({
    queryKey: companyKeys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: allLeads = [], isLoading, refetch } = useQuery({
    queryKey: companyKeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerLeads = useMemo(
    () => allLeads
      .filter((l: any) => l.partnerId === partner?.id && !l.isDeleted)
      .filter((l: any) => l.installationStatus && l.installationStatus !== 'pending')
      .sort((a: any, b: any) => {
        const da = a.updatedAt || a.createdAt ? new Date(a.updatedAt || a.createdAt).getTime() : 0;
        const db = b.updatedAt || b.createdAt ? new Date(b.updatedAt || b.createdAt).getTime() : 0;
        return db - da;
      }),
    [allLeads, partner?.id],
  );

  const pendingInstallationLeads = useMemo(
    () => allLeads
      .filter((l: any) => l.partnerId === partner?.id && !l.isDeleted)
      .filter((l: any) => !l.installationStatus || l.installationStatus === 'pending'),
    [allLeads, partner?.id],
  );

  const loading = partnersLoading || isLoading;

  // ── KPIs ───────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = partnerLeads.length + pendingInstallationLeads.length;
    const active = partnerLeads.length;
    const completed = partnerLeads.filter((l: any) =>
      l.installationStatus === 'closed' || l.installationStatus === 'installation_complete'
    ).length;
    const delayed = partnerLeads.filter((l: any) =>
      isDelayed(l.scheduledDate || l.expectedCompletionDate)
    ).length;
    return { total, active, completed, delayed, inProgress: active - completed };
  }, [partnerLeads, pendingInstallationLeads]);

  // ── Detail drawer state ────────────────────────────────
  const [viewLead, setViewLead] = useState<any>(null);

  if (!partner) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
          <HardHat className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-1">No Partner Profile</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Your account isn&apos;t linked to a partner profile.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-canvas)]">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <HardHat className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[var(--color-text)]">Installations</h1>
              <p className="text-xs text-[var(--color-text-muted)]">
                Track your installation progress
              </p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* ── KPI Cards ─────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl p-2.5 text-white text-center">
            <p className="text-lg font-extrabold tabular-nums leading-tight">{loading ? '—' : kpis.total}</p>
            <p className="text-[9px] font-semibold opacity-80 uppercase tracking-wide mt-0.5">Total</p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-2.5 text-center">
            <p className="text-lg font-extrabold text-blue-700 dark:text-blue-300 tabular-nums leading-tight">{loading ? '—' : kpis.inProgress}</p>
            <p className="text-[9px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mt-0.5">In Progress</p>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl p-2.5 text-center">
            <p className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums leading-tight">{loading ? '—' : kpis.completed}</p>
            <p className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mt-0.5">Completed</p>
          </div>
          <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-700 rounded-xl p-2.5 text-center">
            <p className="text-lg font-extrabold text-rose-700 dark:text-rose-300 tabular-nums leading-tight">{loading ? '—' : kpis.delayed}</p>
            <p className="text-[9px] font-semibold text-rose-600 dark:text-rose-400 uppercase tracking-wide mt-0.5">Delayed</p>
          </div>
        </div>

        {/* ── Pending installations alert ───────────────── */}
        {!loading && pendingInstallationLeads.length > 0 && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-amber-700 dark:text-amber-300 font-medium">
              {pendingInstallationLeads.length} lead{pendingInstallationLeads.length !== 1 ? 's' : ''} pending installation start
            </span>
          </div>
        )}
      </div>

      {/* ── Installation List ───────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {loading ? (
          <>
            <InstallationSkeleton />
            <InstallationSkeleton />
            <InstallationSkeleton />
          </>
        ) : partnerLeads.length === 0 && pendingInstallationLeads.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-16 text-center">
            <div className="h-14 w-14 rounded-2xl bg-[var(--color-bg-sunken)] flex items-center justify-center mb-3">
              <HardHat className="h-7 w-7 text-[var(--color-text-muted)]" />
            </div>
            <p className="text-sm font-semibold text-[var(--color-text)]">No installations yet</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-[200px]">
              Installation tracking will appear here once leads move past the initial stage.
            </p>
          </div>
        ) : (
          partnerLeads.map((lead: any) => {
            const stageIdx = currentStageIndex(lead.installationStatus);
            const delayed = isDelayed(lead.scheduledDate || lead.expectedCompletionDate);
            const totalStages = INSTALLATION_STAGES.length;
            const progressPct = Math.round((stageIdx / (totalStages - 1)) * 100);

            return (
              <button
                key={lead.id}
                onClick={() => setViewLead(lead)}
                className="w-full text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-sm transition-all active:scale-[0.98]"
              >
                {/* Lead Header */}
                <div className="flex items-start gap-3 mb-3">
                  <div className={cn(
                    'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
                    lead.installationStatus === 'closed' || lead.installationStatus === 'installation_complete'
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                      : delayed
                        ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400'
                        : 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
                  )}>
                    {STAGE_ICONS[lead.installationStatus] || <HardHat className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm text-[var(--color-text)] truncate">
                        {lead.name || 'Untitled'}
                      </p>
                      <StatusChip
                        label={STAGE_LABELS[lead.installationStatus] || lead.installationStatus?.replace(/_/g, ' ') || 'Pending'}
                        color={
                          lead.installationStatus === 'closed' || lead.installationStatus === 'installation_complete' ? 'emerald'
                          : delayed ? 'red'
                          : 'blue'
                        }
                      />
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {[lead.city, lead.state].filter(Boolean).join(', ') || lead.phone || '—'}
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="flex items-center gap-1.5 mb-2.5">
                  {INSTALLATION_STAGES.map((stage, i) => (
                    <div
                      key={stage}
                      className={cn(
                        'h-1.5 flex-1 rounded-full transition-colors',
                        i <= stageIdx
                          ? i === stageIdx && (lead.installationStatus === 'closed' || lead.installationStatus === 'installation_complete')
                            ? 'bg-emerald-500'
                            : i === stageIdx && delayed
                              ? 'bg-rose-500'
                              : i === stageIdx
                                ? 'bg-indigo-500'
                                : 'bg-emerald-400'
                          : 'bg-[var(--color-bg-sunken)]'
                      )}
                    />
                  ))}
                </div>

                {/* Project link */}
                {lead.projectId && (
                  <div className="mb-1.5 flex items-center gap-1 text-[10px] text-[var(--color-primary)]">
                    <FolderKanban className="h-3 w-3" />
                    <span>{lead.projectName || (() => { const p = projects.find((pr: any) => pr.id === lead.projectId || pr.projectId === lead.projectId); return p?.projectId || lead.projectId; })()}</span>
                  </div>
                )}

                {/* Progress Info */}
                <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                  <span>{progressPct}% complete</span>
                  <div className="flex items-center gap-2">
                    {lead.scheduledDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {fmtDateShort(lead.scheduledDate)}
                      </span>
                    )}
                    {lead.assignedEngineerName && (
                      <span className="flex items-center gap-1">
                        <HardHat className="h-3 w-3" />
                        {lead.assignedEngineerName}
                      </span>
                    )}
                  </div>
                </div>

                {/* Delay Warning */}
                {delayed && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/10 rounded-lg px-2 py-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span>
                      {lead.installationStatus === 'installation_complete' || lead.installationStatus === 'closed'
                        ? 'Completed behind schedule'
                        : 'Past expected completion date'}
                    </span>
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* ── Detail Drawer (reuse existing PartnerLeadDetailDrawer) ── */}
      {viewLead && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface)]">
          <div className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border-subtle)] px-4 py-3 flex items-center gap-3">
            <button onClick={() => setViewLead(null)} className="text-[var(--color-text-muted)]">
              <svg className="h-5 w-5 rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[var(--color-text)] truncate">{viewLead.name || 'Lead Details'}</p>
              <p className="text-[10px] text-[var(--color-text-muted)]">Installation Tracking</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Stage Timeline */}
            <div className="space-y-0">
              <p className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wide mb-3">Installation Timeline</p>
              {INSTALLATION_STAGES.map((stage, i) => {
                const isActive = i === currentStageIndex(viewLead.installationStatus);
                const isPast = i < currentStageIndex(viewLead.installationStatus);
                const isFuture = i > currentStageIndex(viewLead.installationStatus);
                return (
                  <div key={stage} className="flex gap-3 pb-3 last:pb-0">
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        'h-6 w-6 rounded-full flex items-center justify-center shrink-0',
                        isPast ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' :
                        isActive ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-200 dark:ring-indigo-800' :
                        'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]'
                      )}>
                        {isPast ? <CheckCircle2 className="h-3.5 w-3.5" /> : STAGE_ICONS[stage] || <Clock className="h-3.5 w-3.5" />}
                      </div>
                      {i < INSTALLATION_STAGES.length - 1 && (
                        <div className={cn(
                          'w-px flex-1 min-h-[16px] mt-0.5',
                          isPast ? 'bg-emerald-200 dark:bg-emerald-800' : 'bg-[var(--color-border-subtle)]'
                        )} />
                      )}
                    </div>
                    <div className="flex-1 pb-1">
                      <p className={cn(
                        'text-xs font-semibold',
                        isActive ? 'text-[var(--color-text)]' :
                        isPast ? 'text-emerald-700 dark:text-emerald-300' :
                        'text-[var(--color-text-muted)]'
                      )}>
                        {STAGE_LABELS[stage] || stage.replace(/_/g, ' ')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Lead Metadata */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-3 space-y-2 text-xs">
              <p className="font-bold text-[var(--color-text)] mb-1">Details</p>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">Status</span>
                <span className="font-semibold">{STAGE_LABELS[viewLead.installationStatus] || viewLead.installationStatus?.replace(/_/g, ' ') || '—'}</span>
              </div>
              {viewLead.scheduledDate && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Scheduled</span>
                  <span className="font-semibold">{fmtDate(viewLead.scheduledDate)}</span>
                </div>
              )}
              {viewLead.expectedCompletionDate && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Expected Completion</span>
                  <span className="font-semibold">{fmtDate(viewLead.expectedCompletionDate)}</span>
                </div>
              )}
              {viewLead.assignedEngineerName && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Engineer</span>
                  <span className="font-semibold">{viewLead.assignedEngineerName}</span>
                </div>
              )}
              {viewLead.assignedEngineerPhone && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Engineer Phone</span>
                  <span className="font-semibold">{viewLead.assignedEngineerPhone}</span>
                </div>
              )}
              {viewLead.projectId && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Project</span>
                  <span className="font-semibold">{viewLead.projectName || viewLead.projectId}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">Lead Source</span>
                <span className="font-semibold">{viewLead.source || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">System Size</span>
                <span className="font-semibold">{viewLead.systemSizeKW ? `${viewLead.systemSizeKW} kW` : '—'}</span>
              </div>
            </div>

            {/* Commission & Document Status */}
            <div className="grid grid-cols-2 gap-2">
              {viewLead.commissionStatus && (
                <div className="rounded-xl border border-[var(--color-border)] p-3 text-center">
                  <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">Commission</p>
                  <StatusChip
                    label={viewLead.commissionStatus.replace(/_/g, ' ')}
                    color={viewLead.commissionStatus === 'approved' || viewLead.commissionStatus === 'paid' ? 'emerald' : 'amber'}
                  />
                </div>
              )}
              {viewLead.documentationStatus && (
                <div className="rounded-xl border border-[var(--color-border)] p-3 text-center">
                  <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">Documents</p>
                  <StatusChip
                    label={viewLead.documentationStatus.replace(/_/g, ' ')}
                    color={viewLead.documentationStatus === 'verified' ? 'emerald' : viewLead.documentationStatus === 'rejected' ? 'red' : 'amber'}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PartnerMobileInstallationWorkspace;
