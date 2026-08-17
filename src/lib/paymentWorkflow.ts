/**
 * paymentWorkflow.ts — Payment Collection Workflow
 *
 * State machine: Pending → Received → Verified / Cancelled
 * Immutable payment history with audit logging and notifications.
 */

import { COLLECTIONS } from './firebase';
import { createDocWithId, genId, getOne, updateDocById } from './firestore';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { propagateCaseIdFromChain } from './casePropagation';

// ── Types ─────────────────────────────────────────────────────

export type PaymentStatus = 'Pending' | 'Received' | 'Verified' | 'Cancelled';

export interface PaymentStatusHistoryEntry {
  status: PaymentStatus;
  changedAt: string;
  changedBy: string;
  note?: string;
}

export interface PaymentRecord {
  id: string;
  companyId: string;
  customerId: string;
  customerName: string;
  orderId?: string;
  taxInvoiceId?: string;
  amount: number;
  mode: string;
  reference: string;
  notes: string;
  date: string;
  status: PaymentStatus;
  statusHistory: PaymentStatusHistoryEntry[];
  verifiedAt?: string;
  verifiedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  isDeleted: boolean;
}

export interface PaymentCreateInput {
  customerId: string;
  customerName: string;
  orderId?: string;
  taxInvoiceId?: string;
  amount: number;
  mode: string;
  reference?: string;
  notes?: string;
  date: string;
}

// ── State machine ─────────────────────────────────────────────

const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  Pending: ['Received', 'Cancelled'],
  Received: ['Verified', 'Cancelled'],
  Verified: [],
  Cancelled: [],
};

export function isValidTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Create ────────────────────────────────────────────────────

export async function createPayment(input: PaymentCreateInput): Promise<PaymentRecord> {
  if (!input.customerId) throw new Error('Customer is required');
  if (!input.customerName) throw new Error('Customer name is required');
  if (!input.amount || input.amount <= 0) throw new Error('Payment amount must be greater than zero');
  if (!input.mode) throw new Error('Payment mode is required');
  if (!input.date) throw new Error('Payment date is required');

  const state = useAppStore.getState();
  const companyId = state.activeCompanyId || state.company?.id || '';
  if (!companyId) throw new Error('Active company is required');

  const id = genId.payment();
  const now = new Date().toISOString();
  const userId = state.user?.id || 'system';

  const record: PaymentRecord = {
    id,
    companyId,
    customerId: input.customerId,
    customerName: input.customerName,
    orderId: input.orderId,
    taxInvoiceId: input.taxInvoiceId,
    amount: input.amount,
    mode: input.mode,
    reference: input.reference || '',
    notes: input.notes || '',
    date: input.date,
    status: 'Pending',
    statusHistory: [{ status: 'Pending', changedAt: now, changedBy: userId }],
    createdBy: userId,
    createdAt: now,
    updatedBy: userId,
    updatedAt: now,
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.PAYMENTS, id, record);

  await logActivity('Payments', 'Created', id, {
    entityName: `${input.customerName} - ${input.amount}`,
    actionLabel: 'Payment recorded',
    orderId: input.orderId,
  });

  // Phase 3B: Propagate caseId from order to payment
  if (input.orderId) {
    void propagateCaseIdFromChain('payments', id);
  }

  await notifyRoleUsers(
    ['Accounts', 'Director'],
    NotificationType.PAYMENT_RECORDED,
    'Payment recorded',
    `Payment of ${input.amount} recorded for ${input.customerName}.`,
    'payment',
    id,
    companyId,
  );

  return record;
}

// ── Status transitions ────────────────────────────────────────

export async function transitionPaymentStatus(
  paymentId: string,
  nextStatus: PaymentStatus,
  options?: { note?: string },
): Promise<PaymentRecord> {
  const state = useAppStore.getState();
  const userId = state.user?.id || 'system';

  const existing = await getOne<PaymentRecord>(COLLECTIONS.PAYMENTS, paymentId);
  if (!existing) throw new Error(`Payment ${paymentId} not found`);

  const currentStatus = existing.status as PaymentStatus;
  if (!isValidTransition(currentStatus, nextStatus)) {
    throw new Error(`Cannot transition payment from ${currentStatus} to ${nextStatus}`);
  }

  if (existing.isDeleted) throw new Error('Cannot transition a deleted payment');

  const now = new Date().toISOString();
  const newHistoryEntry: PaymentStatusHistoryEntry = {
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

  if (nextStatus === 'Verified') {
    updates.verifiedAt = now;
    updates.verifiedBy = userId;
  }
  if (nextStatus === 'Cancelled') {
    updates.cancelledAt = now;
    updates.cancelledBy = userId;
    updates.cancellationReason = options?.note || 'Cancelled by user';
  }

  await updateDocById(COLLECTIONS.PAYMENTS, paymentId, updates);

  const actionLabel =
    nextStatus === 'Received' ? 'Payment received' :
    nextStatus === 'Verified' ? 'Payment verified' :
    nextStatus === 'Cancelled' ? 'Payment cancelled' : `Payment ${nextStatus.toLowerCase()}`;

  await logActivity('Payments', nextStatus, paymentId, {
    entityName: `${existing.customerName} - ${existing.amount}`,
    actionLabel,
    note: options?.note,
  });

  return {
    ...(existing as PaymentRecord),
    ...updates,
    statusHistory: [...(existing.statusHistory || []), newHistoryEntry],
  } as PaymentRecord;
}

// ── Query helpers ─────────────────────────────────────────────

export async function getPayments(): Promise<PaymentRecord[]> {
  const { getAll } = await import('./firestore');
  const records = await getAll<Record<string, unknown>>(COLLECTIONS.PAYMENTS);
  return records
    .filter((r) => !r.isDeleted)
    .map((r) => r as unknown as PaymentRecord);
}

export async function getPayment(id: string): Promise<PaymentRecord | null> {
  const record = await getOne<Record<string, unknown>>(COLLECTIONS.PAYMENTS, id);
  if (!record || record.isDeleted) return null;
  return record as unknown as PaymentRecord;
}
