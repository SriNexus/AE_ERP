/**
 * documentCountLimitRemoval.test.ts
 *
 * Product change — remove the document COUNT limit globally.
 *
 * ROOT CAUSE: `DocumentManager.tsx` (the single shared component reused
 * across Leads, Customers, Projects, and every other document-enabled
 * ERP surface — see its own header comment) has always supported an
 * OPTIONAL `maxDocuments?: number` prop, explicitly documented as "Omit
 * for no limit." Only two callers ever passed a value: `LeadWorkspace
 * DocumentsSection.tsx` and `CustomerWorkspaceDocumentsSection.tsx`, both
 * with `maxDocuments={2}`. Every other caller (Projects via
 * `ProjectWorkspaceDocumentsSection.tsx`/`EntityDocumentsPanel.tsx`/
 * `UniversalDocumentsTab.tsx`, and every mobile surface, which reuses these
 * exact same desktop components) already omitted the prop and was already
 * unlimited. No Firestore rule, Storage rule, or API endpoint enforces a
 * document count anywhere in this codebase (repo-wide grep confirmed).
 *
 * FIX: removed the two `maxDocuments={2}` props. Nothing in
 * `DocumentManager.tsx` itself was changed — the component's own
 * "unlimited when omitted" behavior already existed and is exactly what
 * now applies everywhere. File-size cap (5MB) and the accepted-file-type
 * list are untouched and re-asserted here as an explicit regression guard.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const documentManagerSrc = readFileSync(resolve(__dirname, '../../components/shared/DocumentManager.tsx'), 'utf-8');
const leadDocsSectionSrc = readFileSync(resolve(__dirname, '../../features/leads/components/workspace/LeadWorkspaceDocumentsSection.tsx'), 'utf-8');
const customerDocsSectionSrc = readFileSync(resolve(__dirname, '../../features/customers/components/workspace/CustomerWorkspaceDocumentsSection.tsx'), 'utf-8');
const projectDocsSectionSrc = readFileSync(resolve(__dirname, '../../features/projects/components/workspace/ProjectWorkspaceDocumentsSection.tsx'), 'utf-8');

describe('Leads and Customers no longer pass a document-count cap to the shared DocumentManager', () => {
  it('LeadWorkspaceDocumentsSection.tsx does not pass maxDocuments', () => {
    expect(leadDocsSectionSrc).not.toContain('maxDocuments');
  });

  it('CustomerWorkspaceDocumentsSection.tsx does not pass maxDocuments', () => {
    expect(customerDocsSectionSrc).not.toContain('maxDocuments');
  });

  it('ProjectWorkspaceDocumentsSection.tsx never passed maxDocuments either — Projects were already unlimited (confirms this is the correct, complete fix, not a partial one)', () => {
    expect(projectDocsSectionSrc).not.toContain('maxDocuments');
  });
});

describe('DocumentManager.tsx itself is unchanged — the shared "omit maxDocuments = unlimited" contract already existed and now applies everywhere', () => {
  it('maxDocuments remains an optional prop on the shared component (still usable by a future caller that genuinely wants a cap)', () => {
    expect(documentManagerSrc).toContain('maxDocuments?: number');
    expect(documentManagerSrc).toContain('Omit for no limit');
  });

  it('the upload-count guard only activates when maxDocuments is an explicit number — never a default/implicit cap', () => {
    expect(documentManagerSrc).toContain("typeof maxDocuments === 'number' && docs.length >= maxDocuments");
  });

  it('the atLimit / disabled-upload-button guard is likewise conditional on an explicit maxDocuments only', () => {
    expect(documentManagerSrc).toContain("const atLimit = typeof maxDocuments === 'number' && docs.length >= maxDocuments;");
  });
});

describe('REGRESSION — legitimate safety controls are untouched by this change', () => {
  it('the 5MB per-file size cap is still enforced', () => {
    expect(documentManagerSrc).toContain('const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;');
    expect(documentManagerSrc).toContain('uploadFileObj.size > MAX_FILE_SIZE_BYTES');
  });

  it('the accepted-file-type default is still restricted (not opened to arbitrary file types)', () => {
    expect(documentManagerSrc).toContain("accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,audio/*,video/*'");
  });

  it('uploads still go through the authenticated Storage pipeline (uploadFile) — no bypass introduced', () => {
    expect(documentManagerSrc).toContain('await uploadFile(storagePath, uploadFileObj, true)');
  });

  it('append-only semantics are unchanged — an upload still adds to the existing list, never replaces it', () => {
    expect(documentManagerSrc).toContain('// APPEND — never overwrite the previous list');
    expect(documentManagerSrc).toContain('const next = [...docs, entry];');
  });

  it('per-document delete still removes only the targeted document', () => {
    expect(documentManagerSrc).toContain('// Remove ONLY the targeted document — never touch the others');
    expect(documentManagerSrc).toContain('const next = docs.filter(d => d.id !== deleteTarget);');
  });
});

// ── Behavioral: mirrors the exact upload-count guard algorithm ──────────
// (DocumentManager's handleUpload is a component-local closure, not
// exported — matching this repo's established convention of behaviorally
// mirroring non-exported page/component logic rather than mounting the
// full component.)
function isUploadBlockedByCount(currentCount: number, maxDocuments?: number): boolean {
  return typeof maxDocuments === 'number' && currentCount >= maxDocuments;
}

describe('Behavioral proof — uploading past the old cap of 2 is never blocked once maxDocuments is omitted', () => {
  it('with maxDocuments omitted (the new Leads/Customers call shape), the 3rd, 4th, and 5th upload are all allowed', () => {
    for (const currentCount of [0, 1, 2, 3, 4, 10, 100]) {
      expect(isUploadBlockedByCount(currentCount, undefined)).toBe(false);
    }
  });

  it('sanity check — the OLD behavior (maxDocuments=2) genuinely did block the 3rd upload, proving this test would have caught the original restriction', () => {
    expect(isUploadBlockedByCount(0, 2)).toBe(false); // 1st upload allowed
    expect(isUploadBlockedByCount(1, 2)).toBe(false); // 2nd upload allowed
    expect(isUploadBlockedByCount(2, 2)).toBe(true);  // 3rd upload was blocked — the bug this change fixes
  });

  it('an explicit maxDocuments still works correctly for any future caller that intentionally wants one — the mechanism itself was not removed, only its use for Leads/Customers', () => {
    expect(isUploadBlockedByCount(4, 5)).toBe(false);
    expect(isUploadBlockedByCount(5, 5)).toBe(true);
  });
});
