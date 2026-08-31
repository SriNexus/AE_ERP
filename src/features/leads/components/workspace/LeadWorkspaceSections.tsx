/**
 * LeadWorkspaceSections — secondary Lead information/records, mounted
 * directly below the always-open Call Outcome card (LeadWorkspace.tsx).
 *
 * Section order (centre column, top → bottom):
 *   CALL OUTCOME  (owned by LeadWorkspace.tsx, above this component)
 *   NOTES         — meaningful user-entered context (NOT activity history)
 *   FOLLOW-UPS    — follow-up tasks/scheduling
 *   DOCUMENTS     — lead documents
 *   TIMELINE      — the complete chronological activity history, latest first
 *
 * There is deliberately NO Communication section here — its calls/WhatsApp/
 * emails counters and "Communication History" list duplicated the Timeline,
 * which is now the single source of truth for activity history on this page.
 *
 * Notes vs Timeline:
 *   - Notes shows ONLY real notes: entries the operator typed (activity-log
 *     entries of type "Note") plus the lead's own `notes` field. It never
 *     mirrors call attempts, status changes, timestamps or operator history.
 *   - Timeline shows every activity event, newest first.
 *
 * Every section reuses an existing, already-working component verbatim — no
 * data logic was rewritten, only the mounting point / ordering changed:
 *   Notes         → NotesCenterPanel (below)
 *   Follow-ups    → FollowupsTab (unchanged)
 *   Documents     → LeadWorkspaceDocumentsSection (unchanged)
 *   Timeline      → TimelineCenterPanel (below)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, Calendar, MessageSquare, History, Clock } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { PeekCard, CollapsedRow } from '../../../../components/shared/WorkspaceSectionCards';
import { usePreserveScroll } from '../../../../hooks/usePreserveScroll';
import { useWorkspace } from './LeadWorkspaceEngine';
import FollowupsTab from './LeadWorkspaceFollowupsTab';
import LeadWorkspaceDocumentsSection from './LeadWorkspaceDocumentsSection';

interface Props {
  lead: any;
  activityLog: any[];
  nextFollowup: { date: string; overdue: boolean } | null;
  followupCount: number;
  mergedTimeline: { entries: any[]; annotations?: any[] };
  activeCompanyId: string;
  onDocsSaved: () => void;
  /**
   * Set to a label like "Connected — Interested" when the operator has just
   * selected a Connected sub-outcome (Interested / Need Follow-up / Qualified
   * / Converted). Activates the Notes section so an optional contextual note
   * can be added. `null` otherwise.
   */
  notesOutcomeContext?: string | null;
  /**
   * Bumped by the "Follow-up" Quick Action. Each increment opens the
   * Follow-ups section and scrolls it into view (the page's own scroll
   * container, so the fixed mobile header/footer are respected).
   */
  followupFocusNonce?: number;
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

/** Real notes only — operator-typed activity-log entries of type "Note". */
function noteEntriesOf(activityLog: any[]): any[] {
  return (activityLog || []).filter((l: any) => l && l.type === 'Note' && l.desc);
}

