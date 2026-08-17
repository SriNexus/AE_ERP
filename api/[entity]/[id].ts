/**
 * Generic REST API handler for single-resource operations.
 *
 * File-based routing: `/api/:entity/:id` → this handler
 * Supports: GET (by ID), PUT (update), DELETE (soft delete)
 *
 * Uses shared ENTITY_REGISTRY from _lib/registry.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminDb } from '../_lib/firebase';
import { verifyAuthToken } from '../_lib/auth';
import { requirePermission } from '../_lib/permissions';
import { ENTITY_REGISTRY, isGlobalCollection } from '../_lib/registry';
import { checkRateLimit, getRateLimitKey } from '../_lib/rateLimit';
import { isHiddenOwnerRecord } from '../../src/lib/ownerAccess';
import { sendSuccess, sendNoContent, sendBadRequest, sendNotFound, sendInternalError, IMMUTABLE_FIELDS } from '../_lib/response';

// ── CORS headers ───────────────────────────────────────────────
function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Extract entity name and ID from URL: /api/projects/abc123
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const segments = url.pathname.split('/').filter(Boolean);
  const entityName = segments[1];
  const resourceId = segments[2];

  if (!entityName || !ENTITY_REGISTRY[entityName]) {
    return sendBadRequest(res, `Unknown entity: '${entityName}'.`);
  }
  if (!resourceId) {
    return sendBadRequest(res, 'Resource ID is required.');
  }

  const config = ENTITY_REGISTRY[entityName];

  // Authenticate
  const user = await verifyAuthToken(req.headers.authorization, req.headers['x-api-key'] as string | undefined);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
    });
  }

  // Rate limit
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress;
  const rateKey = getRateLimitKey(user.uid, clientIp);
  const rateCheck = checkRateLimit(rateKey);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGetById(req, res, config, resourceId, user);
      case 'PUT':
      case 'PATCH':
        return handleUpdate(req, res, config, resourceId, user);
      case 'DELETE':
        return handleDelete(req, res, config, resourceId, user);
      default:
        return res.status(405).json({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed.` },
        });
    }
  } catch (error: any) {
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: error.message } });
    }
    if (error.statusCode === 404) {
      return sendNotFound(res, error.message);
    }
    return sendInternalError(res, error.message || 'Internal server error');
  }
}

// ── Handlers ─────────────────────────────────────────────────

async function handleGetById(
  req: VercelRequest,
  res: VercelResponse,
  config: typeof ENTITY_REGISTRY[string],
  resourceId: string,
  user: any,
) {
  await requirePermission(user, 'view', config.module as any);

  const db = getAdminDb();
  const docSnap = await db.collection(config.collection).doc(resourceId).get();

  if (!docSnap.exists) {
    return sendNotFound(res, `Resource not found.`);
  }

  const data = docSnap.data();
  if (config.collection === 'users' && isHiddenOwnerRecord(data)) {
    return sendNotFound(res, 'Resource not found.');
  }
  if (!isGlobalCollection(config.collection) && !user.isSuperAdmin && data?.companyId !== user.companyId) {
    return sendNotFound(res, 'Resource not found.');
  }
  if (data?.isDeleted) {
    return sendNotFound(res, `Resource has been deleted.`);
  }

  return sendSuccess(res, { id: docSnap.id, ...data });
}

async function handleUpdate(
  req: VercelRequest,
  res: VercelResponse,
  config: typeof ENTITY_REGISTRY[string],
  resourceId: string,
  user: any,
) {
  await requirePermission(user, 'edit', config.module as any);

  const db = getAdminDb();
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendBadRequest(res, 'Request body must be a JSON object.');
  }

  // Check document exists
  const existingSnap = await db.collection(config.collection).doc(resourceId).get();
  if (!existingSnap.exists) {
    return sendNotFound(res, `Resource not found.`);
  }
  if (config.collection === 'users' && isHiddenOwnerRecord(existingSnap.data())) {
    return sendNotFound(res, 'Resource not found.');
  }
  if (!isGlobalCollection(config.collection) && !user.isSuperAdmin && existingSnap.data()?.companyId !== user.companyId) {
    return sendNotFound(res, 'Resource not found.');
  }
  if (existingSnap.data()?.isDeleted) {
    return sendNotFound(res, `Resource has been deleted.`);
  }

  // Strip immutable fields from the update payload
  const updateData: Record<string, unknown> = {
    updatedBy: user.uid,
    updatedAt: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(body)) {
    if (!IMMUTABLE_FIELDS.has(key)) {
      updateData[key] = value;
    }
  }

  await db.collection(config.collection).doc(resourceId).update(updateData);

  // Fetch the updated document
  const updatedSnap = await db.collection(config.collection).doc(resourceId).get();
  return sendSuccess(res, { id: updatedSnap.id, ...updatedSnap.data() });
}

async function handleDelete(
  req: VercelRequest,
  res: VercelResponse,
  config: typeof ENTITY_REGISTRY[string],
  resourceId: string,
  user: any,
) {
  await requirePermission(user, 'delete', config.module as any);

  const db = getAdminDb();

  const existingSnap = await db.collection(config.collection).doc(resourceId).get();
  if (!existingSnap.exists) {
    return sendNotFound(res, `Resource not found.`);
  }
  if (config.collection === 'users' && isHiddenOwnerRecord(existingSnap.data())) {
    return sendNotFound(res, 'Resource not found.');
  }
  if (!isGlobalCollection(config.collection) && !user.isSuperAdmin && existingSnap.data()?.companyId !== user.companyId) {
    return sendNotFound(res, 'Resource not found.');
  }
  if (existingSnap.data()?.isDeleted) {
    return sendNotFound(res, `Resource has already been deleted.`);
  }

  // Soft delete
  await db.collection(config.collection).doc(resourceId).update({
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    deletedBy: user.uid,
    updatedBy: user.uid,
    updatedAt: new Date().toISOString(),
  });

  return sendNoContent(res);
}
