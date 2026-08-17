import type { ReactNode } from 'react';
import { cn } from '../../../utils/cn';

type MobileHomeCardProps = {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function MobileHomeCard({ title, actions, children, className, bodyClassName }: MobileHomeCardProps) {
  return (
    <div className={cn(
      'overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm',
      className
    )}>
      <div className="flex min-h-[54px] items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <h3 className="text-sm font-bold text-[var(--color-text)]">{title}</h3>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      <div className={cn('p-3', bodyClassName)}>
        {children}
      </div>
    </div>
  );
}

export function MobileHomeSkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-0 divide-y divide-[var(--color-border-subtle)]">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex animate-pulse items-center gap-3 py-3">
          <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--color-bg-sunken)]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-3/4 rounded bg-[var(--color-bg-sunken)]" />
            <div className="h-2.5 w-1/2 rounded bg-[var(--color-bg-sunken)] opacity-70" />
          </div>
          <div className="h-7 w-16 rounded-lg bg-[var(--color-bg-sunken)] opacity-70" />
        </div>
      ))}
    </div>
  );
}

export function MobileHomeEmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex min-h-[168px] flex-col items-center justify-center gap-2 px-5 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-bg-sunken)] text-[var(--color-text-disabled)]">
        {icon}
      </div>
      <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
      <p className="max-w-[220px] text-xs leading-5 text-[var(--color-text-muted)]">{description}</p>
    </div>
  );
}