export default function LeadWorkspaceSections({
  lead, activityLog, nextFollowup, followupCount, mergedTimeline, activeCompanyId, onDocsSaved,
  notesOutcomeContext = null, followupFocusNonce = 0,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [followupsExpanded, setFollowupsExpanded] = useState(false);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  // Expanding any of these sections must never move the operator's place on
  // the page — see usePreserveScroll's own doc comment.
  const toggleNotes = usePreserveScroll(rootRef, () => setNotesExpanded((v) => !v));
  const toggleFollowups = usePreserveScroll(rootRef, () => setFollowupsExpanded((v) => !v));
  const toggleTimeline = usePreserveScroll(rootRef, () => setTimelineExpanded((v) => !v));
  const toggleDocuments = usePreserveScroll(rootRef, () => setDocumentsOpen((v) => !v));

  // Selecting a Connected sub-outcome activates Notes: open it so the operator
  // can drop an optional note without an extra click.
  useEffect(() => {
    if (notesOutcomeContext) setNotesExpanded(true);
  }, [notesOutcomeContext]);

  // "Follow-up" Quick Action → open + scroll to the Follow-ups section.
  useEffect(() => {
    if (!followupFocusNonce) return;
    setFollowupsExpanded(true);
    requestAnimationFrame(() => {
      document.getElementById('lead-ws-followups')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [followupFocusNonce]);

  const notes = noteEntriesOf(activityLog);
  const latestNoteEntry = notes[0]; // activityLog is newest-first
  const latestNote: string = latestNoteEntry?.desc || lead?.notes || '';
  const latestNoteWhen = latestNoteEntry
    ? daysAgoText(latestNoteEntry.date)
    : (lead?.notes ? daysAgoText(lead.createdAt) : '');

  const timelineEntries = Array.isArray(mergedTimeline?.entries) ? mergedTimeline.entries : [];
  const latestActivity = timelineEntries[0];

  return (
    <div className="space-y-3" ref={rootRef}>
      <p className="px-0.5 text-[9.5px] font-bold uppercase tracking-wider text-[var(--color-text-disabled)]">Lead Context</p>

      {/* ── NOTES — real user-entered context, above Follow-ups ── */}
      <PeekCard
        title="Notes"
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        expanded={notesExpanded}
        onToggleExpand={toggleNotes}
        expandLabel={latestNote ? 'Show all' : 'Add note'}
        expandedContent={<NotesCenterPanel lead={lead} entries={notes} outcomeContext={notesOutcomeContext} />}
      >
        {latestNote ? (
          <p className="truncate text-[11.5px] text-[var(--color-text-secondary)]">
            {latestNote}{latestNoteWhen && <span className="text-[var(--color-text-muted)]"> · {latestNoteWhen}</span>}
          </p>
        ) : notesOutcomeContext ? (
          <p className="text-[11.5px] text-[var(--color-primary-text)]">
            Add an optional note for <span className="font-semibold">{notesOutcomeContext}</span>.
          </p>
        ) : (
          <p className="text-[11.5px] text-[var(--color-text-muted)]">No notes recorded yet.</p>
        )}
      </PeekCard>

      {/* ── FOLLOW-UPS ── */}
      <div id="lead-ws-followups" className="scroll-mt-3">
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
      </div>

      {/* ── DOCUMENTS ── */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm">
        <CollapsedRow label="Documents" icon={<FileText className="h-3.5 w-3.5" />} open={documentsOpen} onToggle={toggleDocuments}>
          <div className="flex min-h-0 flex-col">
            <LeadWorkspaceDocumentsSection lead={lead} isEditing activeCompanyId={activeCompanyId} onSaved={onDocsSaved} />
          </div>
        </CollapsedRow>
      </div>

      {/* ── TIMELINE — collapsed shows only the latest event; expanded shows
          the complete history, newest → oldest. Single source of truth for
          chronological activity on this page. ── */}
      <PeekCard
        title="Timeline"
        icon={<History className="h-3.5 w-3.5" />}
        expanded={timelineExpanded}
        onToggleExpand={toggleTimeline}
        expandLabel="Show all"
        expandedContent={<TimelineCenterPanel entries={mergedTimeline} />}
      >
        {latestActivity ? (
          <p className="truncate text-[11.5px] text-[var(--color-text-secondary)]">
            {latestActivity.desc || latestActivity.type || 'Activity'}
            <span className="text-[var(--color-text-muted)]">
              {' · '}{latestActivity.time || daysAgoText(latestActivity.date) || 'Today'}
              {latestActivity.userName ? ` · ${latestActivity.userName}` : ''}
            </span>
          </p>
        ) : (
          <p className="text-[11.5px] text-[var(--color-text-muted)]">No activity recorded yet.</p>
        )}
      </PeekCard>
    </div>
  );
}

// ── Notes ────────────────────────────────────────────────────────────────
// Real, operator-entered notes only. Persistence reuses the existing
// ADD_TIMELINE({ type: 'Note' }) path — which buildWorkspaceLeadDelta already
// appends to the lead's activityLog on Save — so no second notes data model.

function NotesCenterPanel({ lead, entries, outcomeContext }: { lead: any; entries: any[]; outcomeContext?: string | null }) {
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
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" /> Add Note
        </h3>
        {outcomeContext && (
          <p className="mb-2 text-[11px] text-[var(--color-text-muted)]">
            Optional context for <span className="font-semibold text-[var(--color-text-secondary)]">{outcomeContext}</span> — you can leave this blank.
          </p>
        )}
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={outcomeContext ? `Note for ${outcomeContext}…` : 'Write a note...'}
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
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" /> Previous Notes
        </h3>
        {(lead?.notes || entries.length > 0) ? (
          <div className="space-y-3">
            {lead?.notes && (
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-4">
                <p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{lead.notes}</p>
                <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">Initial · {daysAgoText(lead.createdAt)}</p>
              </div>
            )}
            {entries.map((log: any, idx: number) => (
              <div key={log.id || idx} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-4">
                <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{log.desc}</p>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                  <span>{daysAgoText(log.date) || 'Today'}</span>
                  {log.userName && <><span>·</span><span>{log.userName}</span></>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-10">
            <MessageSquare className="h-6 w-6 text-[var(--color-text-disabled)]" />
            <p className="text-sm text-[var(--color-text-muted)]">No notes yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────
// `entries.entries` arrives already sorted newest → oldest from
// LeadWorkspace.mergedTimeline (real timestamps, stable id tiebreak) — this
// component only renders it, it does not re-order.

function TimelineCenterPanel({ entries }: { entries: { entries: any[]; annotations?: any[] } }) {
  const list = Array.isArray(entries) ? entries : entries?.entries || [];

  return (
    <div>
      {list.length > 0 ? (
        <div className="space-y-2">
          {list.map((entry: any, idx: number) => (
            <div key={entry.id || idx} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-3 transition-colors hover:border-[var(--color-border)]">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[var(--color-text)]">{entry.type || 'Activity'}</p>
                  <span className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap">{entry.time || daysAgoText(entry.date) || 'Today'}</span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{entry.desc || 'No details'}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">{entry.userName || 'Demo User'}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-10">
          <History className="h-8 w-8 text-[var(--color-text-disabled)]" />
          <p className="text-sm text-[var(--color-text-muted)]">No activity recorded</p>
        </div>
      )}
    </div>
  );
}
