import { Check, Circle, Clock3, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { cn } from '../../utils/cn';
import type { StageCardStatus } from './StageCard';

export interface StageTimelineItem {
  id: string;
  title: string;
  description?: string;
  status?: StageCardStatus;
  badge?: ReactNode;
  href?: string;
  disabled?: boolean;
  onClick?: () => void;
}

export interface StageTimelineResolvedItem extends StageTimelineItem {
  resolvedStatus: StageCardStatus;
  index: number;
}

export interface StageTimelineProps {
  stages: StageTimelineItem[];
  activeStageId?: string;
  orientation?: 'horizontal' | 'vertical';
  compact?: boolean;
  className?: string;
  onStageClick?: (stage: StageTimelineItem) => void;
}

export function resolveStageTimelineItems(
  stages: StageTimelineItem[],
  activeStageId?: string
): { items: StageTimelineResolvedItem[]; completedCount: number; activeIndex: number } {
  const explicitActiveIndex = activeStageId ? stages.findIndex((stage) => stage.id === activeStageId) : -1;
  const fallbackActiveIndex = stages.findIndex((stage) => stage.status === 'current');
  const activeIndex = explicitActiveIndex >= 0 ? explicitActiveIndex : fallbackActiveIndex >= 0 ? fallbackActiveIndex : 0;

  const items = stages.map((stage, index) => {
    const resolvedStatus: StageCardStatus = stage.status
      ?? (index < activeIndex ? 'completed' : index === activeIndex ? 'current' : 'upcoming');

    return {
      ...stage,
      index,
      resolvedStatus,
    };
  });

  return {
    items,
    completedCount: items.filter((item) => item.resolvedStatus === 'completed').length,
    activeIndex,
  };
}

function StageMarker({ status }: { status: StageCardStatus }) {
  const icon = status === 'completed'
    ? <Check className="h-3.5 w-3.5" />
    : status === 'current'
      ? <Circle className="h-3.5 w-3.5 fill-current" />
      : <Clock3 className="h-3.5 w-3.5" />;

  return (
    <div
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-[var(--color-surface)]',
        status === 'completed' && 'bg-[var(--color-success)] text-[var(--color-text-inverse)] ring-[var(--color-success)]',
        status === 'current' && 'bg-[var(--color-primary)] text-[var(--color-text-inverse)] ring-[var(--color-primary)]',
        status === 'blocked' && 'bg-[var(--color-danger)] text-[var(--color-text-inverse)] ring-[var(--color-danger)]',
        status === 'attention' && 'bg-[var(--color-warning)] text-[var(--color-text-inverse)] ring-[var(--color-warning)]',
        status === 'upcoming' && 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] ring-[var(--color-border)]'
      )}
      aria-hidden="true"
    >
      {icon}
    </div>
  );
}

export function StageTimeline({
  stages,
  activeStageId,
  orientation = 'horizontal',
  compact = false,
  className,
  onStageClick,
}: StageTimelineProps) {
  const { items, completedCount } = resolveStageTimelineItems(stages, activeStageId);
  const progressPercent = items.length ? Math.round((completedCount / items.length) * 100) : 0;

  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project Timeline</p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{progressPercent}% complete</p>
        </div>
        <Badge variant="info">{items.length} stages</Badge>
      </div>

      <div className="mt-4">
        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border-subtle)]">
          <div className="h-full rounded-full bg-[var(--color-primary)] transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div
        aria-label="Project stages"
        className={cn(
          'mt-4',
          orientation === 'horizontal'
            ? 'flex gap-3 overflow-x-auto pb-2'
            : 'space-y-3',
          compact && 'gap-2'
        )}
      >
        {items.map((stage) => {
          const clickable = Boolean(stage.href || stage.onClick || onStageClick) && !stage.disabled;
          const sharedClassName = cn(
            'group flex min-w-0 flex-1 items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition',
            clickable && 'hover:-translate-y-0.5 hover:shadow-[var(--theme-shadow-md)]',
            stage.resolvedStatus === 'current' && 'ring-2 ring-[var(--color-primary)]',
            stage.resolvedStatus === 'completed' && 'border-[var(--color-success)]',
            stage.resolvedStatus === 'blocked' && 'border-[var(--color-danger)]',
            stage.resolvedStatus === 'attention' && 'border-[var(--color-warning)]',
            stage.disabled && 'cursor-not-allowed opacity-60',
            orientation === 'vertical' && 'w-full'
          );

          const inner = (
            <>
              <StageMarker status={stage.resolvedStatus} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-[var(--color-text)]">{stage.title}</span>
                  {stage.badge}
                </div>
                {stage.description && (
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{stage.description}</p>
                )}
              </div>
              {clickable && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition group-hover:text-[var(--color-text-secondary)]" />}
            </>
          );

          if (stage.href) {
            return (
              <a
                key={stage.id}
                aria-current={stage.resolvedStatus === 'current' ? 'step' : undefined}
                href={stage.href}
                onClick={(event) => {
                  if (stage.disabled) {
                    event.preventDefault();
                    return;
                  }
                  stage.onClick?.();
                  onStageClick?.(stage);
                }}
                className={sharedClassName}
                aria-label={stage.title}
              >
                {inner}
              </a>
            );
          }

          return (
            <button
              key={stage.id}
              aria-current={stage.resolvedStatus === 'current' ? 'step' : undefined}
              type="button"
              onClick={() => {
                stage.onClick?.();
                onStageClick?.(stage);
              }}
              disabled={!clickable}
              className={sharedClassName}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
