/**
 * partnerNotifications — canonical Channel Partner team notification helper
 * (Channel Partner spec §18).
 *
 * §18 prescribes `notifyPartnerTeam(partnerId, type, title, body,
 * entityType, entityId)` → notifies the partner's user + the partner's
 * TL/Manager user, plus Management (`notifyRoleUsers(['Director','Manager'])`)
 * ONLY when configured per event.
 *
 * The Registration (Vendor Lock / Scheme Registration) event table row is:
 *   SchemeRegistration status change / vendor lock → Partner ✅, TL/Manager ✅,
 *   Management —, Accounts —, Admin —
 * so Registration callers never enable the Management broadcast. Director /
 * Admin / Accounts receive no Registration notifications — matching the
 * completed VL-9/VL-10 actor matrix (Director read-only, Accounts no access,
 * Admin not on the row).
 *
 * Recipient resolution is ALWAYS derived from the trusted record chain
 * (scheme_registrations.userId = the owning partner's linked users doc id;
 * scheme_registrations.managerId = the partner's TL/Manager USER id — both
 * stamped by the workflow service at creation from the channel_partners
 * document, never from URL/form/client payload). This keeps notifications
 * team-scoped: Manager A's team never receives another Manager's team events,
 * a partner never receives another partner's events, and every notification
 * stays company-scoped (the caller passes the record's own companyId).
 *
 * Uses the existing notification infrastructure (sendNotification + the
 * shared `notifications` collection + preference/quiet-hours/dedup logic) —
 * there is NO parallel notification system.
 */
import { sendNotification } from './notifications';
import { NotificationType } from '../types';

export interface NotifyPartnerTeamOptions {
  /** The owning partner's linked users doc id (scheme_registrations.userId). */
  partnerUserId?: string | null;
  /** The partner's TL/Manager USER id (scheme_registrations.managerId). */
  managerUserId?: string | null;
  /** The authenticated actor performing the event — never notified about
   *  their own action (self-notification prevention, matching
   *  notifyUsersOnce). */
  actorUserId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  /** Canonical tenant — the record's own companyId (never the neutral
   *  'default' placeholder). */
  companyId: string;
  projectId?: string;
  /** §18 "when configured": Management broadcast is opt-in per event. The
   *  Registration subsystem never enables it (table row = Management —). */
  includeManagement?: boolean;
}

/**
 * Notifies the partner's user + the partner's TL/Manager user through the
 * existing sendNotification infrastructure. Recipients are deduplicated and
 * the acting user is never self-notified. When neither recipient resolves
 * (no linked partner user / no TL assigned), no notification is emitted —
 * the event is still covered by the audit trail.
 */
export async function notifyPartnerTeam(options: NotifyPartnerTeamOptions): Promise<void> {
  const {
    partnerUserId,
    managerUserId,
    actorUserId,
    includeManagement,
    ...notification
  } = options;

  const candidates = [partnerUserId, managerUserId]
    .filter((id): id is string => Boolean(id) && String(id).trim().length > 0);
  const recipients = Array.from(new Set(candidates)).filter((id) => id !== actorUserId);

  if (recipients.length === 0) return;

  await Promise.all(recipients.map((recipientUserId) => sendNotification(
    recipientUserId,
    notification.type,
    notification.title,
    notification.body,
    notification.entityType,
    notification.entityId,
    notification.companyId,
    notification.projectId,
  )));

  // §18 helper contract: Management ('Director','Manager') is only notified
  // when the event row configures it. No Registration event does.
  if (includeManagement) {
    const { notifyRoleUsers } = await import('./notifications');
    await notifyRoleUsers(
      ['Director', 'Manager'],
      notification.type,
      notification.title,
      notification.body,
      notification.entityType,
      notification.entityId,
      notification.companyId,
      notification.projectId,
    );
  }
}
