/**
 * amcWorkflow.ts — AMC Contract Workflow
 *
 * State machine: Draft → Active → Expired / Cancelled
 * Immutable contract history with audit logging and notifications.
 */

import { COLLECTIONS } from './firebase';
import { advanceProjectStage } from './projectStageTransition';
import { createDocWithId, getAll, getOne, resolveWriteCompanyId, updateDocById } from './firestore';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { propagateCaseIdFromChain } from './casePropagation';
import { isProjectStageAtOrPast } from './projectLifecycle';

// ── Types ─────────────────────────────────────────────────────

export type AmcStatus = 'Draft' | 'Active' | 'Expired' | 'Cancelled';

export interface AmcStatusHistoryEntry {
  status: AmcStatus;
  changedAt: string;
  changedBy: string;
  note?: string;
}

export interface AmcContractRecord {
  id: string;
  companyId: string;
  projectId: string;
  projectName: string;
  customerId: string;
  customerName: string;
  contractNumber: string;
  startDate: string;
  endDate: string;
  visitsPerYear: number;
  contractValue: number;
  assignedTo?: string;
  assignedToName?: string;
  notes: string;
  status: AmcStatus;
  statusHistory: AmcStatusHistoryEntry[];
  activatedAt?: string;
  activatedBy?: string;
  expiredAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  isDeleted: boolean;
}

export interface AmcContractCreateInput {
  projectId: string;
  projectName: string;
  customerId: string;
  customerName: string;
  startDate: string;
  endDate: string;
  visitsPerYear: number;
  contractValue: number;
  assignedTo?: string;
  assignedToName?: string;
  notes?: string;
}

// ── State machine ─────────────────────────────────────────────

const VALID_TRANSITIONS: Record<AmcStatus, AmcStatus[]> = {
  Draft: ['Active', 'Cancelled'],
  Active: ['Expired', 'Cancelled'],
  Expired: [],
  Cancelled: [],
};

