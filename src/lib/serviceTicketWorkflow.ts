/**
 * serviceTicketWorkflow.ts — Service Ticket Workflow
 *
 * State machine: Open → InProgress → Resolved → Closed / Cancelled
 * Immutable ticket history with audit logging and notifications.
 */

import { COLLECTIONS } from './firebase';
import { advanceProjectStage } from './projectStageTransition';
import { createDocWithId, getOne, updateDocById } from './firestore';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { propagateCaseIdFromChain } from './casePropagation';

// ── Types ─────────────────────────────────────────────────────

export type TicketStatus = 'Open' | 'InProgress' | 'Resolved' | 'Closed' | 'Cancelled';

export interface TicketStatusHistoryEntry {
  status: TicketStatus;
  changedAt: string;
  changedBy: string;
  note?: string;
}

export interface ServiceTicketRecord {
  id: string;
  companyId: string;
  projectId: string;
  projectName: string;
  customerId: string;
  customerName: string;
  ticketNumber: string;
  issueType: string;
  description: string;
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  reportedDate: string;
  resolvedDate?: string;
  closedDate?: string;
  assignedTechnician?: string;
  assignedTechnicianName?: string;
  amcContractId?: string;
  amcContractNumber?: string;
  notes: string;
  status: TicketStatus;
  statusHistory: TicketStatusHistoryEntry[];
  inProgressAt?: string;
  inProgressBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  closedAt?: string;
  closedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  isDeleted: boolean;
}

export interface ServiceTicketCreateInput {
  projectId: string;
  projectName: string;
  customerId: string;
  customerName: string;
  issueType: string;
  description: string;
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  assignedTechnician?: string;
  assignedTechnicianName?: string;
  amcContractId?: string;
  amcContractNumber?: string;
  notes?: string;
}

// ── State machine ─────────────────────────────────────────────

const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  Open: ['InProgress', 'Cancelled'],
  InProgress: ['Resolved', 'Cancelled'],
  Resolved: ['Closed', 'Cancelled'],
  Closed: [],
  Cancelled: [],
};

