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
 * Sanitize a create request body by stripping immutable fields and ensuring required timestamps.
 */
export function sanitizeCreateBody(
  body: Record<string, unknown>,
  userUid: string,
  companyId: string,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!IMMUTABLE_FIELDS.has(key)) {
      sanitized[key] = value;
    }
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
