/**
 * ProjectWorkspaceSections — secondary Project information, mounted
 * directly below the always-open "Work on This Project" card
 * (ProjectWorkspace.tsx) — same tiered PeekCard/CollapsedRow mechanic
 * Customer/Lead Workspace already use (see
 * src/components/shared/WorkspaceSectionCards.tsx — the actual shared
 * component now, not just a similar-looking copy), so a UI/UX change to
 * that shell reflects in all three workspaces at once.
 *
 * Order: Documents → Activity → Notes → Linked Records (Documents first,
 * per explicit feedback — Activity sits directly below it, not first like
 * Customer's own ordering).
 *
 * Every section reuses an existing, already-working implementation
 * verbatim — no data logic invented:
 *   Documents      → ProjectWorkspaceDocumentsSection (the same shared
 *                     DocumentManager Customer/Lead already wrap)
 *   Activity       → project.stageHistory, the real existing stage-
 *                     transition log (2 most recent shown, "Show all"
 *                     expands to the full list) — same peek/expand
 *                     mechanic as Customer's own Activity section
 *   Notes          → project.notes, the same field the Left Panel and the
 *                     inline editor already read/write
 *   Linked Records → CustomerLinkedRecordsTabContent, reused verbatim and
 *                     scoped to this project's own linked customerId — the
 *                     SAME customer relationship Customer Workspace itself
 *                     shows for that customer, not a parallel system
 */
import { useState } from 'react';
import { FileText, Activity, Link2 } from 'lucide-react';
import { PeekCard, CollapsedRow } from '../../../../components/shared/WorkspaceSectionCards';
import { projectStageLabel } from '../../utils/projectDisplay';
import CustomerLinkedRecordsTabContent from '../../../customers/components/workspace/CustomerLinkedRecordsTabContent';
import ProjectWorkspaceDocumentsSection from './ProjectWorkspaceDocumentsSection';
import type { ProjectRecord } from '../../types';

type CollapsedId = 'documents' | 'linked';

interface Props {
  project: ProjectRecord;
  customer: any;
  users: any[];
  activeCompanyId: string;
  canEditProject: boolean;
  permissions: { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean };
  onDocsSaved: () => void;
}

function fmtWhen(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function userName(id: string | undefined, users: any[]): string | undefined {
  if (!id) return undefined;
  const match = users.find((u) => u.id === id);
  return match?.name || match?.displayName;
}

export default function ProjectWorkspaceSections({ project, customer, users, activeCompanyId, canEditProject, permissions, onDocsSaved }: Props) {
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [openRow, setOpenRow] = useState<CollapsedId | null>(null);
  const toggleRow = (id: CollapsedId) => setOpenRow((cur) => (cur === id ? null : id));

  const activityAll = (project.stageHistory || [])
    .slice()
    .sort((a, b) => new Date(b.changedAt || 0).getTime() - new Date(a.changedAt || 0).getTime());
  const activityRecent = activityAll.slice(0, 2);
  const docCount = (project.documents || []).length;

  return (
    <div className="space-y-3">
      <p className="px-0.5 text-[9.5px] font-bold uppercase tracking-wider text-[var(--color-text-disabled)]">Project Context</p>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm">
        <CollapsedRow label="Documents" icon={<FileText className="h-3.5 w-3.5" />} meta={docCount ? `${docCount}` : undefined} open={openRow === 'documents'} onToggle={() => toggleRow('documents')}>
          <ProjectWorkspaceDocumentsSection project={project} isEditing={canEditProject} activeCompanyId={activeCompanyId} onSaved={onDocsSaved} />
        </CollapsedRow>
      </div>

      <PeekCard
        title="Activity"
        icon={<Activity className="h-3.5 w-3.5" />}
        expanded={activityExpanded}
        onToggleExpand={() => setActivityExpanded((v) => !v)}
        expandLabel="Show full log"
        expandedContent={
          <div className="space-y-2">
            {activityAll.map((entry, idx) => (
              <div key={`${entry.stage}-${entry.changedAt}-${idx}`} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
                <p className="min-w-0 flex-1 text-[11.5px] text-[var(--color-text-secondary)]">
                  <span className="text-[var(--color-text)] font-medium">{projectStageLabel(entry.stage)}{entry.note ? ` — ${entry.note}` : ''}</span>
                  <span className="text-[var(--color-text-muted)]"> · {fmtWhen(entry.changedAt)}{userName(entry.changedBy, users) ? ` · ${userName(entry.changedBy, users)}` : ''}</span>
                </p>
              </div>
            ))}
          </div>
        }
      >
        {activityRecent.length > 0 ? (
          <div className="space-y-1.5">
            {activityRecent.map((entry, idx) => (
              <div key={`${entry.stage}-${entry.changedAt}-${idx}`} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
                <p className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--color-text-secondary)]">
                  <span className="text-[var(--color-text)] font-medium">{projectStageLabel(entry.stage)}{entry.note ? ` — ${entry.note}` : ''}</span>
                  <span className="text-[var(--color-text-muted)]"> · {fmtWhen(entry.changedAt)}</span>
                </p>
              </div>
            ))}
            {activityAll.length > activityRecent.length && (
              <p className="pl-3.5 text-[10px] text-[var(--color-text-muted)]">+{activityAll.length - activityRecent.length} more</p>
            )}
          </div>
        ) : (
          <p className="text-[11.5px] text-[var(--color-text-muted)]">No activity recorded yet.</p>
        )}
      </PeekCard>

      {project.notes && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h4 className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes</h4>
          <p className="text-[12px] text-[var(--color-text-secondary)] leading-5 whitespace-pre-wrap">{project.notes}</p>
        </div>
      )}

      {customer && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm">
          <CollapsedRow label="Linked Records" icon={<Link2 className="h-3.5 w-3.5" />} open={openRow === 'linked'} onToggle={() => toggleRow('linked')}>
            <CustomerLinkedRecordsTabContent customer={customer} entityId={project.customerId} companyId={activeCompanyId} permissions={permissions} />
          </CollapsedRow>
        </div>
      )}
    </div>
  );
}
