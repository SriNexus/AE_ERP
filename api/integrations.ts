import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AuthResolutionError, resolveAuthenticatedUser } from './_lib/auth';
import {
  createDefaultIntegrationPlatformAdapter,
  resolveIntegrationRequest,
  normalizeIntegrationAction,
  normalizeIntegrationSection,
  type IntegrationPlatformAdapter,
} from './_lib/integrationPlatform';
import { sendBadRequest, sendError, sendSuccess } from './_lib/response';
import {isDemoCapabilityAllowed} from '../src/lib/demoCapabilityPolicy';

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export interface IntegrationHandlerDeps {
  adapter: IntegrationPlatformAdapter;
  authenticate(authHeader?: string | null, apiKeyHeader?: string | null): ReturnType<typeof resolveAuthenticatedUser>;
}

export async function handleIntegrationsRequest(req: VercelRequest, res: VercelResponse, deps?: Partial<IntegrationHandlerDeps>) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const adapter = deps?.adapter || await createDefaultIntegrationPlatformAdapter();
  const authenticate = deps?.authenticate || resolveAuthenticatedUser;

  let auth;
  try {
    auth = await authenticate(headerValue(req.headers.authorization), headerValue(req.headers['x-api-key']));
  } catch (error) {
    if (error instanceof AuthResolutionError) {
      return sendError(res, error.status, error.code, error.message);
    }
    return sendError(res, 500, 'BOOTSTRAP_FAILED', 'Authentication failed unexpectedly.');
  }

  if (!auth.isSuperAdmin && auth.role !== 'Admin') {
    return sendError(res, 403, 'FORBIDDEN', 'Only Admin users can manage integration secrets.');
  }

  if(!isDemoCapabilityAllowed(auth.companyId,'integration-secrets'))return sendError(res,403,'DEMO_CAPABILITY_BLOCKED','Integration secret operations are unavailable in the public demo.');

  const body = asRecord(req.body) || {};
  const section = normalizeIntegrationSection(req.method === 'GET' ? req.query.section : body.section);
  if (!section) {
    return sendBadRequest(res, 'A valid integration section is required.');
  }

  const requestedCompanyId = text(body.companyId ?? req.query.companyId);
  if (requestedCompanyId && requestedCompanyId !== auth.companyId) {
    return sendError(res, 403, 'FORBIDDEN', 'The requested company does not match the authenticated account.');
  }

  const action = req.method === 'GET'
    ? 'status'
    : normalizeIntegrationAction(body.action);

  if (req.method === 'GET') {
    try {
      const result = await resolveIntegrationRequest(null, null, section, 'status', undefined, {
        authenticate: async () => auth,
        adapter,
      });
      return sendSuccess(res, result);
    } catch (error) {
      if (error instanceof AuthResolutionError) {
        return sendError(res, error.status, error.code, error.message);
      }
      return sendError(res, 500, 'BOOTSTRAP_FAILED', 'Failed to read integration status.');
    }
  }

  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET for status or POST for update actions.');
  }

  if (!action) {
    return sendBadRequest(res, 'A valid integration action is required.');
  }

  try {
    const result = await resolveIntegrationRequest(null, null, section, action, body.secretPayload, {
      authenticate: async () => auth,
      adapter,
    });
    return sendSuccess(res, result);
  } catch (error) {
    if (error instanceof AuthResolutionError) {
      return sendError(res, error.status, error.code, error.message);
    }
    return sendError(res, 500, 'BOOTSTRAP_FAILED', 'Failed to process integration request.');
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleIntegrationsRequest(req, res);
}
