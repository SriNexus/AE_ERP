/**
 * customerWorkspaceEditorType.test.ts — Header/action cleanup mission,
 * item 5: Customer Type (B2B/B2C) is now changed through the normal Edit
 * Customer flow instead of a separate "Edit Type" popup/form.
 *
 * Source-text regression tests (no @testing-library/react in this repo) —
 * complements the data-layer tests in customerWorkspacePersistence.test.ts
 * (CUSTOMER_DRAFT_FIELDS now includes 'type', delta building for it).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const editorSrc = readFileSync(resolve(__dirname, '../CustomerWorkspaceEditor.tsx'), 'utf-8');

describe('CustomerWorkspaceEditor — Customer Type selector', () => {
  it('renders a Customer Type select wired to onFieldChange, using the existing customer save/update architecture (no second editing system)', () => {
    const idx = editorSrc.indexOf('label="Customer Type"');
    expect(idx).toBeGreaterThan(-1);
    const block = editorSrc.slice(idx, idx + 250);
    expect(block).toContain("onChange={(e) => onFieldChange('type', e.target.value)}");
    // Phase 2: options are no longer a static B2B/B2C literal — they're derived
    // from the active Company's Business Mode, so a 'B2B'-only (or 'B2C'-only)
    // company can never re-type a customer into a type it doesn't support.
    expect(block).toContain('options={allowedTypeOptions}');
    expect(editorSrc).toContain('getAllowedCustomerTypesForBusinessMode(businessMode)');
  });

  it("isB2B reacts to the staged draft's pending type, not just the saved customer.type — so switching the dropdown live-updates which fields show", () => {
    const idx = editorSrc.indexOf('const isB2B =');
    const line = editorSrc.slice(idx, editorSrc.indexOf('\n', idx));
    expect(line).toContain("val('type')");
  });

  it('B2B-only fields (Company, GST, Credit Limit, Payment Terms) are still conditionally rendered by isB2B — switching to B2C hides them, matching existing B2B/B2C conditional behavior', () => {
    expect(editorSrc).toMatch(/\{isB2B && <Input label="Company"/);
    expect(editorSrc).toMatch(/\{isB2B && <Input label="GST"/);
    expect(editorSrc).toMatch(/\{isB2B && \(\s*<div className="grid grid-cols-2 gap-2">\s*<Input label="Credit Limit"/);
  });

  it('the Type selector is not gated by isB2B itself (it must always be visible/changeable regardless of current type)', () => {
    const idx = editorSrc.indexOf('label="Customer Type"');
    const before = editorSrc.slice(Math.max(0, idx - 60), idx);
    expect(before).not.toMatch(/isB2B &&\s*$/);
  });
});
