/**
 * ProjectJourneyTimeline.helpers.ts
 *
 * Pure helpers for the 12-stage project journey timeline.
 * No Firestore dependencies — derives all data from existing ProjectRecord fields.
 */

import {
  Activity,
  BarChart3,
  ClipboardCheck,
  FileText,
  Handshake,
  HardHat,
  Landmark,
  Search,
  ShoppingCart,
  Truck,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type {
  ProjectJourneyStage,
  ProjectJourneyStageId,
  ProjectJourneyStageStatus,
  ProjectJourneyFooterData,
  AmcFooterStatus,
  MonitoringFooterStatus,
} from './ProjectJourneyTimeline.types';
import { JOURNEY_STAGE_TO_PROJECT_MAP } from './ProjectJourneyTimeline.types';
import { projectStageIndex } from '../../lib/projectLifecycle';

// ── Stage metadata ────────────────────────────────────────────

interface StageDefinition {
  id: ProjectJourneyStageId;
  title: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
}

export const JOURNEY_STAGE_DEFINITIONS: StageDefinition[] = [
  { id: 'survey',        title: 'Survey',         shortLabel: 'Survey',   description: 'Site survey & approval',     icon: Search },
  { id: 'engineering',   title: 'Engineering',     shortLabel: 'Design',   description: 'System design & review',     icon: Wrench },
  { id: 'quotation',     title: 'Quotation',       shortLabel: 'Quote',    description: 'Commercial proposal',        icon: FileText },
  { id: 'order',         title: 'Order',           shortLabel: 'Order',    description: 'Accepted sales order',       icon: ShoppingCart },
  { id: 'procurement',   title: 'Procurement',     shortLabel: 'Procure',  description: 'Material procurement',       icon: Activity },
  { id: 'dispatch',      title: 'Dispatch',        shortLabel: 'Dispatch', description: 'Material movement',           icon: Truck },
  { id: 'installation',  title: 'Installation',    shortLabel: 'Install',  description: 'On-site execution',          icon: HardHat },
  { id: 'qc',            title: 'Quality Check',   shortLabel: 'QC',       description: 'Installation quality gate',  icon: ClipboardCheck },
  { id: 'commissioning', title: 'Commissioning',   shortLabel: 'Comm',     description: 'Plant commissioning',        icon: Zap },
  { id: 'net-metering',  title: 'Net Metering',    shortLabel: 'Net Met',  description: 'DISCOM application',         icon: BarChart3 },
  { id: 'subsidy',       title: 'Subsidy',         shortLabel: 'Subsidy',  description: 'Government subsidy',          icon: Landmark },
  { id: 'handover',      title: 'Handover',        shortLabel: 'Handover', description: 'Customer handover package',   icon: Handshake },
];

// ── Status helpers ────────────────────────────────────────────

/** Status color classes for use with Tailwind / CSS variables. */
export const STATUS_COLORS: Record<ProjectJourneyStageStatus, { bg: string; text: string; ring: string; line: string }> = {
  completed:  { bg: 'bg-emerald-500',           text: 'text-emerald-600 dark:text-emerald-400',           ring: 'ring-emerald-500/30',          line: 'bg-emerald-400' },
  current:    { bg: 'bg-[var(--color-primary)]', text: 'text-[var(--color-primary)]',                     ring: 'ring-[var(--color-primary)]',  line: 'bg-[var(--color-primary)]' },
  upcoming:   { bg: 'bg-[var(--color-bg-sunken)]', text: 'text-[var(--color-text-muted)]',                ring: 'ring-[var(--color-border)]',   line: 'bg-[var(--color-border)]' },
  blocked:    { bg: 'bg-[var(--color-danger)]',  text: 'text-[var(--color-danger)]',                      ring: 'ring-[var(--color-danger)]',   line: 'bg-[var(--color-danger)]' },
  attention:  { bg: 'bg-amber-500',              text: 'text-amber-600 dark:text-amber-400',              ring: 'ring-amber-500/30',            line: 'bg-amber-400' },
};

/** Human-readable label for each status. */
export function statusLabel(status: ProjectJourneyStageStatus): string {
  switch (status) {
    case 'completed': return 'Completed';
    case 'current':   return 'In Progress';
    case 'upcoming':  return 'Pending';
    case 'blocked':   return 'Blocked';
    case 'attention': return 'Needs Attention';
  }
}

// ── Stage resolution ──────────────────────────────────────────

/**
 * Build the 12-stage journey from a project record.
 *
 * Mirrors the logic from `resolveProjectWorkspaceStages` but
 * operates only on the 12 journey stages (excludes AMC / Service / Monitoring).
 */
export function resolveJourneyStages(
  currentStage: string,
  stageHistory: Array<{ stage: string; changedAt: string }>,
  projectId?: string,
): ProjectJourneyStage[] {
  // Phase 5: completion is compared via the canonical stage order
  // (projectStageIndex), not position within this component's own 12-item
  // JOURNEY_STAGE_DEFINITIONS subset — `index` below remains the subset's
  // own display position (used for the returned `index` field), a separate
  // concern from lifecycle ordering.
  const currentCanonicalIndex = projectStageIndex(currentStage);
  const completedStageNames = new Set(stageHistory.map((entry) => entry.stage));
  const archived = currentStage === 'Archived';

  return JOURNEY_STAGE_DEFINITIONS.map((def, index) => {
    const projectStageForDef = JOURNEY_STAGE_TO_PROJECT_MAP[def.id];

    // Compute status — same logic as resolveProjectWorkspaceStages
    let status: ProjectJourneyStageStatus = 'upcoming';

    if (archived || completedStageNames.has(projectStageForDef) || projectStageIndex(projectStageForDef) < currentCanonicalIndex) {
      status = 'completed';
    }
    if (!archived && projectStageForDef === currentStage) {
      status = 'current';
    }
    if (
      !archived &&
      (currentStage === 'NetMetering' || currentStage === 'Subsidy') &&
      (projectStageForDef === 'NetMetering' || projectStageForDef === 'Subsidy') &&
      projectStageForDef !== currentStage &&
      !completedStageNames.has(projectStageForDef)
    ) {
      status = 'attention';
    }

    // Find date from stage history
    const historyEntry = stageHistory.find((entry) => entry.stage === JOURNEY_STAGE_TO_PROJECT_MAP[def.id]);

    // Build href with project context (same pattern as useProjectStage)
    const href = stageHref(def.id, projectId);

    return {
      id: def.id,
      projectStage: JOURNEY_STAGE_TO_PROJECT_MAP[def.id],
      title: def.title,
      shortLabel: def.shortLabel,
      description: def.description,
      status,
      icon: def.icon,
      href: (href && status !== 'upcoming') ? href : undefined,
      date: historyEntry?.changedAt,
      index,
    };
  });
}

/** Routes for each journey stage. */
const STAGE_ROUTES: Record<ProjectJourneyStageId, string> = {
  survey: '/surveys',
  engineering: '/engineering-designs',
  quotation: '/quotations',
  order: '/orders',
  procurement: '/purchase-orders',
  dispatch: '/dispatch',
  installation: '/installations',
  qc: '/qc',
  commissioning: '/commissioning',
  'net-metering': '/net-metering',
  subsidy: '/subsidy',
  handover: '/project-handover',
};

function stageHref(id: ProjectJourneyStageId, projectId?: string): string | undefined {
  const base = STAGE_ROUTES[id];
  if (!base) return undefined;
  if (projectId) {
    return `${base}?projectId=${encodeURIComponent(projectId)}`;
  }
  return base;
}

// ── Footer resolution ─────────────────────────────────────────

/**
 * Derive footer data from linked records.
 * Uses ONLY existing fields — no schema changes.
 * Anything absent is displayed as "TBD".
 */
export function resolveJourneyFooterData(
  amcContracts: Array<{ status?: string }>,
  generationReadings: Array<unknown>,
): ProjectJourneyFooterData {
  // ── AMC status ──
  let amcStatus: AmcFooterStatus = 'tbd';
  if (amcContracts.length > 0) {
    const hasActive = amcContracts.some((c) => c.status === 'Active');
    amcStatus = hasActive ? 'active' : 'inactive';
  }

  // ── Monitoring status ──
  let monitoringStatus: MonitoringFooterStatus = 'tbd';
  if (generationReadings.length > 0) {
    monitoringStatus = 'enabled';
  }

  // ── Warranty (not in current schema — always TBD) ──
  const warrantyStatus = { label: 'TBD', isTbd: true } as const;

  return {
    amcStatus,
    amcCount: amcContracts.length,
    monitoringStatus,
    monitoringCount: generationReadings.length,
    warrantyStatus,
  };
}

// ── Date formatting ───────────────────────────────────────────

/**
 * Format a date string for display in the timeline.
 * Returns a short relative or absolute date label.
 */
export function formatJourneyDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 1) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export function formatJourneyDateFull(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

// ── Progress calculation ──────────────────────────────────────

export function calculateJourneyProgress(stages: ProjectJourneyStage[]): {
  completedCount: number;
  totalCount: number;
  percent: number;
} {
  const totalCount = stages.length;
  const completedCount = stages.filter((s) => s.status === 'completed').length;
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  return { completedCount, totalCount, percent };
}

/**
 * Calculate how many days a project has been in its current stage.
 * Returns the number of days or 0 if data is unavailable.
 */
export function calculateDaysInStage(
  currentStage: string,
  stageHistory: Array<{ stage: string; changedAt: string }>,
): number {
  // Find when the current stage was entered
  const currentEntry = [...stageHistory]
    .reverse()
    .find((entry) => entry.stage === currentStage);
  if (!currentEntry?.changedAt) return 0;
  try {
    const entered = new Date(currentEntry.changedAt);
    const now = new Date();
    const diffMs = now.getTime() - entered.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  } catch {
    return 0;
  }
}

/**
 * Resolve all KPI data needed for the sticky bar and timeline header.
 * Single function to avoid duplicating stage computations.
 */
export function resolveKpiData(
  project: {
    currentStage: string;
    stageHistory: Array<{ stage: string; changedAt: string }>;
  },
  projectId?: string,
): {
  stages: ProjectJourneyStage[];
  percent: number;
  completedCount: number;
  currentStageName: string;
  attentionCount: number;
  remainingCount: number;
  daysInStage: number;
  hasAttention: boolean;
} {
  const stages = resolveJourneyStages(project.currentStage, project.stageHistory, projectId);
  const { percent, completedCount } = calculateJourneyProgress(stages);
  const currentStageObj = stages.find((s) => s.status === 'current');
  const attentionCount = stages.filter((s) => s.status === 'attention' || s.status === 'blocked').length;
  const remainingCount = stages.filter((s) => s.status === 'upcoming').length;
  const daysInStage = calculateDaysInStage(project.currentStage, project.stageHistory);

  return {
    stages,
    percent,
    completedCount,
    currentStageName: currentStageObj?.title ?? project.currentStage,
    attentionCount,
    remainingCount,
    daysInStage,
    hasAttention: attentionCount > 0,
  };
}
