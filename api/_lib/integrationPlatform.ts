/**
 * Secure Integration Platform — shared server-side secret boundary.
 *
 * This module is intentionally generic: it stores provider secrets on the
 * trusted backend, writes only masked metadata back to Firestore, and never
 * returns raw secret values to the caller.
 */

import { getAdminDb, getAdminStorageBucket } from './firebase';
import { AuthResolutionError, resolveAuthenticatedUser, type AuthenticatedUser } from './auth';

export type IntegrationSectionId = 'email' | 'whatsapp' | 'sms' | 'integrations';
export type IntegrationAction = 'status' | 'update' | 'rotate' | 'test' | 'disconnect';

export interface IntegrationSecretEnvelope {
  version: 1;
  companyId: string;
  section: IntegrationSectionId;
  secretPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  lastAction: IntegrationAction;
}

export interface IntegrationMaskedStatus {
  hasSecretConfigured: boolean;
  secretLastUpdatedAt?: string;
  secretLastRotatedBy?: string;
}

export interface IntegrationOperationResult extends IntegrationMaskedStatus {
  companyId: string;
  section: IntegrationSectionId;
  action: IntegrationAction;
  secretKeyCount: number;
}

export interface IntegrationPlatformAdapter {
  readSecretEnvelope(companyId: string, section: IntegrationSectionId): Promise<IntegrationSecretEnvelope | null>;
  writeSecretEnvelope(companyId: string, section: IntegrationSectionId, envelope: IntegrationSecretEnvelope): Promise<void>;
  deleteSecretEnvelope(companyId: string, section: IntegrationSectionId): Promise<void>;
  writeMaskedStatus(companyId: string, section: IntegrationSectionId, status: IntegrationMaskedStatus, updatedBy: string): Promise<void>;
  appendAuditLog(entry: Record<string, unknown>): Promise<void>;
}

async function appendAuditLogSafely(adapter: IntegrationPlatformAdapter, entry: Record<string, unknown>): Promise<void> {
  try {
    await adapter.appendAuditLog(entry);
  } catch {
    // Audit logging must never break secret management.
  }
}

const VALID_SECTIONS: IntegrationSectionId[] = ['email', 'whatsapp', 'sms', 'integrations'];
const VALID_ACTIONS: IntegrationAction[] = ['status', 'update', 'rotate', 'test', 'disconnect'];

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function normalizeIntegrationSection(value: unknown): IntegrationSectionId | null {
  const candidate = text(value).toLowerCase();
  return (VALID_SECTIONS as string[]).includes(candidate) ? candidate as IntegrationSectionId : null;
}

export function normalizeIntegrationAction(value: unknown): IntegrationAction | null {
  const candidate = text(value).toLowerCase();
  return (VALID_ACTIONS as string[]).includes(candidate) ? candidate as IntegrationAction : null;
}

export function normalizeSecretPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AuthResolutionError(422, 'INVALID_PAYLOAD', 'Secret payload must be a plain object.');
  }
  try {
    const cloned = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    if (!Object.keys(cloned).length) {
      throw new AuthResolutionError(422, 'INVALID_PAYLOAD', 'Secret payload must include at least one field.');
    }
    return cloned;
  } catch (error) {
    if (error instanceof AuthResolutionError) throw error;
    throw new AuthResolutionError(422, 'INVALID_PAYLOAD', 'Secret payload must be JSON-serializable.', { cause: error });
  }
}

export function buildSecretPath(companyId: string, section: IntegrationSectionId): string {
  return `integration-secrets/${companyId}/${section}.json`;
}

export function maskEnvelope(envelope: IntegrationSecretEnvelope | null): IntegrationMaskedStatus {
  if (!envelope) {
    return { hasSecretConfigured: false };
  }
  return {
    hasSecretConfigured: Object.keys(envelope.secretPayload || {}).length > 0,
    secretLastUpdatedAt: envelope.updatedAt,
    secretLastRotatedBy: envelope.updatedBy,
  };
}

export function summarizeEnvelope(companyId: string, section: IntegrationSectionId, action: IntegrationAction, envelope: IntegrationSecretEnvelope | null): IntegrationOperationResult {
  const masked = maskEnvelope(envelope);
  return {
    companyId,
    section,
    action,
    secretKeyCount: envelope ? Object.keys(envelope.secretPayload || {}).length : 0,
    ...masked,
  };
}