export function isValidTransition(from: TicketStatus, to: TicketStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Create ────────────────────────────────────────────────────

export async function createServiceTicket(input: ServiceTicketCreateInput): Promise<ServiceTicketRecord> {
  if (!input.projectId) throw new Error('Project is required');
  if (!input.customerName) throw new Error('Customer name is required');
  if (!input.issueType) throw new Error('Issue type is required');
  if (!input.description) throw new Error('Description is required');

  const state = useAppStore.getState();
  const companyId = state.activeCompanyId || state.company?.id || '';
  if (!companyId) throw new Error('Active company is required');

  const id = `STK-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`.toUpperCase();
  const now = new Date().toISOString();
  const userId = state.user?.id || 'system';

  const record: ServiceTicketRecord = {
    id,
    companyId,
    projectId: input.projectId,
    projectName: input.projectName,
    customerId: input.customerId,
    customerName: input.customerName,
    ticketNumber: id,
    issueType: input.issueType,
    description: input.description,
    priority: input.priority,
    reportedDate: now,
    assignedTechnician: input.assignedTechnician,
    assignedTechnicianName: input.assignedTechnicianName,
    amcContractId: input.amcContractId,
    amcContractNumber: input.amcContractNumber,
    notes: input.notes || '',
    status: 'Open',
    statusHistory: [{ status: 'Open', changedAt: now, changedBy: userId }],
    createdBy: userId,
    createdAt: now,
    updatedBy: userId,
    updatedAt: now,
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.SERVICE_TICKETS, id, record);
  await advanceProjectStage(input.projectId, 'Service', userId, 'Service ticket ' + id + ' created', now);

  await logActivity('ServiceTicket', 'Created', id, {
    entityName: `${input.issueType} - ${input.customerName}`,
    actionLabel: 'Service ticket created',
    projectId: input.projectId,
  });

  await notifyRoleUsers(
    ['Operations', 'Director', 'ServiceTechnician'],
    NotificationType.TASK_ASSIGNED,
    'Service ticket created',
    `Ticket #${id}: ${input.issueType} reported for ${input.customerName} (${input.projectName}). Priority: ${input.priority}`,
    'service_ticket',
    id,
    companyId,
  );

  // Phase 3B: Propagate caseId from project chain to service ticket
  void propagateCaseIdFromChain('service_tickets', id);

  return record;
}

// ── Status transitions ────────────────────────────────────────

export async function transitionTicketStatus(
  ticketId: string,
  nextStatus: TicketStatus,
  options?: { note?: string },
): Promise<ServiceTicketRecord> {
  const state = useAppStore.getState();
  const userId = state.user?.id || 'system';

  const existing = await getOne<ServiceTicketRecord>(COLLECTIONS.SERVICE_TICKETS, ticketId);
  if (!existing) throw new Error(`Service ticket ${ticketId} not found`);

  const currentStatus = existing.status as TicketStatus;
  if (!isValidTransition(currentStatus, nextStatus)) {
    throw new Error(`Cannot transition service ticket from ${currentStatus} to ${nextStatus}`);
  }

  if (existing.isDeleted) throw new Error('Cannot transition a deleted service ticket');

  const now = new Date().toISOString();
  const newHistoryEntry: TicketStatusHistoryEntry = {
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

  if (nextStatus === 'InProgress') {
    updates.inProgressAt = now;
    updates.inProgressBy = userId;
  }
  if (nextStatus === 'Resolved') {
    updates.resolvedAt = now;
    updates.resolvedBy = userId;
    updates.resolvedDate = now;
  }
  if (nextStatus === 'Closed') {
    updates.closedAt = now;
    updates.closedBy = userId;
    updates.closedDate = now;
  }
  if (nextStatus === 'Cancelled') {
    updates.cancelledAt = now;
    updates.cancelledBy = userId;
    updates.cancellationReason = options?.note || 'Cancelled by user';
  }

  await updateDocById(COLLECTIONS.SERVICE_TICKETS, ticketId, updates);

  const actionLabel =
    nextStatus === 'InProgress' ? 'Ticket in progress' :
    nextStatus === 'Resolved' ? 'Ticket resolved' :
    nextStatus === 'Closed' ? 'Ticket closed' :
    nextStatus === 'Cancelled' ? 'Ticket cancelled' : `Ticket ${nextStatus.toLowerCase()}`;

  await notifyRoleUsers(
    ['Operations', 'Director', 'ServiceTechnician'],
    NotificationType.TASK_STATUS_CHANGED,
    `Service ticket ${nextStatus}`,
    `Ticket #${existing.ticketNumber}: ${existing.issueType} for ${existing.customerName} is now ${nextStatus}.${options?.note ? ` Note: ${options.note}` : ''}`,
    'service_ticket',
    ticketId,
    existing.companyId,
  );

  await logActivity('ServiceTicket', nextStatus, ticketId, {
    entityName: `${existing.issueType} - ${existing.customerName}`,
    actionLabel,
    note: options?.note,
  });

  return {
    ...(existing as ServiceTicketRecord),
    ...updates,
    statusHistory: [...(existing.statusHistory || []), newHistoryEntry],
  } as ServiceTicketRecord;
}

// ── Reassign ──────────────────────────────────────────────────

/** Reassign the technician on an existing service ticket without a status transition. */
export async function reassignServiceTicket(id: string, technicianId: string, technicianName: string): Promise<void> {
  await updateDocById(COLLECTIONS.SERVICE_TICKETS, id, {
    assignedTechnician: technicianId,
    assignedTechnicianName: technicianName,
  });
}

// ── Query helpers ─────────────────────────────────────────────

export async function getServiceTickets(): Promise<ServiceTicketRecord[]> {
  const { getAll } = await import('./firestore');
  const records = await getAll<Record<string, unknown>>(COLLECTIONS.SERVICE_TICKETS);
  return records
    .filter((r) => !r.isDeleted)
    .map((r) => r as unknown as ServiceTicketRecord);
}

export async function getServiceTicket(id: string): Promise<ServiceTicketRecord | null> {
  const record = await getOne<Record<string, unknown>>(COLLECTIONS.SERVICE_TICKETS, id);
  if (!record || record.isDeleted) return null;
  return record as unknown as ServiceTicketRecord;
}
