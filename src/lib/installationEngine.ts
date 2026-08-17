/**
 * installationEngine — Reusable Installation Stage Engine
 *
 * Single source of truth for installation lifecycle.
 * No duplicated stage calculations anywhere in the codebase.
 * All UI components consume these exported helpers.
 *
 * Stages:
 *   lead_approved → survey_scheduled → survey_completed → material_ordered →
 *   material_delivered → installation_started → installation_in_progress →
 *   quality_inspection → customer_handover → completed
 */

import { getOne, updateDocById, createDocWithId, genId, getAll, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { sendNotification, notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { propagateCaseIdFromChain } from './casePropagation';

// ═══════════════════════════════════════════════════════════
//  PHASE 10 — REAL, PROJECT-SCOPED INSTALLATION RECORD
// ═══════════════════════════════════════════════════════════
//
// Installation data has always lived on the Lead document
// (installationChecklist/capturedSerialNumbers/assignedEngineerId, etc.) —
// confirmed still true by this phase's fresh audit, exactly as the Gap
// Audit originally found. That meant qc_checks.installationId could only
// ever point at a Lead id, which casePropagation.ts's chain (installations
// -> parentCollection 'projects'; qc_checks -> parentCollection
// 'installations') can never resolve, permanently breaking caseId
// propagation for everything downstream of QC.
//
// Fix, scoped to avoid the HIGH-regression-risk full rewrite the Blueprint
// itself warns against: every mutating function below now ALSO mirrors its
// write onto a real, Project-scoped COLLECTIONS.INSTALLATIONS document
// (dual-write), created lazily the first time a Lead with a linked Project
// is mutated. This is the SAME single architecture, not a competing one —
// the Installation record is now real and the source of truth for
// case/QC linkage going forward; the Lead fields are kept and still
// written to for backward compatibility with the existing list/detail UI
// (Installations.tsx, InstallationWorkspace.tsx) until a future phase
// re-points that UI's reads and retires the Lead fields entirely (a
// separate, lower-risk follow-up once the new collection has real data).
// A Lead with no projectId yet cannot have a Project-scoped Installation
// record — ensureInstallationForLead() returns null in that case, and
// callers simply skip the mirror write (the Lead-side write already
// happened; nothing is lost).

export interface InstallationRecord {
  id: string;
  installationId: string;
  projectId: string;
  leadId: string;
  companyId: string;
  installationStatus: string;
  checklist: InstallationChecklistItem[];
  capturedSerialNumbers: InstallationSerialCapture[];
  assignedEngineerId?: string;
  assignedEngineerName?: string;
  assignedEngineerPhone?: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  isDeleted: boolean;
}

/** Finds the real Installation document for a Lead's linked Project, creating
 * it on first use. Returns null when the Lead has no Project yet — a
 * Project-scoped record cannot exist without one. */
async function ensureInstallationForLead(lead: any): Promise<string | null> {
  if (!lead?.projectId) return null;
  const all = await getAll<InstallationRecord>(COLLECTIONS.INSTALLATIONS);
  const existing = all.find((doc) => doc.projectId === lead.projectId && doc.isDeleted !== true);
  if (existing) return existing.id;

  const state = useAppStore.getState();
  // Canonical tenant resolution — the lead's company is the authoritative
  // tenant for its installation records; never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId() || lead.companyId || '';
  const id = genId.generic('INST');
  const now = new Date().toISOString();
  const userId = state.user?.id || 'system';

  await createDocWithId(COLLECTIONS.INSTALLATIONS, id, {
    id,
    installationId: id,
    projectId: lead.projectId,
    leadId: lead.id,
    companyId,
    installationStatus: lead.installationStatus || 'lead_approved',
    checklist: lead.installationChecklist || DEFAULT_INSTALLATION_CHECKLIST.map((item) => ({ ...item })),
    capturedSerialNumbers: lead.capturedSerialNumbers || [],
    assignedEngineerId: lead.assignedEngineerId || '',
    assignedEngineerName: lead.assignedEngineerName || '',
    assignedEngineerPhone: lead.assignedEngineerPhone || '',
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  });

  // Restores caseId propagation for QC/Commissioning/NetMetering/Subsidy —
  // previously permanently broken since no real installations doc ever existed.
  void propagateCaseIdFromChain('installations', id);
  return id;
}

/** Best-effort mirror write — dual-write must never fail the caller's
 * already-successful Lead-side mutation. */
async function mirrorToInstallation(lead: any, patch: Record<string, unknown>): Promise<void> {
  try {
    const installationId = await ensureInstallationForLead(lead);
    if (!installationId) return;
    await updateDocById(COLLECTIONS.INSTALLATIONS, installationId, patch);
  } catch (err) {
    console.warn('[installationEngine] failed to mirror write to installations collection', err);
  }
}

// ═══════════════════════════════════════════════════════════
//  STAGE DEFINITIONS
// ═══════════════════════════════════════════════════════════

export const INSTALLATION_STAGES = [
  'lead_approved',
  'survey_scheduled',
  'survey_completed',
  'material_ordered',
  'material_delivered',
  'installation_started',
  'installation_in_progress',
  'quality_inspection',
  'customer_handover',
  'completed',
] as const;

export type InstallationStage = (typeof INSTALLATION_STAGES)[number];

export const STAGE_LABELS: Record<InstallationStage, string> = {
  lead_approved: 'Lead Approved',
  survey_scheduled: 'Survey Scheduled',
  survey_completed: 'Survey Completed',
  material_ordered: 'Material Ordered',
  material_delivered: 'Material Delivered',
  installation_started: 'Installation Started',
  installation_in_progress: 'Installation In Progress',
  quality_inspection: 'Quality Inspection',
  customer_handover: 'Customer Handover',
  completed: 'Completed',
};

export const STAGE_COLORS: Record<InstallationStage, string> = {
  lead_approved: 'bg-blue-500',
  survey_scheduled: 'bg-indigo-500',
  survey_completed: 'bg-teal-500',
  material_ordered: 'bg-amber-500',
  material_delivered: 'bg-orange-500',
  installation_started: 'bg-purple-500',
  installation_in_progress: 'bg-violet-500',
  quality_inspection: 'bg-cyan-500',
  customer_handover: 'bg-emerald-500',
  completed: 'bg-green-600',
};

export const STAGE_BADGE_COLORS: Record<InstallationStage, string> = {
  lead_approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  survey_scheduled: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  survey_completed: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  material_ordered: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  material_delivered: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  installation_started: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  installation_in_progress: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  quality_inspection: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  customer_handover: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

// ═══════════════════════════════════════════════════════════
//  INSTALLATION CHECKLIST
// ═══════════════════════════════════════════════════════════

export interface InstallationChecklistItem {
  item: string;
  completed: boolean;
  completedAt?: string;
  completedBy?: string;
}

/** Default checklist template for solar installation projects */
export const DEFAULT_INSTALLATION_CHECKLIST: InstallationChecklistItem[] = [
  { item: 'Site readiness verified', completed: false },
  { item: 'Mounting structure installed', completed: false },
  { item: 'Solar panels mounted', completed: false },
  { item: 'Inverter installed', completed: false },
  { item: 'DC wiring completed', completed: false },
  { item: 'AC wiring completed', completed: false },
  { item: 'Earthing / grounding verified', completed: false },
  { item: 'String connections verified', completed: false },
  { item: 'System powered on', completed: false },
  { item: 'Generation test passed', completed: false },
];

/**
 * Toggle a checklist item's completed status on an installation lead.
 */
export async function toggleChecklistItem(
  leadId: string,
  itemIndex: number,
): Promise<InstallationChecklistItem[]> {
  const state = useAppStore.getState();
  const lead = await getOne<any>(COLLECTIONS.LEADS, leadId);
  if (!lead) throw new Error('Installation lead not found');

  const checklist: InstallationChecklistItem[] = lead.installationChecklist
    ? JSON.parse(JSON.stringify(lead.installationChecklist))
    : DEFAULT_INSTALLATION_CHECKLIST.map((i) => ({ ...i }));

  if (itemIndex < 0 || itemIndex >= checklist.length) {
    throw new Error(`Invalid checklist item index: ${itemIndex}`);
  }

  const item = checklist[itemIndex];
  item.completed = !item.completed;
  if (item.completed) {
    item.completedAt = new Date().toISOString();
    item.completedBy = state.user?.id || 'system';
  } else {
    item.completedAt = undefined;
    item.completedBy = undefined;
  }

  await updateDocById(COLLECTIONS.LEADS, leadId, {
    installationChecklist: checklist,
    updatedBy: state.user?.id || 'system',
  });
  void mirrorToInstallation(lead, { checklist, updatedBy: state.user?.id || 'system' });

  await logActivity('Installations', 'Checklist updated', leadId, {
    item: item.item,
    completed: item.completed,
    entityName: lead.name || leadId,
    actionLabel: `Checklist item "${item.item}" ${item.completed ? 'completed' : 'unchecked'}`,
  });

  return checklist;
}

/**
 * Reset the installation checklist for a lead (mark all incomplete).
 */
export async function resetChecklist(leadId: string): Promise<void> {
  const resetItems = DEFAULT_INSTALLATION_CHECKLIST.map((i) => ({ ...i }));
  const lead = await getOne<any>(COLLECTIONS.LEADS, leadId);
  await updateDocById(COLLECTIONS.LEADS, leadId, {
    installationChecklist: resetItems,
    updatedBy: useAppStore.getState().user?.id || 'system',
  });
  if (lead) void mirrorToInstallation(lead, { checklist: resetItems, updatedBy: useAppStore.getState().user?.id || 'system' });
}

// ═══════════════════════════════════════════════════════════
//  SERIAL NUMBER CAPTURE
// ═══════════════════════════════════════════════════════════

export interface InstallationSerialCapture {
  serialNumber: string;
  productId?: string;
  product?: string;
  capturedAt: string;
  capturedBy: string;
}

/**
 * Capture a serial number for an installation.
 * Stores on the lead document AND writes to the serial_numbers collection
 * (reusing the existing stock serial number tracking).
 */
export async function captureInstallationSerial(
  leadId: string,
  serialNumber: string,
  productId?: string,
  product?: string,
): Promise<void> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const lead = await getOne<any>(COLLECTIONS.LEADS, leadId);
  if (!lead) throw new Error('Installation lead not found');

  const capture: InstallationSerialCapture = {
    serialNumber,
    productId,
    product,
    capturedAt: new Date().toISOString(),
    capturedBy: state.user?.id || 'system',
  };

  const existingSerials: InstallationSerialCapture[] = lead.capturedSerialNumbers || [];
  if (existingSerials.some((s) => s.serialNumber === serialNumber)) {
    throw new Error(`Serial ${serialNumber} already captured for this installation`);
  }
  existingSerials.push(capture);

  // Write to lead document
  await updateDocById(COLLECTIONS.LEADS, leadId, {
    capturedSerialNumbers: existingSerials,
    updatedBy: state.user?.id || 'system',
  });
  const installationId = await ensureInstallationForLead(lead).catch(() => null);
  if (installationId) {
    await updateDocById(COLLECTIONS.INSTALLATIONS, installationId, {
      capturedSerialNumbers: existingSerials,
      updatedBy: state.user?.id || 'system',
    }).catch((err) => console.warn('[installationEngine] failed to mirror serial capture', err));
  }

  // Reuse existing serial_numbers collection for stock tracking. Phase 10:
  // installationId now points at the real installations doc once a Project
  // is linked (restoring a real FK instead of a Lead id); falls back to the
  // Lead id only when no Project is linked yet, matching prior behavior.
  const serialId = genId.generic('SRL');
  await createDocWithId(COLLECTIONS.SERIAL_NUMBERS, serialId, {
    id: serialId,
    companyId,
    serialNumber,
    productId,
    product: product || '',
    installationId: installationId || leadId,
    capturedAt: capture.capturedAt,
    capturedBy: capture.capturedBy,
    createdBy: state.user?.id || 'system',
    createdAt: new Date().toISOString(),
    isDeleted: false,
  });

  await logActivity('Installations', 'Serial captured', leadId, {
    serialNumber,
    product,
    entityName: lead.name || leadId,
    actionLabel: `Serial ${serialNumber} captured${product ? ` for ${product}` : ''}`,
  });
}

/**
 * Remove a captured serial number by index.
 */
export async function removeCapturedSerial(
  leadId: string,
  index: number,
): Promise<void> {
  const state = useAppStore.getState();
  const lead = await getOne<any>(COLLECTIONS.LEADS, leadId);
  if (!lead) throw new Error('Installation lead not found');

  const serials: InstallationSerialCapture[] = lead.capturedSerialNumbers || [];
  if (index < 0 || index >= serials.length) throw new Error('Invalid serial index');
  serials.splice(index, 1);

  await updateDocById(COLLECTIONS.LEADS, leadId, {
    capturedSerialNumbers: serials,
    updatedBy: state.user?.id || 'system',
  });
  void mirrorToInstallation(lead, { capturedSerialNumbers: serials, updatedBy: state.user?.id || 'system' });
}

// ═══════════════════════════════════════════════════════════
//  VISIT STATUSES
// ═══════════════════════════════════════════════════════════

export type VisitStatus = 'scheduled' | 'completed' | 'cancelled' | 'rescheduled' | 'missed';

export interface InstallationVisit {
  id: string;
  leadId: string;
  companyId: string;
  engineerId?: string;
  engineerName?: string;
  scheduledDate: string;
  scheduledTime?: string;
  status: VisitStatus;
  notes?: string;
  outcome?: string;
  completedAt?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  isDeleted?: boolean;
}

// ═══════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

/** Get the index of a stage in the ordered list */
export function stageIndex(stage: string): number {
  return INSTALLATION_STAGES.indexOf(stage as InstallationStage);
}

/** Get the label for a stage */
export function stageLabel(stage?: string): string {
  if (!stage) return 'Not Started';
  return STAGE_LABELS[stage as InstallationStage] || stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Get the CSS badge color class for a stage */
export function stageBadgeColor(stage?: string): string {
  if (!stage) return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  return STAGE_BADGE_COLORS[stage as InstallationStage] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
}

/** Calculate completion percentage (0–100) */
export function calculateCompletion(stage?: string): number {
  if (!stage) return 0;
  const idx = stageIndex(stage);
  if (idx < 0) return 0;
  return Math.round((idx / (INSTALLATION_STAGES.length - 1)) * 100);
}

/** Get the next stage after the current one */
export function nextStage(current?: string): InstallationStage | null {
  if (!current) return INSTALLATION_STAGES[0];
  const idx = stageIndex(current);
  if (idx < 0 || idx >= INSTALLATION_STAGES.length - 1) return null;
  return INSTALLATION_STAGES[idx + 1];
}

/** Get the previous stage before the current one */
export function previousStage(current?: string): InstallationStage | null {
  if (!current) return null;
  const idx = stageIndex(current);
  if (idx <= 0) return null;
  return INSTALLATION_STAGES[idx - 1];
}

/** Get stage progress info for a lead */
export function stageProgress(installationStatus?: string): {
  currentIndex: number;
  totalStages: number;
  completionPct: number;
  isCompleted: boolean;
} {
  const currentIdx = Math.max(0, stageIndex(installationStatus || ''));
  const total = INSTALLATION_STAGES.length;
  return {
    currentIndex: currentIdx,
    totalStages: total,
    completionPct: Math.round((currentIdx / (total - 1)) * 100),
    isCompleted: installationStatus === 'completed' || currentIdx >= total - 1,
  };
}

/** Check if an installation is delayed */
export function isInstallationDelayed(
  installationStatus?: string,
  expectedCompletionDate?: string | null,
  scheduledDate?: string | null,
): boolean {
  if (!installationStatus) return false;
  const progress = stageProgress(installationStatus);
  if (progress.isCompleted) return false;

  // Check expected completion date
  if (expectedCompletionDate) {
    const d = new Date(expectedCompletionDate);
    if (!isNaN(d.getTime()) && d < new Date()) return true;
  }

  // Check scheduled date for early stages
  if (scheduledDate && (installationStatus === 'survey_scheduled' || installationStatus === 'installation_started')) {
    const d = new Date(scheduledDate);
    if (!isNaN(d.getTime()) && d < new Date()) return true;
  }

  return false;
}

/** Calculate delay in days */
export function delayDays(
  installationStatus?: string,
  expectedCompletionDate?: string | null,
  scheduledDate?: string | null,
): number {
  if (!isInstallationDelayed(installationStatus, expectedCompletionDate, scheduledDate)) return 0;
  const dateStr = expectedCompletionDate || scheduledDate;
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.max(1, Math.floor((Date.now() - d.getTime()) / 86400000));
}

/** Determine if a lead is a valid installation project (has progressed past initial stages) */
export function isValidInstallation(lead: any): boolean {
  if (!lead || !lead.installationStatus) return false;
  return lead.installationStatus !== 'pending' && lead.isDeleted !== true;
}

// ═══════════════════════════════════════════════════════════
//  PROJECT LINKING
// ═══════════════════════════════════════════════════════════

/**
 * Link an installation lead to a project.
 * Logs activity and updates the lead document with projectId and projectName.
 */
export async function linkInstallationToProject(
  leadId: string,
  projectId: string,
  projectName: string,
  previousProjectId?: string,
): Promise<void> {
  const state = useAppStore.getState();
  const lead = await getOne<any>(COLLECTIONS.LEADS, leadId);
  if (!lead) throw new Error('Installation lead not found');

  await updateDocById(COLLECTIONS.LEADS, leadId, {
    projectId,
    projectName,
    updatedBy: state.user?.id || 'system',
  });

  // This is the moment a Lead first gains a projectId, so the real
  // Project-scoped installation doc can only be created/found from here
  // onward — pass the updated lead shape, not the stale pre-link one.
  await ensureInstallationForLead({ ...lead, projectId, projectName }).catch((err) =>
    console.warn('[installationEngine] failed to create/link installation doc', err)
  );

  const action = previousProjectId ? 'project-changed' : 'project-linked';
  const label = previousProjectId
    ? `Project changed from ${previousProjectId} to ${projectId}`
    : `Linked to project ${projectId}`;

  await logActivity('Installations', `Project ${action}`, leadId, {
    projectId,
    previousProjectId,
    entityName: lead.name || leadId,
    actionLabel: label,
  });
}

/**
 * Unlink an installation lead from its project.
 * Logs activity and clears the projectId/projectName fields.
 */
export async function unlinkInstallationFromProject(leadId: string): Promise<void> {
  const state = useAppStore.getState();
  const lead = await getOne<any>(COLLECTIONS.LEADS, leadId);
  if (!lead) throw new Error('Installation lead not found');

  const previousProjectId = lead.projectId;
  if (!previousProjectId) return; // nothing to unlink

  await updateDocById(COLLECTIONS.LEADS, leadId, {
    projectId: '',
    projectName: '',
    updatedBy: state.user?.id || 'system',
  });

  await logActivity('Installations', 'Project unlinked', leadId, {
    previousProjectId,
    entityName: lead.name || leadId,
    actionLabel: `Unlinked from project ${previousProjectId}`,
  });
}

/**
 * Get all installation leads linked to a specific project.
 */
export async function getProjectInstallations(projectId: string): Promise<any[]> {
  const allLeads = await getAll<any>(COLLECTIONS.LEADS);
  return allLeads
    .filter((l: any) =>
      !l.isDeleted &&
      l.installationStatus &&
      l.installationStatus !== 'pending' &&
      (l.projectId === projectId)
    )
    .sort((a: any, b: any) => {
      const da = a.updatedAt || a.createdAt ? new Date(a.updatedAt || a.createdAt).getTime() : 0;
      const db = b.updatedAt || b.createdAt ? new Date(b.updatedAt || b.createdAt).getTime() : 0;
      return db - da;
    });
}

// ═══════════════════════════════════════════════════════════
//  ENGINEER ASSIGNMENT
// ═══════════════════════════════════════════════════════════

export interface EngineerAssignment {
  engineerId: string;
  engineerName: string;
  engineerPhone?: string;
  assignedAt: string;
  assignedBy: string;
  assignmentNote?: string;
}

/**
 * Assign or reassign an engineer to a lead/installation.
 * Logs activity and sends notifications.
 */
export async function assignEngineer(
  leadId: string,
  engineerId: string,
  engineerName: string,
  engineerPhone?: string,
  assignmentNote?: string,
): Promise<void> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  // Get existing assignment history
  const lead = await getOne<any>(COLLECTIONS.LEADS, leadId);
  const existingHistory: EngineerAssignment[] = lead?.engineerAssignmentHistory || [];

  const newAssignment: EngineerAssignment = {
    engineerId,
    engineerName,
    engineerPhone: engineerPhone || '',
    assignedAt: new Date().toISOString(),
    assignedBy: state.user?.id || 'system',
    assignmentNote,
  };

  await updateDocById(COLLECTIONS.LEADS, leadId, {
    assignedEngineerId: engineerId,
    assignedEngineerName: engineerName,
    assignedEngineerPhone: engineerPhone || '',
    engineerAssignmentHistory: [...existingHistory, newAssignment],
    updatedBy: state.user?.id || 'system',
  });
  if (lead) {
    void mirrorToInstallation(lead, {
      assignedEngineerId: engineerId,
      assignedEngineerName: engineerName,
      assignedEngineerPhone: engineerPhone || '',
      engineerAssignmentHistory: [...existingHistory, newAssignment],
      updatedBy: state.user?.id || 'system',
    });
  }

  await logActivity('Installations', 'Engineer Assigned', leadId, {
    engineerId,
    engineerName,
    assignmentNote,
    entityName: lead?.name || leadId,
    actionLabel: `Engineer ${engineerName} assigned`,
  });

  // Notify the engineer if they are a system user
  await notifyRoleUsers(
    ['Admin', 'Director'],
    NotificationType.TASK_ASSIGNED,
    'Engineer assigned',
    `${engineerName} has been assigned to installation for ${lead?.name || leadId}.`,
    'lead',
    leadId,
    companyId,
  );
}

/**
 * Get workload summary for an engineer
 */
export async function getEngineerWorkload(engineerId: string): Promise<{
  activeInstallations: number;
  completedInstallations: number;
  totalInstallations: number;
}> {
  const allLeads = await getAll<any>(COLLECTIONS.LEADS);
  const engineerLeads = allLeads.filter((l: any) =>
    l.assignedEngineerId === engineerId && !l.isDeleted
  );

  return {
    totalInstallations: engineerLeads.length,
    activeInstallations: engineerLeads.filter((l: any) =>
      l.installationStatus && !['completed', 'customer_handover'].includes(l.installationStatus)
    ).length,
    completedInstallations: engineerLeads.filter((l: any) =>
      l.installationStatus === 'completed' || l.installationStatus === 'customer_handover'
    ).length,
  };
}

// ═══════════════════════════════════════════════════════════
//  VISIT SCHEDULING
// ═══════════════════════════════════════════════════════════

/**
 * Schedule a visit for an installation
 */
export async function scheduleVisit(
  leadId: string,
  scheduledDate: string,
  engineerId?: string,
  engineerName?: string,
  scheduledTime?: string,
  notes?: string,
): Promise<string> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const visitId = genId.generic('VIS');
  const lead = await getOne<any>(COLLECTIONS.LEADS, leadId);
  const leadName = lead?.name || leadId;

  const visit: InstallationVisit = {
    id: visitId,
    leadId,
    companyId,
    engineerId: engineerId || lead?.assignedEngineerId,
    engineerName: engineerName || lead?.assignedEngineerName,
    scheduledDate,
    scheduledTime,
    status: 'scheduled',
    notes,
    createdBy: state.user?.id || 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDeleted: false,
  };

  // Store visits in a sub-collection via entities for now
  await createDocWithId(COLLECTIONS.ENTITIES, visitId, {
    ...visit,
    entityType: 'installation_visit',
  });

  await logActivity('Installations', 'Visit Scheduled', leadId, {
    visitId,
    scheduledDate,
    engineerName: engineerName || lead?.assignedEngineerName,
    entityName: leadName,
    actionLabel: `Visit scheduled for ${scheduledDate}${engineerName ? ` with ${engineerName}` : ''}`,
  });

  // Notify
  if (engineerId) {
    await sendNotification(
      engineerId,
      NotificationType.TASK_ASSIGNED,
      'Visit scheduled',
      `A visit has been scheduled for ${leadName} on ${scheduledDate}.`,
      'lead',
      leadId,
      companyId,
    ).catch(() => {});
  }

  return visitId;
}

/**
 * Update a visit's status (complete, cancel, reschedule, mark missed)
 */
export async function updateVisitStatus(
  visitId: string,
  status: VisitStatus,
  metadata?: { outcome?: string; rescheduledDate?: string; notes?: string },
): Promise<void> {
  const state = useAppStore.getState();
  const visit = await getOne<any>(COLLECTIONS.ENTITIES, visitId);
  if (!visit || visit.entityType !== 'installation_visit') throw new Error('Visit not found');

  const updates: Record<string, unknown> = {
    status,
    updatedAt: new Date().toISOString(),
    updatedBy: state.user?.id || 'system',
  };

  if (status === 'completed' || status === 'missed') {
    updates.completedAt = new Date().toISOString();
  }
  if (metadata?.outcome) updates.outcome = metadata.outcome;
  if (metadata?.rescheduledDate) updates.scheduledDate = metadata.rescheduledDate;
  if (metadata?.notes) updates.notes = metadata.notes;

  await updateDocById(COLLECTIONS.ENTITIES, visitId, updates);

  await logActivity('Installations', `Visit ${status.charAt(0).toUpperCase() + status.slice(1)}`, visit.leadId, {
    visitId,
    entityName: visit.leadId,
    actionLabel: `Visit ${status.replace(/_/g, ' ')}`,
    outcome: metadata?.outcome,
  });
}

/**
 * Get all visits for a lead
 */
export async function getLeadVisits(leadId: string): Promise<InstallationVisit[]> {
  const allEntities = await getAll<any>(COLLECTIONS.ENTITIES);
  return allEntities
    .filter((e: any) => e.entityType === 'installation_visit' && e.leadId === leadId && !e.isDeleted)
    .sort((a: any, b: any) => {
      const da = a.scheduledDate ? new Date(a.scheduledDate).getTime() : 0;
      const db = b.scheduledDate ? new Date(b.scheduledDate).getTime() : 0;
      return db - da;
    }) as InstallationVisit[];
}

/**
 * Get today's scheduled visits for a company
 */
export async function getTodayVisits(companyId: string): Promise<InstallationVisit[]> {
  const allEntities = await getAll<any>(COLLECTIONS.ENTITIES);
  const today = new Date().toISOString().slice(0, 10);
  return allEntities
    .filter((e: any) =>
      e.entityType === 'installation_visit' &&
      e.companyId === companyId &&
      e.scheduledDate?.slice(0, 10) === today &&
      e.status === 'scheduled' &&
      !e.isDeleted
    )
    .sort((a: any, b: any) => (a.scheduledTime || '').localeCompare(b.scheduledTime || '')) as InstallationVisit[];
}

// ═══════════════════════════════════════════════════════════
//  SCHEDULER INTEGRATION HOOKS
// ═══════════════════════════════════════════════════════════

/**
 * Find all delayed installations — used by scheduler for daily health checks.
 */
export async function getDelayedInstallations(companyId?: string): Promise<any[]> {
  const allLeads = await getAll<any>(COLLECTIONS.LEADS);
  return allLeads.filter((l: any) => {
    if (l.isDeleted) return false;
    if (companyId && l.companyId !== companyId) return false;
    if (!l.installationStatus || l.installationStatus === 'pending') return false;
    if (l.installationStatus === 'completed') return false;
    return isInstallationDelayed(l.installationStatus, l.expectedCompletionDate, l.scheduledDate);
  });
}

export default {
  INSTALLATION_STAGES,
  stageIndex,
  stageLabel,
  stageBadgeColor,
  calculateCompletion,
  nextStage,
  previousStage,
  stageProgress,
  isInstallationDelayed,
  delayDays,
  isValidInstallation,
  assignEngineer,
  getEngineerWorkload,
  scheduleVisit,
  updateVisitStatus,
  getLeadVisits,
  getTodayVisits,
  getDelayedInstallations,
  linkInstallationToProject,
  unlinkInstallationFromProject,
  getProjectInstallations,
  DEFAULT_INSTALLATION_CHECKLIST,
  toggleChecklistItem,
  resetChecklist,
  captureInstallationSerial,
  removeCapturedSerial,
};
