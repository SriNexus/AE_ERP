/**
 * LeadWorkspaceSections — secondary Lead information/records, mounted
 * directly below the always-open Call Outcome card (LeadWorkspace.tsx).
 *
 * Final Leads Workspace — Customer Workspace Design System Replication
 * mission: replaces the old top tab bar (Overview/Documents/Follow-ups/
 * Notes/Timeline/Communication) with the same "primary workflow, always
 * open → secondary sections below" philosophy already built for the
 * Customer Workspace (see CustomerWorkspaceSections.tsx) — same tiered
 * mechanic, not shared code (Lead's own data/components stay Lead's own):
 *   - Follow-ups and Notes are time-sensitive/actionable, so they get an
 *     always-visible compact peek (next follow-up date/overdue state;
 *     latest note snippet) with a "Show all" expansion to the full existing
 *     tab component.
 *   - Documents/Timeline/Communication are occasional-reference, so they
 *     stay one-click collapsed rows. Timeline deliberately does NOT also
 *     get a peek preview — the Right Panel's own "Recent Activity" widget
 *     already covers "what just happened at a glance"; a second preview of
 *     the same underlying activity log here would be exactly the kind of
 *     duplication the Customer Workspace mission removed (Right Panel
 *     Recent Activity vs. Center Activity peek there).
 *
 * Every section reuses an existing, already-working tab component verbatim
 * — no data logic was rewritten, only the mounting point changed:
 *   Follow-ups    → FollowupsTab (unchanged)
 *   Notes         → NotesCenterPanel (moved here from LeadWorkspace.tsx,
 *                   body untouched — same useWorkspace() dispatch, same
 *                   ADD_TIMELINE action, same fields)
 *   Documents     → LeadWorkspaceDocumentsSection (unchanged)
 *   Timeline      → TimelineCenterPanel (moved here from LeadWorkspace.tsx,
 *                   body untouched)
 *   Communication → CommunicationTab (unchanged)
 */
import { useCallback, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, Calendar, MessageSquare, History, MessageCircle, Clock } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { PeekCard, CollapsedRow } from '../../../../components/shared/WorkspaceSectionCards';
import { usePreserveScroll } from '../../../../hooks/usePreserveScroll';
import { useWorkspace } from './LeadWorkspaceEngine';
import FollowupsTab from './LeadWorkspaceFollowupsTab';
import CommunicationTab from './LeadWorkspaceCommunicationTab';
import LeadWorkspaceDocumentsSection from './LeadWorkspaceDocumentsSection';

type CollapsedId = 'documents' | 'timeline' | 'communication';

interface Props {
  lead: any;
  activityLog: any[];
  nextFollowup: { date: string; overdue: boolean } | null;
  followupCount: number;
  mergedTimeline: { entries: any[]; annotations?: any[] };
  activeCompanyId: string;
  onDocsSaved: () => void;
}

function daysAgoText(value: unknown): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(d); then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'Today'; if (days === 1) return '1 day ago';
  return `${days} days ago`;
}


