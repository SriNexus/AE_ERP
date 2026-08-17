/**
 * customerWorkspaceHeaderCleanup.test.ts — Header cleanup mission history.
 *
 * Source-text regression tests (no @testing-library/react in this repo).
 *
 * The "Generate Invoice modal" section of this original mission was later
 * fully retired by the Remove Unnecessary Actions & Tabs mission —
 * CustomerInvoiceModal.tsx was deleted, and the header's Generate Invoice /
 * Create Task quick actions were removed entirely (CustomerWorkspaceHeader
 * now always receives a static empty actions array). Those tests are
 * removed below rather than kept pointing at deleted code; the still-valid
 * header field-removal / layout checks from the original mission remain.
 * InvoicesWorkspace.tsx's own orderId-prefill capability is untouched code
 * (a different page's feature, not Customer Workspace's), so those tests
 * still pass unchanged and are kept.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const headerComponent = read('../../features/customers/components/workspace/CustomerWorkspaceHeader.tsx');
const customerWorkspacePage = read('../CustomerWorkspace.tsx');
const invoicesWorkspacePage = read('../InvoicesWorkspace.tsx');

describe('Header cleanup — removed fields no longer render', () => {
  it('no company-name chip in the header', () => {
    expect(headerComponent).not.toContain('companyName &&');
    expect(headerComponent).not.toMatch(/\{companyName\}/);
  });

  it('Premium UX Redesign mission reverses the earlier "no city" decision: city is now shown on the identity\'s second line (the redesign brief explicitly asks for location in the header context row) — an intentional, later override of this same test file\'s original assertion, not a regression', () => {
    expect(headerComponent).toMatch(/\{city &&/);
  });

  it('no "From Lead" link/button in the header', () => {
    expect(headerComponent).not.toContain('From Lead');
    expect(headerComponent).not.toContain('onViewSourceLead');
  });

  it('CustomerWorkspace.tsx no longer passes onViewSourceLead to the header (the Right Panel keeps its own, separate wiring)', () => {
    const headerCallIdx = customerWorkspacePage.indexOf('<CustomerWorkspaceHeader');
    const headerCallBlock = customerWorkspacePage.slice(headerCallIdx, customerWorkspacePage.indexOf('/>', headerCallIdx));
    expect(headerCallBlock).not.toContain('onViewSourceLead');
  });
});

describe('Header cleanup — Customer Type sits immediately beside the name', () => {
  it('TypeChip renders directly after the name heading, with no company chip in between', () => {
    const idx = headerComponent.indexOf('<h1');
    const block = headerComponent.slice(idx, idx + 200);
    expect(block).toMatch(/<h1[^>]*>\{displayName\}<\/h1>\s*<TypeChip/);
  });
});

describe('Remove Unnecessary Actions & Tabs mission — Generate Invoice / Create Task header actions are fully retired', () => {
  it('buildCustomerQuickActions (which used to build these two actions) no longer exists — the Premium UX Redesign mission deleted the whole workspaceConfig.ts file it lived in (CUSTOMER_TABS, its only other export, is also superseded by CustomerWorkspaceSections.tsx\'s accordion)', () => {
    expect(existsSync(resolve(__dirname, '../../features/customers/utils/workspaceConfig.ts'))).toBe(false);
  });

  it('CustomerWorkspace.tsx passes a static empty actions array to the header instead', () => {
    expect(customerWorkspacePage).toMatch(/<CustomerWorkspaceHeader[\s\S]{0,200}actions=\{\[\]\}/);
    expect(customerWorkspacePage).not.toContain('buildCustomerQuickActions(');
  });

  it('CustomerInvoiceModal no longer exists and is not referenced', () => {
    expect(customerWorkspacePage).not.toContain('CustomerInvoiceModal');
    expect(customerWorkspacePage).not.toContain('showInvoiceModal');
  });

  it('does not resurrect the retired CustomerDetailModal or CustomerDetailDrawer', () => {
    expect(customerWorkspacePage).not.toContain('CustomerDetailModal');
    expect(customerWorkspacePage).not.toContain('CustomerDetailDrawer');
  });
});

describe('InvoicesWorkspace.tsx — pre-fill capability is untouched, separate-page code (not deleted just because Customer Workspace stopped linking to it)', () => {
  it('still reads an orderId param distinct from the existing open/create params', () => {
    expect(invoicesWorkspacePage).toContain("searchParams.get('orderId')");
  });

  it('still calls the EXISTING handleOrderSelect() to hydrate the form — no duplicated invoice business logic', () => {
    const idx = invoicesWorkspacePage.indexOf('prefillOrderIdParam, orders]');
    const block = invoicesWorkspacePage.slice(Math.max(0, idx - 400), idx);
    expect(block).toContain('handleOrderSelect(prefillOrderIdParam)');
  });

  it('still cleans up orderId/customerId from the URL once consumed', () => {
    expect(invoicesWorkspacePage).toMatch(/next\.delete\('orderId'\)/);
  });
});
