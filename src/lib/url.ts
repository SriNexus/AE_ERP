/**
 * URL safety guard — prevents intentionally non-fetchable URL schemes from
 * ever being rendered as browser resources.
 *
 * The demo seed (scripts/demo/datasets/businessGraph.ts) intentionally writes
 * non-fetchable placeholder URLs such as `demo://signoff-placeholder` and
 * `demo://document-placeholder/<slug>` for signature images and document
 * attachments. If a renderer places those into an <img>/<iframe> src or a
 * navigable <a href>, the browser attempts to load the unknown scheme and
 * logs `net::ERR_UNKNOWN_URL_SCHEME`. Every surface that renders a stored URL
 * as a resource must first pass it through isLoadableUrl().
 */
export function isLoadableUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Same-origin / relative paths (e.g. /uploads/..., ./file.pdf)
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true;
  // Only schemes the browser can actually fetch
  return /^(https?:|blob:|data:)/i.test(trimmed);
}
