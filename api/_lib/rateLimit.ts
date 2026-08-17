/**
 * Rate Limiter — Simple in-memory rate limiting for API endpoints
 *
 * Uses a sliding window approach. Since this is in-memory, rate limits
 * reset when the serverless function cold-starts. This is acceptable
 * for API key + authenticated users but not for DDoS protection
 * (which should be handled at the Vercel/Firebase edge level).
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Default: 100 requests per 60 seconds per user/IP
const DEFAULT_MAX_REQUESTS = 100;
const DEFAULT_WINDOW_MS = 60_000;

/**
 * Check if a request should be rate limited.
 *
 * @param key - Unique identifier (user UID, API key hash, or IP)
 * @param maxRequests - Maximum requests allowed in the window (default: 100)
 * @param windowMs - Time window in milliseconds (default: 60000)
 * @returns Object with `allowed` boolean and `remaining` count
 */
export function checkRateLimit(
  key: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  if (maxRequests <= 0) return { allowed: false, remaining: 0, resetAt: now + Math.max(0, windowMs) };
  const entry = store.get(key);

  // No existing entry or window expired — create new window
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  // Within window — check count
  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  // Increment count
  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

/**
 * Generate a rate limit key from a user or IP.
 */
export function getRateLimitKey(uid: string, ip?: string): string {
  return uid || ip || 'anonymous';
}

/**
 * Clean up expired entries to prevent memory leaks.
 * Called periodically.
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  Array.from(store.entries()).forEach(([key, entry]) => {
    if (now >= entry.resetAt) {
      store.delete(key);
    }
  });
}

// Run cleanup every 5 minutes (only outside test environments)
if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
  setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
}
