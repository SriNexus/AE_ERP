/**
 * subsidyWorkflow — Subsidy Application Stage Engine
 *
 * Handles government subsidy application tracking for solar projects.
 * - Tracks application through submission, review, approval, and disbursement
 * - Includes immutable disbursement ledger (append-only financial records)
 * - Runs in parallel with Net Metering (both are independent)
 * - Phase 16: filing an application here is one of the two real triggers
 *   (the other is netMeteringWorkflow.ts's transitionNetMeteringStatus()
 *   reaching 'MeterInstalled') that advances the project to the 'Subsidy'
 *   stage. Neither file used to do this at all, which meant
 *   projectHandoverWorkflow.ts's createHandover() — gated on
 *   currentStage>=Subsidy — could never be satisfied by any real (non-demo)
 *   code path; see netMeteringWorkflow.ts's header comment for the full
 *   trace and the reasoning for triggering on "first real progress" rather
 *   than full resolution of both tracks.
 *
 * Status flow:
 *   Draft → Submitted → UnderReview → Approved → Disbursed → Rejected
 *
 * Reuses existing:
 *   - Firestore abstraction (getOne, updateDocById, createDocWithId, genId, getAll)
 *   - Audit logging (logActivity)
 *   - Notifications (notifyRoleUsers)
 */

