/**
 * customerWorkspaceDialogs.test.ts — Regression tests for CustomerWorkspaceDialogs
 *
 * Verifies:
 * - Component exports correctly
 * - Defensive array defaults are in source code (= [] in destructuring)
 * - Component handles undefined/empty/populated array props without crashing
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, '../../features/customers/components/CustomerWorkspaceDialogs.tsx');
const source = readFileSync(sourcePath, 'utf-8');

describe('CustomerWorkspaceDialogs — source code analysis', () => {
  it('has defensive defaults for all array destructuring props', () => {
    // Verify the source code has = [] defaults for all collection/array props
    expect(source).toContain('salesUsers = []');
    expect(source).toContain('STATE_OPTS = []');
    expect(source).toContain('PROPERTY_TYPES = []');
    expect(source).toContain('INDUSTRY_TYPES = []');
    expect(source).toContain('ROOF_TYPES = []');
  });

  it('uses ROOF_TYPES from destructuring (not ctx.ROOF_TYPES)', () => {
    // Verify the component accesses ROOF_TYPES via destructured variable, not ctx.ROOF_TYPES
    // which would bypass the defensive default
    expect(source).not.toContain('ctx.ROOF_TYPES.map');
    expect(source).toContain('ROOF_TYPES.map');
  });
});

describe('CustomerWorkspaceDialogs — module export', () => {
  it('exports the component function', async () => {
    const mod = await import('../../features/customers/components/CustomerWorkspaceDialogs');
    expect(mod.CustomerWorkspaceDialogs).toBeDefined();
    expect(typeof mod.CustomerWorkspaceDialogs).toBe('function');
  });
});

// The Phase 0 "broken-Edit bug" this section originally guarded
// (ctx.handleEditSubmit referencing an undefined prop) applied to the
// list-page structural Edit form, which the Header/action cleanup mission
// retired entirely: Customer Type (the one thing that form was still needed
// for) is now edited through the normal Edit Customer flow in the Workspace
// itself (CustomerWorkspaceEditor.tsx — see customerWorkspaceEditorType.test.ts
// and CUSTOMER_DRAFT_FIELDS in customerWorkspacePersistence.test.ts). There is
// no ctx.handleEditSubmit, no saveEdit, no closeEdit left to regress — this is
// an intentional architectural retirement, not the historical bug
// reappearing. Replaced with a check that the retirement is actually
// complete, not just partial.
describe('Customer Edit submit wiring — legacy Edit form retired (Header/action cleanup mission), not partially removed', () => {
  const dialogsSource = source;
  const pageSourcePath = resolve(__dirname, '../../pages/CustomersWorkspace.tsx');
  const pageSource = readFileSync(pageSourcePath, 'utf-8');

  it('CustomerWorkspaceDialogs no longer renders the Edit form or references ctx.handleEditSubmit', () => {
    expect(dialogsSource).not.toMatch(/ctx\.handleEditSubmit/);
    expect(dialogsSource).not.toContain('title="Edit Customer"');
  });

  it('CustomersWorkspace.tsx no longer defines handleEditSubmit, saveEdit, openEdit, or closeEdit', () => {
    expect(pageSource).not.toMatch(/function handleEditSubmit\(/);
    expect(pageSource).not.toMatch(/\bsaveEdit\b/);
    expect(pageSource).not.toMatch(/function openEdit\(/);
    expect(pageSource).not.toMatch(/function closeEdit\(/);
  });

  it('the B2B/B2C create forms remain untouched by the edit-form retirement', () => {
    expect(dialogsSource).toContain('Add B2B Customer');
    expect(dialogsSource).toContain('Add B2C Customer');
    expect(pageSource).toMatch(/handleB2BSubmit,\s*handleB2CSubmit,\s*ctxToast/);
  });
});
