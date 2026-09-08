/**
 * Phase 10 (RBAC Master Plan) — N2 / AUTH-D9 regression guard.
 *
 * The mobile Installations workspace previously authorized ~7 edit/schedule/
 * checklist controls with a hardcoded `user?.role === 'Admin' || user?.role
 * === 'Director'` string check. That was wrong in two directions:
 *   - it DENIED InstallationLead, the one role seeded `installations:{edit}`
 *     in roleBootstrap.ts (its actual job on mobile);
 *   - where a company grants the Director role any `installations` access it
 *     silently promoted Director from view to edit — a role that has no
 *     `installations` grant in the default seed.
 *
 * The desktop InstallationWorkspace has always used the permission system
 * (`perms.canEdit('installations')`). This guard pins the mobile workspace to
 * the SAME mechanism — no rules change, no new role check, no desktop change.
 *
 * Source-text/structural convention (no @testing-library/react in this repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const workspacePath = join(__dirname, '..', 'MobileInstallationsWorkspace.tsx');
const rawSource = readFileSync(workspacePath, 'utf-8');
const source = stripComments(rawSource);

const desktopPath = join(__dirname, '..', '..', '..', '..', 'pages', 'InstallationWorkspace.tsx');
const desktopSource = stripComments(readFileSync(desktopPath, 'utf-8'));

describe('N2 / AUTH-D9 — mobile Installations edit controls are permission-gated, not role-gated', () => {
  it('derives the edit-controls gate from perms.canEdit(\'installations\')', () => {
    expect(source).toContain("canEditInstallations = perms.canEdit('installations')");
  });

  it('does NOT use a hardcoded role-string check as the authorization mechanism', () => {
    // No `role === 'Admin'` / `role === 'Director'` (or !==) anywhere in the
    // executable source of this workspace.
    expect(source).not.toMatch(/\.role\s*(===|!==)\s*['"](Admin|Director)['"]/);
    // The prior variable name is gone too.
    expect(source).not.toMatch(/\bisAdmin\b/);
  });

  it('gates every edit/schedule/checklist control through the single canEditInstallations value', () => {
    // Every conditional render / disabled guard uses canEditInstallations.
    const guardHits = source.match(/canEditInstallations/g) || [];
    // 1 declaration + the control guards (>= 6).
    expect(guardHits.length).toBeGreaterThanOrEqual(7);
  });

  it('matches the desktop InstallationWorkspace authorization mechanism exactly', () => {
    expect(desktopSource).toContain("perms.canEdit('installations')");
    // Neither surface authorizes installation edits by role string.
    expect(desktopSource).not.toMatch(/\.role\s*(===|!==)\s*['"](Admin|Director)['"]/);
  });
});