import { createDocWithId, genId, getAll, getOne, updateDocById, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { propagateCaseIdFromChain } from './casePropagation';
import { buildProjectStageAdvancePatch, isProjectStageAtOrPast } from './projectLifecycle';
import type { ProjectRecord } from '../features/projects/types';

// ═══════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════

export type SubsidyStatus =
  | 'Draft'
  | 'Submitted'
  | 'UnderReview'
  | 'Approved'
  | 'Disbursed'
  | 'Rejected';

export interface SubsidyStatusHistoryEntry {
  status: SubsidyStatus;
  changedAt: string;
  changedBy?: string;
  note?: string;
}

/** Immutable disbursement ledger entry — append-only */
export interface DisbursementEntry {
  id: string;
  amount: number;
  disbursedDate: string;
  referenceNumber?: string;
  disbursedBy?: string;
  notes?: string;
  createdAt: string;
}

export interface SubsidyApplication {
  id: string;
  companyId: string;
  projectId: string;
  projectName?: string;
  schemeName: string;
  schemeType?: string; // e.g. 'PM Surya Ghar', 'State Scheme'
  applicationNumber: string;
  status: SubsidyStatus;
  applicationDate?: string;
  submittedDate?: string;
  approvedDate?: string;
  rejectedDate?: string;
  rejectionReason?: string;
  disbursedDate?: string;
  totalSanctionedAmount?: number;   // Total subsidy amount approved
  totalDisbursedAmount?: number;    // Running total of disbursements
  documentsSubmitted?: string[];    // List of document URLs/names
  notes?: string;
  statusHistory: SubsidyStatusHistoryEntry[];
  disbursements: DisbursementEntry[]; // Immutable disbursement ledger
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
}

export interface SubsidyCreateInput {
  projectId: string;
  projectName?: string;
  schemeName: string;
  schemeType?: string;
  applicationNumber: string;
  applicationDate?: string;
  submittedDate?: string;
  totalSanctionedAmount?: number;
  documentsSubmitted?: string[];
  notes?: string;
}

export interface DisburseInput {
  amount: number;
  referenceNumber?: string;
  notes?: string;
}

// ═══════════════════════════════════════════════════════════
//  VALID TRANSITIONS
// ═══════════════════════════════════════════════════════════

const VALID_TRANSITIONS: Record<SubsidyStatus, SubsidyStatus[]> = {
  Draft: ['Submitted', 'Rejected'],
  Submitted: ['UnderReview', 'Rejected'],
  UnderReview: ['Approved', 'Rejected'],
  Approved: ['Disbursed', 'Rejected'],
  Disbursed: [],
  Rejected: [],
};

export function isValidTransition(current: SubsidyStatus, next: SubsidyStatus): boolean {
  return VALID_TRANSITIONS[current]?.includes(next) ?? false;
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

function nowISO(): string {
  return new Date().toISOString();
}

function resolveCompanyId(): string {
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  return resolveWriteCompanyId();
}

// ═══════════════════════════════════════════════════════════
//  CREATE APPLICATION
// ═══════════════════════════════════════════════════════════

/**
 * Create a new subsidy application for a project.
 * The project must be in an appropriate post-commissioning stage.
 */
export async function createSubsidyApplication(
  input: SubsidyCreateInput,
): Promise<SubsidyApplication> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();
  const userId = state.user?.id || 'system';
  const now = nowISO();
  const id = genId.generic('SUB');

  // Validate required fields
  if (!input.projectId) throw new Error('Project ID is required');
  if (!input.schemeName?.trim()) throw new Error('Scheme name is required');
  if (!input.applicationNumber?.trim()) throw new Error('Application number is required');

  // Verify project exists and is in an appropriate stage. Phase 16: this
  // previously checked a hardcoded, independently-drifted local array
  // (['NetMetering','Subsidy','Handover','Archived']) — the exact anti-
  // pattern Phase 5 eliminated everywhere else — which was also functionally
  // wrong, since it excluded 'AMC'/'Service'/'Monitoring' and would have
  // incorrectly blocked a project already that far along from ever filing a
  // (late) subsidy application.
  const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, input.projectId);
  if (!project) throw new Error('Project not found');
  if (!isProjectStageAtOrPast(project.currentStage, 'NetMetering')) {
    throw new Error(
      `Subsidy applications can only be created once a project has reached the Net Metering stage. Current stage: ${project.currentStage}`
    );
  }

  const status: SubsidyStatus = input.submittedDate ? 'Submitted' : 'Draft';
  const submittedDate = input.submittedDate || (status === 'Submitted' ? now : undefined);

  const record: SubsidyApplication = {
    id,
    companyId,
    projectId: input.projectId,
    projectName: input.projectName || project.projectId,
    schemeName: input.schemeName.trim(),
    schemeType: input.schemeType?.trim(),
    applicationNumber: input.applicationNumber.trim(),
    status,
    applicationDate: input.applicationDate || now,
    submittedDate,
    totalSanctionedAmount: input.totalSanctionedAmount,
    documentsSubmitted: input.documentsSubmitted || [],
    notes: input.notes?.trim(),
    statusHistory: [
      {
        status,
        changedAt: now,
        changedBy: userId,
        note: status === 'Draft' ? 'Application draft created' : 'Application submitted',
      },
    ],
    disbursements: [],
    totalDisbursedAmount: 0,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.SUBSIDY_APPLICATIONS, id, record);

  // Phase 16: filing a Subsidy application is one of the two real triggers
  // (the other is Net Metering reaching MeterInstalled) that advances the
  // project to the 'Subsidy' stage — see this file's header comment.
  // Forward-only and idempotent: a no-op if the project already advanced
  // via the other track.
  const stagePatch = buildProjectStageAdvancePatch(project, 'Subsidy', userId, 'Subsidy application filed — advancing to Subsidy', now);
  if (Object.keys(stagePatch).length > 0) {
    await updateDocById(COLLECTIONS.PROJECTS, input.projectId, stagePatch);
  }

  // Audit logging
  await logActivity('Subsidy', 'Application Created', id, {
    entityName: `Subsidy ${id}`,
    actionLabel: `Subsidy application created for project ${input.projectName || input.projectId}`,
    projectId: input.projectId,
    schemeName: input.schemeName,
    applicationNumber: input.applicationNumber,
    status,
  });

  // Phase 3B: Propagate caseId from net metering/project chain to subsidy application
  void propagateCaseIdFromChain('subsidy_applications', id);

  // Notify compliance/admins
  await notifyRoleUsers(
    ['Admin', 'Director', 'Operations'],
    NotificationType.TASK_ASSIGNED,
    `Subsidy application ${status === 'Draft' ? 'drafted' : 'submitted'}`,
    `Subsidy application ${input.applicationNumber} for ${input.projectName || input.projectId} under ${input.schemeName}.`,
    'subsidy_application',
    id,
    companyId,
  ).catch(() => {});

  return record;
}

