/**
 * ProjectWorkspaceHeader — compact operational identity area for the Project
 * Workspace (Project Workspace UI Structure mission — replicates
 * CustomerWorkspaceHeader.tsx's exact visual language: same avatar
 * treatment (h-12 w-12/text-lg), same text-xl name, same px-6 py-4 padding,
 * same chip styling, same info-row pattern, same Call/WhatsApp/Email
 * quick-action buttons).
 *
 * A Project has no name of its own — its real identifier is `projectId`
 * (e.g. PRJ-2024-00123), so that's the header's title, not a copied
 * Customer name. The linked customer's name is a prominent secondary line
 * (operators need to know whose project this is), never the primary
 * identity. Call/WhatsApp/Email use the LINKED CUSTOMER's own contact
 * details — a Project has none of its own — a real cross-reference, not
 * Customer Workspace content reused wholesale.
 */
import { ArrowLeft, Phone, Mail, MessageCircle, MapPin, User } from 'lucide-react';
import { projectStageLabel, projectCapacityLabel } from '../../utils/projectDisplay';
import type { ProjectRecord } from '../../types';

export interface ProjectHeaderFields {
  projectId: string;
  stageLabel: string;
  capacityLabel: string;
  projectType: string | undefined;
  city: string | undefined;
  salesOwner: string | undefined;
}

/** Pure field-resolution — no React — mirrors resolveCustomerHeaderFields's
 * own discipline; unit-testable without rendering. Header shows only the
 * city (matching Customer Workspace's own header — city only, not a full
 * address line) — the full site address belongs in the Project's own
 * detail, not this compact identity strip. */
export function resolveProjectHeaderFields(project: ProjectRecord): ProjectHeaderFields {
  return {
    projectId: project.projectId || project.id,
    stageLabel: projectStageLabel(project.currentStage),
    capacityLabel: projectCapacityLabel(project.capacityKw),
    projectType: project.projectType || undefined,
    city: project.siteAddress?.city || undefined,
    salesOwner: project.salesOwner || undefined,
  };
}

interface Props {
  project: ProjectRecord;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  onViewCustomer?: () => void;
  onBack: () => void;
}

export default function ProjectWorkspaceHeader({ project, customerName, customerPhone, customerEmail, onViewCustomer, onBack }: Props) {
  const { projectId, stageLabel, capacityLabel, projectType, city, salesOwner } = resolveProjectHeaderFields(project);

  return (
    <div className="flex shrink-0 items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-6 py-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-hover)] text-lg font-bold text-white shadow-sm ring-2 ring-[var(--color-primary-muted)]">
        {projectId[0]?.toUpperCase() || 'P'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="truncate text-xl font-bold text-[var(--color-text)]">{projectId}</h1>
          {/* One status signal (stage) — matches Customer Workspace's own
              "exactly one status pill" rule. Capacity is identity/spec, not
              status, so it stays a neutral tag chip, never colored like the
              stage pill. */}
          <span className="inline-flex items-center rounded-full border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-primary-text)]">
            {stageLabel}
          </span>
          <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            {capacityLabel}
          </span>
          {projectType && (
            <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              {projectType}
            </span>
          )}
        </div>
        {(customerName || city || salesOwner) && (
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {customerName && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><User className="h-3 w-3" />{customerName}</span>}
            {city && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><MapPin className="h-3 w-3" />{city}</span>}
            {salesOwner && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><User className="h-3 w-3" />{salesOwner}</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
        {customerPhone && (
          <a href={`tel:${customerPhone}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors shadow-sm">
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
        )}
        {customerPhone && (
          <a href={`https://wa.me/${String(customerPhone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 dark:hover:bg-emerald-900/20 dark:hover:border-emerald-700 dark:hover:text-emerald-400 transition-colors shadow-sm">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        )}
        {customerEmail && (
          <a href={`mailto:${customerEmail}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 dark:hover:bg-blue-900/20 dark:hover:border-blue-700 dark:hover:text-blue-400 transition-colors shadow-sm">
            <Mail className="h-3.5 w-3.5" /> Email
          </a>
        )}
        {onViewCustomer && (
          <button
            type="button"
            onClick={onViewCustomer}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors shadow-sm"
          >
            View Customer
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 sm:px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors shadow-sm"
          title="Back to Projects"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Projects</span>
        </button>
      </div>
    </div>
  );
}
