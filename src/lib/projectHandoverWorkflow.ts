/**
 * projectHandoverWorkflow.ts — Project Handover Workflow
 *
 * State machine: Draft → Scheduled → Completed / Cancelled
 * Immutable handover history with audit logging and notifications.
 */

import { COLLECTIONS } from './firebase';
import { advanceProjectStage } from './projectStageTransition';
import { createDocWithId, getAll, getOne, updateDocById } from './firestore';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { propagateCaseIdFromChain } from './casePropagation';
import { isProjectStageAtOrPast } from './projectLifecycle';

// ── Types ─────────────────────────────────────────────────────

export type HandoverStatus = 'Draft' | 'Scheduled' | 'Completed' | 'Cancelled';

export interface HandoverStatusHistoryEntry {
  status: HandoverStatus;
  changedAt: string;
  changedBy: string;
  note?: string;
}

export interface HandoverRecord {
  id: string;
  companyId: string;
  projectId: string;
  projectName: string;
  customerId: string;
  customerName: string;
  handoverNumber: string;
  handoverDate: string;
  scheduledDate?: string;
  completedDate?: string;
  assignedEngineer?: string;
  assignedEngineerName?: string;
  notes: string;
  status: HandoverStatus;
  statusHistory: HandoverStatusHistoryEntry[];
  completedAt?: string;
  completedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  isDeleted: boolean;
}

export interface HandoverCreateInput {
  projectId: string;
  projectName: string;
  customerId: string;
  customerName: string;
  handoverDate: string;
  scheduledDate?: string;
  assignedEngineer?: string;
  assignedEngineerName?: string;
  notes?: string;
}

// ── State machine ─────────────────────────────────────────────