// ═══════════════════════════════════════════════════════════
//  TRANSITION STATUS
// ═══════════════════════════════════════════════════════════

/**
 * Transition a subsidy application to a new status.
 * Validates the transition is allowed and updates the record.
 */
export async function transitionSubsidyStatus(
  applicationId: string,
  newStatus: SubsidyStatus,
  options?: {
    note?: string;
    approvedDate?: string;
    rejectionReason?: string;
    totalSanctionedAmount?: number;
  },
): Promise<SubsidyApplication> {
  const app = await getOne<SubsidyApplication>(COLLECTIONS.SUBSIDY_APPLICATIONS, applicationId);
  if (!app) throw new Error('Subsidy application not found');

  if (!isValidTransition(app.status, newStatus)) {
    throw new Error(`Cannot transition from ${app.status} to ${newStatus}`);
  }

  const state = useAppStore.getState();
  const userId = state.user?.id || 'system';
  const now = nowISO();

  // Build status-specific field updates
  const fieldUpdates: Record<string, unknown> = {};
  if (newStatus === 'Approved') {
    fieldUpdates.approvedDate = options?.approvedDate || now;
    if (options?.totalSanctionedAmount !== undefined) {
      fieldUpdates.totalSanctionedAmount = options.totalSanctionedAmount;
    }
  }
  if (newStatus === 'Rejected') {
    fieldUpdates.rejectedDate = now;
    fieldUpdates.rejectionReason = options?.rejectionReason || '';
  }
  if (newStatus === 'Disbursed') {
    fieldUpdates.disbursedDate = now;
  }

  const historyEntry: SubsidyStatusHistoryEntry = {
    status: newStatus,
    changedAt: now,
    changedBy: userId,
    note: options?.note || `Status changed to ${newStatus}`,
  };

  const updateData = {
    status: newStatus,
    notes: options?.note !== undefined ? options.note : app.notes,
    statusHistory: [...(app.statusHistory || []), historyEntry],
    updatedAt: now,
    ...fieldUpdates,
  };

  await updateDocById(COLLECTIONS.SUBSIDY_APPLICATIONS, applicationId, updateData);

  // Audit logging
  const actionLabel = `Subsidy application ${app.applicationNumber} status changed from ${app.status} to ${newStatus}`;
  await logActivity('Subsidy', `Status: ${newStatus}`, applicationId, {
    entityName: `Subsidy ${applicationId}`,
    actionLabel,
    projectId: app.projectId,
    previousStatus: app.status,
    newStatus,
    applicationNumber: app.applicationNumber,
    note: options?.note,
  });

  // Notify
  await notifyRoleUsers(
    ['Admin', 'Director', 'Operations'],
    NotificationType.TASK_STATUS_CHANGED,
    `Subsidy: ${newStatus}`,
    `Application ${app.applicationNumber} for ${app.projectName || app.projectId} is now ${newStatus}.`,
    'subsidy_application',
    applicationId,
    resolveCompanyId(),
  ).catch(() => {});

  return {
    ...app,
    ...updateData,
  } as SubsidyApplication;
}

// ═══════════════════════════════════════════════════════════
//  DISBURSEMENT — Immutable Ledger
// ═══════════════════════════════════════════════════════════

/**
 * Record a disbursement on a subsidy application.
 * Disbursements are append-only immutable ledger entries.
 */
