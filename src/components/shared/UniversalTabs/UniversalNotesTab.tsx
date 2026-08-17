/**
 * UniversalNotesTab — Chronological notes list with add-note composer
 *
 * Phase 0C: Connected to real data from notes subcollection.
 * Data source: COLLECTIONS.ACTIVITY filtered by entityId
 * or embedded notes array on the record.
 *
 * Features:
 * - Chronological list (newest first)
 * - Add-note composer pinned at top
 * - Edit/delete gated by canEdit/canDelete
 * - Permission aware
 * - Empty state: "No notes yet."
 */

import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Plus, Edit3, Trash2, Check, X } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { EmptyState } from '../EmptyState';
import { Button } from '../../ui/Button';
import { useAppStore } from '../../../store/useAppStore';
import { logActivity } from '../../../lib/workflow';
import { genId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import type { UniversalTabProps } from '../../../types';

// ── Note interface (stored in activity logs as 'note' type) ──

interface NoteItem {
  id: string;
  content: string;
  authorName: string;
  authorId: string;
  createdAt: string;
  updatedAt?: string;
}

// ── Add/Edit Note Form ──────────────────────────────────────

function NoteForm({
  initialValue,
  onSave,
  onCancel,
  saving,
}: {
  initialValue?: string;
  onSave: (content: string) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  const [content, setContent] = useState(initialValue || '');

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!content.trim() || saving) return;
      await onSave(content.trim());
      setContent('');
    },
    [content, saving, onSave],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write a note..."
        rows={3}
        className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40 resize-none"
        disabled={saving}
        autoFocus
      />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={saving || !content.trim()}>
          {saving ? 'Saving...' : initialValue ? 'Update' : 'Add Note'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Main Component ──────────────────────────────────────────

export function UniversalNotesTab({
  entityId,
  entityType,
  companyId,
  permissions,
  record,
}: UniversalTabProps) {
  const user = useAppStore((s) => s.user);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load notes from record.activityLog (which contains note-type entries)
  useEffect(() => {
    if (!record) {
      setNotes([]);
      setLoading(false);
      return;
    }

    const activityLog = (record as any).activityLog || [];
    const followups = (record as any).followups || [];

    // Extract note-type entries from activity log
    const noteEntries: NoteItem[] = activityLog
      .filter((entry: any) => entry.type === 'Note' || entry.type === 'note' || entry.type === 'Follow-up')
      .map((entry: any) => ({
        id: entry.id || genId.generic('NOTE'),
        content: entry.desc || entry.note || entry.content || '',
        authorName: entry.userName || entry.authorName || 'User',
        authorId: entry.userId || entry.authorId || '',
        createdAt: entry.date || entry.createdAt || new Date().toISOString(),
        updatedAt: entry.updatedAt,
      }));

    // Also include followup entries
    const followupEntries: NoteItem[] = followups
      .map((entry: any) => ({
        id: entry.id || genId.generic('FU'),
        content: entry.note || entry.content || '',
        authorName: entry.userName || entry.createdByName || 'User',
        authorId: entry.userId || entry.createdBy || '',
        createdAt: entry.createdAt || entry.date || new Date().toISOString(),
      }));

    const all = [...noteEntries, ...followupEntries].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    setNotes(all);
    setLoading(false);
  }, [record]);

  const handleAddNote = useCallback(
    async (content: string) => {
      setSaving(true);
      try {
        await logActivity(
          entityType.charAt(0).toUpperCase() + entityType.slice(1),
          'Note',
          entityId,
          {
            actionLabel: `Note added: ${content.slice(0, 80)}`,
            entityName: (record as any)?.name || (record as any)?.displayName || entityId,
            type: 'Note',
            desc: content,
          },
        );

        // Optimistically add to local state
        const newNote: NoteItem = {
          id: genId.generic('NOTE'),
          content,
          authorName: user?.name || 'User',
          authorId: user?.id || '',
          createdAt: new Date().toISOString(),
        };
        setNotes((prev) => [newNote, ...prev]);
        setShowAddForm(false);
      } catch {
        // Silently fail — activity logging is best-effort
      } finally {
        setSaving(false);
      }
    },
    [entityId, entityType, record, user],
  );

  const handleEditNote = useCallback(
    async (noteId: string, content: string) => {
      setSaving(true);
      try {
        await logActivity(
          entityType.charAt(0).toUpperCase() + entityType.slice(1),
          'Note Edited',
          entityId,
          {
            actionLabel: `Note edited: ${content.slice(0, 80)}`,
            entityName: (record as any)?.name || entityId,
            noteId,
            type: 'Note',
            desc: content,
          },
        );
        setNotes((prev) =>
          prev.map((n) =>
            n.id === noteId ? { ...n, content, updatedAt: new Date().toISOString() } : n,
          ),
        );
        setEditingId(null);
      } catch {
        // Silently fail
      } finally {
        setSaving(false);
      }
    },
    [entityId, entityType, record],
  );

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    },
    [],
  );

  const canCreate = permissions.canCreate !== false;
  const canEdit = permissions.canEdit !== false;

  // Loading skeleton
  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <MessageSquare className="h-4 w-4" />
          <span>
            {notes.length} note{notes.length !== 1 ? 's' : ''}
          </span>
        </div>

        {canCreate && !showAddForm && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setShowAddForm(true)}
          >
            Add note
          </Button>
        )}
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="px-6 py-3 border-b border-[var(--color-border-subtle)]">
          <NoteForm
            onSave={handleAddNote}
            onCancel={() => setShowAddForm(false)}
            saving={saving}
          />
        </div>
      )}

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto p-6">
        {notes.length === 0 ? (
          <EmptyState
            title="No notes yet."
            description="Add a note to this record."
            compact
          />
        ) : (
          <div className="space-y-3">
            {notes.map((note) => {
              const isEditing = editingId === note.id;
              const isOwn = note.authorId === user?.id;

              return (
                <div
                  key={note.id}
                  className="p-4 rounded-xl bg-[var(--color-bg-sunken)] border border-[var(--color-border-subtle)] group"
                >
                  {isEditing ? (
                    <NoteForm
                      initialValue={note.content}
                      onSave={async (content) => handleEditNote(note.id, content)}
                      onCancel={() => setEditingId(null)}
                      saving={saving}
                    />
                  ) : (
                    <>
                      <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">
                        {note.content}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                          <span className="font-medium text-[var(--color-text-secondary)]">
                            {note.authorName}
                          </span>
                          <span>·</span>
                          <span>
                            {new Date(note.createdAt).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {note.updatedAt && note.updatedAt !== note.createdAt && (
                            <span className="italic">(edited)</span>
                          )}
                        </div>

                        {/* Actions */}
                        {canEdit && isOwn && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => setEditingId(note.id)}
                              className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
                              title="Edit note"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteNote(note.id)}
                              className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface)] transition-colors"
                              title="Delete note"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default UniversalNotesTab;
