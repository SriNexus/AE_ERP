/**
 * monitoringWorkflow — Generation Readings Workflow
 *
 * Generation readings are immutable historical records of kWh generation
 * captured manually during AMC service visits. No state machine is needed;
 * readings are created once and stored permanently.
 *
 * State: immutable (no transitions)
 * Pattern: create + validate only (follows same architecture as other workflows)
 */

import { createDocWithId, genId } from './firestore';
import { advanceProjectStage } from './projectStageTransition';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity, resolveWorkflowCompanyId, text } from './workflow';
import { getNotificationUsersByRoles, notifyUsersOnce } from './notifications';
import { NotificationType } from '../types';
import { propagateCaseIdFromChain } from './casePropagation';

// ── Types ──────────────────────────────────────────────────────

export interface GenerationReadingRecord {
  id: string;
  companyId: string;
  projectId: string;
  projectName?: string;
  readingDate: string;
  readingKwh: number;
  notes?: string;
  recordedBy: string;
  recordedByName?: string;
  amcContractId?: string;
  amcContractNumber?: string;
  linkedServiceTicketId?: string;
  linkedServiceTicketNumber?: string;
  createdAt: string;
  updatedAt: string;
  statusHistory?: GenerationReadingStatusEntry[];
}

export interface GenerationReadingStatusEntry {
  status: string;
  timestamp: string;
  userId: string;
  userName: string;
  notes?: string;
}

// ── Validation ─────────────────────────────────────────────────

export interface ReadingValidation {
  valid: boolean;
  errors: string[];
}

export function validateReading(data: Partial<GenerationReadingRecord>): ReadingValidation {
  const errors: string[] = [];

  if (!data.projectId) errors.push('Project is required');
  if (!data.readingDate) errors.push('Reading date is required');
  if (data.readingKwh === undefined || data.readingKwh === null || data.readingKwh < 0) {
    errors.push('Generation (kWh) must be a non-negative number');
  }
  if (data.readingKwh !== undefined && data.readingKwh > 999999) {
    errors.push('Generation value is unrealistically high');
  }

  return { valid: errors.length === 0, errors };
}

// ── Notification helpers ───────────────────────────────────────

const READING_NOTIFICATION_ROLES = ['admin', 'manager', 'servicetechnician'];

// ── Workflow Functions ─────────────────────────────────────────

export async function createReading(
  input: Partial<GenerationReadingRecord> & {
    projectId: string;
    readingDate: string;
    readingKwh: number;
  },
): Promise<{ data: GenerationReadingRecord | null; error?: string }> {
  const validation = validateReading(input);
  if (!validation.valid) {
    return { data: null, error: validation.errors.join('; ') };
  }

  const companyId = resolveWorkflowCompanyId();
  const state = useAppStore.getState();
  const userId = state.user?.id || 'system';
  const userName = state.user?.name || 'System';
  const now = new Date().toISOString();

  const id = genId.generic('GEN');

  const entry: GenerationReadingRecord = {
    id,
    companyId,
    projectId: input.projectId,
    projectName: text(input.projectName),
    readingDate: input.readingDate,
    readingKwh: input.readingKwh,
    notes: text(input.notes),
    recordedBy: userId,
    recordedByName: userName,
    amcContractId: text(input.amcContractId),
    amcContractNumber: text(input.amcContractNumber),
    linkedServiceTicketId: text(input.linkedServiceTicketId),
    linkedServiceTicketNumber: text(input.linkedServiceTicketNumber),
    createdAt: now,
    updatedAt: now,
    statusHistory: [
      {
        status: 'Recorded',
        timestamp: now,
        userId,
        userName,
        notes: 'Generation reading recorded',
      },
    ],
  };

  try {
    await createDocWithId(COLLECTIONS.GENERATION_READINGS, id, entry);
    await advanceProjectStage(input.projectId, 'Monitoring', userId, 'Generation reading ' + id + ' recorded', now);

    // Audit log
    await logActivity('monitoring', 'generation_reading_recorded', id, {
      projectId: input.projectId,
      readingKwh: input.readingKwh,
      readingDate: input.readingDate,
      actionLabel: 'Generation Reading Recorded',
    });

    // Notify relevant users
    const users = await getNotificationUsersByRoles(READING_NOTIFICATION_ROLES, companyId);
    await notifyUsersOnce(
      users,
      NotificationType.INSTALLATION_COMPLETED,
      'New Generation Reading',
      `${input.readingKwh} kWh recorded for project ${input.projectName || input.projectId}`,
      'generation_reading',
      id,
      companyId,
    );

    // Phase 3B: Propagate caseId from project chain to generation reading
    void propagateCaseIdFromChain('generation_readings', id);

    return { data: entry };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Failed to create reading' };
  }
}
