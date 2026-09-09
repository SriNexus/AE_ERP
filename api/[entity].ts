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
import { ENTITY_REGISTRY, isGlobalCollection, isRestWriteBlocked, isApiGroupAdmin, resolveApiCreateTenant, ApiTenantScopeError } from './_lib/registry';
import { resolveApiOwnershipScope, apiRecordIsOwned } from './_lib/ownership';
import { assertApiPartnerCanCreate, PartnerNotEligibleError } from './_lib/partnerEligibility';
import { checkRateLimit, getRateLimitKey } from './_lib/rateLimit';
import { filterManageableUsers, isOwnerEmail } from '../src/lib/ownerAccess';
import { createProductWithSkuLockAdmin, SkuConflictError } from './_lib/productSkuLock';
import {
  sendPaginated,
  sendCreated,
  sendBadRequest,
  sendInternalError,
  sendMethodNotAllowed,
  parsePagination,
  parseSearch,
  sanitizeCreateBody,
} from './_lib/response';

const READ_ONLY_ENTITY_MESSAGE =
  'This resource is read-only through the REST API. Inventory quantities and ledger movements ' +
  'are written only by the authorized application inventory workflow, never the generic REST endpoint.';

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

  // INVENTORY-02 (P0-2): read-only entities (stock, stock_ledger) reject every
  // mutating method with 405 BEFORE any auth / rate-limit / DB access — there
  // is no generic REST write path for them at all.
  if (isRestWriteBlocked(entityName, req.method)) {
    return sendMethodNotAllowed(res, READ_ONLY_ENTITY_MESSAGE);
  }

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
  // 'view' is gated by the caller's own company template. A GroupAdmin's list
  // is always hard-scoped by `where('groupId','==', actorGroup)` below (an
  // optional ?companyId= only narrows WITHIN that group), so this never
  // over-exposes another company's rows; a per-company 'view' template is not
  // resolved here because the `?companyId=` value is not itself group-vetted
  // and 'view' is not a per-company-customized grant in practice. The
  // per-target-company template DOES apply to the mutating paths
  // (create/edit/delete) — see handleCreate + api/[entity]/[id].ts.
  await requirePermission(user, 'view', config.module as any);

  const db = getAdminDb();
  const { page, perPage } = parsePagination(req.query as any);
  const { search, status, sortBy, sortOrder } = parseSearch(req.query as any);

  // Company isolation: only super-admin can filter by arbitrary companyId.
  const isGlobal = isGlobalCollection(config.collection);
  const companyId = user.isSuperAdmin && req.query.companyId
    ? String(req.query.companyId)
    : (user.companyId || '');
  // RBAC Master Plan Phase 8 — a GroupAdmin's API tenant scope is its whole
  // group (mirrors the client's companyScopedQuery + firestore.rules'
  // groupAdminCanRead: data.groupId == actorGroupId()), NOT just the home
  // company. An optional ?companyId= narrows within the group. Non-GroupAdmin
  // actors keep the exact companyId-only scoping above.
  const groupScoped = isApiGroupAdmin(user);
  const groupId = groupScoped ? String(user.groupId || '') : '';
  const subCompanyId = groupScoped && req.query.companyId ? String(req.query.companyId) : '';

  // Use perPage+1 heuristic to determine if there are more results
  // instead of an expensive count query
  const fetchLimit = perPage + 1;
  const offset = (page - 1) * perPage;

  // RBAC Master Plan Phase 10 (N1 / AUTH-C1): for `leads`/`customers` and a
  // caller whose seeded visibility on the module is 'self' (Partner) or 'team'
  // (Manager/TL), the REST API must enforce the same ownership scope
  // firestore.rules enforces (canReadLeadScoped / canReadCustomerScoped) — the
  // generic company/group scope alone let a Partner/Manager list every
  // same-company record. `mode: 'all'` (Sales/Admin/Director/GroupAdmin/Owner,
  // and every other collection) → no change.
  const ownership = await resolveApiOwnershipScope(db, user, config.collection, config.module);

  if (ownership.mode === 'owned') {
    // Ownership filtering only ever applies to a single-company role (Partner /
    // Manager/TL — never GroupAdmin, which resolves to `mode: 'all'`), so the
    // fetch is bounded by a single `where('companyId','==')` — one equality
    // filter, served by Firestore's automatic single-field index, no composite
    // index required. Server-side offset/limit is skipped (unsafe when the row
    // set is filtered AFTER the query — pages under-fill); the ownership /
    // status / search / sort / pagination all run in memory, mirroring
    // src/lib/firestore.ts's getAll() and the index-fallback path below.
    let ownedQuery: FirebaseFirestore.Query = db.collection(config.collection);
    if (companyId) ownedQuery = ownedQuery.where('companyId', '==', companyId);
    const allSnap = await ownedQuery.get();
    let ownedDocs: any[] = allSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((doc: any) => !doc.isDeleted && (!companyId || doc.companyId === companyId));
    ownedDocs = ownedDocs.filter((doc: any) => apiRecordIsOwned(doc, ownership.allowIds));
    if (status) ownedDocs = ownedDocs.filter((doc: any) => doc.status === status);
    if (search) {
      const term = search.toLowerCase();
      ownedDocs = ownedDocs.filter((doc: any) =>
        config.searchFields.some((field) => String(doc[field] || '').toLowerCase().includes(term)),
      );
    }
    ownedDocs.sort((a: any, b: any) => {
      const sortField = sortBy || 'createdAt';
      const aVal = a[sortField] || '';
      const bVal = b[sortField] || '';
      return sortOrder === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });
    const paged = ownedDocs.slice(offset, offset + perPage);
    return sendPaginated(res, paged, ownedDocs.length, page, perPage);
  }

  try {
    let query: FirebaseFirestore.Query = db.collection(config.collection);

    // Always filter out soft-deleted records
    query = query.where('isDeleted', '==', false);

    // Apply tenant filter (skip global collections like roles).
    if (!isGlobal) {
      if (groupScoped && groupId) {
        query = query.where('groupId', '==', groupId);
        if (subCompanyId) query = query.where('companyId', '==', subCompanyId);
      } else if (companyId) {
        query = query.where('companyId', '==', companyId);
      }
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
    // Fallback: if Firestore index is missing, fetch all and paginate in-memory.
    // INVENTORY-11 (§11b / BRAIN.md API-6): this silently degrades to an
    // UNSCOPED full-collection read (every tenant's raw documents pulled into
    // this function before the companyId filter is applied in-memory below) —
    // "make it loud" per Plan §14 11b, so a missing composite index is a
    // visible, actionable signal instead of a permanently-masked cost/latency
    // problem. The fallback behavior itself is intentionally UNCHANGED (this
    // stays a resilience path, not a hard 500, for every registered entity —
    // removing it outright is a broader REST-API behavior change than this
    // inventory-scoped phase should make) — only the visibility changes.
    if (error.code === 'failed-precondition' || (error.message && error.message.includes('index'))) {
      console.error(
        `[api/${config.collection}] Firestore composite index MISSING for handleList ` +
        `(companyId+isDeleted+${sortBy || 'createdAt'}${status ? '+status' : ''}) — ` +
        `falling back to a full-collection read. Add the matching composite index to ` +
        `firestore.indexes.json and deploy it.`,
        { collection: config.collection, sortBy: sortBy || 'createdAt', status: status || null, code: error.code },
      );
      try {
        const allSnap = await db.collection(config.collection).get();
        let allDocs = allSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((doc: any) => !doc.isDeleted);
        if (config.collection === 'users') allDocs = filterManageableUsers(allDocs);

        if (!isGlobal) {
          if (groupScoped && groupId) {
            allDocs = allDocs.filter((doc: any) => doc.groupId === groupId && (!subCompanyId || doc.companyId === subCompanyId));
          } else if (companyId) {
            allDocs = allDocs.filter((doc: any) => doc.companyId === companyId);
          }
        }
        if (status) {
          allDocs = allDocs.filter((doc: any) => doc.status === status);
        }
        // Phase 10 N1 (AUTH-C1): this index-fallback path is unreachable when
        // ownership filtering applies — a `mode: 'owned'` caller (Partner /
        // Manager on leads/customers) early-returns above via a plain
        // full-collection get() that needs no index and never raises
        // `failed-precondition`. Ownership enforcement therefore lives entirely
        // in that early-return branch; nothing to add here.
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
  // INVENTORY-02: defense in depth — a read-only entity never accepts a create,
  // regardless of how this handler is reached.
  if (config?.readOnly === true) {
    return sendMethodNotAllowed(res, READ_ONLY_ENTITY_MESSAGE);
  }

  const db = getAdminDb();
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendBadRequest(res, 'Request body must be a JSON object.');
  }

  // RBAC Master Plan Phase 8 — one centralized tenant resolution: SuperAdmin
  // may target any company; a GroupAdmin may target any company IN THEIR
  // GROUP (an out-of-group request is a 403, never a silent redirect); every
  // other role gets their home company exactly as before. Also returns the
  // authoritative groupId the new doc must carry (the client write path
  // already stamps this; the generic API path did not — closing that gap so
  // a GroupAdmin's group-scoped reads can see records created here).
  let companyId: string;
  let resolvedGroupId: string;
  try {
    ({ companyId, groupId: resolvedGroupId } = await resolveApiCreateTenant(db, user, body.companyId));
  } catch (error) {
    if (error instanceof ApiTenantScopeError) {
      return res.status(403).json({ success: false, error: { code: error.code, message: error.message } });
    }
    throw error;
  }
  if (!companyId) return sendBadRequest(res, 'Authenticated identity has no company scope.');

  // RBAC Master Plan §5.2: the permission check runs AFTER tenant resolution
  // so a GroupAdmin creating in a legitimate same-group sibling company is
  // gated by THAT company's Admin role template, not their home company's
  // (resolveApiCreateTenant already rejected an out-of-group target with a
  // 403). Non-GroupAdmin actors always resolve to their own `companyId` here.
  await requirePermission(user, 'create', config.module as any, companyId);

  // RBAC Master Plan §15 BD-3 (owner-approved 2026-09-09): a suspended /
  // inactive / not-yet-approved Channel Partner may not create NEW
  // leads/customers/projects/scheme_registrations through the REST facade —
  // mirrors firestore.rules' partnerCreateEligible(). No-op for every
  // non-Partner caller and every other collection. KYC is advisory (not
  // checked). Runs after requirePermission so it never leaks whether the
  // module grant exists.
  try {
    await assertApiPartnerCanCreate(db, user, config.collection);
  } catch (error) {
    if (error instanceof PartnerNotEligibleError) {
      return res.status(403).json({ success: false, error: { code: error.code, message: error.message } });
    }
    throw error;
  }

  // Phase 15: this used to ALSO enforce a hard per-entity cap (max 5
  // non-deleted records for the demo company) here. Removed — it directly
  // contradicted the Blueprint's "no artificial ceiling" principle. The
  // client-side mirror of this same cap (src/lib/firestore.ts's
  // enforceDemoRecordLimit()) was later deleted outright, not just relaxed
  // (Demo-to-Group conversion — docs/reports/NEOZY_DEMO_GROUP_CONVERSION_REPORT.md):
  // Neozy Demo is a real Group now, so no capability-gating mechanism keyed
  // on "is this the demo company" exists anywhere in this codebase.

  if (config.collection === 'users' && isOwnerEmail(body.email)) {
    return sendBadRequest(res, 'This Firebase owner identity is not a manageable ERP user.');
  }

  const docData = sanitizeCreateBody(body, user.uid, companyId);
  // sanitizeCreateBody() strips the reserved `groupId` field (mass-assignment
  // protection); re-stamp the authoritative, server-resolved value — the
  // exact parallel of the client's resolveWriteGroupId(). Company-scoped
  // collections only; global collections (roles) never carry a groupId.
  if (resolvedGroupId && !isGlobalCollection(config.collection)) {
    docData.groupId = resolvedGroupId;
  }

  try {
    // INVENTORY-09 (§A): the `products` write path additionally claims the
    // SAME company-scoped SKU lock the SDK create path uses — one
    // authoritative uniqueness mechanism, not a second implementation.
    if (config.collection === 'products') {
      const id = body.id || db.collection(config.collection).doc().id;
      await createProductWithSkuLockAdmin(db, id, docData, companyId);
      return sendCreated(res, { id, ...docData });
    }

    if (body.id) {
      await db.collection(config.collection).doc(body.id).create(docData);
      return sendCreated(res, { id: body.id, ...docData });
    }

    const ref = await db.collection(config.collection).add(docData);
    return sendCreated(res, { id: ref.id, ...docData });
  } catch (error: any) {
    if (error instanceof SkuConflictError) {
      return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: error.message } });
    }
    if (error.code === 'ALREADY_EXISTS' || (error.message && error.message.includes('already exists'))) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: `A ${config.collection} record with this ID already exists.` },
      });
    }
    throw error;
  }
}