const VALID_TRANSITIONS: Record<HandoverStatus, HandoverStatus[]> = {
  Draft: ['Scheduled', 'Cancelled'],
  Scheduled: ['Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};

export function isValidTransition(from: HandoverStatus, to: HandoverStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Create ────────────────────────────────────────────────────

export async function createHandover(input: HandoverCreateInput): Promise<HandoverRecord> {
  if (!input.projectId) throw new Error('Project is required');
  if (!input.projectName) throw new Error('Project name is required');
  if (!input.customerName) throw new Error('Customer name is required');
  if (!input.handoverDate) throw new Error('Handover date is required');

  const state = useAppStore.getState();
  const companyId = state.activeCompanyId || state.company?.id || '';
  if (!companyId) throw new Error('Active company is required');

  // A project must have reached Subsidy (i.e. already passed through
  // NetMetering) before a Handover record makes sense. Consistent with the
  // precondition every sibling stage-creating module already enforces
  // (Commissioning requires exactly 'Commissioning'; NetMetering/Subsidy
  // require being at/past NetMetering) — Handover/AMC were the two missing
  // this check entirely, allowing a Handover to be created (and the
  // project stage force-advanced) from any earlier stage.
  const project = await getOne<{ currentStage?: string }>(COLLECTIONS.PROJECTS, input.projectId);
  if (!project) throw new Error('Project not found');
  if (!isProjectStageAtOrPast(project.currentStage, 'Subsidy')) {
    throw new Error(`Handover can only be created once a project has reached the Subsidy stage. Current stage: ${project.currentStage}`);
  }

  // Guard against a duplicate open handover for the same project — an
  // unresolved (Draft/Scheduled) second handover is ambiguous. A prior
  // handover that was Cancelled can still be superseded by a fresh one.
  const existingHandovers = await getAll<HandoverRecord>(COLLECTIONS.PROJECT_HANDOVERS);
  const openDuplicate = existingHandovers.find(
    (h) => h.projectId === input.projectId && !h.isDeleted && (h.status === 'Draft' || h.status === 'Scheduled')
  );
  if (openDuplicate) {
    throw new Error(`An open handover (${openDuplicate.id}) already exists for this project. Resolve it before creating another.`);
  }

  const id = `HDO-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`.toUpperCase();
  const now = new Date().toISOString();
  const userId = state.user?.id || 'system';

  const record: HandoverRecord = {
    id,
    companyId,
    projectId: input.projectId,
    projectName: input.projectName,
    customerId: input.customerId,
    customerName: input.customerName,
    handoverNumber: id,
    handoverDate: input.handoverDate,
    scheduledDate: input.scheduledDate,
    assignedEngineer: input.assignedEngineer,
    assignedEngineerName: input.assignedEngineerName,
    notes: input.notes || '',
    status: 'Draft',
    statusHistory: [{ status: 'Draft', changedAt: now, changedBy: userId }],
    createdBy: userId,
    createdAt: now,
    updatedBy: userId,
    updatedAt: now,
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.PROJECT_HANDOVERS, id, record);
  await advanceProjectStage(input.projectId, 'Handover', userId, 'Handover record ' + id + ' created', now);

  await logActivity('ProjectHandover', 'Created', id, {
    entityName: `${input.customerName} - ${input.projectName}`,
    actionLabel: 'Handover record created',
    projectId: input.projectId,
  });

  await notifyRoleUsers(
    ['Operations', 'Director'],
    NotificationType.INSTALLATION_COMPLETED,
    'Handover initiated',
    `Project handover created for ${input.customerName} (${input.projectName}).`,
    'project_handover',
    id,
    companyId,
  );

  // Phase 3B: Propagate caseId from project chain to handover
  void propagateCaseIdFromChain('project_handovers', id);

  return record;
}

// ── Status transitions ────────────────────────────────────────

export async function transitionHandoverStatus(
  handoverId: string,
  nextStatus: HandoverStatus,
  options?: { note?: string; scheduledDate?: string; assignedEngineer?: string; assignedEngineerName?: string },
): Promise<HandoverRecord> {
  const state = useAppStore.getState();
  const userId = state.user?.id || 'system';

  const existing = await getOne<HandoverRecord>(COLLECTIONS.PROJECT_HANDOVERS, handoverId);
  if (!existing) throw new Error(`Handover ${handoverId} not found`);

  const currentStatus = existing.status as HandoverStatus;
  if (!isValidTransition(currentStatus, nextStatus)) {
    throw new Error(`Cannot transition handover from ${currentStatus} to ${nextStatus}`);
  }

  if (existing.isDeleted) throw new Error('Cannot transition a deleted handover record');

  const now = new Date().toISOString();
  const newHistoryEntry: HandoverStatusHistoryEntry = {
    status: nextStatus,
    changedAt: now,
    changedBy: userId,
    note: options?.note,
  };

  const updates: Record<string, unknown> = {
    status: nextStatus,
    updatedBy: userId,
    updatedAt: now,
    statusHistory: [...(existing.statusHistory || []), newHistoryEntry],
  };

  if (nextStatus === 'Scheduled') {
    updates.scheduledDate = options?.scheduledDate || existing.scheduledDate || now;
    if (options?.assignedEngineer) updates.assignedEngineer = options.assignedEngineer;
    if (options?.assignedEngineerName) updates.assignedEngineerName = options.assignedEngineerName;
  }
  if (nextStatus === 'Completed') {
    updates.completedAt = now;
    updates.completedBy = userId;
  }
  if (nextStatus === 'Cancelled') {
    updates.cancelledAt = now;
    updates.cancelledBy = userId;
    updates.cancellationReason = options?.note || 'Cancelled by user';
  }

  await updateDocById(COLLECTIONS.PROJECT_HANDOVERS, handoverId, updates);

  const actionLabel =
    nextStatus === 'Scheduled' ? 'Handover scheduled' :
    nextStatus === 'Completed' ? 'Handover completed' :
    nextStatus === 'Cancelled' ? 'Handover cancelled' : `Handover ${nextStatus.toLowerCase()}`;

  await logActivity('ProjectHandover', nextStatus, handoverId, {
    entityName: `${existing.customerName} - ${existing.projectName}`,
    actionLabel,
    note: options?.note,
  });

  return {
    ...(existing as HandoverRecord),
    ...updates,
    statusHistory: [...(existing.statusHistory || []), newHistoryEntry],
  } as HandoverRecord;
}

// ── Reassign ──────────────────────────────────────────────────

/** Reassign the responsible engineer on an existing handover without a status transition. */
export async function reassignHandoverEngineer(id: string, userId: string, userName: string): Promise<void> {
  await updateDocById(COLLECTIONS.PROJECT_HANDOVERS, id, {
    assignedEngineer: userId,
    assignedEngineerName: userName,
  });
}

// ── Query helpers ─────────────────────────────────────────────

export async function getHandovers(): Promise<HandoverRecord[]> {
  const { getAll } = await import('./firestore');
  const records = await getAll<Record<string, unknown>>(COLLECTIONS.PROJECT_HANDOVERS);
  return records
    .filter((r) => !r.isDeleted)
    .map((r) => r as unknown as HandoverRecord);
}

export async function getHandover(id: string): Promise<HandoverRecord | null> {
  const record = await getOne<Record<string, unknown>>(COLLECTIONS.PROJECT_HANDOVERS, id);
  if (!record || record.isDeleted) return null;
  return record as unknown as HandoverRecord;
}
