/**
 * Response helpers — Standard API response utilities
 *
 * Ensures consistent JSON response format across all endpoints.
 */

import type { VercelResponse } from '@vercel/node';

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: {
    total?: number;
    page?: number;
    perPage?: number;
    hasMore?: boolean;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Send a successful response.
 */
export function sendSuccess<T>(res: VercelResponse, data: T, status = 200, meta?: ApiSuccessResponse['meta']) {
  const body: ApiSuccessResponse<T> = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

/**
 * Send a paginated list response.
 */
export function sendPaginated<T>(
  res: VercelResponse,
  data: T[],
  total: number,
  page: number,
  perPage: number,
) {
  return sendSuccess(res, data, 200, {
    total,
    page,
    perPage,
    hasMore: page * perPage < total,
  });
}

/**
 * Send a created response (201).
 */
export function sendCreated<T>(res: VercelResponse, data: T) {
  return sendSuccess(res, data, 201);
}

/**
 * Send a no-content response (204).
 */
export function sendNoContent(res: VercelResponse) {
  return res.status(204).end();
}

/**
 * Send an error response.
 */
export function sendError(
  res: VercelResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  const body: ApiErrorResponse = {
    success: false,
    error: { code, message },
  };
  if (details !== undefined) body.error.details = details;
  return res.status(status).json(body);
}

/**
 * Send a 400 Bad Request.
 */
export function sendBadRequest(res: VercelResponse, message: string, details?: unknown) {
  return sendError(res, 400, 'BAD_REQUEST', message, details);
}

/**
 * Send a 404 Not Found.
 */
export function sendNotFound(res: VercelResponse, message = 'Resource not found') {
  return sendError(res, 404, 'NOT_FOUND', message);
}

/**
 * Send a 409 Conflict.
 */
export function sendConflict(res: VercelResponse, message: string) {
  return sendError(res, 409, 'CONFLICT', message);
}

/**
 * Send a 500 Internal Server Error.
 */
export function sendInternalError(res: VercelResponse, message = 'Internal server error') {
  return sendError(res, 500, 'INTERNAL_ERROR', message);
}

/**
 * Immutable fields that cannot be set or overridden by client input.
 * Shared between api/[entity].ts and api/[entity]/[id].ts.
 */
export const IMMUTABLE_FIELDS = new Set([
  'id',
  'companyId',
  'createdBy',
  'createdAt',
  'updatedBy',
  'updatedAt',
  'isDeleted',
  'deletedAt',
  'deletedBy',
]);

/**
 * DI-03 (Phase 4): the reserved identity/tenant/security surface no
 * entity's legitimate schema in this generic REST API ever accepts from
 * client input — a superset of IMMUTABLE_FIELDS, which only ever covered
 * audit/ownership bookkeeping fields and never actually blocked `groupId`,
 * `role`, `isSuperAdmin`, or `permissions`, leaving them fully writable
 * through the generic PATCH route despite being exactly the fields DI-03
 * flags as the concrete privilege-escalation risk. This route has no
 * internal caller (the web app talks to Firestore directly, governed by
 * firestore.rules; this REST facade is documented — api/index.ts — as the
 * external/machine-to-machine integration surface). None of these fields is
 * legitimate client-supplied business data on ANY entity in ENTITY_REGISTRY.
 * Used on BOTH create (sanitizeCreateBody) and update
 * (buildWritableUpdatePayload) — but on update it is only the second layer
 * of the writable-field gate; see buildWritableUpdatePayload for the first
 * (per-entity) layer.
 */
export const SECURITY_RESERVED_FIELDS = new Set<string>([
  ...IMMUTABLE_FIELDS,
  'groupId',
  'role',
  'isSuperAdmin',
  'permissions',
  'isOwner',
  'ownerEmail',
]);

/**
 * Build the writable-field payload for a PATCH/PUT update — the actual
 * per-entity allowlist: a field is writable only if (a) it already exists
 * as a key on the document being updated — i.e. the entity's OWN real,
 * current shape, not a hand-authored guess at 28 heterogeneous entities'
 * schemas, which would risk rejecting legitimate fields I have no ground
 * truth for — and (b) it is not one of the universal SECURITY_RESERVED_FIELDS
 * (checked even for a pre-existing key, in case a reserved name ever ended
 * up on a legacy/malformed document). `updatedBy`/`updatedAt` are always
 * server-stamped, and prototype-polluting key names (`__proto__`/
 * `constructor`/`prototype`) are rejected outright regardless. A brand-new
 * field the target document has never had cannot be introduced through this
 * generic PATCH route — establishing a new field belongs to the entity's
 * `create` path (sanitizeCreateBody), which has no such restriction.
 */
export function buildWritableUpdatePayload(
  body: Record<string, unknown>,
  userUid: string,
  existingData: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    updatedBy: userUid,
    updatedAt: new Date().toISOString(),
  };
  const knownFields = new Set(Object.keys(existingData));
  for (const [key, value] of Object.entries(body)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (SECURITY_RESERVED_FIELDS.has(key)) continue;
    if (!knownFields.has(key)) continue;
    payload[key] = value;
  }
  return payload;
}

/**
 * Sanitize a create request body by stripping immutable/reserved fields and
 * ensuring required timestamps. DI-03 (Phase 4): uses SECURITY_RESERVED_FIELDS,
 * not just IMMUTABLE_FIELDS — POST shares the exact same mass-assignment
 * surface as PATCH (buildWritableUpdatePayload above), and leaving it on the
 * narrower set here would make the PATCH fix trivially bypassable by
 * creating a fresh document with `role`/`isSuperAdmin`/`groupId`/`permissions`
 * instead of patching an existing one.
 */
export function sanitizeCreateBody(
  body: Record<string, unknown>,
  userUid: string,
  companyId: string,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (SECURITY_RESERVED_FIELDS.has(key)) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    sanitized[key] = value;
  }
  const now = new Date().toISOString();
  sanitized.companyId = sanitized.companyId || companyId;
  sanitized.createdBy = userUid;
  sanitized.updatedBy = userUid;
  sanitized.createdAt = now;
  sanitized.updatedAt = now;
  sanitized.isDeleted = false;
  return sanitized;
}

/**
 * Parse pagination params from query string.
 */
export function parsePagination(query: Record<string, string | string[] | undefined>) {
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(String(query.perPage || '20'), 10) || 20));
  return { page, perPage, offset: (page - 1) * perPage };
}

/**
 * Parse search/filter params from query string.
 */
export function parseSearch(query: Record<string, string | string[] | undefined>) {
  return {
    search: String(query.search || '').trim(),
    status: String(query.status || '').trim(),
    sortBy: String(query.sortBy || 'createdAt').trim(),
    sortOrder: String(query.sortOrder || 'desc').trim() === 'asc' ? 'asc' as const : 'desc' as const,
  };
}
