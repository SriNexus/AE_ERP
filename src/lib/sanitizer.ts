function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeValue(value: unknown, inArray: boolean): unknown {
  if (value === undefined) return inArray ? null : undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    return inArray ? null : undefined;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, true));

  // Firestore sentinels, Timestamps, GeoPoints, document refs and Files are non-plain objects.
  if (!isPlainObject(value)) return value;

  const sanitized: Record<string, unknown> = {};
  Object.entries(value).forEach(([key, child]) => {
    const cleanChild = sanitizeValue(child, false);
    if (cleanChild !== undefined) sanitized[key] = cleanChild;
  });
  return sanitized;
}

/**
 * Recursively prepares data for Firestore writes.
 * - Removes undefined/unsupported object fields.
 * - Converts unsupported array items to null to preserve array shape.
 * - Converts NaN and invalid Date values to null.
 * - Preserves Firestore sentinels and references.
 */
export function sanitizeFirestoreData<T>(obj: T): T {
  return sanitizeValue(obj, false) as T;
}

export const sanitizePayload = sanitizeFirestoreData;
