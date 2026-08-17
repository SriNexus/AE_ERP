/**
 * customerWorkspacePhase51.test.ts — Phase 5.1 Final Validation Audit.
 *
 * Regression tests for the two confirmed bugs found and fixed during the
 * audit (see CUSTOMER_WORKSPACE_PHASE_5_1_FINAL_VALIDATION_REPORT.md §18-19):
 *   1. "Cancel Editing" only collapsed the Left Panel's editor view without
 *      discarding the staged draft — a later Save would silently persist an
 *      edit the user believed they had cancelled.
 *   2. buildCustomerDraftDelta's current-value comparison only stringified
 *      creditLimit/paymentTerms, inconsistent with the editor's own display
 *      logic — any other field stored as a non-string Firestore type (e.g. a
 *      legacy numeric pincode) would be spuriously included in every save's
 *      delta even when visually unchanged.
 *
 * Source-text analysis for the first (component wiring, no
 * @testing-library/react in this repo); the second already has direct unit
 * tests in customerWorkspacePersistence.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const customerWorkspacePage = read('../CustomerWorkspace.tsx');
const leftPanel = read('../../features/customers/components/workspace/CustomerWorkspaceLeftPanel.tsx');
const persistence = read('../../features/customers/components/workspace/CustomerWorkspacePersistence.ts');
const recentActivityWidget = read('../../features/customers/components/workspace/rightPanel/CustomerRecentActivity.tsx');
const activityContextPanel = read('../../features/customers/components/workspace/leftPanel/RecordContextPanels.tsx');
const useCustomersHook = read('../../features/customers/hooks/useCustomers.ts');

describe('Phase 5.1 fix — "Cancel Editing" actually discards the staged draft', () => {
  it('CustomerWorkspaceLeftPanel calls onCancelEdit when toggling out of edit mode', () => {
    expect(leftPanel).toContain('onCancelEdit?.()');
    const fnIdx = leftPanel.indexOf('function handleToggleEdit');
    const fnBlock = leftPanel.slice(fnIdx, fnIdx + 300);
    expect(fnBlock).toMatch(/if \(isEditing\)/);
    expect(fnBlock).toContain('onCancelEdit?.()');
  });

  it('does not call onCancelEdit when opening the editor (only when cancelling out of it)', () => {
    const fnIdx = leftPanel.indexOf('function handleToggleEdit');
    const fnBlock = leftPanel.slice(fnIdx, fnIdx + 300);
    // onCancelEdit must be inside the `if (isEditing)` branch, not unconditional
    const ifIdx = fnBlock.indexOf('if (isEditing)');
    const cancelIdx = fnBlock.indexOf('onCancelEdit?.()');
    const closeBraceIdx = fnBlock.indexOf('}', ifIdx);
    expect(cancelIdx).toBeGreaterThan(ifIdx);
    expect(cancelIdx).toBeLessThan(closeBraceIdx);
  });

  it('CustomerWorkspace.tsx wires onCancelEdit to a handler that dispatches RESET_WORKSPACE, discarding the Tier A draft — Premium UX Redesign mission extracted the earlier inline arrow into a named handleCancelEdit so it can also close the shared isEditingCustomer flag the Footer now depends on', () => {
    expect(customerWorkspacePage).toContain('onCancelEdit={handleCancelEdit}');
    const fnIdx = customerWorkspacePage.indexOf('const handleCancelEdit = useCallback');
    const fnBlock = customerWorkspacePage.slice(fnIdx, fnIdx + 300);
    expect(fnBlock).toContain("cwDispatch({ type: 'RESET_WORKSPACE' })");
    expect(fnBlock).toContain('setIsEditingCustomer(false)');
  });

  it('Final Premium UX Refinement Pass — regression guard: handleToggleEdit no longer calls onToggleEdit unconditionally after onCancelEdit. That double-call let React\'s batched updates flip isEditingCustomer straight back to true (setIsEditingCustomer(false) from onCancelEdit, immediately followed by setIsEditingCustomer(v => !v) from onToggleEdit acting on that same pending false), so clicking "Cancel Editing" silently re-entered edit mode instead of exiting it. onToggleEdit must now live in an `else` branch, mutually exclusive with the cancel branch.', () => {
    const fnIdx = leftPanel.indexOf('function handleToggleEdit');
    const fnBlock = leftPanel.slice(fnIdx, fnIdx + 300);
    expect(fnBlock).toMatch(/\}\s*else\s*\{\s*onToggleEdit\(\);/);
  });

  it('the toggle button itself now calls the wrapping handler, not a bare setState', () => {
    expect(leftPanel).toContain('onClick={handleToggleEdit}');
    expect(leftPanel).not.toContain("onClick={() => setIsEditing((v) => !v)}");
  });
});

describe('Phase 5.1 fix — Save\'s activity is now actually visible in the workspace UI', () => {
  it('Recent Activity (Right Panel) and the Activity tab context both read customer.activityLog[] directly', () => {
    expect(recentActivityWidget).toContain('customer?.activityLog');
    expect(activityContextPanel).toContain('customer?.activityLog');
  });

  it('saveCustomerWorkspace appends a manual entry to customer.activityLog[] in the same write — not relying on logActivity() alone', () => {
    expect(persistence).toContain('existingActivityLog');
    expect(persistence).toMatch(/activityLog:\s*\[\.\.\.existingActivityLog,\s*logEntry\]/);
  });

  it('still calls logActivity() too — the separate company-wide audit trail is a real, additional consumer, not replaced', () => {
    expect(persistence).toContain("logActivity('Customers', 'Customer Updated'");
  });

  it('the appended entry uses a real, distinct type ("Update") so it is not mistaken for a Note by the Notes-tab filter', () => {
    expect(persistence).toMatch(/type:\s*['"]Update['"]/);
  });
});

describe('Phase 5.1 fix — the customer\'s primary update path persists the full delta, not just name/phone/email/city', () => {
  it('updateCustomerProjection (the wrapper used by updateCustomerProjectionWithPhoneLock, the Edit form, and Mobile Workspace) calls CustomerDomainService.update, not .updateProjection', () => {
    const fnIdx = useCustomersHook.indexOf('export function updateCustomerProjection');
    expect(fnIdx).toBeGreaterThan(-1);
    const fnBlock = useCustomersHook.slice(fnIdx, fnIdx + 1000);
    const returnIdx = fnBlock.indexOf('return CustomerDomainService.');
    expect(returnIdx).toBeGreaterThan(-1);
    // .replace(/\r$/, '') — useCustomers.ts has CRLF line endings; indexOf('\n')
    // alone leaves the trailing \r inside the slice, which made this line look
    // identical to the expected string in every diff/log yet fail strict
    // equality every time (pre-existing test bug, unrelated to this file's
    // own logic — confirmed via byte-level inspection).
    const returnLine = fnBlock.slice(returnIdx, fnBlock.indexOf('\n', returnIdx)).replace(/\r$/, '');
    expect(returnLine).toBe('return CustomerDomainService.update(id, compactDelta(payload));');
  });
});
