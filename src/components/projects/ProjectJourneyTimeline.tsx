/**
 * ProjectJourneyTimeline.tsx
 *
 * A polished, visually-driven 12-stage timeline for project workspaces.
 * This is a UI-only component — it does not modify any Firestore fields,
 * Project types, hooks, or business logic.
 */

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  Circle,
  Clock,
  AlertTriangle,
  AlertCircle,
  Shield,
  Wifi,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { cn } from '../../utils/cn';
import type { AmcContractRecord } from '../../features/amc/types';
import type { GenerationReadingRecord } from '../../features/monitoring/types';

import type {
  ProjectJourneyStage,
  ProjectJourneyStageStatus,
  ProjectJourneyFooterData,
  AmcFooterStatus,
  MonitoringFooterStatus,
} from './ProjectJourneyTimeline.types';
import {
  resolveKpiData,
  resolveJourneyFooterData,
  formatJourneyDate,
  formatJourneyDateFull,
  STATUS_COLORS,
  statusLabel,
} from './ProjectJourneyTimeline.helpers';

// ═══════════════════════════════════════════════════════════════
//  MetricTile (exported for reuse in sticky bar)
// ═══════════════════════════════════════════════════════════════

export function MetricTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  accent?: 'success' | 'warning' | 'danger' | 'info' | 'muted';
}) {
  const accentStyles: Record<string, string> = {
    success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400',
    warning: 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400',
    danger:  'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400',
    info:    'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400',
    muted:   'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 transition-colors hover:border-[var(--color-border)]">
      <div className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
        accentStyles[accent ?? 'muted'],
      )}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {label}
        </p>
        <p className="mt-0.5 text-base font-bold text-[var(--color-text)]">
          {value}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  StageIcon
// ═══════════════════════════════════════════════════════════════

const StageIcon = memo(function StageIcon({
  icon: Icon,
  status,
  size = 'md',
}: {
  icon: LucideIcon;
  status: ProjectJourneyStageStatus;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeMap = {
    sm: 'h-7 w-7',
    md: 'h-9 w-9',
    lg: 'h-11 w-11',
  };
  const iconSizeMap = {
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };
  const colors = STATUS_COLORS[status];

  const iconContent =
    status === 'completed' ? <Check className={cn(iconSizeMap[size], 'text-white')} /> :
    status === 'current' ? <Icon className={cn(iconSizeMap[size], 'text-white')} /> :
    status === 'blocked' ? <AlertTriangle className={cn(iconSizeMap[size], 'text-white')} /> :
    status === 'attention' ? <AlertCircle className={cn(iconSizeMap[size], 'text-white')} /> :
    <Icon className={cn(iconSizeMap[size], 'text-[var(--color-text-muted)]')} />;

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full transition-all duration-300',
        sizeMap[size],
        colors.bg,
        colors.ring,
        status === 'current' && 'ring-4 shadow-lg shadow-[var(--color-primary)]/20',
        status === 'completed' && 'ring-2',
      )}
      aria-hidden="true"
    >
      {iconContent}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
//  StatusBadge
// ═══════════════════════════════════════════════════════════════

const StatusBadge = memo(function StatusBadge({ status }: { status: ProjectJourneyStageStatus }) {
  const variantMap: Record<ProjectJourneyStageStatus, 'success' | 'info' | 'gray' | 'danger' | 'warning'> = {
    completed: 'gray',
    current: 'info',
    upcoming: 'gray',
    blocked: 'danger',
    attention: 'warning',
  };

  return <Badge variant={variantMap[status]}>{statusLabel(status)}</Badge>;
});

// ═══════════════════════════════════════════════════════════════
//  StageCard
// ═══════════════════════════════════════════════════════════════

const StageCard = memo(function StageCard({
  stage,
  isActive,
}: {
  stage: ProjectJourneyStage;
  isActive: boolean;
}) {
  const colors = STATUS_COLORS[stage.status];
  const dateLabel = stage.date ? formatJourneyDate(stage.date) : undefined;

  return (
    <div
      className={cn(
        'relative flex w-[196px] shrink-0 flex-col gap-3 rounded-2xl border p-4 transition-all duration-300',
        'hover:-translate-y-0.5 hover:shadow-md',
        isActive
          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 shadow-sm ring-1 ring-[var(--color-primary)]/15'
          : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
        stage.status === 'attention' && !isActive && 'border-amber-300/70 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/10',
        stage.status === 'blocked' && !isActive && 'border-red-300/70 bg-red-50/40 dark:border-red-800/40 dark:bg-red-950/10',
      )}
      role="listitem"
      aria-current={isActive ? 'step' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <StageIcon icon={stage.icon} status={stage.status} size="md" />
        <StatusBadge status={stage.status} />
      </div>

      <div className="min-w-0">
        <h3 className={cn(
          'text-sm font-bold truncate',
          stage.status === 'upcoming' ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]',
        )}>
          {stage.title}
        </h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          {stage.description}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between">
        {dateLabel ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--color-text-secondary)]">
            <Clock className="h-3 w-3" />
            {dateLabel}
          </span>
        ) : (
          <span />
        )}
        {stage.href && stage.status !== 'upcoming' && (
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-wider',
            colors.text,
          )}>
            View
          </span>
        )}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
