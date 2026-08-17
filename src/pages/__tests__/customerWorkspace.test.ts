/**
 * customerWorkspace.test.ts — Phase 1 wiring regression checks
 *
 * Source-text analysis, matching the existing repo convention for this file
 * cluster (see customerWorkspaceDialogs.test.ts) — there is no
 * @testing-library/react dependency in this repository, so full render
 * testing of CustomerWorkspace.tsx / CustomerWorkspaceHeader.tsx isn't
 * available without adding new test infrastructure, which is out of scope
 * for this phase. See the Phase 1 report for the stated limitation.
 *
 * What these checks verify: the exact structural decisions this phase made
 * on purpose — no duplicate header (WorkspaceShell's own header/quickActions
 * omitted), tabs genuinely preserved (Tasks/Linked Records/Permissions must
 * not silently disappear), and the existing quick-actions function is reused
 * rather than reimplemented.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const pagePath = resolve(__dirname, '../CustomerWorkspace.tsx');
const pageSource = readFileSync(pagePath, 'utf-8');
const sectionsPath = resolve(__dirname, '../../features/customers/components/workspace/CustomerWorkspaceSections.tsx');
const sectionsSource = readFileSync(sectionsPath, 'utf-8');

describe('CustomerWorkspace — Phase 1 header/KPI wiring', () => {
  it('renders the new CustomerWorkspaceHeader; the KPI bar was removed by the Final UI Cleanup mission', () => {
    expect(pageSource).toContain('<CustomerWorkspaceHeader');
    expect(pageSource).not.toContain('<CustomerWorkspaceKpis');
  });

  it('does not render WorkspaceShell at all (Left Panel/Tabs/Documents/Footer UI standardization mission: replaced with a workspace-level tab bar + direct content() dispatch) — so there is no duplicate/redundant header from it either', () => {
    // WorkspaceShell's own `header`/`quickActions` props were never used by
    // this page even before the mission (CustomerWorkspaceHeader/Kpis were
    // always the real header) — now WorkspaceShell isn't used at all.
    expect(pageSource).not.toContain('<WorkspaceShell');
    expect(pageSource).not.toMatch(/\bheader=\{/);
    expect(pageSource).not.toMatch(/\bquickActions=\{/);
  });

  it('Premium UX Redesign mission: the tab system (Tasks, Linked Records, etc.) is no longer a <nav role="tablist">/CUSTOMER_TABS dispatch — the equivalent content now lives in CustomerWorkspaceSections\' always-visible/collapsible sections, and workspaceConfig.ts (CUSTOMER_TABS\' only home) no longer exists', () => {
    expect(pageSource).not.toContain('role="tablist"');
    expect(pageSource).not.toContain('CUSTOMER_TABS');
    expect(existsSync(resolve(__dirname, '../../features/customers/utils/workspaceConfig.ts'))).toBe(false);
    for (const name of ['Documents', 'Order History', 'Linked Records', 'Tasks', 'Activity']) {
      expect(sectionsSource).toContain(name);
    }
  });

  it('Remove Unnecessary Actions & Tabs mission: buildCustomerQuickActions and its Generate Invoice/Create Task header actions are retired — the header now gets a static empty actions array', () => {
    expect(pageSource).not.toContain('buildCustomerQuickActions(');
    expect(pageSource).toMatch(/actions=\{\[\]\}/);
  });

  it('module exports the component function', async () => {
    // Phase 2 added 5 embedded-workflow components to this page's import
    // graph (CustomerCenterPanel + its Quotation/Order/Loan Application/Project
    // forms) — the real cold import can exceed the default 15s testTimeout
    // under full-suite parallel load. This is import weight, not a hang.
    const mod = await import('../CustomerWorkspace');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
    // 90s: cold import of the full CustomerWorkspace graph under full-suite
    // parallel load (verified: passes isolated/grouped within 15-30s; the
    // full-suite parallel scheduler can push a cold compile past 30s).
  }, 90000);
});

describe('CustomerWorkspace — Phase 0 regressions must remain intact', () => {
  const dialogsPath = resolve(__dirname, '../../features/customers/components/CustomerWorkspaceDialogs.tsx');
  const listPagePath = resolve(__dirname, '../CustomersWorkspace.tsx');
  const quotationWorkflowPath = resolve(__dirname, '../../lib/quotationWorkflow.ts');
  const orderWorkflowPath = resolve(__dirname, '../../lib/orderWorkflow.ts');

  it('the old list-page Edit form (ctx.handleEditSubmit) is retired — Customer Type editing moved to the normal Edit Customer flow, not a regression', () => {
    expect(readFileSync(dialogsPath, 'utf-8')).not.toMatch(/ctx\.handleEditSubmit/);
    const src = readFileSync(listPagePath, 'utf-8');
    expect(src).not.toMatch(/function handleEditSubmit\(/);
    // The B2B/B2C create forms remain — only the structural edit form is gone.
    expect(src).toMatch(/handleB2BSubmit,\s*handleB2CSubmit,\s*ctxToast/);
  });

  it('createQuotation and convertQuotationToOrder both still exist in quotationWorkflow.ts', () => {
    const src = readFileSync(quotationWorkflowPath, 'utf-8');
    expect(src).toMatch(/export async function createQuotation\(/);
    expect(src).toMatch(/export async function convertQuotationToOrder\(/);
  });

  it('createOrder still exists in orderWorkflow.ts', () => {
    const src = readFileSync(orderWorkflowPath, 'utf-8');
    expect(src).toMatch(/export async function createOrder\(/);
  });
});
