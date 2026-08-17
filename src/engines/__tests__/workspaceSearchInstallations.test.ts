/**
 * workspaceSearchInstallations.test.ts — Phase 10 wiring check.
 *
 * Source-text analysis, matching this repo's established convention (no
 * @testing-library/react in this repository).
 *
 * searchInstallations() already targeted the real 'installations' collection
 * name before that collection had any real documents (installationEngine.ts's
 * dual-write fix now populates it), so two latent field mismatches would
 * have surfaced: it read `doc.status`/`doc.assignedInstaller`, which don't
 * exist on the real InstallationRecord shape (`installationStatus` /
 * `assignedEngineerName`), and it linked to `/installations/${doc.id}` even
 * though that route (InstallationWorkspace.tsx) resolves by LEAD id, not
 * the installations collection's own id.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Normalized to LF: WorkspaceSearchEngine.ts has CRLF line endings, and the
// boundary detection below searches for a literal '\n}\n' — matching against
// the raw CRLF source silently overshoots the intended function (no bare
// '}\n' exists in a CRLF file; the search falls through into the NEXT
// function's body, e.g. picking up searchQcChecks' `doc.status` and failing
// the "does not contain doc.status" assertion below for the wrong reason).
const source = readFileSync(resolve(__dirname, '../WorkspaceSearchEngine.ts'), 'utf-8').replace(/\r\n/g, '\n');

function searchInstallationsBody(): string {
  const start = source.indexOf('async function searchInstallations');
  const end = source.indexOf('\n}\n', start);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, end);
}

describe('searchInstallations — reads the real InstallationRecord shape and links by Lead id', () => {
  it('reads installationStatus/assignedEngineerName, not the nonexistent status/assignedInstaller fields', () => {
    const body = searchInstallationsBody();
    expect(body).toContain('doc.installationStatus');
    expect(body).toContain('doc.assignedEngineerName');
    expect(body).not.toContain('doc.status');
    expect(body).not.toContain('doc.assignedInstaller');
  });

  it('links to /installations/:leadId, since InstallationWorkspace.tsx still resolves by Lead id', () => {
    const body = searchInstallationsBody();
    expect(body).toMatch(/\/installations\/\$\{encodeURIComponent\(doc\.leadId \?\? doc\.id\)\}/);
  });
});
