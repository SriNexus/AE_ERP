/**
 * customersWorkspacePopupRetirement.test.ts — Phase 5.3 popup retirement.
 *
 * The Customer Workspace (/customers/:id) is now the primary View/Edit
 * experience; the legacy CustomerDetailModal (and the fully-orphaned
 * CustomerDetailDrawer, confirmed zero callers before deletion) are retired.
 * Per the TRACE → CLASSIFY → REPLACE → TEST → REMOVE discipline: every
 * caller of the retired popup was traced first (row click/View button,
 * post-create success, ?open= deep links from notifications/Orders/
 * Loan Applications/Mobile Lead Workspace, and CustomerWorkspace.tsx's own
 * structural-edit link) and given a working replacement before removal —
 * this file locks in those replacements.
 *
 * Source-text regression tests (no @testing-library/react in this repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const customersWorkspacePage = read('../CustomersWorkspace.tsx');
const customerWorkspacePage = read('../CustomerWorkspace.tsx');

describe('Phase 5.3 — legacy popup components are actually retired', () => {
  it('CustomerDetailModal.tsx and CustomerDetailDrawer.tsx no longer exist', () => {
    expect(existsSync(resolve(__dirname, '../../features/customers/components/CustomerDetailModal.tsx'))).toBe(false);
    expect(existsSync(resolve(__dirname, '../../components/customers/CustomerDetailDrawer.tsx'))).toBe(false);
  });

  it('CustomersWorkspace.tsx no longer imports or renders CustomerDetailModal', () => {
    expect(customersWorkspacePage).not.toMatch(/import\s*\{\s*CustomerDetailModal/);
    expect(customersWorkspacePage).not.toContain('<CustomerDetailModal');
  });

  it('CustomerTransferModal is still used by the list page\'s own Assign row action; CustomerFollowupModal moved to be exclusively the Workspace\'s own Quick Action (Final Customer Module Polish mission retired the list page\'s Schedule Follow-up row trigger, not the shared component itself)', () => {
    expect(customersWorkspacePage).toContain('<CustomerTransferModal');
    expect(customersWorkspacePage).not.toContain('CustomerFollowupModal');
  });
});

describe('Phase 5.3 — row click / View routes to the Workspace, not a popup', () => {
  it('openDetails() navigates to /customers/:id', () => {
    const idx = customersWorkspacePage.indexOf('function openDetails');
    const block = customersWorkspacePage.slice(idx, idx + 300);
    expect(block).toContain('navigate(`/customers/${encodeURIComponent(customer.id)}`');
  });

  it('handleRowClick and handleRowKeyDown both still route through openDetails (single implementation, not duplicated)', () => {
    expect(customersWorkspacePage).toMatch(/function handleRowClick[\s\S]{0,200}openDetails\(customer\)/);
    expect(customersWorkspacePage).toMatch(/function handleRowKeyDown[\s\S]{0,200}openDetails\(customer\)/);
  });

  it('the row\'s View button calls openDetails, not a modal-opening setter', () => {
    const idx = customersWorkspacePage.indexOf("onClick={() => openDetails(c)}");
    expect(idx).toBeGreaterThan(-1);
  });
});

describe('Phase 5.3 — row-level quick actions preserve what the retired popup used to provide', () => {
  it('each row keeps Assign (Transfer) as a direct trigger, not gated behind the popup — Final Customer Module Polish mission trimmed the row to exactly View + Assign, retiring Schedule Follow-up and Delete as row-level actions (Delete stays reachable from the bulk action bar; Follow-up from the Workspace\'s own Quick Actions)', () => {
    const idx = customersWorkspacePage.indexOf("onClick={() => openDetails(c)}");
    const rowActionsBlock = customersWorkspacePage.slice(idx, idx + 400);
    expect(rowActionsBlock).toContain('setShowTransfer(c)');
    expect(rowActionsBlock).not.toContain('setShowFollowup');
    expect(rowActionsBlock).not.toContain('setDelId(c.id)');
  });

  it('bulk delete (setDelId(\'__bulk__\')) still exists for multi-select delete, just not as a per-row trigger', () => {
    expect(customersWorkspacePage).toContain("setDelId('__bulk__')");
  });
});

describe('Phase 5.3 — ?open= deep link redirects into the Workspace (notifications/Orders/Loan Applications/Mobile Lead Workspace all still link here)', () => {
  it('the ?open= effect navigates to /customers/:id instead of restoring a viewItem/modal', () => {
    expect(customersWorkspacePage).toContain('navigate(`/customers/${encodeURIComponent(openParam)}`, { replace: true })');
  });

  it('no more viewItem state — the popup it backed is gone', () => {
    expect(customersWorkspacePage).not.toMatch(/const \[viewItem, setViewItem\]/);
  });
});

describe('Header/action cleanup mission — Customer Type is now edited via the normal Edit Customer flow, not a separate legacy form', () => {
  it('the ?editType= legacy structural-edit routing is fully retired — no trace of it remains', () => {
    expect(customersWorkspacePage).not.toMatch(/editType/);
    expect(customerWorkspacePage).not.toMatch(/editType/);
  });

  it('the old list-page Edit Customer form (showEdit/editForm/openEdit/saveEdit) is gone — CustomerWorkspaceDialogs.tsx no longer renders it', () => {
    expect(customersWorkspacePage).not.toMatch(/\bshowEdit\b/);
    expect(customersWorkspacePage).not.toMatch(/\bsaveEdit\b/);
    expect(customersWorkspacePage).not.toMatch(/function openEdit/);
  });

  it("CustomerWorkspace.tsx no longer has an 'Edit Type' quick action", () => {
    expect(customerWorkspacePage).not.toContain('onEdit:');
    expect(customerWorkspacePage).not.toMatch(/navigate\(`\/customers\?open=\$\{encodeURIComponent\(customer\.id\)\}`\)/);
  });
});
