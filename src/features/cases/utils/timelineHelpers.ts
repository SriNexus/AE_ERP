/**
 * timelineHelpers — Lightweight utilities for Case Timeline enhancement
 *
 * Phase 3E — Case Timeline UI Enhancement
 * Provides duration formatting, metrics computation, and stage resolution
 * without modifying the case engine, validation engine, or Firestore schema.
 */

// ── Duration formatting ────────────────────────────────────

/**
 * Calculate the duration between two ISO timestamps or Date objects.
 * Returns a human-readable string like "3 days", "2 hours", "1 week", etc.
 */
export function formatDuration(
  fromTimestamp: string | Date | null | undefined,
  toTimestamp: string | Date | null | undefined,
): string {
  if (!fromTimestamp || !toTimestamp) return '—';

  const from = typeof fromTimestamp === 'string' ? new Date(fromTimestamp) : fromTimestamp;
  const to = typeof toTimestamp === 'string' ? new Date(toTimestamp) : toTimestamp;

  if (isNaN(from.getTime()) || isNaN(to.getTime())) return '—';

  const diffMs = to.getTime() - from.getTime();
  if (diffMs < 0) return '—';

  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMinutes < 1) return '< 1 min';
  if (diffMinutes < 60) return `${diffMinutes}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  if (diffWeeks < 5) return `${diffWeeks}wk`;
  return `${diffMonths}mo`;
}

/**
 * Format a total lifecycle duration as a human-readable string.
 */
export function formatTotalDuration(startDate: string | Date | null | undefined): string {
  return formatDuration(startDate, new Date());
}

// ── Status helpers ─────────────────────────────────────────

/** All 6 supported timeline statuses */
export type TimelineStageStatus = 'completed' | 'current' | 'pending' | 'failed' | 'skipped' | 'cancelled';

export const TIMELINE_STATUSES: TimelineStageStatus[] = [
  'completed',
  'current',
  'pending',
  'failed',
  'skipped',
  'cancelled',
];

/** Visual configuration for each status */
export interface StatusVisualConfig {
  label: string;
  dotColor: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  badgeColor: string;
  icon: string; // icon name for resolution in the component
  animClass: string;
}

export const STATUS_VISUALS: Record<TimelineStageStatus, StatusVisualConfig> = {
  completed: {
    label: 'Completed',
    dotColor: 'bg-emerald-500 border-emerald-500',
    bgColor: 'bg-emerald-50/80 dark:bg-emerald-900/15 border-emerald-200 dark:border-emerald-800/40',
    borderColor: 'border-emerald-300 dark:border-emerald-700/50',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    icon: 'CheckCircle2',
    animClass: '',
  },
  current: {
    label: 'In Progress',
    dotColor: 'bg-blue-500 border-blue-500',
    bgColor: 'bg-blue-50/80 dark:bg-blue-900/15 border-blue-200 dark:border-blue-800/40',
    borderColor: 'border-blue-300 dark:border-blue-700/50',
    textColor: 'text-blue-700 dark:text-blue-300',
    badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    icon: 'Loader2',
    animClass: 'animate-pulse',
  },
  pending: {
    label: 'Pending',
    dotColor: 'bg-gray-300 dark:bg-gray-600 border-gray-300 dark:border-gray-600',
    bgColor: 'bg-[var(--color-bg-sunken)] border-[var(--color-border-subtle)]',
    borderColor: 'border-[var(--color-border)]',
    textColor: 'text-[var(--color-text-muted)]',
    badgeColor: 'bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300',
    icon: 'Clock',
    animClass: '',
  },
  failed: {
    label: 'Failed',
    dotColor: 'bg-red-500 border-red-500',
    bgColor: 'bg-red-50/80 dark:bg-red-900/15 border-red-200 dark:border-red-800/40',
    borderColor: 'border-red-300 dark:border-red-700/50',
    textColor: 'text-red-700 dark:text-red-300',
    badgeColor: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    icon: 'XCircle',
    animClass: '',
  },
  skipped: {
    label: 'Skipped',
    dotColor: 'bg-amber-400 border-amber-400',
    bgColor: 'bg-amber-50/80 dark:bg-amber-900/15 border-amber-200 dark:border-amber-800/40',
    borderColor: 'border-amber-300 dark:border-amber-700/50',
    textColor: 'text-amber-700 dark:text-amber-300',
    badgeColor: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    icon: 'SkipForward',
    animClass: '',
  },
  cancelled: {
    label: 'Cancelled',
    dotColor: 'bg-rose-400 border-rose-400',
    bgColor: 'bg-rose-50/80 dark:bg-rose-900/15 border-rose-200 dark:border-rose-800/40',
    borderColor: 'border-rose-300 dark:border-rose-700/50',
    textColor: 'text-rose-700 dark:text-rose-300',
    badgeColor: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
    icon: 'Ban',
    animClass: '',
  },
};

// ── Metrics computation ────────────────────────────────────

export interface TimelineMetrics {
  progressPercent: number;
  completedCount: number;
  currentCount: number;
  pendingCount: number;
  failedCount: number;
  skippedCount: number;
  cancelledCount: number;
  totalStages: number;
  activeStageName: string | null;
  activeStageIndex: number;
  hasFailedStages: boolean;
  hasActiveStage: boolean;
}

/**
 * Compute aggregate timeline metrics from an array of stage statuses.
 */
export function computeTimelineMetrics(
  statuses: TimelineStageStatus[],
  stageNames: string[],
): TimelineMetrics {
  const completedCount = statuses.filter((s) => s === 'completed').length;
  const currentCount = statuses.filter((s) => s === 'current').length;
  const pendingCount = statuses.filter((s) => s === 'pending').length;
  const failedCount = statuses.filter((s) => s === 'failed').length;
  const skippedCount = statuses.filter((s) => s === 'skipped').length;
  const cancelledCount = statuses.filter((s) => s === 'cancelled').length;
  const totalStages = statuses.length;

  // Active stage is the first 'current' stage found
  const activeStageIndex = statuses.indexOf('current');
  const activeStageName = activeStageIndex >= 0 ? stageNames[activeStageIndex] : null;

  // Progress: count completed + current as a proxy for progress
  // (skipped and cancelled also count as progress)
  const progressedCount = completedCount + (currentCount > 0 ? 1 : 0) + skippedCount + cancelledCount;
  const progressPercent = totalStages > 0 ? Math.round((progressedCount / totalStages) * 100) : 0;

  return {
    progressPercent,
    completedCount,
    currentCount,
    pendingCount,
    failedCount,
    skippedCount,
    cancelledCount,
    totalStages,
    activeStageName,
    activeStageIndex,
    hasFailedStages: failedCount > 0,
    hasActiveStage: currentCount > 0,
  };
}

// ── Workspace route existence check ────────────────────────

/**
 * Known workspace route prefixes mapped from entity types.
 * These match the routes defined in src/app/router/routes.tsx.
 */
export const WORKSPACE_ROUTES: Record<string, string> = {
  leads: '/leads/',
  customers: '/customers/',
  projects: '/projects/',
  quotations: '/quotations/',
  orders: '/orders/',
  proforma_invoices: '/invoices/',
  payments: '/payments/',
  dispatch: '/dispatch/',
  installations: '/installations/',
  qc_checks: '/qc/',
  commissioning_records: '/commissioning/',
  net_metering_applications: '/net-metering/',
  subsidy_applications: '/subsidy/',
  project_handovers: '/handovers/',
  amc_contracts: '/amc-contracts/',
  service_tickets: '/service-tickets/',
  generation_readings: '/monitoring/',
};

/**
 * Check if a workspace route exists for a given entity type.
 * A workspace exists if we have a defined route prefix for it.
 *
 * In the future, this could check against a registry of registered
 * workspaces. For now, we use the known route map.
 */
export function workspaceExists(entityType: string): boolean {
  return entityType in WORKSPACE_ROUTES;
}

/**
 * Build a workspace route for an entity, or return null if the
 * entity type doesn't have a registered workspace.
 */
export function getWorkspaceRoute(entityType: string, entityId: string): string | null {
  const prefix = WORKSPACE_ROUTES[entityType];
  if (!prefix || !entityId) return null;
  return `${prefix}${encodeURIComponent(entityId)}`;
}

/**
 * Sanitize a Firestore timestamp to an ISO string, handling
 * Firestore Timestamp, Date, string, and number formats.
 */
export function sanitizeTimestamp(value: unknown): string | null {
  if (!value) return null;

  // Firestore Timestamp (has toDate)
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.toDate === 'function') {
      try {
        const d = (obj.toDate as () => Date)();
        return d.toISOString();
      } catch {
        return null;
      }
    }
    // { seconds, nanoseconds } format
    if (typeof obj.seconds === 'number') {
      return new Date(obj.seconds * 1000).toISOString();
    }
  }

  // Date object
  if (value instanceof Date) {
    return value.toISOString();
  }

  // String or number
  const str = String(value);
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString();

  return null;
}

/**
 * Format a timestamp for display in the timeline.
 * Returns a short relative or absolute time string.
 */
export function formatTimelineDate(isoString: string | null): string {
  if (!isoString) return '';

  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format a timestamp to a full date-time string for tooltips.
 */
export function formatTimelineDateFull(isoString: string | null): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