export async function recordDisbursement(
  applicationId: string,
  input: DisburseInput,
): Promise<SubsidyApplication> {
  const app = await getOne<SubsidyApplication>(COLLECTIONS.SUBSIDY_APPLICATIONS, applicationId);
  if (!app) throw new Error('Subsidy application not found');

  if (app.status !== 'Approved' && app.status !== 'Disbursed') {
    throw new Error(`Disbursements can only be recorded for approved applications. Current status: ${app.status}`);
  }

  if (input.amount <= 0) throw new Error('Disbursement amount must be positive');

  const state = useAppStore.getState();
  const userId = state.user?.id || 'system';
  const now = nowISO();
  const disbursementId = genId.generic('DISB');

  const entry: DisbursementEntry = {
    id: disbursementId,
    amount: input.amount,
    disbursedDate: now,
    referenceNumber: input.referenceNumber?.trim(),
    disbursedBy: userId,
    notes: input.notes?.trim(),
    createdAt: now,
  };

  const previousDisbursements = app.disbursements || [];
  const previousTotal = app.totalDisbursedAmount || 0;
  const newTotal = previousTotal + input.amount;

  // Auto-transition to Disbursed status if not already
  const needsStatusUpdate = app.status !== 'Disbursed';
  const newStatus = needsStatusUpdate ? 'Disbursed' as SubsidyStatus : app.status;

  const updateData: Record<string, unknown> = {
    disbursements: [...previousDisbursements, entry],
    totalDisbursedAmount: newTotal,
    updatedAt: now,
  };

  if (needsStatusUpdate) {
    updateData.status = 'Disbursed';
    updateData.disbursedDate = now;
    updateData.statusHistory = [
      ...(app.statusHistory || []),
      {
        status: 'Disbursed' as SubsidyStatus,
        changedAt: now,
        changedBy: userId,
        note: `First disbursement of ${input.amount} recorded`,
      },
    ];
  }

  await updateDocById(COLLECTIONS.SUBSIDY_APPLICATIONS, applicationId, updateData);

  // Audit the disbursement
  await logActivity('Subsidy', 'Disbursement Recorded', applicationId, {
    entityName: `Subsidy ${applicationId}`,
    actionLabel: `Disbursement of ${input.amount} recorded for ${app.applicationNumber}`,
    projectId: app.projectId,
    amount: input.amount,
    referenceNumber: input.referenceNumber,
    runningTotal: newTotal,
  });

  return {
    ...app,
    ...updateData,
  } as SubsidyApplication;
}

// ═══════════════════════════════════════════════════════════
//  QUERIES
// ═══════════════════════════════════════════════════════════

/**
 * Get all subsidy applications for a project.
 */
export async function getProjectSubsidyApplications(
  projectId: string,
): Promise<SubsidyApplication[]> {
  const all = await getAll<SubsidyApplication>(COLLECTIONS.SUBSIDY_APPLICATIONS);
  return all
    .filter((app) => app.projectId === projectId && !app.isDeleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Get the latest subsidy application for a project.
 */
export async function getLatestSubsidyApplication(
  projectId: string,
): Promise<SubsidyApplication | null> {
  const apps = await getProjectSubsidyApplications(projectId);
  return apps.length > 0 ? apps[0] : null;
}

/**
 * Determine if a project's subsidy is resolved or pending.
 */
export async function getSubsidyStatus(projectId: string): Promise<{
  hasApplication: boolean;
  latestStatus: SubsidyStatus | null;
  isResolved: boolean;
}> {
  const latest = await getLatestSubsidyApplication(projectId);
  if (!latest) return { hasApplication: false, latestStatus: null, isResolved: false };
  return {
    hasApplication: true,
    latestStatus: latest.status,
    isResolved: latest.status === 'Disbursed',
  };
}

export default {
  createSubsidyApplication,
  transitionSubsidyStatus,
  recordDisbursement,
  getProjectSubsidyApplications,
  getLatestSubsidyApplication,
  getSubsidyStatus,
  isValidTransition,
  VALID_TRANSITIONS,
};
