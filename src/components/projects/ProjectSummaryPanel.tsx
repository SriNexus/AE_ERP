import { CalendarPlus, MapPin, MessageCircle, Phone, Users } from 'lucide-react';

import type { ProjectRecord } from '../../features/projects/types';
import { projectCapacityLabel, projectCustomerLabel, projectSiteAddressSummary, projectStageLabel } from '../../features/projects/utils/projectDisplay';
import { Badge } from '../ui/Badge';
import { cn } from '../../utils/cn';

function value(record: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const candidate = String(record?.[key] || '').trim();
    if (candidate) return candidate;
  }
  return '';
}

export function ProjectSummaryPanel({ project, customer }: { project: ProjectRecord; customer?: Record<string, unknown> | null }) {
  const phone = value(customer, ['phone', 'mobile', 'businessPhone']);
  const digits = phone.replace(/\D/g, '');
  const team = [
    ['Sales owner', project.salesOwner],
    ['Surveyor', project.assignedSurveyor],
    ['Installer', project.assignedInstaller],
  ] as const;

  const contactValue = phone || value(customer, ['email']) || '—';
  const actionClass = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong,var(--color-border))] hover:bg-[var(--color-surface-hover)] md:h-9 md:min-h-0';

  return (
    <div className="space-y-6">
      {/* Identity — the one thing the eye should land on first */}
      <div>
        <h2 className="text-lg font-bold leading-snug text-[var(--color-text)]">{customer ? projectCustomerLabel(customer) : project.customerId}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Badge variant="info">{projectStageLabel(project.currentStage)}</Badge>
          <span className="font-mono text-xs text-[var(--color-text-muted)]">{project.projectId || project.id}</span>
        </div>
      </div>

      {/* Key facts — quiet, compact, grouped as one visual block instead of three separate labeled stacks */}
      <dl className="space-y-2.5 rounded-xl bg-[var(--color-bg-sunken)] p-3.5 text-sm">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-[var(--color-text-muted)]">Capacity</dt>
          <dd className="font-semibold text-[var(--color-text)]">{projectCapacityLabel(project.capacityKw)}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-[var(--color-text-muted)]">Contact</dt>
          <dd className="truncate text-right font-medium text-[var(--color-text-secondary)]">{contactValue}</dd>
        </div>
        <div className="flex items-start justify-between gap-3 border-t border-[var(--color-border-subtle)] pt-2.5">
          <dt className="flex shrink-0 items-center gap-1 text-[var(--color-text-muted)]"><MapPin className="h-3.5 w-3.5" /> Site</dt>
          <dd className="text-right leading-relaxed text-[var(--color-text-secondary)]">{projectSiteAddressSummary(project.siteAddress)}</dd>
        </div>
      </dl>

      {/* Team — same grouped treatment so it reads as a sibling block, not a separate section fighting for attention */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          <Users className="h-3.5 w-3.5" /> Team
        </p>
        <div className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
          {team.map(([label, member]) => (
            <div key={label} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
              <span className="text-[var(--color-text-muted)]">{label}</span>
              <span className="truncate font-medium text-[var(--color-text)]">{member || 'Unassigned'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions — one consistent visual style so Call / WhatsApp / Schedule read as equal options, not mismatched controls */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
        <a href={phone ? `tel:${phone}` : undefined} aria-disabled={!phone} className={cn(actionClass, !phone && 'pointer-events-none opacity-50')}>
          <Phone className="h-3.5 w-3.5" />Call
        </a>
        <a href={digits ? `https://wa.me/${digits}` : undefined} target="_blank" rel="noreferrer" aria-disabled={!digits} className={cn(actionClass, !digits && 'pointer-events-none opacity-50')}>
          <MessageCircle className="h-3.5 w-3.5" />WhatsApp
        </a>
        <button type="button" onClick={() => document.getElementById('project-schedule-stage')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className={actionClass}>
          <CalendarPlus className="h-3.5 w-3.5" />Schedule Visit
        </button>
      </div>
    </div>
  );
}
