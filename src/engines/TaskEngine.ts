/**
 * TaskEngine — Task & Escalation Engine (Section 7)
 *
 * Phase 0B: Full implementation.
 *
 * Architecture:
 * - Wraps src/lib/tasks.ts for CRUD operations
 * - SLA evaluation and escalation levels managed here
 * - Task dependencies are stored as embedded arrays on TaskRecord
 * - Escalation history is stored as embedded array on TaskRecord
 * - All data persisted to the 'tasks' Firestore collection
 */

import { collection, getDocs, query, where } from 'firebase/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { createDocWithId, fromDoc, genId, getOne, updateDocById, resolveWriteCompanyId } from '../lib/firestore';
import { sanitizeFirestoreData } from '../lib/sanitizer';
import { logActivity } from '../lib/workflow';
import { sendNotification } from '../lib/notifications';
import { useAppStore } from '../store/useAppStore';
import { NotificationType } from '../types';
import type { TaskRecord } from '../types';

// ── Types ──────────────────────────────────────────────────

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type EscalationLevel = 0 | 1 | 2 | 3 | 4;

export interface CreateTaskInput {
  title: string;
  description?: string;
  assigneeId: string;
  assigneeName: string;
  priority: TaskPriority;
  dueDate: string;
  linkedEntityId?: string;
  linkedEntityType?: string;
  caseId?: string;
  companyId: string;
  slaMinutes?: number;
}

export interface SLAStatus {
  level: EscalationLevel;
  consumedPercent: number;
  remainingMinutes: number;
  isBreached: boolean;
  nextLevel: EscalationLevel;
  nextLevelAt: string; // ISO date
}

export interface EscalationEntry {
  id: string;
  taskId: string;
  level: EscalationLevel;
  escalatedAt: string;
  escalatedTo?: string;
  reason?: string;
  resolvedAt?: string;
}

export interface TaskDependency {
  dependsOnTaskId: string;
  dependencyType: 'blocks' | 'blocked_by' | 'related';
  createdAt: string;
}

export interface TaskFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  linkedEntityId?: string;
  caseId?: string;
  escalationLevel?: EscalationLevel;
}

// ── SLA Matrix ─────────────────────────────────────────────

export const SLA_MATRIX: Record<TaskPriority, { slaHours: number; level1: number; level2: number; level3: number; level4: number }> = {
  low:      { slaHours: 72, level1: 57.6, level2: 72,  level3: 144, level4: 216 },
  medium:   { slaHours: 48, level1: 38.4, level2: 48,  level3: 96,  level4: 144 },
  high:     { slaHours: 24, level1: 19.2, level2: 24,  level3: 48,  level4: 72  },
  critical: { slaHours: 4,  level1: 3.2,  level2: 4,   level3: 8,   level4: 24  },
};

// ── Helpers ────────────────────────────────────────────────

