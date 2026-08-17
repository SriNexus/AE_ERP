/**
 * netMeteringWorkflow — Net Metering Application Stage Engine
 *
 * Handles the post-commissioning DISCOM net metering application lifecycle.
 * - Tracks application from submission through meter installation
 * - Runs in parallel with Subsidy (both are independent of each other)
 * - Phase 16: this header previously claimed the project "stays in
 *   NetMetering until Handover (which waits for both NetMetering and
 *   Subsidy)" — but neither this file nor subsidyWorkflow.ts ever actually
 *   advanced the project to the 'Subsidy' stage, and projectHandoverWorkflow.ts's
 *   createHandover() requires currentStage to be at or past 'Subsidy' before
 *   it will run. The net effect (confirmed by a fresh cross-module trace,
 *   not merely inferred) was that NO project could ever organically reach
 *   Handover or, downstream of it, AMC — both were structurally unreachable
 *   via any real (non-demo) code path. Fixed here and symmetrically in
 *   subsidyWorkflow.ts's createSubsidyApplication(): the project now
 *   advances to 'Subsidy' the moment EITHER track shows real forward
 *   progress — Net Metering reaching 'MeterInstalled', or a Subsidy
 *   application being filed at all — whichever happens first. This
 *   deliberately does NOT wait for both tracks to fully resolve
 *   (MeterInstalled + Disbursed): Appendix E item 9 already locked the
 *   policy that Handover itself only requires stage>=Subsidy, not full
 *   resolution of the underlying applications (real subsidy disbursement
 *   can legitimately lag physical handover by months) — mirroring that same
 *   "minimum unambiguous bar" here keeps this consistent with the
 *   already-decided policy instead of inventing a stricter one, and also
 *   covers projects that qualify for Net Metering but never file for a
 *   subsidy at all (e.g. larger commercial/industrial systems), which would
 *   otherwise be permanently stuck.
 *
 * Status flow:
 *   Submitted → UnderReview → Approved → MeterInstalled → Rejected
 *
 * Reuses existing:
 *   - Firestore abstraction (getOne, updateDocById, createDocWithId, genId, getAll)
 *   - Audit logging (logActivity)
 *   - Notifications (notifyRoleUsers)
 *   - Project lifecycle (stageHistory is NOT updated — commission already transitions)
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

export type NetMeteringStatus =
  | 'Submitted'
  | 'UnderReview'
  | 'Approved'
  | 'MeterInstalled'
  | 'Rejected';

export interface NetMeteringStatusHistoryEntry {
  status: NetMeteringStatus;
  changedAt: string;
  changedBy?: string;
  note?: string;
}

export interface NetMeteringApplication {
  id: string;
  companyId: string;
  projectId: string;
  projectName?: string;
  discomName: string;
  applicationNumber: string;
  status: NetMeteringStatus;
  submittedDate: string;
  approvedDate?: string;
  rejectedDate?: string;
  rejectionReason?: string;
  meterInstalledDate?: string;
  expectedMeterInstallationDate?: string;
  notes?: string;
  statusHistory: NetMeteringStatusHistoryEntry[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
}

export interface NetMeteringCreateInput {
  projectId: string;
  projectName?: string;
  discomName: string;
  applicationNumber: string;
  submittedDate?: string;
  expectedMeterInstallationDate?: string;
  notes?: string;
}

// ═══════════════════════════════════════════════════════════
//  VALID TRANSITIONS
// ═══════════════════════════════════════════════════════════

const VALID_TRANSITIONS: Record<NetMeteringStatus, NetMeteringStatus[]> = {
  Submitted: ['UnderReview', 'Rejected'],
  UnderReview: ['Approved', 'Rejected'],
  Approved: ['MeterInstalled', 'Rejected'],
  MeterInstalled: [],
  Rejected: [],
};

export function isValidTransition(current: NetMeteringStatus, next: NetMeteringStatus): boolean {
  return VALID_TRANSITIONS[current]?.includes(next) ?? false;
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

function nowISO(): string {
  return new Date().toISOString();
}

function resolveCompanyId(): string {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  return resolveWriteCompanyId();
}

// ═══════════════════════════════════════════════════════════
//  CREATE APPLICATION
// ═══════════════════════════════════════════════════════════

/**
 * Create a new net metering application for a project.
 * The project must be in the NetMetering stage (set by commissioning).
 */
