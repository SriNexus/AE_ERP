/**
 * commissioningWorkflow — Commissioning Stage Engine
 *
 * Handles the final project sign-off after QC passes.
 * - Single sign-off action — immutable after creation
 * - Records generation test reading, customer sign-off, warranty start date
 * - Transitions project to NetMetering stage
 *
 * Reuses existing:
 *   - Firestore abstraction (getOne, updateDocById, createDocWithId, genId, getAll)
 *   - Audit logging (logActivity)
 *   - Notifications (notifyRoleUsers)
 *   - Project lifecycle (stageHistory updates)
 */

import { createDocWithId, genId, getAll, getOne, updateDocById, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { propagateCaseIdFromChain } from './casePropagation';
import { buildProjectStageAdvancePatch } from './projectLifecycle';
import type { ProjectRecord } from '../features/projects/types';

// ═══════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════

export type CommissioningStatus = 'pending' | 'completed';

export interface CommissioningRecord {
  id: string;
  companyId: string;
  projectId: string;
  projectName?: string;
  qcId?: string;
  status: CommissioningStatus;
  generationTestKwh: number;
  commissionedDate: string;
  commissionedBy: string;
  commissionedByName: string;
  customerName?: string;
  customerSignoff?: boolean;
  customerSignoffUrl?: string;
  warrantyStartDate?: string;
  warrantyMonths?: number;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isCompleted: boolean;
  isDeleted: boolean;
}

export interface CommissioningCreateInput {
  projectId: string;
  projectName?: string;
  generationTestKwh: number;
  commissionedByName: string;
  customerName?: string;
  customerSignoff: boolean;
  customerSignoffUrl: string;
  warrantyStartDate?: string;
  warrantyMonths?: number;
  notes?: string;
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

function formatDate(): string {
  return new Date().toISOString();
}

function resolveCompanyId(): string {
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  return resolveWriteCompanyId();
}

// ═══════════════════════════════════════════════════════════
//  CREATE COMMISSIONING RECORD
// ═══════════════════════════════════════════════════════════

/**
 * Create a new commissioning record.
 * After creation, the record is considered complete and immutable.
 * The project transitions to NetMetering stage.
 */
export async function createCommissioningRecord(
  input: CommissioningCreateInput,
): Promise<CommissioningRecord> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();
  const userId = state.user?.id || 'system';
  const now = formatDate();
  const id = genId.generic('COM');

  // Validate input
  if (!input.projectId) throw new Error('Project ID is required');
  if (!input.generationTestKwh || input.generationTestKwh <= 0) {
    throw new Error('Generation test reading must be greater than zero');
  }
  if (!input.customerSignoffUrl) {
    throw new Error('Customer signature is required — please upload the signed document');
  }

  const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, input.projectId);
  if (!project) throw new Error('Project not found');
  if (project.currentStage !== 'Commissioning') {
    throw new Error('Project must be in Commissioning stage to complete commissioning');
  }

  const passedQC = (await getAll<Record<string, unknown>>(COLLECTIONS.QC_CHECKS))
    .filter((qc) => qc.companyId === companyId && qc.projectId === input.projectId && qc.isDeleted !== true && String(qc.status || '').toLowerCase() === 'passed')
    .sort((a, b) => String(b.completedAt || b.updatedAt || b.createdAt || '').localeCompare(String(a.completedAt || a.updatedAt || a.createdAt || '')))[0];
  if (!passedQC?.id) throw new Error('A passed QC check is required before commissioning');

  const record: CommissioningRecord = {
    id,
    companyId,
    projectId: input.projectId,
    projectName: input.projectName,
    qcId: String(passedQC.id),
    status: 'completed',
    generationTestKwh: input.generationTestKwh,
    commissionedDate: now,
    commissionedBy: userId,
    commissionedByName: input.commissionedByName || state.user?.name || 'System',
    customerName: input.customerName,
    customerSignoff: input.customerSignoff,
    customerSignoffUrl: input.customerSignoffUrl,
    warrantyStartDate: input.warrantyStartDate,
    warrantyMonths: input.warrantyMonths,
    notes: input.notes,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isCompleted: true,
    isDeleted: false,
  };

  // Write to Firestore (immutable — never modified after creation)
  await createDocWithId(COLLECTIONS.COMMISSIONING_RECORDS, id, record);

  // ── Update project stage ──────────────────────────────────
  // Uses the canonical projectLifecycle.ts guard (Phase 5) rather than a
  // manual write. Always a genuine forward move here — the precondition
  // above already confirmed currentStage === 'Commissioning' exactly, so
  // this can never regress a project, but routing through the shared
  // builder keeps the pattern consistent with every other stage-advancing
  // module (Phase 6/7/10) instead of duplicating the patch shape locally.
  const patch = buildProjectStageAdvancePatch(project, 'NetMetering', userId, 'Commissioning completed — advancing to Net Metering', now);
  if (Object.keys(patch).length > 0) {
    await updateDocById(COLLECTIONS.PROJECTS, input.projectId, patch);
  }

  // ── Audit & Notifications ─────────────────────────────────
  await logActivity('Commissioning', 'Commissioning Completed', id, {
    entityName: `Commissioning ${id}`,
    actionLabel: `Commissioning completed for project ${input.projectName || input.projectId}`,
    projectId: input.projectId,
    generationTestKwh: input.generationTestKwh,
    commissionedByName: input.commissionedByName,
    warrantyStartDate: input.warrantyStartDate,
  });

  await logActivity('Projects', 'Stage changed to NetMetering', input.projectId, {
    entityName: project.projectId || input.projectId,
    actionLabel: 'Commissioning completed — project advanced to Net Metering',
    previousStage: 'Commissioning',
    newStage: 'NetMetering',
    commissioningId: id,
  });

  // Phase 3B: Propagate caseId from QC/project chain to commissioning record
  void propagateCaseIdFromChain('commissioning_records', id);

  // Notify relevant users
  await notifyRoleUsers(
    ['Admin', 'Director', 'Operations'],
    NotificationType.INSTALLATION_COMPLETED,
    'Commissioning completed',
    `Project ${input.projectName || input.projectId} has been commissioned. Generation test: ${input.generationTestKwh} kWh.`,
    'commissioning_record',
    id,
    companyId,
  ).catch(() => {});

  return record;
}

// ═══════════════════════════════════════════════════════════
//  REASSIGN
// ═══════════════════════════════════════════════════════════

/**
 * Reassign the commissioned-by owner on an existing commissioning record.
 * (Commissioning is otherwise immutable after creation — this only touches
 * ownership, not the sign-off data itself.)
 */
export async function reassignCommissioning(id: string, userId: string, userName: string): Promise<void> {
  await updateDocById(COLLECTIONS.COMMISSIONING_RECORDS, id, {
    commissionedBy: userId,
    commissionedByName: userName,
  });
}

// ═══════════════════════════════════════════════════════════
//  QUERIES
// ═══════════════════════════════════════════════════════════

/**
 * Get all commissioning records for a project.
 */
export async function getProjectCommissioningRecords(projectId: string): Promise<CommissioningRecord[]> {
  const all = await getAll<CommissioningRecord>(COLLECTIONS.COMMISSIONING_RECORDS);
  return all
    .filter((r) => r.projectId === projectId && !r.isDeleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Check if a project has been commissioned.
 */
export async function isProjectCommissioned(projectId: string): Promise<boolean> {
  const records = await getProjectCommissioningRecords(projectId);
  return records.some((r) => r.isCompleted);
}

export default {
  createCommissioningRecord,
  reassignCommissioning,
  getProjectCommissioningRecords,
  isProjectCommissioned,
};
