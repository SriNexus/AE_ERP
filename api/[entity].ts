/**
 * Generic REST API handler for listing and creating resources.
 *
 * File-based routing: `/api/:entity` → this handler
 * Supports: GET (list with pagination), POST (create)
 *
 * Uses shared ENTITY_REGISTRY from _lib/registry.ts for collection-to-module mapping.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminDb } from './_lib/firebase';
import { verifyAuthToken } from './_lib/auth';
import { requirePermission } from './_lib/permissions';
import { ENTITY_REGISTRY, isGlobalCollection } from './_lib/registry';
import { checkRateLimit, getRateLimitKey } from './_lib/rateLimit';
import { filterManageableUsers, isOwnerEmail } from '../src/lib/ownerAccess';
import {
  sendPaginated,
  sendCreated,
  sendBadRequest,
  sendInternalError,
  parsePagination,
  parseSearch,
  sanitizeCreateBody,
} from './_lib/response';

// ── Route handler ────────────────────────────────────────────

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

  // Extract entity name from URL path: /api/projects → projects
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const segments = url.pathname.split('/').filter(Boolean);
  const entityName = segments[1];

  if (!entityName || !ENTITY_REGISTRY[entityName]) {
    return sendBadRequest(res, `Unknown entity: '${entityName}'. See /api for available endpoints.`);
  }

  const config = ENTITY_REGISTRY[entityName];

  // Authenticate
  const user = await verifyAuthToken(req.headers.authorization, req.headers['x-api-key'] as string | undefined);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required. Provide a Firebase ID token (Bearer) or API key (X-API-Key header).' },
    });
  }

  // Rate limit
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress;
  const rateKey = getRateLimitKey(user.uid, clientIp);
  const rateCheck = checkRateLimit(rateKey);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: `Too many requests. Try again after ${Math.ceil((rateCheck.resetAt - Date.now()) / 1000)} seconds.` },
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleList(req, res, config, user);
      case 'POST':
        return handleCreate(req, res, config, user);
      default:
        return res.status(405).json({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed for '${entityName}'.` },
        });
    }
  } catch (error: any) {
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: error.message } });
    }
    return sendInternalError(res, error.message || 'Internal server error');
  }
}

// ── Handlers ─────────────────────────────────────────────────

async function handleList(req: VercelRequest, res: VercelResponse, config: typeof ENTITY_REGISTRY[string], user: any) {
  await requirePermission(user, 'view', config.module as any);

  const db = getAdminDb();
  const { page, perPage } = parsePagination(req.query as any);
  const { search, status, sortBy, sortOrder } = parseSearch(req.query as any);

  // Company isolation: only super-admin can filter by arbitrary companyId
  const isGlobal = isGlobalCollection(config.collection);
  const companyId = user.isSuperAdmin && req.query.companyId
    ? String(req.query.companyId)
    : (user.companyId || '');

  // Use perPage+1 heuristic to determine if there are more results
  // instead of an expensive count query
  const fetchLimit = perPage + 1;
  const offset = (page - 1) * perPage;

  try {
    let query: FirebaseFirestore.Query = db.collection(config.collection);

    // Always filter out soft-deleted records
    query = query.where('isDeleted', '==', false);

    // Apply company filter (skip global collections like roles, companies, users)
    if (companyId && !isGlobal) {
      query = query.where('companyId', '==', companyId);
    }

    // Apply status filter if provided
    if (status) {
      query = query.where('status', '==', status);
    }

    // Sort
    const sortField = sortBy || 'createdAt';
    const sortDir = sortOrder === 'asc' ? 'asc' : 'desc';
    query = query.orderBy(sortField, sortDir);

    // Apply pagination
    query = query.offset(offset).limit(fetchLimit);

    const snap = await query.get();
    const documents = config.collection === 'users'
      ? filterManageableUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      : snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Apply search filter client-side
    const filtered = search
      ? documents.filter((doc: any) => {
          const term = search.toLowerCase();
          return config.searchFields.some((field) => String(doc[field] || '').toLowerCase().includes(term));
        })
      : documents;

    // Use perPage+1 to determine hasMore
    const hasMore = filtered.length > perPage;
    const paged = filtered.slice(0, perPage);
    const estimatedTotal = offset + filtered.length;

    return sendPaginated(res, paged, estimatedTotal, page, perPage);
  } catch (error: any) {
    // Fallback: if Firestore index is missing, fetch all and paginate in-memory
    if (error.code === 'failed-precondition' || (error.message && error.message.includes('index'))) {
      try {
        const allSnap = await db.collection(config.collection).get();
        let allDocs = allSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((doc: any) => !doc.isDeleted);
        if (config.collection === 'users') allDocs = filterManageableUsers(allDocs);

        if (companyId && !isGlobal) {
          allDocs = allDocs.filter((doc: any) => doc.companyId === companyId);
        }
        if (status) {
          allDocs = allDocs.filter((doc: any) => doc.status === status);
        }
        if (search) {
          const term = search.toLowerCase();
          allDocs = allDocs.filter((doc: any) =>
            config.searchFields.some((field) => String(doc[field] || '').toLowerCase().includes(term))
          );
        }

        allDocs.sort((a: any, b: any) => {
          const sortField = sortBy || 'createdAt';
          const aVal = a[sortField] || '';
          const bVal = b[sortField] || '';
          return sortOrder === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
        });

        const hasMore = allDocs.length > offset + perPage;
        const paged = allDocs.slice(offset, offset + perPage);
        return sendPaginated(res, paged, allDocs.length, page, perPage);
      } catch {
        return sendInternalError(res, 'Failed to fetch resources');
      }
    }

    return sendInternalError(res, 'An unexpected error occurred');
  }
}

async function handleCreate(req: VercelRequest, res: VercelResponse, config: typeof ENTITY_REGISTRY[string], user: any) {
  await requirePermission(user, 'create', config.module as any);

  const db = getAdminDb();
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendBadRequest(res, 'Request body must be a JSON object.');
  }

  const companyId = user.isSuperAdmin && typeof body.companyId === 'string'
    ? body.companyId.trim()
    : user.companyId;
  if (!companyId) return sendBadRequest(res, 'Authenticated identity has no company scope.');

  // Phase 15: this used to ALSO enforce a hard per-entity cap (max 5
  // non-deleted records for the demo company) here — the server-side
  // mirror of the same artificial ceiling removed from src/lib/firestore.ts
  // (see that file's enforceDemoRecordLimit() doc comment for the full
  // rationale). Removed for the same reason: it directly contradicted the
  // Blueprint's "no artificial ceiling" principle and, in practice, blocked
  // all demo creation through this API once the seed data — which every
  // collection here already exceeds 5 records in — was in place.

  if (config.collection === 'users' && isOwnerEmail(body.email)) {
    return sendBadRequest(res, 'This Firebase owner identity is not a manageable ERP user.');
  }

  const docData = sanitizeCreateBody(body, user.uid, companyId);

  try {
    if (body.id) {
      await db.collection(config.collection).doc(body.id).create(docData);
      return sendCreated(res, { id: body.id, ...docData });
    }

    const ref = await db.collection(config.collection).add(docData);
    return sendCreated(res, { id: ref.id, ...docData });
  } catch (error: any) {
    if (error.code === 'ALREADY_EXISTS' || (error.message && error.message.includes('already exists'))) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: `A ${config.collection} record with this ID already exists.` },
      });
    }
    throw error;
  }
}