export async function createDefaultIntegrationPlatformAdapter(): Promise<IntegrationPlatformAdapter> {
  const db = getAdminDb();
  const bucket = getAdminStorageBucket();

  return {
    async readSecretEnvelope(companyId, section) {
      const file = bucket.file(buildSecretPath(companyId, section));
      const [exists] = await file.exists();
      if (!exists) return null;
      const [content] = await file.download();
      const parsed = JSON.parse(content.toString('utf8')) as IntegrationSecretEnvelope;
      if (!parsed || parsed.version !== 1 || parsed.companyId !== companyId || parsed.section !== section) return null;
      return parsed;
    },
    async writeSecretEnvelope(companyId, section, envelope) {
      const file = bucket.file(buildSecretPath(companyId, section));
      await file.save(JSON.stringify(envelope, null, 2), {
        resumable: false,
        metadata: {
          contentType: 'application/json',
          cacheControl: 'private, no-store, max-age=0',
        },
      });
    },
    async deleteSecretEnvelope(companyId, section) {
      const file = bucket.file(buildSecretPath(companyId, section));
      await file.delete({ ignoreNotFound: true });
    },
    async writeMaskedStatus(companyId, section, status, updatedBy) {
      const docId = `${companyId}_settings_${section}`;
      const now = status.secretLastUpdatedAt || new Date().toISOString();
      await db.collection('settings').doc(docId).set({
        companyId,
        section,
        data: {
          hasSecretConfigured: status.hasSecretConfigured,
          secretLastUpdatedAt: status.secretLastUpdatedAt || now,
          secretLastRotatedBy: status.secretLastRotatedBy || updatedBy,
        },
        updatedAt: now,
        updatedBy,
      }, { merge: true });
    },
    async appendAuditLog(entry) {
      const id = String(entry.id || `INT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      await db.collection('audit_logs').doc(id).set({
        id,
        ...entry,
      });
    },
  };
}

export interface IntegrationRequestInput {
  auth: AuthenticatedUser;
  section: IntegrationSectionId;
  action: IntegrationAction;
  secretPayload?: Record<string, unknown>;
}

export async function runIntegrationAction(
  input: IntegrationRequestInput,
  adapter: IntegrationPlatformAdapter,
): Promise<IntegrationOperationResult> {
  const now = new Date().toISOString();
  const { auth, section, action } = input;
  const companyId = auth.companyId;

  if (action === 'disconnect') {
    await adapter.deleteSecretEnvelope(companyId, section);
    const status: IntegrationMaskedStatus = {
      hasSecretConfigured: false,
      secretLastUpdatedAt: now,
      secretLastRotatedBy: auth.erpUserId,
    };
    await adapter.writeMaskedStatus(companyId, section, status, auth.erpUserId);
    await appendAuditLogSafely(adapter, {
      id: `INT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      companyId,
      module: 'settings',
      action: `integration.${action}`,
      section,
      entityId: section,
      entityName: `Integration: ${section}`,
      userId: auth.erpUserId,
      userName: auth.name,
      changedFields: ['secretPayload'],
      outcome: 'success',
      createdAt: now,
      isDeleted: false,
    });
    return summarizeEnvelope(companyId, section, action, null);
  }

  if (action === 'status') {
    const envelope = await adapter.readSecretEnvelope(companyId, section);
    return summarizeEnvelope(companyId, section, action, envelope);
  }

  if (action === 'test') {
    const envelope = await adapter.readSecretEnvelope(companyId, section);
    if (!envelope) {
      throw new AuthResolutionError(409, 'INTEGRATION_NOT_CONFIGURED', 'No integration secret has been configured yet.');
    }
    await appendAuditLogSafely(adapter, {
      id: `INT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      companyId,
      module: 'settings',
      action: `integration.${action}`,
      section,
      entityId: section,
      entityName: `Integration: ${section}`,
      userId: auth.erpUserId,
      userName: auth.name,
      changedFields: ['secretPayload'],
      outcome: 'success',
      createdAt: now,
      isDeleted: false,
    });
    return summarizeEnvelope(companyId, section, action, envelope);
  }

  const secretPayload = normalizeSecretPayload(input.secretPayload);
  const existing = await adapter.readSecretEnvelope(companyId, section);
  const envelope: IntegrationSecretEnvelope = {
    version: 1,
    companyId,
    section,
    secretPayload,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy: auth.erpUserId,
    lastAction: action,
  };

  await adapter.writeSecretEnvelope(companyId, section, envelope);
  await adapter.writeMaskedStatus(companyId, section, {
    hasSecretConfigured: true,
    secretLastUpdatedAt: now,
    secretLastRotatedBy: auth.erpUserId,
  }, auth.erpUserId);
  await appendAuditLogSafely(adapter, {
    id: `INT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    companyId,
    module: 'settings',
    action: `integration.${action}`,
    section,
    entityId: section,
    entityName: `Integration: ${section}`,
    userId: auth.erpUserId,
    userName: auth.name,
    changedFields: Object.keys(secretPayload),
    outcome: 'success',
    createdAt: now,
    isDeleted: false,
  });
  return summarizeEnvelope(companyId, section, action, envelope);
}

export async function resolveIntegrationRequest(
  authHeader?: string | null,
  apiKeyHeader?: string | null,
  section?: unknown,
  action?: unknown,
  secretPayload?: unknown,
  deps?: { authenticate: typeof resolveAuthenticatedUser; adapter: IntegrationPlatformAdapter },
): Promise<IntegrationOperationResult> {
  if (!deps) {
    throw new AuthResolutionError(500, 'BOOTSTRAP_FAILED', 'Integration platform dependencies are missing.');
  }
  const auth = await deps.authenticate(authHeader, apiKeyHeader);
  const normalizedSection = normalizeIntegrationSection(section);
  const normalizedAction = normalizeIntegrationAction(action);
  if (!normalizedSection) {
    throw new AuthResolutionError(422, 'INVALID_SECTION', 'A valid integration section is required.');
  }
  if (!normalizedAction) {
    throw new AuthResolutionError(422, 'INVALID_ACTION', 'A valid integration action is required.');
  }
  if (normalizedAction !== 'disconnect' && normalizedAction !== 'status' && normalizedAction !== 'test' && (!secretPayload || typeof secretPayload !== 'object')) {
    throw new AuthResolutionError(422, 'INVALID_PAYLOAD', 'Secret payload must be provided for update and rotate actions.');
  }
  return runIntegrationAction({
    auth,
    section: normalizedSection,
    action: normalizedAction,
    secretPayload: secretPayload as Record<string, unknown> | undefined,
  }, deps.adapter);
}
