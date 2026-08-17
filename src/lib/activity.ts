import { createDoc, resolveWriteCompanyId, type DocWithId } from './firestore';
import { COLLECTIONS } from './firebase';
import {
  getEntityLabel,
  type EntityRef,
  type EntityType,
} from './entityRegistry';
import {
  extractEntityRefsFromRecord,
  makeEntityRef,
} from './relationships';
import { useAppStore } from '../store/useAppStore';

export type ActivitySeverity = 'info' | 'success' | 'warning' | 'danger';
export type ActivityVisibility = 'all' | 'team' | 'self';

export type ActivityEventInput = {
  type: string;
  module: string;
  action: string;
  primary: EntityRef;
  related?: EntityRef[];
  message?: string;
  severity?: ActivitySeverity;
  visibility?: ActivityVisibility;
  metadata?: Record<string, unknown>;
};

export type ActivityEvent = {
  id?: string;
  companyId: string;
  type: string;
  module: string;
  action: string;
  actor: EntityRef;
  primary: EntityRef;
  related: EntityRef[];
  message: string;
  severity: ActivitySeverity;
  visibility: ActivityVisibility;
  occurredAt: string;
  createdAt?: string;
  createdBy: string;
  metadata: Record<string, unknown>;
  isDeleted: boolean;
};

export type ActivityLogDocument = ActivityEvent & {
  userId: string;
  userName: string;
  entityId: string;
  entityType: EntityType;
};

export type EntityActivityInputParams = {
  entityType: EntityType;
  entityId: string;
  action: string;
  module: string;
  label?: string;
  record?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  type?: string;
  message?: string;
  severity?: ActivitySeverity;
  visibility?: ActivityVisibility;
};

function cleanString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function normalizeAction(action: string): string {
  return action.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function humanize(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (!cleaned) return 'Entity';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function isSameRef(a: EntityRef, b: EntityRef): boolean {
  return a.type === b.type && a.id === b.id;
}

function uniqueRefs(refs: EntityRef[]): EntityRef[] {
  const result: EntityRef[] = [];
  for (const ref of refs) {
    if (!ref.id || result.some((existing) => isSameRef(existing, ref))) continue;
    result.push(ref);
  }
  return result;
}

function currentContext() {
  const state = useAppStore.getState();
  const user = state.user;
  const companyId =
    // Canonical tenant resolution — never the neutral 'default' placeholder.
    resolveWriteCompanyId();

  const actor = makeEntityRef('user', user?.id || 'system', user?.name || 'System');

  return {
    user,
    actor,
    companyId,
    createdBy: user?.id || 'system',
    userName: user?.name || 'System',
  };
}

export function safeActivityMessage(input: Pick<ActivityEventInput, 'primary' | 'action' | 'message'>): string {
  const explicit = cleanString(input.message);
  if (explicit) return explicit;

  const entity = humanize(input.primary.type);
  const action = normalizeAction(input.action);
  return `${entity} ${action || 'updated'}`;
}

export function buildActivityEvent(input: ActivityEventInput): ActivityEvent {
  const context = currentContext();
  const primary = {
    ...input.primary,
    label: input.primary.label || input.primary.id,
  };

  return {
    companyId: context.companyId,
    type: input.type,
    module: input.module,
    action: input.action,
    actor: context.actor,
    primary,
    related: uniqueRefs(input.related ?? []),
    message: safeActivityMessage({ ...input, primary }),
    severity: input.severity ?? 'info',
    visibility: input.visibility ?? 'all',
    occurredAt: new Date().toISOString(),
    createdBy: context.createdBy,
    metadata: input.metadata ?? {},
    isDeleted: false,
  };
}

export async function logActivityEvent(input: ActivityEventInput): Promise<DocWithId<ActivityLogDocument>> {
  const event = buildActivityEvent(input);
  const context = currentContext();
  const payload: ActivityLogDocument = {
    ...event,
    userId: context.createdBy,
    userName: context.userName,
    entityId: event.primary.id,
    entityType: event.primary.type,
  };

  return createDoc(COLLECTIONS.AUDIT_LOGS, payload);
}

export function buildEntityActivityInput(params: EntityActivityInputParams): ActivityEventInput {
  const record = params.record ?? undefined;
  const label = params.label || (record ? getEntityLabel(params.entityType, record) : undefined);
  const primary = makeEntityRef(params.entityType, params.entityId, label);
  const related = record
    ? extractEntityRefsFromRecord(params.entityType, record).filter((ref) => !isSameRef(ref, primary))
    : [];

  return {
    type: params.type ?? `${params.entityType}.${normalizeAction(params.action).replace(/\s+/g, '_') || 'updated'}`,
    module: params.module,
    action: params.action,
    primary,
    related,
    message: params.message,
    severity: params.severity,
    visibility: params.visibility,
    metadata: params.metadata,
  };
}
