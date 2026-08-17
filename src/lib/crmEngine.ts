/**
 * crmEngine — Centralized Customer CRM Engine
 *
 * Single source of truth for:
 *   - Follow-up management (Part 3)
 *   - Communication timeline (Part 4)
 *   - Reminder automation (Part 5)
 *   - Customer satisfaction (Part 6)
 *
 * Reuses existing:
 *   - Notifications (notifyRoleUsers, sendNotification)
 *   - Activity logging (logActivity)
 *   - Scheduler integration (getDelayedInstallations pattern)
 *   - Firestore helper layer (getAll, getOne, createDocWithId, updateDocById)
 *
 * No Firestore SDK in UI.
 * No duplicated business logic.
 */

import { getAll, getOne, createDocWithId, updateDocById, genId, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers, sendNotification } from './notifications';
import { NotificationType } from '../types';

// ═══════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════

export type FollowupStatus = 'pending' | 'completed' | 'missed' | 'cancelled' | 'rescheduled';

export interface Followup {
  id: string;
  customerId: string;
  customerName: string;
  companyId: string;
  note: string;
  priority: 'low' | 'medium' | 'high';
  scheduledDate: string;
  status: FollowupStatus;
  outcome?: string;
  completedAt?: string;
  completedBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

export type CommunicationType = 'phone' | 'whatsapp' | 'email' | 'sms' | 'site_visit' | 'office_meeting' | 'installation_visit';

export interface CommunicationRecord {
  id: string;
  customerId: string;
  customerName: string;
  companyId: string;
  type: CommunicationType;
  summary: string;
  outcome?: string;
  nextAction?: string;
  userId: string;
  userName: string;
  createdAt: string;
  isDeleted?: boolean;
}

export interface CustomerSatisfaction {
  id: string;
  customerId: string;
  customerName: string;
  companyId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  feedback?: string;
  npsIndicator?: 'promoter' | 'passive' | 'detractor';
  complaintCount: number;
  resolvedCount: number;
  lastFeedbackAt?: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

export interface CRMSummary {
  totalCustomers: number;
  activeCustomers: number;
  newThisMonth: number;
  overdueFollowups: number;
  todaysFollowups: number;
  avgSatisfaction: number;
  totalComplaints: number;
  resolvedComplaints: number;
  lowRatedCustomers: number;
  highRatedCustomers: number;
  communicationVolume: number;
  topCities: { city: string; count: number }[];
  followupPerformance: { completed: number; missed: number; pending: number };
}

// ═══════════════════════════════════════════════════════════
//  FOLLOW-UP ENGINE
// ═══════════════════════════════════════════════════════════

/**
 * Schedule a follow-up for a customer.
 * Creates the follow-up record, logs activity, and sends notification.
 */
export async function createFollowup(
  customerId: string,
  customerName: string,
  note: string,
  scheduledDate: string,
  priority: Followup['priority'] = 'medium',
): Promise<string> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const userId = state.user?.id || 'system';
  const userName = state.user?.name || 'System';
  const id = genId.generic('FU');

  const followup: Followup = {
    id,
    customerId,
    customerName,
    companyId,
    note,
    priority,
    scheduledDate,
    status: 'pending',
    createdBy: userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.FOLLOWUPS, id, {
    ...followup,
    entityType: 'customer_followup',
  });

  // Also update customer with next follow-up info
  await updateDocById(COLLECTIONS.CUSTOMERS, customerId, {
    nextFollowupDate: scheduledDate,
    lastFollowupNote: note,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  }).catch(() => {});

  await logActivity('CRM', 'Follow-up Created', customerId, {
    followupId: id,
    note,
    scheduledDate,
    priority,
    entityName: customerName,
    actionLabel: `Follow-up scheduled for ${customerName} on ${scheduledDate}`,
  });

  // Notify assigned user
  const customer = await getOne<any>(COLLECTIONS.CUSTOMERS, customerId);
  if (customer?.assignedToId) {
    await sendNotification(
      customer.assignedToId,
      NotificationType.TASK_ASSIGNED,
      'Follow-up scheduled',
      `Follow-up for ${customerName} scheduled on ${scheduledDate}: ${note}`,
      'customer',
      customerId,
      companyId,
    ).catch(() => {});
  }

