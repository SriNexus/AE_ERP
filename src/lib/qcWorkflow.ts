/**
 * qcWorkflow — QC (Quality Check) Stage Engine
 *
 * Handles the QC lifecycle that occurs after Installation.
 * - Passed QC advances the project to Commissioning stage
 * - Failed QC loops back to Installation stage
 *
 * Reuses existing:
 *   - Firestore abstraction (getOne, updateDocById, createDocWithId, genId, getAll)
 *   - Audit logging (logActivity)
 *   - Notifications (notifyRoleUsers)
 *   - Project lifecycle (stageHistory updates)
 */

import { createDocWithId, genId, getAll, getOne, updateDocById, resolveWriteCompanyId } from './firestore';
import { advanceProjectStage } from './projectStageTransition';
import { buildProjectStageAdvancePatch } from './projectLifecycle';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { propagateCaseIdFromChain } from './casePropagation';
import type { ProjectRecord } from '../features/projects/types';

// ═══════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════

export type QCCheckStatus = 'pending' | 'in_progress' | 'passed' | 'failed';

export interface QCChecklistItem {
  item: string;
  passed: boolean;
  notes?: string;
  inspectedAt?: string;
  inspectedBy?: string;
}

export interface QCRecord {
  id: string;
  companyId: string;
  projectId: string;
  installationId?: string;
  installationName?: string;
  status: QCCheckStatus;
  checklistItems: QCChecklistItem[];
  inspectorId: string;
  inspectorName: string;
  overallNotes?: string;
  passedCount?: number;
  failedCount?: number;
  totalItems?: number;
  submittedAt?: string;
  completedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
}

export function normalizeQCRecord(record: QCRecord & { checklist?: Array<Record<string, unknown>> }): QCRecord {
  if (Array.isArray(record.checklistItems)) return record;
  const legacyItems = Array.isArray(record.checklist) ? record.checklist : [];
  const checklistItems: QCChecklistItem[] = legacyItems.map((item) => ({
    item: String(item.item || item.label || item.key || 'QC checklist item'),
    passed: item.passed === true || item.status === 'passed',
    notes: typeof item.notes === 'string' ? item.notes : undefined,
  }));
  return {
    ...record,
    checklistItems,
    totalItems: record.totalItems ?? checklistItems.length,
    passedCount: record.passedCount ?? checklistItems.filter((item) => item.passed).length,
    failedCount: record.failedCount ?? checklistItems.filter((item) => !item.passed).length,
    overallNotes: record.overallNotes || (typeof (record as unknown as { remarks?: unknown }).remarks === 'string' ? String((record as unknown as { remarks: string }).remarks) : undefined),
  };
}
export interface QCCreateInput {
  projectId: string;
  installationId?: string;
  installationName?: string;
  inspectorId: string;
  inspectorName: string;
  checklistItems?: QCChecklistItem[];
}

// ═══════════════════════════════════════════════════════════
//  DEFAULT QC CHECKLIST
// ═══════════════════════════════════════════════════════════

export const DEFAULT_QC_CHECKLIST: QCChecklistItem[] = [
  { item: 'Panel mounting and alignment verified', passed: false },
  { item: 'Electrical connections checked', passed: false },
  { item: 'Grounding / earthing verified', passed: false },
  { item: 'String voltage measured and verified', passed: false },
  { item: 'Inverter configuration verified', passed: false },
  { item: 'AC/DC isolation tested', passed: false },
  { item: 'Earthing resistance measured', passed: false },
  { item: 'System insulation resistance tested', passed: false },
  { item: 'Meter reading captured', passed: false },
  { item: 'Overall workmanship inspection', passed: false },
];

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

function computeStats(items: QCChecklistItem[]) {
  const total = items.length;
  const passed = items.filter((i) => i.passed).length;
  const failed = total - passed;
  return { totalItems: total, passedCount: passed, failedCount: failed };
}

function formatDate(): string {
  return new Date().toISOString();
}

function resolveCompanyId(): string {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  return resolveWriteCompanyId();
}

