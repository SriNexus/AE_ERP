/**
 * UniversalHistoryTab — Immutable audit trail viewer
 *
 * Phase 0C: Connected to record.stageHistory[] and record.statusHistory[].
 * Features:
 * - Read-only — no edit/delete ever
 * - Shows actor, timestamp, action for each change
 * - Prioritizes stageHistory → statusHistory → audit logs
 * - Empty state: "No history recorded."
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  History,
  Clock,
  User,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Archive,
} from 'lucide-react';
import { cn } from '../../../utils/cn';
import { EmptyState } from '../EmptyState';
import type { UniversalTabProps } from '../../../types';

// ── History Entry interface ─────────────────────────────────

interface HistoryEntry {
  id: string;
  type: 'stage' | 'status' | 'audit';
  from?: string;
  to: string;
  changedAt: string;
  changedBy?: string;
  note?: string;
}

// ── Entry icon mapping ──────────────────────────────────────

function getHistoryIcon(entry: HistoryEntry) {
  if (entry.type === 'stage') {
    if (entry.to === 'Completed' || entry.to === 'Handover') return <CheckCircle2 className="h-3.5 w-3.5" />;
    if (entry.to === 'Cancelled' || entry.to === 'Lost' || entry.to === 'Archived') return <XCircle className="h-3.5 w-3.5" />;
    if (entry.to === 'Closure') return <Archive className="h-3.5 w-3.5" />;
    return <ArrowRight className="h-3.5 w-3.5" />;
  }
  if (entry.type === 'status') return <RotateCcw className="h-3.5 w-3.5" />;
  return <Clock className="h-3.5 w-3.5" />;
}

function getHistoryColor(entry: HistoryEntry): string {
  if (entry.type === 'stage') {
    const to = entry.to.toLowerCase();
    if (to === 'completed' || to === 'handover' || to === 'closure') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
    if (to === 'cancelled' || to === 'lost' || to === 'archived') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    if (to === 'qc') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  }
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

function formatHistoryDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Main Component ──────────────────────────────────────────

export function UniversalHistoryTab({
  entityId,
  permissions,
  record,
}: UniversalTabProps) {
  const [loading, setLoading] = useState(true);

  const entries = useMemo(() => {
    const results: HistoryEntry[] = [];

    // Priority 1: stageHistory[] 
    const stageHistory = (record as any)?.stageHistory || [];
    stageHistory.forEach((entry: any, index: number) => {
      const prevStage = index > 0 ? stageHistory[index - 1]?.stage : undefined;
      results.push({
        id: `stage-${index}`,
        type: 'stage',
        from: prevStage,
        to: entry.stage || entry.to || '',
        changedAt: entry.changedAt || entry.date || new Date().toISOString(),
        changedBy: entry.changedBy || entry.userName || 'System',
        note: entry.note,
      });
    });

    // Priority 2: statusHistory[] (if no stageHistory)
    if (results.length === 0) {
      const statusHistory = (record as any)?.statusHistory || [];
      statusHistory.forEach((entry: any, index: number) => {
        results.push({
          id: `status-${index}`,
          type: 'status',
          from: entry.from || entry.previousStatus,
          to: entry.to || entry.status,
          changedAt: entry.changedAt || entry.date || new Date().toISOString(),
          changedBy: entry.changedBy || entry.changedByName || 'System',
          note: entry.note,
        });
      });
    }

    // Sort by changedAt descending (newest first)
    results.sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());

    return results;
  }, [record]);

  useEffect(() => {
    setLoading(false);
  }, [entries]);

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-[var(--color-bg-sunken)] animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
              <div className="h-3 w-1/3 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
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
        <History className="h-4 w-4" />
        <span>{entries.length} history entr{entries.length !== 1 ? 'ies' : 'y'}</span>
        <span className="text-[var(--color-text-muted)]">· Read-only</span>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-6">
        {entries.length === 0 ? (
          <EmptyState
            title="No history recorded."
            description="Changes to this record will appear here."
            compact
          />
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[17px] top-2 bottom-2 w-0.5 bg-[var(--color-border-subtle)]" aria-hidden />

            <div className="space-y-0">
              {entries.map((entry) => {
                const displayName = entry.type === 'stage' ? 'Stage' : 'Status';
                return (
                  <div key={entry.id} className="relative flex items-start gap-4 pb-4">
                    {/* Dot + icon */}
                    <div
                      className={cn(
                        'relative z-10 flex items-center justify-center h-9 w-9 rounded-full shrink-0',
                        getHistoryColor(entry),
                      )}
                    >
                      {getHistoryIcon(entry)}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[var(--color-text)]">
                          {entry.type === 'stage' ? (
                            <>
                              {entry.from ? (
                                <><span className="text-[var(--color-text-muted)]">{entry.from}</span> <ArrowRight className="h-3 w-3 inline" /> </>  
                              ) : null}
                              <span className="font-semibold">{entry.to}</span>
                            </>
                          ) : (
                            entry.to
                          )}
                        </span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] uppercase tracking-wider">
                          {displayName}
                        </span>
                      </div>

                      {entry.note && (
                        <p className="mt-1 text-xs text-[var(--color-text-muted)] italic">
                          "{entry.note}"
                        </p>
                      )}

                      <div className="flex items-center gap-2 mt-1 text-xs text-[var(--color-text-muted)]">
                        {entry.changedBy && (
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {entry.changedBy}
                          </span>
                        )}
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatHistoryDate(entry.changedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default UniversalHistoryTab;
