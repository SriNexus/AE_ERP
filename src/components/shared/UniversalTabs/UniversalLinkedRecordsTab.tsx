/**
 * UniversalLinkedRecordsTab — Grouped entity relationship viewer
 *
 * Phase 0B: Uses LinkedRecordsEngine to query entity_relationships
 * and RELATIONSHIP_MAP for graph traversal.
 *
 * Shows:
 * - Grouped entity cards with count badges
 * - Preview of linked records per group
 * - View All link to navigate to workspace
 * - Permission-aware rendering
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ExternalLink, Layers, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../utils/cn';
import { EmptyState } from '../EmptyState';
import { linkedRecordsEngine } from '../../../engines/LinkedRecordsEngine';
import type { LinkedRecordGroup } from '../../../types';
import type { UniversalTabProps } from '../../../types';

// ── Entity type → icon color mapping ────────────────────────

const GROUP_COLORS: Record<string, string> = {
  leads: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  customers: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  projects: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  surveys: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  quotations: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  orders: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  invoices: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  dispatch: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  payments: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  registrations: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  tasks: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  cases: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  service_tickets: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  default: 'bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
};

function getGroupColor(entityType: string): string {
  return GROUP_COLORS[entityType] || GROUP_COLORS.default;
}

// ── Status pill colors ───────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  Completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  default: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || STATUS_COLORS.default;
}

// ── Group Card ───────────────────────────────────────────────

function GroupCard({
  group,
  onNavigate,
}: {
  group: LinkedRecordGroup;
  onNavigate: (link: string) => void;
}) {
  const recentRecords = useMemo(
    () => group.records.slice(0, 5),
    [group.records],
  );

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] overflow-hidden transition-all duration-150 hover:border-[var(--color-border)] hover:shadow-sm">
      {/* Group header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'flex items-center justify-center h-7 w-7 rounded-lg text-xs font-bold',
            getGroupColor(group.entityType),
          )}>
            {group.label.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">{group.label}</p>
            <p className="text-[11px] text-[var(--color-text-muted)]">
              {group.count} record{group.count !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigate(group.viewAllLink)}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors"
        >
          View all
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Recent records preview */}
      {recentRecords.length > 0 && (
        <div className="divide-y divide-[var(--color-border-subtle)]">
          {recentRecords.map((record) => (
            <button
              key={record.id}
              type="button"
              onClick={() => onNavigate(record.link)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[var(--color-bg-sunken)] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-[var(--color-text)] truncate">{record.name}</span>
                <span className={cn(
                  'text-[10px] font-medium px-1.5 py-0.5 rounded-md shrink-0',
                  getStatusColor(record.status),
                )}>
                  {record.status}
                </span>
              </div>
              <ExternalLink className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />
            </button>
          ))}
        </div>
      )}

      {/* "+ N more" footer */}
      {group.records.length > 5 && (
        <button
          type="button"
          onClick={() => onNavigate(group.viewAllLink)}
          className="w-full px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-sunken)] transition-colors text-center border-t border-[var(--color-border-subtle)]"
        >
          +{group.records.length - 5} more
        </button>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────

export function UniversalLinkedRecordsTab({
  entityId,
  entityType,
  companyId,
}: UniversalTabProps) {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<LinkedRecordGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    if (!entityId || !entityType) {
      setGroups([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const results = await linkedRecordsEngine.getLinkedRecords(
        entityId,
        entityType,
        companyId,
      );
      setGroups(results);
    } catch (err: any) {
      setGroups([]);
      if (err.message && !err.message.includes('not configured')) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType, companyId]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleNavigate = useCallback(
    (link: string) => {
      navigate(link);
    },
    [navigate],
  );

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger-light)] p-4 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)]">
        <Layers className="h-4 w-4" />
        <span>
          {groups.length} relationship
          {groups.length !== 1 ? 's' : ''} found
        </span>
        {groups.length > 0 && (
          <span className="text-[var(--color-text-muted)]">
            · {groups.reduce((sum, g) => sum + g.count, 0)} total records
          </span>
        )}
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-y-auto p-6">
        {groups.length === 0 ? (
          <EmptyState
            title="No linked records found"
            description="Linked records from other modules will appear here as relationships are created."
            compact
          />
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <GroupCard
                key={group.entityType}
                group={group}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default UniversalLinkedRecordsTab;