//  MilestoneRow
// ═══════════════════════════════════════════════════════════════

const MilestoneRow = memo(function MilestoneRow({ stages }: { stages: ProjectJourneyStage[] }) {
  return (
    <div
      className="relative flex items-center gap-0 overflow-x-auto pb-2 scrollbar-thin scroll-smooth"
      style={{ scrollbarWidth: 'thin' }}
    >
      {stages.map((stage, idx) => {
        const colors = STATUS_COLORS[stage.status];
        const isLast = idx === stages.length - 1;

        return (
          <div key={stage.id} className="flex items-center shrink-0">
            <div
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all duration-300',
                stage.status === 'completed' && colors.bg,
                stage.status === 'current' && cn(colors.bg, 'h-6 w-6 ring-4 ring-[var(--color-primary)]/20'),
                stage.status === 'upcoming' && 'bg-[var(--color-bg-sunken)] border-2 border-[var(--color-border)]',
                stage.status === 'blocked' && colors.bg,
                stage.status === 'attention' && colors.bg,
              )}
              data-stage-id={stage.id}
            >
              {stage.status === 'completed' && <Check className="h-2.5 w-2.5 text-white" />}
              {stage.status === 'current' && <Circle className="h-2.5 w-2.5 fill-white text-white" />}
            </div>

            {!isLast && (
              <div
                className={cn(
                  'h-0.5 w-10 sm:w-16 transition-colors duration-300',
                  stage.status === 'completed' && stages[idx + 1].status !== 'upcoming'
                    ? 'bg-emerald-400'
                    : stage.status === 'completed' && stages[idx + 1].status === 'upcoming'
                      ? 'bg-gradient-to-r from-emerald-400 to-[var(--color-border)]'
                      : 'bg-[var(--color-border)]',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
//  DesktopTimeline
// ═══════════════════════════════════════════════════════════════

function DesktopTimeline({ stages }: { stages: ProjectJourneyStage[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);
  const activeIndex = useMemo(
    () => stages.findIndex((s) => s.status === 'current'),
    [stages],
  );

  useEffect(() => {
    if (hasScrolledRef.current) return;
    const container = containerRef.current;
    if (!container || activeIndex < 0) return;

    const activeCard = container.querySelector<HTMLElement>(
      `[data-stage-index="${activeIndex}"]`,
    );
    if (activeCard) {
      activeCard.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
      hasScrolledRef.current = true;
    }
  }, [activeIndex]);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-[var(--color-bg)] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[var(--color-bg)] to-transparent" />

      <MilestoneRow stages={stages} />

      <div
        ref={containerRef}
        className="mt-4 flex gap-4 overflow-x-auto pb-4 scroll-smooth snap-x snap-mandatory"
        style={{ scrollbarWidth: 'thin', scrollSnapType: 'x mandatory' }}
        role="list"
        aria-label="Project journey stages"
      >
        {stages.map((stage, index) => (
          <div
            key={stage.id}
            data-stage-index={index}
            className="snap-start"
            style={{ scrollSnapAlign: 'start' }}
          >
            {stage.href && stage.status !== 'upcoming' ? (
              <a href={stage.href} className="block no-underline" aria-label={`View ${stage.title}`}>
                <StageCard stage={stage} isActive={index === activeIndex} />
              </a>
            ) : (
              <StageCard stage={stage} isActive={index === activeIndex} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MobileTimeline
// ═══════════════════════════════════════════════════════════════

const MobileTimeline = memo(function MobileTimeline({ stages }: { stages: ProjectJourneyStage[] }) {
  return (
    <div className="space-y-1" role="list" aria-label="Project journey stages">
      {stages.map((stage, index) => {
        const colors = STATUS_COLORS[stage.status];
        const isLast = index === stages.length - 1;
        const dateFull = stage.date ? formatJourneyDateFull(stage.date) : undefined;

        return (
          <div key={stage.id} className="relative flex gap-4" role="listitem">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all',
                  stage.status === 'completed' && colors.bg,
                  stage.status === 'current' && cn(colors.bg, 'ring-2 ring-[var(--color-primary)]/30'),
                  stage.status === 'upcoming' && 'border-2 border-[var(--color-border)] bg-[var(--color-bg-sunken)]',
                  stage.status === 'blocked' && colors.bg,
                  stage.status === 'attention' && colors.bg,
                )}
              >
                {stage.status === 'completed' && <Check className="h-3 w-3 text-white" />}
                {stage.status === 'current' && <Circle className="h-3 w-3 fill-white text-white" />}
                {stage.status === 'upcoming' && <div className="h-2 w-2 rounded-full bg-[var(--color-border)]" />}
                {stage.status === 'blocked' && <AlertTriangle className="h-3 w-3 text-white" />}
                {stage.status === 'attention' && <AlertCircle className="h-3 w-3 text-white" />}
              </div>

              {!isLast && (
                <div
                  className={cn(
                    'mt-1 w-0.5 flex-1 min-h-[24px]',
                    stage.status === 'completed' && stages[index + 1].status !== 'upcoming'
                      ? 'bg-emerald-300 dark:bg-emerald-700'
                      : 'bg-[var(--color-border)]',
                  )}
                />
              )}
            </div>

            <div className={cn(
              'min-w-0 flex-1 pb-5',
              stage.href && stage.status !== 'upcoming' ? 'cursor-pointer' : '',
            )}>
              {stage.href && stage.status !== 'upcoming' ? (
                <a href={stage.href} className="block no-underline">
                  <MobileStageContent stage={stage} dateFull={dateFull} />
                </a>
              ) : (
                <MobileStageContent stage={stage} dateFull={dateFull} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});

const MobileStageContent = memo(function MobileStageContent({
  stage,
  dateFull,
}: {
  stage: ProjectJourneyStage;
  dateFull?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 transition-colors hover:border-[var(--color-border)]">
      <div className="flex items-center justify-between gap-2">
        <h4 className={cn(
          'text-sm font-bold truncate',
          stage.status === 'upcoming' ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]',
        )}>
          {stage.title}
        </h4>
        <StatusBadge status={stage.status} />
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{stage.description}</p>
      {dateFull && (
        <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-[var(--color-text-secondary)]">
          <Clock className="h-3 w-3" />
          {dateFull}
        </p>
      )}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
//  AMCFooter (Phase 6: Improved post-handover section)
// ═══════════════════════════════════════════════════════════════

const AmcFooter = memo(function AmcFooter({ data }: { data: ProjectJourneyFooterData }) {
  return (
    <Card className="overflow-hidden border-[var(--color-border-subtle)] p-0">
      <div className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-5 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
          Post Handover
        </p>
      </div>

      <div className="grid grid-cols-1 divide-y divide-[var(--color-border-subtle)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {/* AMC */}
        <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-bg-sunken)]">
          <div className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
            data.amcStatus === 'active'
              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'
              : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
          )}>
            {data.amcStatus === 'active' ? <Shield className="h-6 w-6" /> : <HelpCircle className="h-6 w-6" />}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              AMC
            </p>
            <p className={cn(
              'mt-0.5 text-lg font-bold',
              data.amcStatus === 'active' ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--color-text)]',
            )}>
              {data.amcStatus === 'active' ? 'ACTIVE' : data.amcStatus === 'inactive' ? 'INACTIVE' : 'TBD'}
            </p>
            {data.amcCount > 0 && (
              <p className="mt-0.5 text-xs font-medium text-[var(--color-text-muted)]">
                {data.amcCount} contract{data.amcCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>

        {/* Monitoring */}
        <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-bg-sunken)]">
          <div className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
            data.monitoringStatus === 'enabled'
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400'
              : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
          )}>
            {data.monitoringStatus === 'enabled' ? <Wifi className="h-6 w-6" /> : <HelpCircle className="h-6 w-6" />}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              Monitoring
            </p>
            <p className={cn(
              'mt-0.5 text-lg font-bold',
              data.monitoringStatus === 'enabled' ? 'text-blue-600 dark:text-blue-400' : 'text-[var(--color-text)]',
            )}>
              {data.monitoringStatus === 'enabled' ? 'ENABLED' : data.monitoringStatus === 'disabled' ? 'DISABLED' : 'TBD'}
            </p>
            {data.monitoringCount > 0 && (
              <p className="mt-0.5 text-xs font-medium text-[var(--color-text-muted)]">
                {data.monitoringCount} reading{data.monitoringCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>

        {/* Warranty */}
        <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-bg-sunken)]">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]">
            {data.warrantyStatus.isTbd ? <HelpCircle className="h-6 w-6" /> : <Shield className="h-6 w-6" />}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              Warranty
            </p>
            <p className="mt-0.5 text-lg font-bold text-[var(--color-text)]">
              {data.warrantyStatus.label}
            </p>
            {data.warrantyStatus.isTbd && (
              <p className="mt-0.5 text-xs font-medium text-[var(--color-text-muted)]">
                Not configured
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
});

// ═══════════════════════════════════════════════════════════════
//  CurrentStageHero (Phase 5: dedicated current-stage card)
// ═══════════════════════════════════════════════════════════════

export function CurrentStageHero({
  currentStageName,
  daysInStage,
  stages,
  projectId,
}: {
  currentStageName: string;
  daysInStage: number;
  stages: ProjectJourneyStage[];
  projectId?: string;
}) {
  const currentStage = stages.find((s) => s.status === 'current');
  const currentIndex = currentStage?.index ?? -1;
  const nextStage = currentIndex >= 0 && currentIndex < stages.length - 1
    ? stages[currentIndex + 1]
    : null;
  const href = currentStage?.href;

  if (!currentStage) return null;

  const startedDate = currentStage.date ? formatJourneyDateFull(currentStage.date) : undefined;

  return (
    <Card className="overflow-hidden border-[var(--color-primary)]/20 p-0">
      <div className="flex items-stretch">
        {/* Left accent bar — the one strong color cue on the page; everything else stays quiet so this reads first */}
        <div className="w-1 shrink-0 bg-[var(--color-primary)]" />

        <div className="flex flex-1 flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              Current Stage
            </p>
            <div className="flex items-center gap-3">
              <StageIcon icon={currentStage.icon} status="current" size="lg" />
              <div>
                <h3 className="text-xl font-bold text-[var(--color-text)]">{currentStageName}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                  {startedDate && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Started {startedDate}
                    </span>
                  )}
                  {daysInStage > 0 && (
                    <span>{daysInStage} day{daysInStage !== 1 ? 's' : ''} in stage</span>
                  )}
                  {nextStage && (
                    <span className="text-[var(--color-text-muted)]">
                      Next: <strong className="text-[var(--color-text-secondary)]">{nextStage.title}</strong>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {href && (
            <a
              href={href}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-semibold text-[var(--color-text-inverse)] transition-all hover:bg-[var(--color-primary)]/90 hover:shadow-md"
            >
              Open {currentStage.shortLabel}
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
//  CollapsibleSection (Phase 3: reusable collapsible group)
// ═══════════════════════════════════════════════════════════════

export function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bg-sunken)]"
      >
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-semibold uppercase tracking-wider',
            count > 0 ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]',
          )}>
            {title}
          </span>
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--color-bg-sunken)] px-1.5 text-[10px] font-bold text-[var(--color-text-secondary)]">
            {count}
          </span>
        </div>
        <span className={cn(
          'text-[10px] font-medium text-[var(--color-text-muted)] transition-transform duration-200',
          isOpen && 'rotate-180',
        )}>
          ▼
        </span>
      </button>
      {isOpen && <div className="border-t border-[var(--color-border-subtle)] px-4 py-4">{children}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════════════════════════

export interface ProjectJourneyTimelineProps {
  project: {
    id: string;
    projectId: string;
    currentStage: string;
    stageHistory: Array<{
      stage: string;
      changedAt: string;
    }>;
    createdAt?: string;
  };
  linked: {
    amcContracts: AmcContractRecord[];
    generationReadings: GenerationReadingRecord[];
  };
}

export const ProjectJourneyTimeline = memo(function ProjectJourneyTimeline({
  project,
  linked,
}: ProjectJourneyTimelineProps) {
  const {
    stages,
    percent,
    completedCount,
    currentStageName,
    attentionCount,
    remainingCount,
    daysInStage,
    hasAttention,
  } = useMemo(() => resolveKpiData(project, project.projectId || project.id), [project]);

  const footerData = useMemo(
    () => resolveJourneyFooterData(linked.amcContracts, linked.generationReadings),
    [linked.amcContracts, linked.generationReadings],
  );

  const createdDate = project.createdAt ? formatJourneyDateFull(project.createdAt) : undefined;

  return (
    <div className="space-y-5">
      {/* Header: overall progress for the journey as a whole */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              Project Journey
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {stages.length} stages
              {createdDate && <span className="hidden sm:inline"> · Created {createdDate}</span>}
            </p>
          </div>
          <p className={cn(
            'text-2xl font-bold tabular-nums',
            percent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--color-text)]',
          )}>
            {percent}%
          </p>
        </div>

        <div className="mt-4">
          <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-bg-sunken)]">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-700 ease-out',
                percent === 100
                  ? 'bg-emerald-500'
                  : 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary)]/70',
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between px-0.5">
            {[0, 25, 50, 75, 100].map((mark) => (
              <span
                key={mark}
                className={cn(
                  'text-[9px] font-medium',
                  percent >= mark ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]',
                )}
              >
                {mark}%
              </span>
            ))}
          </div>
        </div>
      </Card>

      {/* Current Stage Hero — instant orientation, distinct purpose from the detailed stage work surface elsewhere on the page */}
      <CurrentStageHero
        currentStageName={currentStageName}
        daysInStage={daysInStage}
        stages={stages}
        projectId={project.projectId || project.id}
      />

      {/* Desktop Timeline — navigation through the workflow */}
      <div className="hidden sm:block">
        <DesktopTimeline stages={stages} />
      </div>

      {/* Mobile Timeline */}
      <div className="sm:hidden">
        <MobileTimeline stages={stages} />
      </div>

      {/* Post-handover: AMC, monitoring, warranty */}
      <AmcFooter data={footerData} />
    </div>
  );
});