export function generateTaskId(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TSK-${y}${m}${d}-${rnd}`;
}

export function getSLAForPriority(priority: TaskPriority) {
  return SLA_MATRIX[priority];
}

export function getEscalationLevel(elapsedHours: number, priority: TaskPriority): EscalationLevel {
  const sla = SLA_MATRIX[priority];
  if (elapsedHours >= sla.level4) return 4;
  if (elapsedHours >= sla.level3) return 3;
  if (elapsedHours >= sla.level2) return 2;
  if (elapsedHours >= sla.level1) return 1;
  return 0;
}

function nowUserId(): string {
  return useAppStore.getState().user?.id || 'system';
}

function nowUserName(): string {
  return useAppStore.getState().user?.name || 'System';
}

function resolveCompanyId(inputCompanyId?: string): string {
  if (inputCompanyId) return inputCompanyId;
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  return resolveWriteCompanyId();
}

// ── Engine Interface ──────────────────────────────────────

export interface TaskEngineAPI {
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  updateTask(taskId: string, updates: Partial<TaskRecord>): Promise<TaskRecord>;
  assignTask(taskId: string, assigneeId: string, assigneeName: string): Promise<TaskRecord>;
  completeTask(taskId: string): Promise<TaskRecord>;
  cancelTask(taskId: string): Promise<TaskRecord>;
  addDependency(taskId: string, dependsOnTaskId: string, dependencyType: TaskDependency['dependencyType']): Promise<void>;
  getTasksForEntity(entityId: string, entityType: string, companyId: string): Promise<TaskRecord[]>;
  getTasksForUser(userId: string, companyId: string, filters?: TaskFilters): Promise<TaskRecord[]>;
  getTasksForCase(caseId: string, companyId: string): Promise<TaskRecord[]>;
  escalateTask(taskId: string, reason?: string): Promise<TaskRecord>;
  getEscalationHistory(taskId: string): Promise<EscalationEntry[]>;
  evaluateSLA(task: Pick<TaskRecord, 'priority' | 'createdAt' | 'status'>): SLAStatus;
}

// ── Full Implementation ────────────────────────────────────

async function createTask(input: CreateTaskInput): Promise<TaskRecord> {
  const id = generateTaskId();
  const userId = nowUserId();
  const resolvedCompanyId = resolveCompanyId(input.companyId);
  const now = new Date().toISOString();

  const record: TaskRecord = {
    id,
    taskId: id,
    title: input.title.trim(),
    description: input.description?.trim() || '',
    assigneeId: input.assigneeId,
    assigneeName: input.assigneeName,
    priority: input.priority,
    status: 'open',
    dueDate: input.dueDate,
    linkedEntityId: input.linkedEntityId,
    linkedEntityType: input.linkedEntityType,
    caseId: input.caseId,
    companyId: resolvedCompanyId,
    escalationLevel: 0,
    slaMinutes: input.slaMinutes,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  await createDocWithId('tasks', id, sanitizeFirestoreData({
    ...record,
    dependencies: [] as TaskDependency[],
    escalationHistory: [] as EscalationEntry[],
  }));

  // Notify the assignee
  void sendNotification(
    input.assigneeId,
    NotificationType.TASK_ASSIGNED,
    'Task assigned',
    input.title.trim(),
    input.linkedEntityType || 'task',
    id,
    resolvedCompanyId,
  );

  void logActivity('Tasks', 'Task Created', id, {
    actionLabel: `Task "${input.title}" created`,
    entityName: input.title,
    assigneeId: input.assigneeId,
    priority: input.priority,
  });

  return record;
}

async function updateTask(taskId: string, updates: Partial<TaskRecord>): Promise<TaskRecord> {
  const userId = nowUserId();
  const existing = await getOne<TaskRecord>('tasks', taskId);
  if (!existing) {
    throw new Error(`Task ${taskId} not found.`);
  }

  await updateDocById('tasks', taskId, {
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  });

  const updated = await getOne<TaskRecord>('tasks', taskId);
  return updated!;
}

async function assignTask(taskId: string, assigneeId: string, assigneeName: string): Promise<TaskRecord> {
  const existing = await getOne<TaskRecord>('tasks', taskId);
  if (!existing) {
    throw new Error(`Task ${taskId} not found.`);
  }

  await updateDocById('tasks', taskId, {
    assigneeId,
    assigneeName,
    updatedAt: new Date().toISOString(),
    updatedBy: nowUserId(),
  });

  void sendNotification(
    assigneeId,
    NotificationType.TASK_ASSIGNED,
    'Task reassigned',
    existing.title,
    existing.linkedEntityType || 'task',
    taskId,
    existing.companyId,
  );

  const updated = await getOne<TaskRecord>('tasks', taskId);
  return updated!;
}

async function completeTask(taskId: string): Promise<TaskRecord> {
  const existing = await getOne<TaskRecord>('tasks', taskId);
  if (!existing) {
    throw new Error(`Task ${taskId} not found.`);
  }

  const now = new Date().toISOString();
  await updateDocById('tasks', taskId, {
    status: 'completed' as TaskStatus,
    completedAt: now,
    updatedAt: now,
    updatedBy: nowUserId(),
  });

  void logActivity('Tasks', 'Task Completed', taskId, {
    actionLabel: `Task "${existing.title}" completed`,
    entityName: existing.title,
  });

  const updated = await getOne<TaskRecord>('tasks', taskId);
  return updated!;
}

async function cancelTask(taskId: string): Promise<TaskRecord> {
  const existing = await getOne<TaskRecord>('tasks', taskId);
  if (!existing) {
    throw new Error(`Task ${taskId} not found.`);
  }

  const now = new Date().toISOString();
  await updateDocById('tasks', taskId, {
    status: 'cancelled' as TaskStatus,
    updatedAt: now,
    updatedBy: nowUserId(),
  });

  void logActivity('Tasks', 'Task Cancelled', taskId, {
    actionLabel: `Task "${existing.title}" cancelled`,
    entityName: existing.title,
  });

  const updated = await getOne<TaskRecord>('tasks', taskId);
  return updated!;
}

async function addDependency(
  taskId: string,
  dependsOnTaskId: string,
  dependencyType: TaskDependency['dependencyType'],
): Promise<void> {
  const existing = await getOne<any>('tasks', taskId);
  if (!existing) {
    throw new Error(`Task ${taskId} not found.`);
  }

  const dependencies: TaskDependency[] = existing.dependencies || [];
  // Avoid duplicate
  const alreadyExists = dependencies.some((d: TaskDependency) => d.dependsOnTaskId === dependsOnTaskId);
  if (alreadyExists) {
    throw new Error(`Dependency already exists between task ${taskId} and ${dependsOnTaskId}.`);
  }

  dependencies.push({
    dependsOnTaskId,
    dependencyType,
    createdAt: new Date().toISOString(),
  });

  await updateDocById('tasks', taskId, {
    dependencies,
    updatedAt: new Date().toISOString(),
    updatedBy: nowUserId(),
  });
}

async function getTasksForEntity(
  entityId: string,
  entityType: string,
  companyId: string,
): Promise<TaskRecord[]> {
  const resolvedCompanyId = resolveCompanyId(companyId);

  try {
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('companyId', '==', resolvedCompanyId),
      where('linkedEntityId', '==', entityId),
      where('linkedEntityType', '==', entityType),
      where('isDeleted', '==', false),
    ));
    return snap.docs.map((d) => fromDoc<TaskRecord>(d as any));
  } catch {
    // Index may not exist — fall back to client-side filtering
    const { getAll } = await import('../lib/firestore');
    const all = await getAll<TaskRecord>('tasks');
    return all.filter((t: any) =>
      t.companyId === resolvedCompanyId &&
      t.linkedEntityId === entityId &&
      t.linkedEntityType === entityType &&
      t.isDeleted !== true
    );
  }
}

async function getTasksForUser(
  userId: string,
  companyId: string,
  filters?: TaskFilters,
): Promise<TaskRecord[]> {
  const resolvedCompanyId = resolveCompanyId(companyId);

  try {
    const constraints = [
      where('companyId', '==', resolvedCompanyId),
      where('assigneeId', '==', userId),
      where('isDeleted', '==', false),
    ];

    if (filters?.status) {
      constraints.push(where('status', '==', filters.status));
    }

    const snap = await getDocs(query(collection(db, 'tasks'), ...constraints));
    let results = snap.docs.map((d) => fromDoc<TaskRecord>(d as any));

    // Client-side filtering for non-indexable fields
    if (filters?.priority) {
      results = results.filter((t) => t.priority === filters.priority);
    }
    if (filters?.caseId) {
      results = results.filter((t) => t.caseId === filters.caseId);
    }
    if (filters?.escalationLevel !== undefined && filters!.escalationLevel! > 0) {
      results = results.filter((t) => t.escalationLevel >= filters!.escalationLevel!);
    }
    if (filters?.linkedEntityId) {
      results = results.filter((t) => t.linkedEntityId === filters.linkedEntityId);
    }

    return results;
  } catch {
    const { getAll } = await import('../lib/firestore');
    const all = await getAll<TaskRecord>('tasks');
    let results = all.filter((t: any) =>
      t.companyId === resolvedCompanyId &&
      t.assigneeId === userId &&
      t.isDeleted !== true
    );

    if (filters?.status) results = results.filter((t) => t.status === filters.status);
    if (filters?.priority) results = results.filter((t) => t.priority === filters.priority);
    if (filters?.caseId) results = results.filter((t) => t.caseId === filters.caseId);
    if (filters?.linkedEntityId) results = results.filter((t) => t.linkedEntityId === filters.linkedEntityId);

    return results;
  }
}

async function getTasksForCase(caseId: string, companyId: string): Promise<TaskRecord[]> {
  const resolvedCompanyId = resolveCompanyId(companyId);

  try {
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('companyId', '==', resolvedCompanyId),
      where('caseId', '==', caseId),
      where('isDeleted', '==', false),
    ));
    return snap.docs.map((d) => fromDoc<TaskRecord>(d as any));
  } catch {
    const { getAll } = await import('../lib/firestore');
    const all = await getAll<TaskRecord>('tasks');
    return all.filter((t: any) =>
      t.companyId === resolvedCompanyId &&
      t.caseId === caseId &&
      t.isDeleted !== true
    );
  }
}

async function escalateTask(taskId: string, reason?: string): Promise<TaskRecord> {
  const existing = await getOne<any>('tasks', taskId);
  if (!existing) {
    throw new Error(`Task ${taskId} not found.`);
  }

  if (existing.status === 'completed' || existing.status === 'cancelled') {
    throw new Error(`Cannot escalate task ${taskId}: task is already ${existing.status}.`);
  }

  // Calculate current escalation level based on elapsed time
  const sla = evaluateSLA(existing);
  const newLevel = sla.level;

  if (newLevel <= (existing.escalationLevel || 0)) {
    // No higher escalation needed
    return existing;
  }

  const escalationHistory: EscalationEntry[] = existing.escalationHistory || [];
  const entry: EscalationEntry = {
    id: genId.generic('ESC'),
    taskId,
    level: newLevel,
    escalatedAt: new Date().toISOString(),
    escalatedTo: existing.assigneeId,
    reason: reason || `Escalated to level ${newLevel}`,
  };
  escalationHistory.push(entry);

  await updateDocById('tasks', taskId, {
    escalationLevel: newLevel,
    escalatedAt: entry.escalatedAt,
    escalatedTo: existing.assigneeId,
    escalationHistory,
    updatedAt: new Date().toISOString(),
    updatedBy: nowUserId(),
  });

  // Notify assignee about escalation
  void sendNotification(
    existing.assigneeId,
    NotificationType.ESCALATION_CRITICAL,
    `Task escalated to level ${newLevel}`,
    `${existing.title} has been escalated. ${reason || ''}`,
    existing.linkedEntityType || 'task',
    taskId,
    existing.companyId,
  );

  void logActivity('Tasks', 'Task Escalated', taskId, {
    actionLabel: `Task "${existing.title}" escalated to level ${newLevel}`,
    entityName: existing.title,
    escalationLevel: newLevel,
    reason,
  });

  const updated = await getOne<any>('tasks', taskId);
  return updated!;
}

async function getEscalationHistory(taskId: string): Promise<EscalationEntry[]> {
  const existing = await getOne<any>('tasks', taskId);
  if (!existing) return [];
  return existing.escalationHistory || [];
}

function evaluateSLA(task: Pick<TaskRecord, 'priority' | 'createdAt' | 'status'>): SLAStatus {
  if (task.status === 'completed' || task.status === 'cancelled') {
    return {
      level: 0,
      consumedPercent: 100,
      remainingMinutes: 0,
      isBreached: false,
      nextLevel: 0,
      nextLevelAt: '',
    };
  }

  const sla = SLA_MATRIX[task.priority];
  if (!sla) {
    return {
      level: 0,
      consumedPercent: 0,
      remainingMinutes: 0,
      isBreached: false,
      nextLevel: 0,
      nextLevelAt: '',
    };
  }

  const createdAt = task.createdAt ? new Date(task.createdAt).getTime() : Date.now();
  const elapsedMs = Date.now() - createdAt;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  const slaHours = sla.slaHours;
  const consumedPercent = Math.min(100, (elapsedHours / slaHours) * 100);
  const remainingMinutes = Math.max(0, (slaHours - elapsedHours) * 60);

  // Determine escalation level
  const level = getEscalationLevel(elapsedHours, task.priority);

  // Determine next escalation level
  const nextLevel = (level < 4 ? (level + 1) : 4) as EscalationLevel;

  // Calculate when next escalation triggers
  let nextLevelAt = '';
  if (nextLevel > level) {
    const slaConfig = SLA_MATRIX[task.priority];
    const nextLevelKey = `level${nextLevel}` as keyof typeof slaConfig;
    const nextLevelHours = slaConfig[nextLevelKey] as number;
    const remainingToNext = Math.max(0, nextLevelHours - elapsedHours);
    nextLevelAt = new Date(Date.now() + remainingToNext * 60 * 60 * 1000).toISOString();
  }

  return {
    level,
    consumedPercent,
    remainingMinutes,
    isBreached: level > 0,
    nextLevel,
    nextLevelAt,
  };
}

// ── Engine Export ────────────────────────────────────────────

export const taskEngine: TaskEngineAPI = {
  createTask,
  updateTask,
  assignTask,
  completeTask,
  cancelTask,
  addDependency,
  getTasksForEntity,
  getTasksForUser,
  getTasksForCase,
  escalateTask,
  getEscalationHistory,
  evaluateSLA,
};

export default taskEngine;
