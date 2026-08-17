import { COLLECTIONS } from './firebase';
import { getAll } from './firestore';
import type { EntityRef, EntityType } from './entityRegistry';
import { makeEntityRef } from './relationships';

type UnknownRecord = Record<string, unknown>;

const ENTITY_TYPES: readonly EntityType[] = [
  'company',
  'user',
  'role',
  'employee',
  'lead',
  'followup',
  'customer',
  'product',
  'product_category',
  'warehouse',
  'stock',
  'stock_ledger',
  'order',
  'order_item',
  'quotation',
  'proforma_invoice',
  'pi_item',
  'dispatch',
  'dispatch_item',
  'transport',
  'payment',
  'serial_number',
  'attendance',
  'payroll',
  'activity',
];

export type EntityTimelineEvent = {
  id: string;
  companyId?: string;
  type?: string;
  module?: string;
  action?: string;
  message?: string;
  actor?: EntityRef;
  primary?: EntityRef;
  related?: EntityRef[];
  occurredAt?: string;
  createdAt?: string;
  metadata?: UnknownRecord;
  raw: UnknownRecord;
};

export type EntityTimelineOptions = {
  limit?: number;
  module?: string;
  action?: string;
  includeRelated?: boolean;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {});

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const isEntityType = (value: unknown): value is EntityType =>
  typeof value === 'string' && ENTITY_TYPES.includes(value as EntityType);

const asEntityRef = (value: unknown): EntityRef | undefined => {
  const record = asRecord(value);
  const type = record.type;
  const id = stringValue(record.id);

  if (!isEntityType(type) || !id) {
    return undefined;
  }

  return makeEntityRef(
    type,
    id,
    stringValue(record.label),
    stringValue(record.collection)
  );
};

const asEntityRefs = (value: unknown): EntityRef[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asEntityRef)
    .filter((ref): ref is EntityRef => Boolean(ref));
};

const asMetadata = (value: unknown): UnknownRecord | undefined =>
  isRecord(value) ? value : undefined;

const oldAuditPrimaryRef = (activity: UnknownRecord): EntityRef | undefined => {
  const id = stringValue(activity.entityId);
  const type = activity.entityType;

  if (!id || !isEntityType(type)) {
    return undefined;
  }

  return makeEntityRef(type, id);
};

const oldAuditActorRef = (activity: UnknownRecord): EntityRef | undefined => {
  const userId = stringValue(activity.userId);

  if (!userId) {
    return undefined;
  }

  return makeEntityRef('user', userId, stringValue(activity.userName));
};

const dateMs = (event: EntityTimelineEvent): number => {
  const candidate =
    event.occurredAt ||
    event.createdAt ||
    stringValue(event.raw.date) ||
    stringValue(event.raw.updatedAt);

  if (!candidate) {
    return 0;
  }

  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const isSameEntityRef = (
  a?: EntityRef | null,
  b?: EntityRef | null
): boolean => {
  if (!a || !b) {
    return false;
  }

  return a.type === b.type && a.id === b.id;
};

export const activityMatchesEntity = (
  activity: unknown,
  entityRef: EntityRef,
  includeRelated = true
): boolean => {
  const activityRecord = asRecord(activity);
  const primary = asEntityRef(activityRecord.primary) || oldAuditPrimaryRef(activityRecord);

  if (isSameEntityRef(primary, entityRef)) {
    return true;
  }

  const legacyId = stringValue(activityRecord.entityId);
  const legacyType = activityRecord.entityType;

  if (legacyId && isEntityType(legacyType)) {
    if (isSameEntityRef(makeEntityRef(legacyType, legacyId), entityRef)) {
      return true;
    }
  }

  if (!includeRelated) {
    return false;
  }

  return asEntityRefs(activityRecord.related).some((relatedRef) =>
    isSameEntityRef(relatedRef, entityRef)
  );
};

export const normalizeActivityToTimelineEvent = (
  activity: unknown
): EntityTimelineEvent => {
  const activityRecord = asRecord(activity);

  return {
    id: stringValue(activityRecord.id) || '',
    companyId: stringValue(activityRecord.companyId),
    type: stringValue(activityRecord.type),
    module: stringValue(activityRecord.module),
    action: stringValue(activityRecord.action),
    message: stringValue(activityRecord.message),
    actor: asEntityRef(activityRecord.actor) || oldAuditActorRef(activityRecord),
    primary: asEntityRef(activityRecord.primary) || oldAuditPrimaryRef(activityRecord),
    related: asEntityRefs(activityRecord.related),
    occurredAt: stringValue(activityRecord.occurredAt),
    createdAt: stringValue(activityRecord.createdAt),
    metadata: asMetadata(activityRecord.metadata),
    raw: activityRecord,
  };
};

export const getEntityTimeline = async (
  entityRef: EntityRef,
  options: EntityTimelineOptions = {}
): Promise<EntityTimelineEvent[]> => {
  const includeRelated = options.includeRelated ?? true;
  const activities = await getAll<UnknownRecord>(COLLECTIONS.AUDIT_LOGS);

  const events = activities
    .filter((activity) => activityMatchesEntity(activity, entityRef, includeRelated))
    .map(normalizeActivityToTimelineEvent)
    .filter((event) => !options.module || event.module === options.module)
    .filter((event) => !options.action || event.action === options.action)
    .sort((a, b) => dateMs(b) - dateMs(a));

  if (!Number.isFinite(options.limit) || !options.limit || options.limit <= 0) {
    return events;
  }

  return events.slice(0, options.limit);
};

export const getEntityRelatedRefsFromActivities = async (
  entityRef: EntityRef,
  options: EntityTimelineOptions = {}
): Promise<EntityRef[]> => {
  const timeline = await getEntityTimeline(entityRef, {
    ...options,
    includeRelated: true,
  });
  const refsByKey = new Map<string, EntityRef>();

  const addRef = (ref?: EntityRef) => {
    if (!ref || isSameEntityRef(ref, entityRef)) {
      return;
    }

    refsByKey.set(`${ref.type}:${ref.id}`, ref);
  };

  timeline.forEach((event) => {
    addRef(event.primary);
    event.related?.forEach(addRef);
  });

  return Array.from(refsByKey.values());
};

export const groupTimelineByModule = (
  events: EntityTimelineEvent[]
): Record<string, EntityTimelineEvent[]> =>
  events.reduce<Record<string, EntityTimelineEvent[]>>((groups, event) => {
    const key = event.module || 'unknown';
    groups[key] = groups[key] || [];
    groups[key].push(event);
    return groups;
  }, {});

export const groupTimelineByAction = (
  events: EntityTimelineEvent[]
): Record<string, EntityTimelineEvent[]> =>
  events.reduce<Record<string, EntityTimelineEvent[]>>((groups, event) => {
    const key = event.action || 'unknown';
    groups[key] = groups[key] || [];
    groups[key].push(event);
    return groups;
  }, {});
