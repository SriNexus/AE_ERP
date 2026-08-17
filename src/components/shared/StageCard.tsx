import type { ComponentProps, ReactNode } from 'react';

import { Badge, type BadgeVariant } from '../ui/Badge';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { cn } from '../../utils/cn';

export type StageCardStatus = 'completed' | 'current' | 'upcoming' | 'blocked' | 'attention';

export interface StageCardProps {
  title: string;
  description?: ReactNode;
  status?: StageCardStatus;
  badge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
  href?: string;
}

export function resolveStageCardVariant(status?: StageCardStatus): BadgeVariant {
  switch (status) {
    case 'completed':
      return 'success';
    case 'current':
      return 'info';
    case 'blocked':
      return 'danger';
    case 'attention':
      return 'warning';
    case 'upcoming':
    default:
      return 'gray';
  }
}

export function StageCard({
  title,
  description,
  status = 'upcoming',
  badge,
  meta,
  actions,
  children,
  className,
  onClick,
  href,
}: StageCardProps) {
  const content = (
    <Card
      onClick={onClick}
      className={cn(
        'p-4 transition-all',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[var(--theme-shadow-md)]',
        status === 'current' && 'ring-2 ring-[var(--color-primary)]',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{title}</h3>
            {badge ?? <Badge variant={resolveStageCardVariant(status)}>{status}</Badge>}
          </div>
          {description && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>

      {meta && <div className="mt-3 text-xs text-[var(--color-text-secondary)]">{meta}</div>}
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );

  if (href) {
    return (
      <a href={href} className="block" aria-label={title}>
        {content}
      </a>
    );
  }

  return content;
}

export function StageCardAction({
  children,
  variant = 'outline',
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & { children: ReactNode }) {
  return (
    <Button size="sm" variant={variant} className={className} {...props}>
      {children}
    </Button>
  );
}