// ═══════════════════════════════════════════════════════════
//  CREATE QC CHECK
// ═══════════════════════════════════════════════════════════

/**
 * Create a new QC check record.
 * Initializes with the default checklist and 'pending' status.
 */
export async function createQCCheck(input: QCCreateInput): Promise<QCRecord> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();
  const userId = state.user?.id || 'system';
  const now = formatDate();
  const id = genId.generic('QC');

  // Guard against a duplicate open QC check for the same project — an
  // unresolved (pending/in_progress) second check for the same project is
  // ambiguous (which one governs the pass/fail stage transition) and was
  // the contributing risk factor behind submitQCDecision's stage-regression
  // bug below. A prior check that already passed or failed can still be
  // superseded by a fresh one (e.g. rework after a fail).
  const existing = await getAll<QCRecord>(COLLECTIONS.QC_CHECKS);
  const openDuplicate = existing.find(
    (qc) => qc.projectId === input.projectId && !qc.isDeleted && (qc.status === 'pending' || qc.status === 'in_progress')
  );
  if (openDuplicate) {
    throw new Error(`An open QC check (${openDuplicate.id}) already exists for this project. Resolve it before creating another.`);
  }

  const items = input.checklistItems && input.checklistItems.length > 0
    ? input.checklistItems.map((i) => ({ ...i }))
    : DEFAULT_QC_CHECKLIST.map((i) => ({ ...i }));

  const stats = computeStats(items);

  const record: QCRecord = {
    id,
    companyId,
    projectId: input.projectId,
    installationId: input.installationId,
    installationName: input.installationName,
    status: 'pending',
    checklistItems: items,
    inspectorId: input.inspectorId,
    inspectorName: input.inspectorName,
    ...stats,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.QC_CHECKS, id, record);
  await advanceProjectStage(input.projectId, 'QC', userId, 'QC check ' + id + ' initiated', now);

  await logActivity('QC', 'QC Check Created', id, {
    entityName: `QC ${id}`,
    actionLabel: `QC check created for project ${input.projectId}`,
    projectId: input.projectId,
    installationId: input.installationId,
    status: 'pending',
  });

  // Phase 3B: Propagate caseId from installation/project chain to QC check
  void propagateCaseIdFromChain('qc_checks', id);

  // Notify inspectors/admins
  await notifyRoleUsers(
    ['Admin', 'Director', 'Operations'],
    NotificationType.TASK_ASSIGNED,
    'QC check created',
    `A quality check has been initiated for project ${input.projectId} by ${input.inspectorName}.`,
    'qc_check',
    id,
    companyId,
  ).catch(() => {});

  return record;
}

// ═══════════════════════════════════════════════════════════
//  UPDATE QC CHECKLIST ITEM
// ═══════════════════════════════════════════════════════════

/**
 * Toggle a checklist item's pass/fail status.
 * Automatically transitions status to 'in_progress' if currently 'pending'.
 */
export async function updateQCChecklistItem(
  qcId: string,
  itemIndex: number,
  passed: boolean,
  notes?: string,
): Promise<QCRecord> {
  const qc = await getOne<QCRecord>(COLLECTIONS.QC_CHECKS, qcId);
  if (!qc) throw new Error('QC check not found');
  if (qc.status === 'passed' || qc.status === 'failed') {
    throw new Error('Cannot modify a completed QC check');
  }

  const items = JSON.parse(JSON.stringify(qc.checklistItems)) as QCChecklistItem[];
  if (itemIndex < 0 || itemIndex >= items.length) {
    throw new Error(`Invalid checklist item index: ${itemIndex}`);
  }

  const state = useAppStore.getState();
  const now = formatDate();
  items[itemIndex] = {
    ...items[itemIndex],
    passed,
    notes: notes || items[itemIndex].notes,
    inspectedAt: now,
    inspectedBy: state.user?.id || 'system',
  };

  const stats = computeStats(items);
  const newStatus: QCCheckStatus = qc.status === 'pending' ? 'in_progress' : qc.status;

  await updateDocById(COLLECTIONS.QC_CHECKS, qcId, {
    checklistItems: items,
    status: newStatus,
    ...stats,
    updatedAt: now,
  });

  await logActivity('QC', 'Checklist Item Updated', qcId, {
    entityName: `QC ${qcId}`,
    actionLabel: `QC item "${items[itemIndex].item}" marked as ${passed ? 'pass' : 'fail'}`,
    item: items[itemIndex].item,
    passed,
  });

  return { ...qc, checklistItems: items, status: newStatus, ...stats, updatedAt: now };
}

