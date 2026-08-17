import { createDocWithId, genId, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { getNotificationUsersByRoles, sendNotification } from './notifications';
import { NotificationType } from '../types';

type StoreWithMasterUser = ReturnType<typeof useAppStore.getState> & {
  masterUser?: { id?: string } | null;
};

export type WorkflowRecord = Record<string, unknown>;

export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function usersByRole(role: string) {
  try {
    const state = useAppStore.getState();
    const companyId = state.activeCompanyId && state.activeCompanyId !== 'all'
      ? state.activeCompanyId
      // Canonical tenant resolution — never the neutral 'default' placeholder.
      : resolveWriteCompanyId();
    return await getNotificationUsersByRoles([role], companyId);
  } catch (error) {
    console.warn('Notification recipient lookup failed', error);
    return [];
  }
}

export function notifyUsers(
  users: Array<{ id: string }>,
  type: NotificationType,
  title: string,
  body: string,
  entityType: string,
  entityId: string,
  companyId: string,
  /** Optional project context — lets the notification deep link straight to
   * the record's Project Workspace stage card (popup retirement). */
  projectId?: string
) {
  const seen = new Set<string>();
  users.forEach((user) => {
    if (!user.id || seen.has(user.id)) return;
    seen.add(user.id);
    void sendNotification(user.id, type, title, body, entityType, entityId, companyId, projectId);
  });
}

export function resolveWorkflowCompanyId() {
  const state = useAppStore.getState();
  const companyId = state.activeCompanyId && state.activeCompanyId !== 'all'
    ? state.activeCompanyId
    : state.company?.id || state.user?.companyId || '';
  if (!companyId) throw new Error('Active company is required');
  return companyId;
}

export function stockSummaryId(companyId: string, productId: string, warehouseId: string) {
  const part = (value: string) => encodeURIComponent(value || 'default');
  return `SUM-${part(companyId)}-${part(productId)}-${part(warehouseId)}`;
}

export function timestampMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return ((value as { toDate: () => Date }).toDate()).getTime();
  }
  if (typeof value === 'object' && typeof (value as { seconds?: unknown }).seconds === 'number') {
    return Number((value as { seconds: number }).seconds) * 1000;
  }
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isDispatchImmutable(status: string) {
  return status === 'Delivered' || status === 'Closed';
}

export function generateDeliveryOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function hashOTP(otp: string) {
  const bytes = new TextEncoder().encode(otp);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function logActivity(module: string, action: string, entityId: string, metadata: Record<string, unknown> = {}) {
  const state = useAppStore.getState() as StoreWithMasterUser;
  const safeMetadata = metadata && typeof metadata === 'object' ? metadata : {};
  const masterUserId = state.masterUser?.id || safeMetadata.masterUserId || '';
  const id = genId.generic('AUD');
  try {
    const entityName = safeMetadata.entityName || safeMetadata.customerName || safeMetadata.customer || safeMetadata.orderId || safeMetadata.customerId || entityId;
    await createDocWithId(COLLECTIONS.AUDIT_LOGS, id, {
      id,
      companyId: state.activeCompanyId,
      module,
      action,
      actionLabel: safeMetadata.actionLabel || action,
      entityId,
      entityName,
      masterUserId,
      userId: state.user?.id || 'system',
      userName: state.user?.name || 'System',
      metadata: {
        ...safeMetadata,
        masterUserId,
        entityName,
        actionLabel: safeMetadata.actionLabel || action,
      }
    });
  } catch (error) {
    console.warn('Activity logging failed', error);
  }
}
