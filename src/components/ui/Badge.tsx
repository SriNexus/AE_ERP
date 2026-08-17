import { cn } from '../../utils/cn';
import React from 'react';

export type BadgeVariant = 'default'|'success'|'warning'|'danger'|'info'|'purple'|'gray'|'orange'|'teal'|'pink';

const V: Record<BadgeVariant, string> = {
  default: 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)] border-[var(--color-primary-muted)] hover:bg-[var(--color-primary-light)]/80',
  success: 'bg-[var(--color-success-light)] text-[var(--color-success-text)] border-[var(--color-success)] hover:bg-[var(--color-success-light)]/80',
  warning: 'bg-[var(--color-warning-light)] text-[var(--color-warning-text)] border-[var(--color-warning)] hover:bg-[var(--color-warning-light)]/80',
  danger:  'bg-[var(--color-danger-light)] text-[var(--color-danger-text)] border-[var(--color-danger)] hover:bg-[var(--color-danger-light)]/80',
  info:    'bg-[var(--color-info-light)] text-[var(--color-info-text)] border-[var(--color-info)] hover:bg-[var(--color-info-light)]/80',
  // palette-derived variants below are VALID: they represent fixed brand pigments not themed surfaces
  purple:  'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700 hover:bg-purple-200 dark:hover:bg-purple-900/60',
  gray:    'bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]',
  orange:  'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700 hover:bg-orange-200 dark:hover:bg-orange-900/60',
  teal:    'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-700 hover:bg-teal-200 dark:hover:bg-teal-900/60',
  pink:    'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-900/40 dark:text-pink-300 dark:border-pink-700 hover:bg-pink-200 dark:hover:bg-pink-900/60',
};

export function Badge({ children, variant='default', className }: {
  children: React.ReactNode; variant?: BadgeVariant; className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-none tracking-wide border whitespace-nowrap transition-colors duration-150', V[variant], className)}>
      {children}
    </span>
  );
}

const STATUS_MAP: Record<string, BadgeVariant> = {
  new:'info', active:'success', inactive:'gray', converted:'success',
  lost:'danger', qualified:'purple', 'follow-up':'warning', followup:'warning',
  pending:'warning', processing:'info', confirmed:'teal', completed:'success',
  cancelled:'danger', dispatched:'info', 'in transit':'orange', delivered:'success',
  returned:'danger', packed:'teal', b2b:'purple', b2c:'info',
  paid:'success', unpaid:'danger', partial:'warning', overdue:'danger', refunded:'gray',
  present:'success', absent:'danger', late:'warning', 'half day':'orange',
  approved:'success', rejected:'danger', draft:'gray', sent:'info',
  accepted:'success', expired:'danger', male:'info', female:'pink',
  open:'info', closed:'gray', 'on hold':'orange', escalated:'danger',
  'in progress':'teal', resolved:'success',
  urgent:'danger', high:'orange', medium:'warning', low:'info',
  // Center Panel B2B Workflow Enhancement mission — subtle, consistent
  // status language for stage cards that depend on a prior stage existing.
  'not started':'info', 'action needed':'warning', 'not available yet':'gray',
};

export function statusBadge(status: string): React.ReactElement {
  const v = STATUS_MAP[status?.toLowerCase()] ?? 'default';
  return <Badge variant={v}>{status}</Badge>;
}

const TIER_MAP: Record<string, BadgeVariant> = {
  bronze: 'orange',
  silver: 'gray',
  gold: 'warning',
  platinum: 'purple',
};

export function tierBadge(tier: string): React.ReactElement {
  const v = TIER_MAP[tier?.toLowerCase()] ?? 'default';
  return <Badge variant={v}>{tier}</Badge>;
}
