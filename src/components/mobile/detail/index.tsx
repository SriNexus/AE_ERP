import React, { useEffect, useState } from 'react';
import { ChevronDown, MoreVertical, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { statusBadge } from '../../ui/Badge';
import { cn } from '../../../utils/cn';

export type DetailAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
};

function useActionLock() {
  const [locked, setLocked] = useState(false);
  return {
    locked,
    run(action?: DetailAction) {
      if (!action || action.disabled || action.loading || locked) return;
      setLocked(true);
      try {
        action.onClick();
      } finally {
        window.setTimeout(() => setLocked(false), 650);
      }
    },
  };
}

export type DetailField = {
  label: string;
  value: React.ReactNode;
};

export type TimelineItem = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  date?: React.ReactNode;
  actor?: React.ReactNode;
};

export function EntityHeader({
  title,
  subtitle,
  status,
  owner,
  backTarget,
  onBack,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  status?: string;
  owner?: React.ReactNode;
  backTarget?: string;
  onBack?: () => void;
}) {
  return (
    <header className="mobile-detail-header">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{backTarget || 'Details'}</p>
            <h2 className="mt-1 truncate text-lg font-bold text-[var(--color-text)]">{title}</h2>
            {subtitle && <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">{subtitle}</p>}
          </div>
          {onBack && (
            <button type="button" aria-label="Close detail" onClick={onBack} className="mobile-detail-icon-button">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {status && statusBadge(status)}
          {owner && <span className="mobile-detail-owner">{owner}</span>}
        </div>
      </div>
    </header>
  );
}

export function StickyActions({
  primary,
  secondary = [],
  loading,
  disabled,
}: {
  primary?: DetailAction;
  secondary?: DetailAction[];
  loading?: boolean;
  disabled?: boolean;
}) {
  const actionLock = useActionLock();
  if (!primary && secondary.length === 0) return null;
  return (
    <div className="mobile-sticky-actions" role="toolbar" aria-label="Primary detail actions">
      {primary && (
        <Button className="min-w-0 flex-1" size="sm" onClick={() => actionLock.run(primary)} disabled={disabled || primary.disabled || actionLock.locked} loading={loading || primary.loading}>
          {primary.label}
        </Button>
      )}
      {secondary.slice(0, 2).map((action) => (
        <Button
          key={action.label}
          className="min-w-0 flex-1"
          size="sm"
          variant="outline"
          onClick={() => actionLock.run(action)}
          disabled={disabled || action.disabled || actionLock.locked}
          loading={action.loading}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

export function PrimaryInfoCard({ items }: { items: DetailField[] }) {
  return (
    <section className="mobile-primary-card">
      <dl className="grid grid-cols-2 gap-3">
        {items.filter((item) => item.value !== undefined && item.value !== null && item.value !== '').map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="truncate text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{item.label}</dt>
            <dd className="mt-1 truncate text-sm font-semibold text-[var(--color-text)]">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DetailSection({
  title,
  collapsed,
  content,
}: {
  title: string;
  collapsed?: boolean;
  content: React.ReactNode;
}) {
  return (
    <CollapsibleSection title={title} defaultCollapsed={collapsed}>
      {content}
    </CollapsibleSection>
  );
}

export function CollapsibleSection({
  title,
  defaultCollapsed = false,
  children,
}: {
  title: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  return (
    <section className="mobile-detail-section">
      <button
        type="button"
        className="mobile-detail-section__header"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <span>{title}</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="mobile-detail-section__body">{children}</div>}
    </section>
  );
}

export function TimelineSection({ items, empty = 'No activity recorded yet.' }: { items?: TimelineItem[]; empty?: string }) {
  const safeItems = items?.filter((item) => item.title || item.description || item.date || item.actor) || [];
  if (!safeItems.length) return null;
  return (
    <section className="mobile-detail-timeline">
      <h3>Timeline</h3>
      <div className="space-y-3">
        {safeItems.map((item, index) => (
          <div key={index} className="mobile-detail-timeline__item">
            <span className="mobile-detail-timeline__dot" />
            <div className="min-w-0 flex-1">
              {item.title && <p className="truncate text-sm font-semibold text-[var(--color-text)]">{item.title}</p>}
              {item.description && <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{item.description}</p>}
              {(item.date || item.actor) && (
                <p className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]">
                  {[item.actor, item.date].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      {!safeItems.length && <p className="text-sm text-[var(--color-text-muted)]">{empty}</p>}
    </section>
  );
}

export function ActionDrawer({
  actions = [],
  dangerActions = [],
  permissions = true,
}: {
  actions?: DetailAction[];
  dangerActions?: DetailAction[];
  permissions?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const actionLock = useActionLock();
  const allActions = [...actions, ...dangerActions];

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previousActive = document.activeElement as HTMLElement | null;
    window.setTimeout(() => document.querySelector<HTMLElement>('.mobile-detail-action-sheet__sheet button:not(:disabled)')?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previousActive?.focus?.();
    };
  }, [open]);

  if (!permissions || allActions.length === 0) return null;

  return (
    <div className="mobile-detail-drawer">
      <Button variant="outline" size="sm" className="w-full" icon={<MoreVertical className="h-4 w-4" />} onClick={() => setOpen(true)}>
        More actions
      </Button>
      {open && (
        <div className="mobile-detail-action-sheet" role="dialog" aria-modal="true">
          <button type="button" className="mobile-detail-action-sheet__backdrop" aria-label="Close actions" onClick={() => setOpen(false)} />
          <div className="mobile-detail-action-sheet__sheet" role="menu" aria-label="Detail actions">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--color-border-strong)]" />
            {[...actions, ...dangerActions].map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={action.disabled || action.loading}
                onClick={() => {
                  setOpen(false);
                  actionLock.run(action);
                }}
                role="menuitem"
                aria-disabled={action.disabled || action.loading || undefined}
                className={cn(
                  'w-full rounded-xl px-4 py-3 text-left text-sm font-semibold transition-colors',
                  action.danger ? 'text-[var(--color-danger-text)] hover:bg-[var(--color-danger-light)]' : 'text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]',
                  (action.disabled || action.loading) && 'cursor-not-allowed opacity-50',
                )}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