// ═══════════════════════════════════════════════════════════
//  SUBMIT QC (Complete with Pass/Fail Decision)
// ═══════════════════════════════════════════════════════════

/**
 * Submit the final QC decision.
 * - If all items pass → status = 'passed', advance project to 'Commissioning'
 * - If any item fails  → status = 'failed', loop-back project to 'Installation'
 */
export async function submitQCDecision(
  qcId: string,
  overallNotes?: string,
): Promise<{ qc: QCRecord; projectTransition: string }> {
  const qc = await getOne<QCRecord>(COLLECTIONS.QC_CHECKS, qcId);
  if (!qc) throw new Error('QC check not found');
  if (qc.status === 'passed' || qc.status === 'failed') {
    throw new Error('QC decision has already been submitted');
  }

  const state = useAppStore.getState();
  const userId = state.user?.id || 'system';
  const now = formatDate();
  const items = qc.checklistItems;
  const stats = computeStats(items);
  const allPassed = items.every((i) => i.passed);
  const newStatus: QCCheckStatus = allPassed ? 'passed' : 'failed';

  // Update QC record
  await updateDocById(COLLECTIONS.QC_CHECKS, qcId, {
    status: newStatus,
    overallNotes: overallNotes || '',
    completedAt: now,
    ...stats,
    submittedAt: now,
    updatedAt: now,
  });

  // ── Handle project stage transition ──────────────────────
  const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, qc.projectId);
  if (!project) throw new Error('Associated project not found');

  const targetStage = allPassed ? 'Commissioning' : 'Installation';
  const transitionNote = allPassed
    ? 'QC passed — advancing to Commissioning'
    : `QC failed — returning to Installation for rework`;

  if (allPassed) {
    // Forward-only, regression-proof — the canonical guard (Phase 5).
    const patch = buildProjectStageAdvancePatch(project, 'Commissioning', userId, transitionNote, now);
    if (Object.keys(patch).length > 0) {
      await updateDocById(COLLECTIONS.PROJECTS, qc.projectId, patch);
    }
  } else {
    // A fail's loop-back to 'Installation' is a legitimate, intentional
    // exception to forward-only progression — buildProjectStageAdvancePatch
    // would refuse it (Installation is behind QC in PROJECT_STAGE_ORDER).
    // Still guarded: only regress a project that is CURRENTLY at QC, so a
    // stale/duplicate QC record can never regress a project that has
    // already legitimately moved past QC via a later, different QC check.
    if (project.currentStage === 'QC') {
      const updatedHistory = [
        ...(project.stageHistory || []),
        { stage: targetStage, changedAt: now, changedBy: userId, note: transitionNote },
      ];
      await updateDocById(COLLECTIONS.PROJECTS, qc.projectId, {
        currentStage: targetStage,
        stageHistory: updatedHistory,
        updatedBy: userId,
        updatedAt: now,
      });
    }
  }

  // ── Audit & Notifications ─────────────────────────────────
  const actionLabel = allPassed
    ? `QC passed — project advanced to Commissioning`
    : `QC failed — ${stats.failedCount} item(s) failed, project returned to Installation`;

  await logActivity('QC', allPassed ? 'QC Passed' : 'QC Failed', qcId, {
    entityName: `QC ${qcId}`,
    actionLabel,
    projectId: qc.projectId,
    passedCount: stats.passedCount,
    failedCount: stats.failedCount,
    newStage: targetStage,
    overallNotes: overallNotes || '',
  });

  await logActivity('Projects', `Stage changed to ${targetStage}`, qc.projectId, {
    entityName: project.projectId || qc.projectId,
    actionLabel: transitionNote,
    previousStage: project.currentStage,
    newStage: targetStage,
    qcId,
  });

  // Notify
  const notificationTitle = allPassed
    ? 'QC check passed'
    : 'QC check failed — rework required';
  const notificationBody = allPassed
    ? `QC for project ${qc.projectId} has passed. Project is advancing to Commissioning.`
    : `QC for project ${qc.projectId} has failed (${stats.failedCount} item(s)). Project returned to Installation for rework.`;

  await notifyRoleUsers(
    ['Admin', 'Director', 'Operations', 'Installations'],
    allPassed ? NotificationType.INSTALLATION_COMPLETED : NotificationType.INSTALLATION_SCHEDULED,
    notificationTitle,
    notificationBody,
    'qc_check',
    qcId,
    resolveCompanyId(),
  ).catch(() => {});

  const result: QCRecord = {
    ...qc,
    status: newStatus,
    checklistItems: items,
    ...stats,
    overallNotes: overallNotes || '',
    submittedAt: now,
    completedAt: now,
    updatedAt: now,
  };

  return { qc: result, projectTransition: targetStage };
}

