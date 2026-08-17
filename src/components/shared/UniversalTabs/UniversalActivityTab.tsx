/**
 * UniversalActivityTab — Activity log viewer with timeline UI
 *
 * Phase 0C: Connected to audit_logs collection + record.activityLog[].
 * Features:
 * - Chronological timeline (newest first)
 * - Icon per action type
 * - Actor, timestamp, action label
 * - Lazy loading via pagination
 * - Empty state
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Clock,
  User,
  Plus,
  Edit3,
  Trash2,
  ArrowRight,
  MessageSquare,
  Phone,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { cn } from '../../../utils/cn';
import { EmptyState } from '../EmptyState';
import { Button } from '../../ui/Button';
import { COLLECTIONS } from '../../../lib/firebase';
import type { UniversalTabProps } from '../../../types';

// ── Activity Entry interface ────────────────────────────────

interface ActivityEntry {
  id: string;
  type: string;
  action: string;
  desc: string;
  date: string;
  userName: string;
  userId?: string;
}

// ── Action icon mapping ─────────────────────────────────────

function getActionIcon(action: string) {
  const key = action.toLowerCase();
  if (key.includes('create') || key.includes('add')) return <Plus className="h-3.5 w-3.5" />;
  if (key.includes('edit') || key.includes('update')) return <Edit3 className="h-3.5 w-3.5" />;
  if (key.includes('delete') || key.includes('remove')) return <Trash2 className="h-3.5 w-3.5" />;
  if (key.includes('transfer')) return <ArrowRight className="h-3.5 w-3.5" />;
  if (key.includes('note') || key.includes('comment')) return <MessageSquare className="h-3.5 w-3.5" />;
  if (key.includes('call') || key.includes('phone')) return <Phone className="h-3.5 w-3.5" />;
  if (key.includes('convert') || key.includes('status')) return <ArrowRight className="h-3.5 w-3.5" />;
  if (key.includes('document') || key.includes('file')) return <FileText className="h-3.5 w-3.5" />;
  return <Activity className="h-3.5 w-3.5" />;
}

function getActionColor(action: string): string {
  const key = action.toLowerCase();
  if (key.includes('create') || key.includes('add')) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (key.includes('delete') || key.includes('remove')) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  if (key.includes('edit') || key.includes('update')) return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  if (key.includes('transfer')) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (key.includes('convert')) return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

function formatActivityDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Main Component ──────────────────────────────────────────

export function UniversalActivityTab({
  entityId,
  entityType,
  permissions,
  record,
}: UniversalTabProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(20);

  // Load activity from record.activityLog[] or embedded data
  useEffect(() => {
    if (!record) {
      setEntries([]);
      setLoading(false);
      return;
    }

    const activityLog = (record as any).activityLog || [];
    const logs: ActivityEntry[] = activityLog
      .filter((entry: any) => entry.type !== 'Note') // Notes handled in NotesTab
      .map((entry: any) => ({
        id: entry.id || `act-${Math.random().toString(36).slice(2, 8)}`,
        type: entry.type || 'Activity',
        action: entry.action || entry.type || 'Updated',
        desc: entry.desc || entry.actionLabel || entry.message || `${entry.type || 'Activity'} recorded`,
        date: entry.date || entry.createdAt || entry.changedAt || new Date().toISOString(),
        userName: entry.userName || entry.authorName || entry.changedBy || 'System',
        userId: entry.userId || entry.authorId,
      }))
      .sort((a: ActivityEntry, b: ActivityEntry) => new Date(b.date).getTime() - new Date(a.date).getTime());

    setEntries(logs);
    setLoading(false);
  }, [record]);

  const visibleEntries = useMemo(
    () => entries.slice(0, visibleCount),
    [entries, visibleCount],
  );

  const handleLoadMore = useCallback(() => {
    setVisibleCount((prev) => prev + 20);
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-[var(--color-bg-sunken)] animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
              <div className="h-3 w-1/4 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)]">
        <Activity className="h-4 w-4" />
        <span>{entries.length} activity log{entries.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-6">
        {entries.length === 0 ? (
          <EmptyState
            title="No activity recorded."
            description="Changes and actions on this record will appear here."
            compact
          />
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[17px] top-2 bottom-2 w-0.5 bg-[var(--color-border-subtle)]" aria-hidden />

            <div className="space-y-0">
              {visibleEntries.map((entry) => (
                <div key={entry.id} className="relative flex items-start gap-4 pb-4">
                  {/* Dot + icon */}
                  <div
                    className={cn(
                      'relative z-10 flex items-center justify-center h-9 w-9 rounded-full shrink-0',
                      getActionColor(entry.action),
                    )}
                  >
                    {getActionIcon(entry.action)}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="text-sm text-[var(--color-text)]">{entry.desc}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-[var(--color-text-muted)]">
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {entry.userName}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatActivityDate(entry.date)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Load more */}
            {entries.length > visibleCount && (
              <div className="flex justify-center pt-2 pb-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  onClick={handleLoadMore}
                >
                  Show {Math.min(20, entries.length - visibleCount)} more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default UniversalActivityTab;