  return id;
}

/**
 * Update a follow-up's status (complete, mark missed, cancel, reschedule).
 */
export async function updateFollowupStatus(
  followupId: string,
  status: FollowupStatus,
  metadata?: { outcome?: string; rescheduledDate?: string },
): Promise<void> {
  const state = useAppStore.getState();
  const userId = state.user?.id || 'system';
  const updates: Record<string, unknown> = {
    status,
    updatedAt: new Date().toISOString(),
  };

  if (status === 'completed' || status === 'missed') {
    updates.completedAt = new Date().toISOString();
    updates.completedBy = userId;
  }
  if (metadata?.outcome) updates.outcome = metadata.outcome;
  if (metadata?.rescheduledDate) updates.scheduledDate = metadata.rescheduledDate;

  const entity = await getOne<any>(COLLECTIONS.FOLLOWUPS, followupId);
  if (!entity) return;

  await updateDocById(COLLECTIONS.FOLLOWUPS, followupId, updates);

  await logActivity('CRM', `Follow-up ${status.charAt(0).toUpperCase() + status.slice(1)}`, entity.customerId, {
    followupId,
    entityName: entity.customerName || followupId,
    actionLabel: `Follow-up ${status.replace(/_/g, ' ')}${metadata?.outcome ? `: ${metadata.outcome}` : ''}`,
  });
}

/**
 * Get follow-ups for a customer.
 */
export async function getCustomerFollowups(customerId: string): Promise<Followup[]> {
  const allEntities = await getAll<any>(COLLECTIONS.FOLLOWUPS);
  return allEntities
    .filter((e: any) => e.entityType === 'customer_followup' && e.customerId === customerId && !e.isDeleted)
    .sort((a: any, b: any) => {
      const da = a.scheduledDate ? new Date(a.scheduledDate).getTime() : 0;
      const db = b.scheduledDate ? new Date(b.scheduledDate).getTime() : 0;
      return db - da;
    }) as Followup[];
}

/**
 * Get today's pending follow-ups.
 */
export async function getTodaysFollowups(companyId: string): Promise<Followup[]> {
  const allEntities = await getAll<any>(COLLECTIONS.FOLLOWUPS);
  const today = new Date().toISOString().slice(0, 10);
  return allEntities
    .filter((e: any) =>
      e.entityType === 'customer_followup' &&
      e.companyId === companyId &&
      e.scheduledDate?.slice(0, 10) === today &&
      e.status === 'pending' &&
      !e.isDeleted
    )
    .sort((a: any, b: any) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[a.priority as keyof typeof p] ?? 1) - (p[b.priority as keyof typeof p] ?? 1);
    }) as Followup[];
}

/**
 * Get overdue follow-ups.
 */
export async function getOverdueFollowups(companyId: string): Promise<Followup[]> {
  const allEntities = await getAll<any>(COLLECTIONS.FOLLOWUPS);
  const now = new Date();
  return allEntities
    .filter((e: any) =>
      e.entityType === 'customer_followup' &&
      e.companyId === companyId &&
      e.scheduledDate &&
      new Date(e.scheduledDate) < now &&
      e.status === 'pending' &&
      !e.isDeleted
    )
    .sort((a: any, b: any) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()) as Followup[];
}

// ═══════════════════════════════════════════════════════════
//  COMMUNICATION TIMELINE
// ═══════════════════════════════════════════════════════════

/**
 * Record a communication entry for a customer.
 */
export async function addCommunication(
  customerId: string,
  customerName: string,
  type: CommunicationType,
  summary: string,
  metadata?: { outcome?: string; nextAction?: string },
): Promise<string> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const userId = state.user?.id || 'system';
  const userName = state.user?.name || 'System';
  const id = genId.generic('COM');

  const record: CommunicationRecord = {
    id,
    customerId,
    customerName,
    companyId,
    type,
    summary,
    outcome: metadata?.outcome,
    nextAction: metadata?.nextAction,
    userId,
    userName,
    createdAt: new Date().toISOString(),
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.ENTITIES, id, {
    ...record,
    entityType: 'customer_communication',
  });

  await logActivity('CRM', `Communication: ${type.replace(/_/g, ' ')}`, customerId, {
    communicationId: id,
    type,
    summary,
    entityName: customerName,
    actionLabel: `${type.replace(/_/g, ' ')} with ${customerName}: ${summary}`,
  });

  return id;
}

/**
 * Get communication timeline for a customer.
 */
export async function getCustomerCommunications(customerId: string): Promise<CommunicationRecord[]> {
  const allEntities = await getAll<any>(COLLECTIONS.ENTITIES);
  return allEntities
    .filter((e: any) => e.entityType === 'customer_communication' && e.customerId === customerId && !e.isDeleted)
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) as CommunicationRecord[];
}

const COMMUNICATION_LABELS: Record<CommunicationType, string> = {
  phone: 'Phone Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  sms: 'SMS',
  site_visit: 'Site Visit',
  office_meeting: 'Office Meeting',
  installation_visit: 'Installation Visit',
};

