/**
 * WorkspaceSectionCards — shared PeekCard/CollapsedRow building blocks for
 * every workspace's secondary-sections area below its primary workflow
 * card (Customer/Lead/Project Workspace). Extracted from
 * CustomerWorkspaceSections.tsx/LeadWorkspaceSections.tsx, which had
 * pixel-identical implementations of both (verified byte-for-byte before
 * this extraction, aside from each other's `meta` prop — a lossless merge,
 * not a behavior change for either existing consumer). A single UI/UX
 * change here now reflects in all three workspaces at once, instead of
 * near-identical local copies quietly drifting apart.
 */
import { ChevronDown } from 'lucide-react';

/** Always-visible peek card — for time-sensitive content worth a glance
 * without a click. `expanded` reveals the full underlying component. */
export function PeekCard({ title, icon, meta, expanded, onToggleExpand, expandLabel, children, expandedContent }: {
  title: string; icon: React.ReactNode; meta?: React.ReactNode; expanded: boolean; onToggleExpand: () => void; expandLabel: string;
  children: React.ReactNode; expandedContent: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2.5">
        <h4 className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          <span>{icon}</span>{title}{meta}
        </h4>
        <button type="button" onClick={onToggleExpand} className="rounded text-[10.5px] font-semibold text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1">
          {expanded ? 'Show less' : expandLabel}
        </button>
      </div>
      {children}
      {expanded && <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">{expandedContent}</div>}
    </div>
  );
}

/** One-click collapsed row — for occasional, non-time-sensitive lookups. */
export function CollapsedRow({ label, icon, meta, open, onToggle, children }: {
  label: string; icon: React.ReactNode; meta?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border-b border-[var(--color-border-subtle)] last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-3 text-left transition-colors hover:text-[var(--color-primary-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1"
      >
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${open ? '' : '-rotate-90'}`} />
        <span className="shrink-0 text-[var(--color-text-muted)]">{icon}</span>
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">{label}</span>
        {meta && <span className="text-[10px] font-medium text-[var(--color-text-muted)]">{meta}</span>}
      </button>
      {open && <div className="pb-4 pl-6">{children}</div>}
    </div>
  );
}
