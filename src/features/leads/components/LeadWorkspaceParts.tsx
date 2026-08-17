import React from 'react';
import { AlertTriangle, Calendar } from 'lucide-react';

import { fmtDate } from '../../../lib/firestore';

export function EmptyCell({ children = '-' }: { children?: React.ReactNode }) {
  return <span className="text-[var(--color-text-disabled)]">{children}</span>;
}

export function CreatedDateCell({
  value,
  formatCreatedDate,
  recencyDotClass,
}: {
  value: any;
  formatCreatedDate: (value: any) => string;
  recencyDotClass: (value: any) => string;
}) {
  const formatted = formatCreatedDate(value);
  if (!formatted) return <EmptyCell />;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full ${recencyDotClass(value)}`} aria-hidden="true" />
      {formatted}
    </span>
  );
}

export function FollowupBadge({
  next_date,
  isOverdue,
  isToday,
}: {
  next_date: any;
  isOverdue: (value: any) => boolean;
  isToday: (value: any) => boolean;
}) {
  if (!next_date) return <span className="text-[var(--color-text-muted)] text-xs">-</span>;
  const formatted = fmtDate(next_date);
  if (isOverdue(next_date)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-1.5 py-0.5 rounded-md border border-red-200 dark:border-red-700 whitespace-nowrap">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        {formatted}
      </span>
    );
  }
  if (isToday(next_date)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-md border border-amber-200 dark:border-amber-700 whitespace-nowrap">
        <Calendar className="h-3 w-3 shrink-0" />
        Today
      </span>
    );
  }
  return <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{formatted}</span>;
}