export function communicationLabel(type: CommunicationType): string {
  return COMMUNICATION_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const COMMUNICATION_COLORS: Record<CommunicationType, string> = {
  phone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  whatsapp: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  email: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  sms: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  site_visit: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  office_meeting: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  installation_visit: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
};

export function communicationColor(type: CommunicationType): string {
  return COMMUNICATION_COLORS[type] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
}

// ═══════════════════════════════════════════════════════════
//  CUSTOMER SATISFACTION
// ═══════════════════════════════════════════════════════════

/**
 * Record customer satisfaction rating.
 */
export async function recordSatisfaction(
  customerId: string,
  customerName: string,
  rating: CustomerSatisfaction['rating'],
  feedback?: string,
): Promise<string> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const id = genId.generic('CSAT');

  const npsIndicator = rating >= 4 ? 'promoter' : rating === 3 ? 'passive' : 'detractor';

  const existing = await getSatisfaction(customerId);
  const record: CustomerSatisfaction = {
    id: existing?.id || id,
    customerId,
    customerName,
    companyId,
    rating,
    feedback,
    npsIndicator,
    complaintCount: existing?.complaintCount || 0,
    resolvedCount: existing?.resolvedCount || 0,
    lastFeedbackAt: new Date().toISOString(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.ENTITIES, id, {
    ...record,
    entityType: 'customer_satisfaction',
  });

  await logActivity('CRM', 'Satisfaction Recorded', customerId, {
    rating,
    npsIndicator,
    feedback,
    entityName: customerName,
    actionLabel: `Satisfaction rating ${rating}/5 from ${customerName}`,
  });

  await notifyRoleUsers(
    ['Admin', 'Director'],
    NotificationType.CUSTOMER_CREATED,
    'Customer feedback received',
    `${customerName} rated ${rating}/5.${feedback ? ` Feedback: ${feedback}` : ''}`,
    'customer',
    customerId,
    companyId,
  ).catch(() => {});

  return id;
}

/**
 * Get satisfaction record for a customer.
 */
export async function getSatisfaction(customerId: string): Promise<CustomerSatisfaction | null> {
  const allEntities = await getAll<any>(COLLECTIONS.ENTITIES);
  const match = allEntities.find(
    (e: any) => e.entityType === 'customer_satisfaction' && e.customerId === customerId && !e.isDeleted,
  );
  return match as CustomerSatisfaction | null;
}

/**
 * Record a complaint for a customer.
 */
export async function recordComplaint(
  customerId: string,
  customerName: string,
  description: string,
  complaintId?: string,
): Promise<string> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  const existing = await getSatisfaction(customerId);
  const cid = existing?.id || genId.generic('CSAT');

  await createDocWithId(COLLECTIONS.ENTITIES, cid, {
    customerId,
    customerName,
    companyId,
    complaintDescription: description,
    complaintId: complaintId || genId.generic('CMP'),
    status: 'open',
    entityType: 'customer_complaint',
    createdAt: new Date().toISOString(),
    isDeleted: false,
  }).catch(() => {});

  // Update complaint count on satisfaction record
  if (existing) {
    await updateDocById(COLLECTIONS.ENTITIES, existing.id, {
      complaintCount: (existing.complaintCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  }

  await logActivity('CRM', 'Complaint Created', customerId, {
    description,
    entityName: customerName,
    actionLabel: `Complaint recorded for ${customerName}: ${description}`,
  });

  await notifyRoleUsers(
    ['Admin', 'Director'],
    NotificationType.CUSTOMER_CREATED,
    'Complaint registered',
    `Complaint for ${customerName}: ${description}`,
    'customer',
    customerId,
    companyId,
  ).catch(() => {});

  return cid;
}

/**
 * Resolve a complaint.
 */
export async function resolveComplaint(
  customerId: string,
  resolution: string,
): Promise<void> {
  const state = useAppStore.getState();
  const existing = await getSatisfaction(customerId);
  if (!existing) return;

  await updateDocById(COLLECTIONS.ENTITIES, existing.id, {
    resolvedCount: (existing.resolvedCount || 0) + 1,
    lastResolution: resolution,
    resolvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await logActivity('CRM', 'Complaint Resolved', customerId, {
    resolution,
    entityName: existing.customerName,
    actionLabel: `Complaint resolved for ${existing.customerName}: ${resolution}`,
  });
}

// ═══════════════════════════════════════════════════════════
//  CRM SUMMARY (for dashboard & reports)
// ═══════════════════════════════════════════════════════════

/**
 * Get CRM summary metrics.
 * Pure read — no side effects.
 */
export async function getCRMSummary(companyId: string): Promise<CRMSummary> {
  const [customers, followups, communications, satisfactions, leads] = await Promise.all([
    getAll<any>(COLLECTIONS.CUSTOMERS),
    getAll<any>(COLLECTIONS.FOLLOWUPS),
    getAll<any>(COLLECTIONS.ENTITIES),
    getAll<any>(COLLECTIONS.ENTITIES),
    getAll<any>(COLLECTIONS.LEADS),
  ]);

  const companyCustomers = customers.filter((c: any) => c.companyId === companyId && !c.isDeleted);
  const companyFollowups = followups.filter((f: any) => f.companyId === companyId && !f.isDeleted && f.entityType === 'customer_followup');
  const companyComms = communications.filter((c: any) => c.companyId === companyId && !c.isDeleted && c.entityType === 'customer_communication');
  const companySat = satisfactions.filter((s: any) => s.companyId === companyId && !s.isDeleted && s.entityType === 'customer_satisfaction');

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const todaysFollowups = companyFollowups.filter(
    (f: any) => f.scheduledDate?.slice(0, 10) === today && f.status === 'pending',
  );
  const overdueFollowups = companyFollowups.filter(
    (f: any) => f.scheduledDate && new Date(f.scheduledDate) < now && f.status === 'pending',
  );

  const ratings = companySat.filter((s: any) => s.rating).map((s: any) => s.rating);
  const avgSatisfaction = ratings.length > 0
    ? Math.round((ratings.reduce((a: number, r: number) => a + r, 0) / ratings.length) * 10) / 10
    : 0;

  // City distribution
  const cityCount: Record<string, number> = {};
  companyCustomers.forEach((c: any) => {
    const city = c.city || 'Unknown';
    cityCount[city] = (cityCount[city] || 0) + 1;
  });
  const topCities = Object.entries(cityCount)
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const completed = companyFollowups.filter((f: any) => f.status === 'completed').length;
  const missed = companyFollowups.filter((f: any) => f.status === 'missed').length;
  const pending = companyFollowups.filter((f: any) => f.status === 'pending').length;

  return {
    totalCustomers: companyCustomers.length,
    activeCustomers: companyCustomers.filter((c: any) => (c.status || 'Active') === 'Active').length,
    newThisMonth: companyCustomers.filter((c: any) => c.createdAt && new Date(c.createdAt) >= firstOfMonth).length,
    overdueFollowups: overdueFollowups.length,
    todaysFollowups: todaysFollowups.length,
    avgSatisfaction,
    totalComplaints: companySat.reduce((s: number, sat: any) => s + (sat.complaintCount || 0), 0),
    resolvedComplaints: companySat.reduce((s: number, sat: any) => s + (sat.resolvedCount || 0), 0),
    lowRatedCustomers: companySat.filter((s: any) => s.rating && s.rating <= 2).length,
    highRatedCustomers: companySat.filter((s: any) => s.rating && s.rating >= 4).length,
    communicationVolume: companyComms.length,
    topCities,
    followupPerformance: { completed, missed, pending },
  };
}

// ═══════════════════════════════════════════════════════════
//  REMINDER AUTOMATION (Scheduler Integration)
// ═══════════════════════════════════════════════════════════

/**
 * Check for overdue follow-ups and generate notifications.
 * Called by the scheduler for daily health checks.
 */
export async function checkOverdueFollowups(companyId: string): Promise<{
  checked: number;
  overdue: number;
  notified: number;
}> {
  const overdue = await getOverdueFollowups(companyId);
  const result = { checked: 0, overdue: overdue.length, notified: 0 };

  for (const fu of overdue) {
    result.checked++;
    await notifyRoleUsers(
      ['Admin', 'Director', 'Manager'],
      NotificationType.TASK_STATUS_CHANGED,
      'Follow-up overdue',
      `Follow-up for ${fu.customerName} (${fu.note}) was due on ${fu.scheduledDate.slice(0, 10)} and is now overdue.`,
      'customer',
      fu.customerId,
      companyId,
    ).catch(() => {});
    result.notified++;
  }

  return result;
}

export default {
  createFollowup,
  updateFollowupStatus,
  getCustomerFollowups,
  getTodaysFollowups,
  getOverdueFollowups,
  addCommunication,
  getCustomerCommunications,
  communicationLabel,
  communicationColor,
  recordSatisfaction,
  getSatisfaction,
  recordComplaint,
  resolveComplaint,
  getCRMSummary,
  checkOverdueFollowups,
};
