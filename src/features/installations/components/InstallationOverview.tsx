/**
 * InstallationOverview — Phase 7B Field Execution Center
 *
 * 8 sections:
 *   1. Header (ID, Project Name, Status, Team Lead)
 *   2. 6 KPI cards (Completion, Team, Days Active, Materials, Issues, QC Readiness)
 *   3. Installation Timeline (11 stages)
 *   4. Installation Details (site, capacity, customer, project, dispatch, team)
 *   5. Field Team
 *   6. Issues & Blockers
 *   7. Tasks Overview
 *   8. Recent Activity
 */

import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  HardHat,
  Phone,
  MapPin,
  User,
  Users,
  Wrench,
  FileText,
  Activity,
  ChevronRight,
  Box,
  Zap,
  Shield,
  Building2,
} from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../utils/cn';
import {
  stageLabel,
  stageBadgeColor,
  calculateCompletion,
  INSTALLATION_STAGES,
} from '../../../lib/installationEngine';

// ── Helpers ────────────────────────────────────────────────

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') {
    const d = value.toDate();
    return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`;
  }
  if (typeof value === 'object' && value && 'seconds' in value) {
    const d = new Date(Number((value as { seconds: number }).seconds) * 1000);
    return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`;
  }
  return String(value);
}

function MetricTile({ label, value, icon, trend }: { label: string; value: string | number; icon: ReactNode; trend?: { dir: 'up' | 'down'; pct: number } }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 transition-all duration-150 hover:shadow-sm hover:border-[var(--color-border)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-[var(--color-text-muted)]">{label}</span>
        <span className="text-[var(--color-text-muted)] opacity-60">{icon}</span>
      </div>
      <p className="mt-1.5 text-xl font-bold tabular-nums text-[var(--color-text)]">{value}</p>
      {trend && (
        <p className={cn('mt-0.5 text-[10px] font-medium', trend.dir === 'up' ? 'text-emerald-600' : 'text-rose-600')}>
          {trend.dir === 'up' ? '↑' : '↓'} {trend.pct}%
        </p>
      )}
    </div>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      {title && (
        <div className="mb-3 flex items-center gap-2">
          {icon && <span className="text-[var(--color-text-muted)]">{icon}</span>}
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

function TimelineStage({ index, isCurrent, isPast, label }: { index: number; isCurrent: boolean; isPast: boolean; label: string }) {
  const isLast = index === INSTALLATION_STAGES.length - 1;
  return (
    <div className="flex items-start gap-2">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all',
            isPast ? 'bg-emerald-500 text-white' :
            isCurrent ? 'bg-indigo-500 text-white ring-2 ring-indigo-200 dark:ring-indigo-800' :
            'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
          )}
        >
          {isPast ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : isCurrent ? (
            <Clock className="h-3 w-3" />
          ) : (
            <div className="h-1.5 w-1.5 rounded-full bg-current" />
          )}
        </div>
        {!isLast && <div className={cn('w-px flex-1 min-h-[12px]', isPast ? 'bg-emerald-200 dark:bg-emerald-800' : 'bg-[var(--color-border-subtle)]')} />}
      </div>
      <div className={cn('pb-2 text-[11px] font-medium', isCurrent ? 'text-[var(--color-text)]' : isPast ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--color-text-muted)]')}>
        {label}
      </div>
    </div>
  );
}

// ── Props ───────────────────────────────────────────────────

export interface InstallationOverviewProps {
  installation: Record<string, unknown>;
  linkedProject?: Record<string, unknown> | null;
  partners?: Record<string, unknown>[];
  projects?: Record<string, unknown>[];
}

// ── Main Component ──────────────────────────────────────────

export default function InstallationOverview({
  installation,
  linkedProject,
  partners,
  projects,
}: InstallationOverviewProps) {
  const navigate = useNavigate();

  const lead = installation as any;
  const status = String(lead?.installationStatus || '');
  const progressPct = calculateCompletion(status);
  const location = [lead?.city, lead?.state].filter(Boolean).join(', ') || '—';
  const partnerName = lead?.partnerName || (lead?.partnerId && partners ? (partners.find((p: any) => p.id === lead.partnerId)?.firmName) : null) || '—';
  const caseId = lead?.caseId ? String(lead.caseId) : null;
  const teamCount = 0; // simplified — would come from team field
  const daysActive = lead?.createdAt ? Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000) : 0;
  const pendingIssues: any[] = []; // simplified — would come from issues/blockers field
  const materialsUsed = (lead?.capturedSerialNumbers as any[])?.length || 0;

  // Mock stage history for timeline — use actual history or fallback to current stage position
  const currentStageIndex = INSTALLATION_STAGES.indexOf(status as any);

  // Field team — prefer lead.teamMembers array, fall back to assignedEngineer
  const assignedEngineer = lead?.assignedEngineerName || null;
  const rawTeamMembers = Array.isArray(lead?.teamMembers) ? lead.teamMembers : [];
  const teamMembers = rawTeamMembers.length > 0
    ? rawTeamMembers
    : [{ name: assignedEngineer, role: 'Team Lead' }].filter((m: any) => m.name);
  const teamLead = teamMembers.find((m: any) => m.role === 'Team Lead' || m.role === 'team_lead')?.name || assignedEngineer;
  const installer = teamMembers.find((m: any) => m.role === 'Installer' || m.role === 'installer')?.name || null;
  const electrician = teamMembers.find((m: any) => m.role === 'Electrician' || m.role === 'electrician')?.name || null;
  const supervisor = teamMembers.find((m: any) => m.role === 'Supervisor' || m.role === 'supervisor')?.name || null;
  const photoCount = (Array.isArray(lead?.uploadedDocuments) ? lead.uploadedDocuments : []).length;

  // Latest activity mock — would use actual activity query
  const recentActivities: any[] = []; // simplified — use UniversalActivityTab in production

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* ── Section 1: Header ──────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <HardHat className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="text-xs font-mono font-medium text-[var(--color-text-muted)]">
              {lead?.id ? `#${String(lead.id).slice(-8)}` : '—'}
            </span>
            <Badge variant={status === 'completed' ? 'success' : status === 'installation_started' || status === 'installation_in_progress' ? 'warning' : 'default'}>
              {stageLabel(status)}
            </Badge>
          </div>
          <h2 className="text-lg font-bold text-[var(--color-text)]">{lead?.name || 'Installation'}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
            {partnerName !== '—' && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5">
                <Building2 className="h-3 w-3" />
                {partnerName}
              </span>
            )}
            {lead?.systemSizeKW && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5">
                <Zap className="h-3 w-3" />
                {lead.systemSizeKW} kW
              </span>
            )}
            {assignedEngineer && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5">
                <User className="h-3 w-3" />
                {assignedEngineer}
              </span>
            )}
          </div>
        </div>
        {/* Quick action buttons — keep minimal, no strip */}
        <div className="flex items-center gap-2">
          {lead?.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-sunken)] transition-colors"
            >
              <Phone className="h-3.5 w-3.5" />
              Call
            </a>
          )}
        </div>
      </div>

      {/* ── Section 2: 6 KPI Cards ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Completion" value={`${progressPct}%`} icon={<CheckCircle2 className="h-4 w-4" />} />
        <MetricTile label="Team Members" value={lead?.assignedEngineerName ? 1 : 0} icon={<Users className="h-4 w-4" />} />
        <MetricTile label="Days Active" value={daysActive} icon={<Clock className="h-4 w-4" />} />
        <MetricTile label="Materials Used" value={materialsUsed} icon={<Box className="h-4 w-4" />} />
        <MetricTile label="Pending Issues" value={pendingIssues.length} icon={<AlertTriangle className="h-4 w-4" />} />
        <MetricTile
          label="QC Readiness"
          value={status === 'completed' ? 'Ready' : status === 'quality_inspection' ? 'In Progress' : 'Pending'}
          icon={<Shield className="h-4 w-4" />}
        />
      </div>

      {/* ── Section 3: Installation Timeline + Section 4: Details (side-by-side) ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        {/* Timeline */}
        <SectionCard title="Installation Timeline" icon={<Clock className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-2">
            {INSTALLATION_STAGES.map((stage, i) => (
              <TimelineStage
                key={stage}
                index={i}
                isCurrent={i === currentStageIndex}
                isPast={i < currentStageIndex}
                label={stageLabel(stage)}
              />
            ))}
          </div>
        </SectionCard>

        {/* Installation Details */}
        <div className="space-y-4">
          <SectionCard title="Installation Details" icon={<HardHat className="h-3.5 w-3.5" />}>
            <div className="space-y-2.5">
              <DetailRow label="Site Address" value={lead?.siteAddress || location} icon={<MapPin className="h-3 w-3" />} />
              <DetailRow label="Capacity" value={lead?.systemSizeKW ? `${lead.systemSizeKW} kW` : '—'} icon={<Zap className="h-3 w-3" />} />
              <DetailRow label="Customer" value={lead?.name || '—'} icon={<User className="h-3 w-3" />} />
              <DetailRow label="Project" value={linkedProject?.projectId || lead?.projectId || '—'} icon={<Building2 className="h-3 w-3" />} />
              <DetailRow label="Dispatch Ref" value={lead?.dispatchId || '—'} icon={<Box className="h-3 w-3" />} />
              <DetailRow label="Team Assigned" value={assignedEngineer || '—'} icon={<Users className="h-3 w-3" />} />
            </div>
          </SectionCard>

          {/* Schedule */}
          <SectionCard title="Schedule" icon={<Calendar className="h-3.5 w-3.5" />}>
            <div className="space-y-2.5">
              <DetailRow label="Scheduled" value={fmtDateSafe(lead?.scheduledDate)} />
              <DetailRow label="Expected Completion" value={fmtDateSafe(lead?.expectedCompletionDate)} />
              {lead?.installationCompletedAt && (
                <DetailRow label="Completed At" value={fmtDateSafe(lead.installationCompletedAt)} icon={<CheckCircle2 className="h-3 w-3" />} />
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── Section 5: Field Team ──────────────────────────── */}
      <SectionCard title="Field Team" icon={<Users className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Team Lead</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{teamLead || '—'}</p>
            {lead?.assignedEngineerPhone && (
              <a href={`tel:${lead.assignedEngineerPhone}`} className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-[var(--color-primary)] hover:underline">
                <Phone className="h-3 w-3" />
                {lead.assignedEngineerPhone}
              </a>
            )}
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Installers</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{installer || '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Electrician</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{electrician || '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Supervisor</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{supervisor || '—'}</p>
          </div>
        </div>
      </SectionCard>

      {/* ── Section 6: Issues & Blockers ───────────────────── */}
      <SectionCard title="Issues & Blockers" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
        {pendingIssues.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 px-3 py-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">No blockers reported</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingIssues.map((issue: any, i: number) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10 px-3 py-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{issue.title || 'Issue'}</p>
                  {issue.description && <p className="text-[10px] text-amber-600 dark:text-amber-400">{issue.description}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Bottom Row: Tasks + Recent Activity ───────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Section 7: Tasks Overview */}
        <SectionCard title="Tasks Overview" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-[var(--color-bg-sunken)] p-3 text-center">
              <p className="text-lg font-bold tabular-nums text-[var(--color-text)]">—</p>
              <p className="text-[10px] font-medium text-[var(--color-text-muted)]">Total</p>
            </div>
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/10 p-3 text-center">
              <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">—</p>
              <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Completed</p>
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/10 p-3 text-center">
              <p className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">—</p>
              <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Pending</p>
            </div>
          </div>
        </SectionCard>

        {/* Section 8: Recent Activity */}
        <SectionCard title="Recent Activity" icon={<Activity className="h-3.5 w-3.5" />}>
          {recentActivities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Activity className="h-5 w-5 text-[var(--color-text-muted)] mb-2 opacity-40" />
              <p className="text-xs text-[var(--color-text-muted)]">No recent activity</p>
              <p className="text-[10px] text-[var(--color-text-muted)] opacity-60">Activity will appear here as work progresses</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentActivities.map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="h-6 w-6 rounded-full bg-[var(--color-bg-sunken)] flex items-center justify-center shrink-0">
                    <User className="h-3 w-3 text-[var(--color-text-muted)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--color-text)]">{a.action}</p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">{a.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// ── Detail Row Helper ──────────────────────────────────────

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-xs font-medium text-[var(--color-text)]">{value}</span>
    </div>
  );
}
