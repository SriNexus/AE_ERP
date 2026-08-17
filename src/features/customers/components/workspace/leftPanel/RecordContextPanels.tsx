/**
 * RecordContextPanels — Left Panel context for Notes / Documents / Activity /
 * History tabs (Phase 3).
 *
 * All four are pure, derived-from-already-loaded-data views — zero
 * additional Firestore queries. Each reads exactly the same source field the
 * corresponding UniversalTabs component reads, so the counts/previews shown
 * here are always consistent with that tab's own content:
 *   - Notes:    record.activityLog[] filtered to type === 'Note' (matches UniversalNotesTab)
 *   - Documents: record.documents[] || record.attachments[] (matches UniversalDocumentsTab)
 *   - Activity: record.activityLog[] excluding Note entries (matches UniversalActivityTab)
 *   - History:  record.transferHistory[] (real field — see CustomersWorkspace.tsx's
 *               assignment-transfer handler) since Customer records have no
 *               stageHistory/statusHistory (those are Lead/Project-only fields;
 *               UniversalHistoryTab falls back to an empty state for Customers today,
 *               a pre-existing gap this phase does not attempt to fix)
 *
 * The filter/sort logic is exported as pure functions (deriveNoteEntries,
 * deriveDocumentEntries, deriveActivityEntries, deriveTransferEntries) so it
 * is unit-testable without rendering — this repo has no
 * @testing-library/react dependency, so pure-function extraction is the only
 * way to get real coverage on this logic (same pattern as Phase 1/2's
 * buildCustomerKpiValues / mostRecentByDate).
 */
import { MessageSquare, FileText as FileIcon, Activity as ActivityIcon, History as HistoryIcon } from 'lucide-react';

function fmt(dateStr: string): string {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function deriveNoteEntries(customer: any): any[] {
  return ((customer?.activityLog || []) as any[])
    .filter((e) => e.type === 'Note' || e.type === 'note')
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
}

export function deriveDocumentEntries(customer: any): any[] {
  return ((customer?.documents || customer?.attachments || []) as any[])
    .slice()
    .sort((a, b) => new Date(b.uploadedAt || b.createdAt || 0).getTime() - new Date(a.uploadedAt || a.createdAt || 0).getTime());
}

export function deriveActivityEntries(customer: any): any[] {
  return ((customer?.activityLog || []) as any[])
    .filter((e) => e.type !== 'Note' && e.type !== 'note')
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
}

export function deriveTransferEntries(customer: any): any[] {
  // Real field shape written by CustomersWorkspace.tsx's transferCustomer
  // mutation: { fromUserName, toUserName, transferredAt, note }.
  return ((customer?.transferHistory || []) as any[])
    .sort((a, b) => new Date(b.transferredAt || 0).getTime() - new Date(a.transferredAt || 0).getTime());
}

export function NotesContextPanel({ customer }: { customer: any }) {
  const notes = deriveNoteEntries(customer);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <MessageSquare className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes Summary</h4>
        </div>
        <p className="text-xs"><strong className="text-sm">{notes.length}</strong> note{notes.length !== 1 ? 's' : ''} recorded</p>
      </div>
      {notes.slice(0, 3).map((n, i) => (
        <div key={n.id || i} className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5">
          <p className="text-xs text-[var(--color-text)] line-clamp-2">{n.desc || n.note || n.content}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{fmt(n.date)} · {n.userName || 'User'}</p>
        </div>
      ))}
    </div>
  );
}

export function DocumentsContextPanel({ customer }: { customer: any }) {
  const docs = deriveDocumentEntries(customer);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <FileIcon className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Document Summary</h4>
        </div>
        <p className="text-xs"><strong className="text-sm">{docs.length}</strong> document{docs.length !== 1 ? 's' : ''} on file</p>
      </div>
      {docs.slice(0, 3).map((d, i) => (
        <div key={d.id || i} className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5">
          <p className="text-xs font-medium text-[var(--color-text)] truncate">{d.name || d.fileName || `Document ${i + 1}`}</p>
          {(d.uploadedAt || d.createdAt) && <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{fmt(d.uploadedAt || d.createdAt)}</p>}
        </div>
      ))}
    </div>
  );
}

export function ActivityContextPanel({ customer }: { customer: any }) {
  const entries = deriveActivityEntries(customer);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <ActivityIcon className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Recent Activity</h4>
        </div>
        <p className="text-xs"><strong className="text-sm">{entries.length}</strong> activity entr{entries.length !== 1 ? 'ies' : 'y'}</p>
      </div>
      {entries.slice(0, 4).map((e, i) => (
        <div key={e.id || i} className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5">
          <p className="text-xs text-[var(--color-text)] line-clamp-2">{e.actionLabel || e.desc || e.type}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{fmt(e.date)} · {e.userName || 'System'}</p>
        </div>
      ))}
    </div>
  );
}

export function HistoryContextPanel({ customer }: { customer: any }) {
  const transfers = deriveTransferEntries(customer);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <HistoryIcon className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Assignment History</h4>
        </div>
        <p className="text-xs"><strong className="text-sm">{transfers.length}</strong> transfer{transfers.length !== 1 ? 's' : ''} recorded</p>
      </div>
      {transfers.length === 0 && (
        <p className="text-[11px] text-[var(--color-text-muted)] px-1">No reassignment history for this customer.</p>
      )}
      {transfers.slice(0, 3).map((t, i) => (
        <div key={i} className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5">
          <p className="text-xs text-[var(--color-text)]">{t.fromUserName || 'Unassigned'} → {t.toUserName || '—'}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{fmt(t.transferredAt)}</p>
        </div>
      ))}
    </div>
  );
}