export function isValidTransition(from: AmcStatus, to: AmcStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Create ────────────────────────────────────────────────────

export async function createAmcContract(input: AmcContractCreateInput): Promise<AmcContractRecord> {
  if (!input.projectId) throw new Error('Project is required');
  if (!input.customerName) throw new Error('Customer name is required');
  if (!input.startDate) throw new Error('Start date is required');
  if (!input.endDate) throw new Error('End date is required');
  if (input.visitsPerYear < 0) throw new Error('Visits per year cannot be negative');
  if (input.contractValue < 0) throw new Error('Contract value cannot be negative');

  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  if (!companyId) throw new Error('Active company is required');

  // A project must have completed Handover before an AMC contract makes
  // sense (matches the real-world sequence: AMC covers post-handover
  // maintenance). Consistent with the precondition every sibling
  // stage-creating module already enforces (Commissioning/NetMetering/
  // Subsidy) — Handover/AMC were the two missing this check.
  const project = await getOne<{ currentStage?: string }>(COLLECTIONS.PROJECTS, input.projectId);
  if (!project) throw new Error('Project not found');
  if (!isProjectStageAtOrPast(project.currentStage, 'Handover')) {
    throw new Error(`AMC contracts can only be created once a project has reached Handover. Current stage: ${project.currentStage}`);
  }

  // Guard against a duplicate open contract for the same project — an
  // unresolved (Draft/Active) second contract is ambiguous about which one
  // actually governs service coverage. A prior contract that has Expired
  // or been Cancelled can still be legitimately renewed with a fresh one.
  const existingContracts = await getAll<AmcContractRecord>(COLLECTIONS.AMC_CONTRACTS);
  const openDuplicate = existingContracts.find(
    (c) => c.projectId === input.projectId && !c.isDeleted && (c.status === 'Draft' || c.status === 'Active')
  );
  if (openDuplicate) {
    throw new Error(`An open AMC contract (${openDuplicate.id}) already exists for this project. Resolve it before creating another.`);
  }

  const id = `AMC-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`.toUpperCase();
  const now = new Date().toISOString();
  const userId = state.user?.id || 'system';

  const record: AmcContractRecord = {
    id,
    companyId,
    projectId: input.projectId,
    projectName: input.projectName,
    customerId: input.customerId,
    customerName: input.customerName,
    contractNumber: id,
    startDate: input.startDate,
    endDate: input.endDate,
    visitsPerYear: input.visitsPerYear,
    contractValue: input.contractValue,
    assignedTo: input.assignedTo,
    assignedToName: input.assignedToName,
    notes: input.notes || '',
    status: 'Draft',
    statusHistory: [{ status: 'Draft', changedAt: now, changedBy: userId }],
    createdBy: userId,
    createdAt: now,
    updatedBy: userId,
    updatedAt: now,
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.AMC_CONTRACTS, id, record);
  await advanceProjectStage(input.projectId, 'AMC', userId, 'AMC contract ' + id + ' created', now);

  await logActivity('AmcContract', 'Created', id, {
    entityName: `${input.customerName} - ${input.projectName}`,
    actionLabel: 'AMC contract created',
    projectId: input.projectId,
  });

  await notifyRoleUsers(
    ['Operations', 'Director'],
    NotificationType.INSTALLATION_COMPLETED,
    'AMC contract created',
    `AMC contract created for ${input.customerName} (${input.projectName}). Value: ${input.contractValue}`,
    'amc_contract',
    id,
    companyId,
  );

  // Phase 3B: Propagate caseId from project chain to AMC contract
  void propagateCaseIdFromChain('amc_contracts', id);

  return record;
}

// ── Status transitions ────────────────────────────────────────

export async function transitionAmcStatus(
  contractId: string,
  nextStatus: AmcStatus,
  options?: { note?: string },
): Promise<AmcContractRecord> {
  const state = useAppStore.getState();
  const userId = state.user?.id || 'system';

  const existing = await getOne<AmcContractRecord>(COLLECTIONS.AMC_CONTRACTS, contractId);
  if (!existing) throw new Error(`AMC contract ${contractId} not found`);

  const currentStatus = existing.status as AmcStatus;
  if (!isValidTransition(currentStatus, nextStatus)) {
    throw new Error(`Cannot transition AMC contract from ${currentStatus} to ${nextStatus}`);
  }

  if (existing.isDeleted) throw new Error('Cannot transition a deleted AMC contract');

  const now = new Date().toISOString();
  const newHistoryEntry: AmcStatusHistoryEntry = {
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

  if (nextStatus === 'Active') {
    updates.activatedAt = now;
    updates.activatedBy = userId;
  }
  if (nextStatus === 'Expired') {
    updates.expiredAt = now;
  }
  if (nextStatus === 'Cancelled') {
    updates.cancelledAt = now;
    updates.cancelledBy = userId;
    updates.cancellationReason = options?.note || 'Cancelled by user';
  }

  await updateDocById(COLLECTIONS.AMC_CONTRACTS, contractId, updates);

  const actionLabel =
    nextStatus === 'Active' ? 'AMC contract activated' :
    nextStatus === 'Expired' ? 'AMC contract expired' :
    nextStatus === 'Cancelled' ? 'AMC contract cancelled' : `AMC contract ${nextStatus.toLowerCase()}`;

  await logActivity('AmcContract', nextStatus, contractId, {
    entityName: `${existing.customerName} - ${existing.projectName}`,
    actionLabel,
    note: options?.note,
  });

  return {
    ...(existing as AmcContractRecord),
    ...updates,
    statusHistory: [...(existing.statusHistory || []), newHistoryEntry],
  } as AmcContractRecord;
}

// ── Reassign ──────────────────────────────────────────────────

/** Reassign the responsible owner on an existing AMC contract without a status transition. */
export async function reassignAmcContract(id: string, userId: string, userName: string): Promise<void> {
  await updateDocById(COLLECTIONS.AMC_CONTRACTS, id, {
    assignedTo: userId,
    assignedToName: userName,
  });
}

// ── Query helpers ─────────────────────────────────────────────

export async function getAmcContracts(): Promise<AmcContractRecord[]> {
  const { getAll } = await import('./firestore');
  const records = await getAll<Record<string, unknown>>(COLLECTIONS.AMC_CONTRACTS);
  return records
    .filter((r) => !r.isDeleted)
    .map((r) => r as unknown as AmcContractRecord);
}

export async function getAmcContract(id: string): Promise<AmcContractRecord | null> {
  const record = await getOne<Record<string, unknown>>(COLLECTIONS.AMC_CONTRACTS, id);
  if (!record || record.isDeleted) return null;
  return record as unknown as AmcContractRecord;
}
