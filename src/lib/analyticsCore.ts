/**
 * P10-02 — Analytics Core: Shared Helpers & Types
 *
 * Extracted from dashboardAggregation.ts and reportsAggregation.ts
 * to eliminate duplicate date-parsing and counting logic.
 *
 * Pure functions — no Firestore, no React.
 */
import { PROJECT_STAGE_ORDER } from './projectLifecycle';

// ── Date Helpers ───────────────────────────────────────────

/** Parse any value → Date | null. Handles Firestore Timestamp, ISO string, unix seconds. */
export function safeDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.toDate === 'function') return (obj as { toDate: () => Date }).toDate();
    if (typeof obj.seconds === 'number') return new Date(Number(obj.seconds) * 1000);
  }
  return null;
}

/** Convert value to milliseconds since epoch (0 on failure). */
export function dateMs(value: unknown): number {
  const d = safeDate(value);
  return d ? d.getTime() : 0;
}

/** Days between two dates (absolute, rounded). */
export function daysBetween(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();
  return Math.max(0, Math.round(diff / 86400000));
}

/** Safe number conversion — returns 0 for NaN/null/undefined. */
export function safeNumber(value: unknown): number {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

/** Start of today (midnight). */
export function startOfDay(date = new Date()): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Start of current month (midnight). */
export function startOfMonth(date = new Date()): Date {
  const next = new Date(date);
  next.setDate(1);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Short month key (e.g. "Jan", "Feb"). */
export function monthKey(date: Date): string {
  return date.toLocaleString('default', { month: 'short' });
}

/** Check if a value is within a date range. */
export function inRange(value: unknown, from: Date, to: Date): boolean {
  const parsed = dateMs(value);
  return parsed >= from.getTime() && parsed < to.getTime();
}

/** Build N month buckets starting from `months-1` months ago. */
export function buildMonthBuckets(months = 6): Record<string, { month: string; orders: number; revenue: number }> {
  const now = new Date();
  const buckets: Record<string, { month: string; orders: number; revenue: number }> = {};
  for (let i = months - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(date);
    buckets[key] = { month: key, orders: 0, revenue: 0 };
  }
  return buckets;
}

// ── Stage Counting ─────────────────────────────────────────

export const STAGE_COLORS: Record<string, string> = {
  New: '#6366f1',
  Survey: '#8b5cf6',
  Engineering: '#06b6d4',
  Quotation: '#0ea5e9',
  Order: '#10b981',
  Procurement: '#84cc16',
  Dispatch: '#eab308',
  Installation: '#f59e0b',
  QC: '#f97316',
  Commissioning: '#ef4444',
  NetMetering: '#ec4899',
  Subsidy: '#a855f7',
  Handover: '#3b82f6',
  AMC: '#14b8a6',
  Service: '#22c55e',
  Monitoring: '#64748b',
  Archived: '#6b7280',
};

// Phase 5: re-exported (not redeclared) — was a separately-maintained literal
// copy of the same 17-stage list; now sourced from projectLifecycle.ts.
export const PROJECT_STAGE_DASHBOARD_ORDER = PROJECT_STAGE_ORDER;

const DEFAULT_COLOR = '#6366f1';

/**
 * Internal: count projects by stage, excluding deleted.
 * Returns Map<stage, count>.
 */
export function countProjectsByStage(projects: Array<{ currentStage?: unknown; isDeleted?: boolean }>): Map<string, number> {
  const counts = new Map<string, number>(PROJECT_STAGE_DASHBOARD_ORDER.map((stage) => [stage, 0]));
  projects.forEach((project) => {
    if (project.isDeleted === true) return;
    const stage = String(project.currentStage || 'New').trim() || 'New';
    counts.set(stage, (counts.get(stage) || 0) + 1);
  });
  return counts;
}

export function getStageColor(stage: string): string {
  return STAGE_COLORS[stage] || DEFAULT_COLOR;
}
