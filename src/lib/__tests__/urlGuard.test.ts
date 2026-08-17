import { describe, expect, it } from 'vitest';
import { isLoadableUrl } from '../url';

/**
 * Contract tests for isLoadableUrl — the URL-safety guard that prevents the
 * demo seed's intentionally non-fetchable `demo://` placeholders (and any
 * other unknown scheme) from ever being rendered as browser resources
 * (<img>/<iframe> src, navigable hrefs) — which previously produced
 * `net::ERR_UNKNOWN_URL_SCHEME` console errors.
 */
describe('isLoadableUrl', () => {
  it('rejects demo:// placeholder URLs (the signoff/document placeholder scheme)', () => {
    expect(isLoadableUrl('demo://signoff-placeholder')).toBe(false);
    expect(isLoadableUrl('demo://document-placeholder/order-acknowledgement')).toBe(false);
  });

  it('rejects empty, null and undefined values', () => {
    expect(isLoadableUrl(null)).toBe(false);
    expect(isLoadableUrl(undefined)).toBe(false);
    expect(isLoadableUrl('')).toBe(false);
    expect(isLoadableUrl('   ')).toBe(false);
  });

  it('accepts https/http URLs', () => {
    expect(isLoadableUrl('https://firebasestorage.googleapis.com/v0/b/x.appspot.com/o/file.pdf?alt=media')).toBe(true);
    expect(isLoadableUrl('http://example.com/img.png')).toBe(true);
  });

  it('accepts blob and data URLs (signature capture / inline previews)', () => {
    expect(isLoadableUrl('blob:https://app.example/9b7d2a1c')).toBe(true);
    expect(isLoadableUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });

  it('accepts same-origin / relative paths', () => {
    expect(isLoadableUrl('/uploads/file.pdf')).toBe(true);
    expect(isLoadableUrl('./local/file.jpg')).toBe(true);
    expect(isLoadableUrl('../assets/image.png')).toBe(true);
  });

  it('rejects other non-fetchable schemes', () => {
    expect(isLoadableUrl('file:///c:/secret.docx')).toBe(false);
    expect(isLoadableUrl('ftp://example.com/file.pdf')).toBe(false);
    expect(isLoadableUrl('javascript:alert(1)')).toBe(false);
  });
});
