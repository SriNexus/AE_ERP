/**
 * customerWorkspaceLeftPanel.test.ts — permanent Left Panel architecture
 * (Left Panel/Tabs/Documents/Footer UI standardization mission).
 *
 * Source-text analysis, matching the convention established across this
 * codebase (no @testing-library/react). The old `resolveLeftPanelMode`
 * per-tab mode-switching function this file used to test exhaustively has
 * been removed entirely — the Left Panel is now permanent (always Customer
 * Information, regardless of the active center tab), mirroring Lead
 * Workspace's own "Left Panel: permanent" layout. These tests instead
 * verify that permanence directly from the source.
 *
 * Document System + Panel Standardization mission: Documents moved out of
 * this panel into its own workspace-level tab (CustomerWorkspace.tsx) — see
 * customerWorkspaceLeadStandardization.test.ts for that coverage.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');
const leftPanel = read('../CustomerWorkspaceLeftPanel.tsx');

describe('CustomerWorkspaceLeftPanel — permanent Info (no per-tab mode-switching); Documents lives in its own tab', () => {
  it('no longer exports or defines resolveLeftPanelMode / LeftPanelMode (the mode-switching architecture is fully retired)', () => {
    expect(leftPanel).not.toMatch(/export function resolveLeftPanelMode/);
    expect(leftPanel).not.toMatch(/export type LeftPanelMode/);
    expect(leftPanel).not.toMatch(/const mode = resolveLeftPanelMode/);
  });

  it('does not accept or branch on an activeTab prop', () => {
    expect(leftPanel).not.toMatch(/activeTab/);
  });

  it('always renders CustomerContextPanel (Customer Information) unconditionally, not gated behind a tab check', () => {
    expect(leftPanel).toMatch(/<CustomerContextPanel customer=\{customer\}\s*\/>/);
  });

  it('no longer renders the Documents section here — it moved to its own workspace-level tab (Document System + Panel Standardization mission)', () => {
    expect(leftPanel).not.toMatch(/import CustomerWorkspaceDocumentsSection/);
    expect(leftPanel).not.toMatch(/<CustomerWorkspaceDocumentsSection/);
  });

  it('retired per-tab summary panels (Tasks/Notes/Activity/History/Linked Records/Commercial) are no longer imported here — their center-tab equivalents (Universal*Tab via WorkspaceTabs) are untouched and still show that data in full', () => {
    for (const name of ['TaskContextPanel', 'NotesContextPanel', 'DocumentsContextPanel', 'ActivityContextPanel', 'HistoryContextPanel', 'LinkedRecordsContextPanel', 'CommercialContextPanel']) {
      expect(leftPanel).not.toContain(name);
    }
  });

  it('keeps the existing Tier A staged-draft edit toggle (Edit Customer / Cancel Editing) — Customer save/editing logic is unchanged, only the surrounding visual chrome now matches Lead', () => {
    expect(leftPanel).toContain('CustomerWorkspaceEditor');
    expect(leftPanel).toContain('onCancelEdit');
    expect(leftPanel).toMatch(/Cancel Editing|Edit customer/);
  });

  it('title row + edit-toggle button classes match Lead Workspace\'s own left-panel header row (h-7 w-7 icon button when not editing)', () => {
    expect(leftPanel).toContain('Customer Information');
    expect(leftPanel).toMatch(/h-7 w-7 items-center justify-center rounded-lg/);
  });

  it('module exports the component function', async () => {
    const mod = await import('../CustomerWorkspaceLeftPanel');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
    // Cold import of the CustomerWorkspace graph; under full-suite parallel
    // load this can exceed the default 15s testTimeout (import weight, not a
    // hang). 240s keeps the module-existence assertion meaningful on slow CI.
  }, 240000);
});
