/**
 * ProjectJourneyTimeline.types.ts
 *
 * Types for the redesigned 12-stage project journey timeline.
 * This is a UI-only layer — no Firestore fields or Project types are modified.
 */

import type { LucideIcon } from 'lucide-react';
import type { ProjectStage } from '../../types';

// ── Exact 12 stages of the project journey ────────────────────
// AMC is NOT part of the journey. It appears only in the footer.

export type ProjectJourneyStageId =
  | 'survey'
  | 'engineering'
  | 'quotation'
  | 'order'
  | 'procurement'
  | 'dispatch'
  | 'installation'
  | 'qc'
  | 'commissioning'
  | 'net-metering'
  | 'subsidy'
  | 'handover';

/** Maps each journey stage id to the canonical ProjectStage string. */
export const JOURNEY_STAGE_TO_PROJECT_MAP: Record<ProjectJourneyStageId, ProjectStage> = {
  survey: 'Survey',
  engineering: 'Engineering',
  quotation: 'Quotation',
  order: 'Order',
  procurement: 'Procurement',
  dispatch: 'Dispatch',
  installation: 'Installation',
  qc: 'QC',
  commissioning: 'Commissioning',
  'net-metering': 'NetMetering',
  subsidy: 'Subsidy',
  handover: 'Handover',
};

/** All 12 journey stage ids in order. */
export const JOURNEY_STAGE_IDS: ProjectJourneyStageId[] = [
  'survey',
  'engineering',
  'quotation',
  'order',
  'procurement',
  'dispatch',
  'installation',
  'qc',
  'commissioning',
  'net-metering',
  'subsidy',
  'handover',
];

export type ProjectJourneyStageStatus = 'completed' | 'current' | 'upcoming' | 'blocked' | 'attention';

export interface ProjectJourneyStage {
  id: ProjectJourneyStageId;
  projectStage: ProjectStage;
  title: string;
  shortLabel: string;
  description: string;
  status: ProjectJourneyStageStatus;
  icon: LucideIcon;
  href?: string;
  /** Date this stage was entered / completed (from stageHistory). */
  date?: string;
  /** Index in the journey (0-based). */
  index: number;
}

// ── Footer data ───────────────────────────────────────────────

export type AmcFooterStatus = 'active' | 'inactive' | 'tbd';
export type MonitoringFooterStatus = 'enabled' | 'disabled' | 'tbd';
export type WarrantyFooterStatus = { label: string; isTbd: boolean };

export interface ProjectJourneyFooterData {
  amcStatus: AmcFooterStatus;
  amcCount: number;
  monitoringStatus: MonitoringFooterStatus;
  monitoringCount: number;
  warrantyStatus: WarrantyFooterStatus;
}

// ── Component props ───────────────────────────────────────────

export interface ProjectJourneyTimelineProps {
  project: {
    id: string;
    projectId: string;
    currentStage: ProjectStage;
    stageHistory: Array<{
      stage: ProjectStage;
      changedAt: string;
      changedBy?: string;
      note?: string;
    }>;
    createdAt?: string;
  };
  linked: {
    amcContracts: Array<{ status?: string }>;
    generationReadings: Array<unknown>;
  };
}