export async function createNetMeteringApplication(
  input: NetMeteringCreateInput,
): Promise<NetMeteringApplication> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();
  const userId = state.user?.id || 'system';
  const now = nowISO();
  const id = genId.generic('NM');

  // Validate required fields
  if (!input.projectId) throw new Error('Project ID is required');
  if (!input.discomName?.trim()) throw new Error('DISCOM/Utility name is required');
  if (!input.applicationNumber?.trim()) throw new Error('Application number is required');

  // Verify project exists and is in an appropriate stage. Phase 16: this
  // previously checked a hardcoded, independently-drifted local array
  // (['NetMetering','Subsidy','Handover','Archived']) — the exact anti-
  // pattern Phase 5 eliminated everywhere else — which was also functionally
  // wrong, since it excluded 'AMC'/'Service'/'Monitoring' and would have
  // incorrectly blocked a project already that far along from ever creating
  // a (late) Net Metering application.
  const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, input.projectId);
  if (!project) throw new Error('Project not found');
  if (!isProjectStageAtOrPast(project.currentStage, 'NetMetering')) {
    throw new Error(
      `Net metering applications can only be created once a project has reached the Net Metering stage. Current stage: ${project.currentStage}`
    );
  }

  const status: NetMeteringStatus = 'Submitted';
  const submittedDate = input.submittedDate || now;

  const record: NetMeteringApplication = {
    id,
    companyId,
    projectId: input.projectId,
    projectName: input.projectName || project.projectId,
    discomName: input.discomName.trim(),
    applicationNumber: input.applicationNumber.trim(),
    status,
    submittedDate,
    expectedMeterInstallationDate: input.expectedMeterInstallationDate,
    notes: input.notes?.trim(),
    statusHistory: [
      {
        status,
        changedAt: now,
        changedBy: userId,
        note: 'Application submitted',
      },
    ],
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.NET_METERING_APPLICATIONS, id, record);

  // Audit logging
  await logActivity('Net Metering', 'Application Created', id, {
    entityName: `Net Metering ${id}`,
    actionLabel: `Net metering application submitted for project ${input.projectName || input.projectId}`,
    projectId: input.projectId,
    discomName: input.discomName,
    applicationNumber: input.applicationNumber,
    status: 'Submitted',
  });

  // Phase 3B: Propagate caseId from commissioning/project chain to net metering application
  void propagateCaseIdFromChain('net_metering_applications', id);

  // Notify compliance/admins
  await notifyRoleUsers(
    ['Admin', 'Director', 'Operations'],
    NotificationType.TASK_ASSIGNED,
    'Net metering application submitted',
    `Net metering application ${input.applicationNumber} submitted for ${input.projectName || input.projectId} with ${input.discomName}.`,
    'net_metering_application',
    id,
    companyId,
  ).catch(() => {});

  return record;
}

// ═══════════════════════════════════════════════════════════
//  TRANSITION STATUS
// ═══════════════════════════════════════════════════════════

/**
 * Transition a net metering application to a new status.
 * Validates the transition is allowed and updates the record.
 */
export async function transitionNetMeteringStatus(
  applicationId: string,
  newStatus: NetMeteringStatus,
  options?: {
    note?: string;
    approvedDate?: string;
    rejectionReason?: string;
    meterInstalledDate?: string;
  },
): Promise<NetMeteringApplication> {
  const app = await getOne<NetMeteringApplication>(COLLECTIONS.NET_METERING_APPLICATIONS, applicationId);
  if (!app) throw new Error('Net metering application not found');

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
  }
  if (newStatus === 'Rejected') {
    fieldUpdates.rejectedDate = now;
    fieldUpdates.rejectionReason = options?.rejectionReason || '';
  }
  if (newStatus === 'MeterInstalled') {
    fieldUpdates.meterInstalledDate = options?.meterInstalledDate || now;
  }

  const historyEntry: NetMeteringStatusHistoryEntry = {
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

  await updateDocById(COLLECTIONS.NET_METERING_APPLICATIONS, applicationId, updateData);

  // Phase 16: reaching MeterInstalled is one of the two real triggers (the
  // other is subsidyWorkflow.ts's createSubsidyApplication()) that advances
  // the project to the 'Subsidy' stage — see this file's header comment for
  // why. Forward-only and idempotent via buildProjectStageAdvancePatch: a
  // no-op if the project already advanced via the other track.
  if (newStatus === 'MeterInstalled') {
    const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, app.projectId);
    const stagePatch = buildProjectStageAdvancePatch(project, 'Subsidy', userId, 'Net metering complete — advancing to Subsidy', now);
    if (Object.keys(stagePatch).length > 0) {
      await updateDocById(COLLECTIONS.PROJECTS, app.projectId, stagePatch);
    }
  }

  // Audit logging
  const actionLabel = `Net metering application ${app.applicationNumber} status changed from ${app.status} to ${newStatus}`;
  await logActivity('Net Metering', `Status: ${newStatus}`, applicationId, {
    entityName: `Net Metering ${applicationId}`,
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
    `Net metering: ${newStatus}`,
    `Application ${app.applicationNumber} for ${app.projectName || app.projectId} is now ${newStatus}.`,
    'net_metering_application',
    applicationId,
    resolveCompanyId(),
  ).catch(() => {});

  return {
    ...app,
    ...updateData,
  } as NetMeteringApplication;
}

// ═══════════════════════════════════════════════════════════
//  QUERIES
// ═══════════════════════════════════════════════════════════

/**
 * Get all net metering applications for a project.
 */
export async function getProjectNetMeteringApplications(
  projectId: string,
): Promise<NetMeteringApplication[]> {
  const all = await getAll<NetMeteringApplication>(COLLECTIONS.NET_METERING_APPLICATIONS);
  return all
    .filter((app) => app.projectId === projectId && !app.isDeleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Get the latest net metering application for a project.
 */
export async function getLatestNetMeteringApplication(
  projectId: string,
): Promise<NetMeteringApplication | null> {
  const apps = await getProjectNetMeteringApplications(projectId);
  return apps.length > 0 ? apps[0] : null;
}

/**
 * Determine if a project's net metering is resolved (meter installed) or pending.
 */
export async function getNetMeteringStatus(projectId: string): Promise<{
  hasApplication: boolean;
  latestStatus: NetMeteringStatus | null;
  isResolved: boolean;
}> {
  const latest = await getLatestNetMeteringApplication(projectId);
  if (!latest) return { hasApplication: false, latestStatus: null, isResolved: false };
  return {
    hasApplication: true,
    latestStatus: latest.status,
    isResolved: latest.status === 'MeterInstalled',
  };
}

export default {
  createNetMeteringApplication,
  transitionNetMeteringStatus,
  getProjectNetMeteringApplications,
  getLatestNetMeteringApplication,
  getNetMeteringStatus,
  isValidTransition,
  VALID_TRANSITIONS,
};