export default function LeadWorkspaceSections({
  lead, activityLog, nextFollowup, followupCount, mergedTimeline, activeCompanyId, onDocsSaved,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [followupsExpanded, setFollowupsExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [openRow, setOpenRow] = useState<CollapsedId | null>(null);
  // Expanding any of these sections must never move the operator's place on
  // the page — see usePreserveScroll's own doc comment. Same fix applied to
  // the Customer Workspace's equivalent accordion (CustomerWorkspaceSections.tsx).
  const toggleFollowups = usePreserveScroll(rootRef, () => setFollowupsExpanded((v) => !v));
  const toggleNotes = usePreserveScroll(rootRef, () => setNotesExpanded((v) => !v));
  const toggleRow = usePreserveScroll(rootRef, (id: CollapsedId) => setOpenRow((cur) => (cur === id ? null : id)));

  const latestNoteEntry = activityLog.find((l: any) => l.desc);
  const latestNote: string = latestNoteEntry?.desc || lead?.notes || '';
  const latestNoteWhen = latestNoteEntry ? daysAgoText(latestNoteEntry.date) : (lead?.notes ? daysAgoText(lead.createdAt) : '');

  return (
    <div className="space-y-3" ref={rootRef}>
      <p className="px-0.5 text-[9.5px] font-bold uppercase tracking-wider text-[var(--color-text-disabled)]">Lead Context</p>

      <PeekCard
        title="Follow-ups"
        icon={<Calendar className="h-3.5 w-3.5" />}
        meta={followupCount > 0 && (
          <span className="ml-1 inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--color-primary-light)] px-1 text-[9px] font-bold text-[var(--color-primary-text)]">
            {followupCount > 99 ? '99+' : followupCount}
          </span>
        )}
        expanded={followupsExpanded}
        onToggleExpand={toggleFollowups}
        expandLabel="Show all"
        expandedContent={<FollowupsTab activities={activityLog} nextDate={nextFollowup?.date} isOverdue={nextFollowup?.overdue || false} />}
      >
        {nextFollowup ? (
          <p className={['text-[11.5px] leading-snug', nextFollowup.overdue ? 'font-semibold text-red-600 dark:text-red-400' : 'text-[var(--color-text-secondary)]'].join(' ')}>
            {nextFollowup.overdue ? `Follow-up overdue — was due ${nextFollowup.date}` : `Next follow-up: ${nextFollowup.date}`}
          </p>
        ) : (
          <p className="text-[11.5px] text-[var(--color-text-muted)]">No follow-up scheduled yet.</p>
        )}
      </PeekCard>

      <PeekCard
        title="Notes"
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        expanded={notesExpanded}
        onToggleExpand={toggleNotes}
        expandLabel={latestNote ? 'Show all' : 'Add note'}
        expandedContent={<NotesCenterPanel lead={lead} entries={activityLog.filter((l: any) => l.desc)} />}
      >
        {latestNote ? (
          <p className="truncate text-[11.5px] text-[var(--color-text-secondary)]">
            {latestNote}{latestNoteWhen && <span className="text-[var(--color-text-muted)]"> · {latestNoteWhen}</span>}
          </p>
        ) : (
          <p className="text-[11.5px] text-[var(--color-text-muted)]">No notes recorded yet.</p>
        )}
      </PeekCard>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm">
        <CollapsedRow label="Documents" icon={<FileText className="h-3.5 w-3.5" />} open={openRow === 'documents'} onToggle={() => toggleRow('documents')}>
          <div className="flex min-h-0 flex-col">
            <LeadWorkspaceDocumentsSection lead={lead} isEditing activeCompanyId={activeCompanyId} onSaved={onDocsSaved} />
          </div>
        </CollapsedRow>

        <CollapsedRow label="Timeline" icon={<History className="h-3.5 w-3.5" />} open={openRow === 'timeline'} onToggle={() => toggleRow('timeline')}>
          <TimelineCenterPanel entries={mergedTimeline} />
        </CollapsedRow>

        <CollapsedRow label="Communication" icon={<MessageCircle className="h-3.5 w-3.5" />} open={openRow === 'communication'} onToggle={() => toggleRow('communication')}>
          <CommunicationTab activities={activityLog} />
        </CollapsedRow>
      </div>
    </div>
  );
}

// ── Moved verbatim from LeadWorkspace.tsx (Notes/Timeline tab bodies) ──────

function NotesCenterPanel({ lead, entries }: { lead: any; entries: any[] }) {
  const { dispatch } = useWorkspace();
  const [draft, setDraft] = useState('');

  const handleSaveNote = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    dispatch({
      type: 'ADD_TIMELINE',
      payload: {
        id: `note-${Date.now()}`,
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
        type: 'Note',
        desc: text,
      },
    });
    setDraft('');
    toast('Note added — press Save (Alt+S) to store it');
  }, [draft, dispatch]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> Add Note</h3>
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Write a note..."
              className="w-full resize-none bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="xs" onClick={() => setDraft('')} disabled={!draft}>Cancel</Button>
            <Button size="xs" disabled={!draft.trim()} onClick={handleSaveNote}>Save Note</Button>
          </div>
        </div>
      </div>
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Previous Notes</h3>
        {(lead.notes || entries.length > 0) ? (
          <div className="space-y-3">
            {lead.notes && <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-4"><p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{lead.notes}</p><p className="mt-2 text-[10px] text-[var(--color-text-muted)]">Initial · {daysAgoText(lead.createdAt)}</p></div>}
            {entries.map((log: any, idx: number) => (
              <div key={log.id || idx} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-4">
                <p className="text-sm text-[var(--color-text-secondary)]">{log.desc}</p>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                  <span>{log.type}</span><span>·</span><span>{daysAgoText(log.date)}</span>
                  {log.userName && <><span>·</span><span>{log.userName}</span></>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-10"><MessageSquare className="h-6 w-6 text-[var(--color-text-disabled)]" /><p className="text-sm text-[var(--color-text-muted)]">No notes yet</p></div>
        )}
      </div>
    </div>
  );
}

function TimelineCenterPanel({ entries }: { entries: { entries: any[]; annotations?: any[] } }) {
  const list = Array.isArray(entries) ? entries : entries?.entries || [];
  const reversed = [...list].reverse();

  return (
    <div>
      {reversed.length > 0 ? (
        <div className="space-y-2">
          {reversed.map((entry: any, idx: number) => (
            <div key={entry.id || idx} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-3 transition-colors hover:border-[var(--color-border)]">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[var(--color-text)]">{entry.type || 'Activity'}</p>
                  <span className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap">{entry.time || daysAgoText(entry.date)}</span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{entry.desc || 'No details'}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">{entry.userName || 'Demo User'}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-10"><History className="h-8 w-8 text-[var(--color-text-disabled)]" /><p className="text-sm text-[var(--color-text-muted)]">No activity recorded</p></div>
      )}
    </div>
  );
}