// ═══════════════════════════════════════════════════════════
//  QUERIES
// ═══════════════════════════════════════════════════════════

/**
 * Get all QC checks for a project.
 */
export async function getProjectQCChecks(projectId: string): Promise<QCRecord[]> {
  const all = await getAll<QCRecord>(COLLECTIONS.QC_CHECKS);
  return all
    .filter((q) => q.projectId === projectId && !q.isDeleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Get the latest QC check for a project (most recently created).
 */
export async function getLatestQCCheck(projectId: string): Promise<QCRecord | null> {
  const checks = await getProjectQCChecks(projectId);
  return checks.length > 0 ? checks[0] : null;
}

/**
 * Determine if a project's QC is resolved (passed) or needs attention.
 */
export async function getQCStatus(projectId: string): Promise<{
  hasQC: boolean;
  latestStatus: QCCheckStatus | null;
  isResolved: boolean;
}> {
  const latest = await getLatestQCCheck(projectId);
  if (!latest) return { hasQC: false, latestStatus: null, isResolved: false };
  return {
    hasQC: true,
    latestStatus: latest.status,
    isResolved: latest.status === 'passed',
  };
}

// ═══════════════════════════════════════════════════════════
//  RESET QC (for loop-back re-inspection)
// ═══════════════════════════════════════════════════════════

/**
 * Reset a failed QC check to allow re-inspection after rework.
 * Sets status back to 'pending' and clears all pass/fail flags.
 */
export async function resetQCCheck(qcId: string): Promise<QCRecord> {
  const qc = await getOne<QCRecord>(COLLECTIONS.QC_CHECKS, qcId);
  if (!qc) throw new Error('QC check not found');
  if (qc.status !== 'failed') {
    throw new Error('Only failed QC checks can be reset');
  }

  const resetItems: QCChecklistItem[] = DEFAULT_QC_CHECKLIST.map((i) => ({ ...i }));
  const now = formatDate();

  await updateDocById(COLLECTIONS.QC_CHECKS, qcId, {
    status: 'pending',
    checklistItems: resetItems,
    passedCount: 0,
    failedCount: resetItems.length,
    totalItems: resetItems.length,
    overallNotes: '',
    submittedAt: undefined,
    completedAt: undefined,
    updatedAt: now,
  });

  await logActivity('QC', 'QC Check Reset', qcId, {
    entityName: `QC ${qcId}`,
    actionLabel: `QC check reset for re-inspection`,
    projectId: qc.projectId,
  });

  return { ...qc, status: 'pending', checklistItems: resetItems, passedCount: 0, failedCount: resetItems.length, totalItems: resetItems.length, overallNotes: '', submittedAt: undefined, completedAt: undefined, updatedAt: now };
}

export default {
  createQCCheck,
  updateQCChecklistItem,
  submitQCDecision,
  resetQCCheck,
  getProjectQCChecks,
  getLatestQCCheck,
  getQCStatus,
  DEFAULT_QC_CHECKLIST,
};
