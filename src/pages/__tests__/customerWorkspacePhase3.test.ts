/**
 * customerWorkspacePhase3.test.ts — Phase 3 Left Panel wiring + regression
 * checks.
 *
 * Source-text analysis, matching the convention established in
 * customerWorkspace.test.ts / customerWorkspacePhase2.test.ts — no
 * @testing-library/react in this repo. Logic that CAN be pure-tested lives
 * in customerContextPanel.test.ts / recordContextPanels.test.ts /
 * taskContextPanel.test.ts / customerWorkspaceLeftPanel.test.ts; this file
 * covers wiring facts only: is the Left Panel actually mounted, is the
 * layout structured as documented, is Phase 0/1/2 still intact, were no
 * mobile files touched, no duplicate Firestore mutations introduced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const customerWorkspacePage = read('../CustomerWorkspace.tsx');
const leftPanel = read('../../features/customers/components/workspace/CustomerWorkspaceLeftPanel.tsx');
const contextPanel = read('../../features/customers/components/workspace/leftPanel/CustomerContextPanel.tsx');
const taskPanel = read('../../features/customers/components/workspace/leftPanel/TaskContextPanel.tsx');
const recordPanels = read('../../features/customers/components/workspace/leftPanel/RecordContextPanels.tsx');
const relationshipPanel = read('../../features/customers/components/workspace/leftPanel/RelationshipContextPanel.tsx');
const centerPanel = read('../../features/customers/components/workspace/CustomerCenterPanel.tsx');
const kpis = read('../../features/customers/components/workspace/CustomerWorkspaceKpis.tsx');
const sections = read('../../features/customers/components/workspace/CustomerWorkspaceSections.tsx');

describe('CustomerWorkspace — Phase 3 Left Panel wiring', () => {
  it('mounts CustomerWorkspaceLeftPanel, passing the live customer', () => {
    expect(customerWorkspacePage).toContain('import CustomerWorkspaceLeftPanel');
    // Phase 5 added draft/canEdit/onFieldChange props (deferred-commit
    // editing) and a key={customer.id} for per-customer state isolation.
    // The Left Panel/Tabs/Documents/Footer UI standardization mission made
    // the Left Panel permanent (Customer Information + Documents regardless
    // of the active tab, mirroring Lead Workspace) so it no longer needs
    // (or accepts) an `activeTab` prop.
    expect(customerWorkspacePage).toMatch(/<CustomerWorkspaceLeftPanel[\s\S]{0,300}customer=\{customer\}/);
    expect(customerWorkspacePage).not.toMatch(/<CustomerWorkspaceLeftPanel[\s\S]{0,400}activeTab=/);
  });

  it('establishes a 3-column body (Left/Center/Right) — Customer + Leads Workspace Completion Pass mission retargeted the Left Panel to reuse Leads Workspace\'s own finalized 25% width (Right Panel stays this workspace\'s locked source-of-truth at 19%, unchanged; Center is the flex-1 remainder ≈56%)', () => {
    expect(customerWorkspacePage).toContain('w-[25%]');
    expect(customerWorkspacePage).toContain('w-[19%]');
    expect(customerWorkspacePage).not.toContain('w-[20%]');
    expect(customerWorkspacePage).not.toContain('w-[15%]');
    expect(customerWorkspacePage).not.toContain('w-[28%]');
    // Center has no fixed width — it is the flex-1 remainder. The mission's
    // tabpanel wrapper made it a flex column (`flex ... flex-1 flex-col
    // overflow-hidden`) instead of a plain `min-w-0 flex-1 overflow-hidden`
    // div, so it can size its own tabpanel child — `min-w-0` and `flex-1`
    // are still both present, just no longer contiguous.
    expect(customerWorkspacePage).toMatch(/flex min-w-0 flex-1 flex-col overflow-hidden/);
  });

  it('Premium UX Redesign mission: the workspace-level tab bar itself is retired (not just lifted) — CustomerWorkspace.tsx no longer imports WorkspaceTabs\' content() dispatch directly; CustomerWorkspaceSections now owns that reuse instead, one level down', () => {
    // WorkspaceShell bundles its own tab bar + content into one inseparable
    // unit (see WorkspaceShell.tsx) — this page never called it directly
    // even before this mission, and still doesn't.
    expect(customerWorkspacePage).not.toContain('<WorkspaceShell');
    expect(customerWorkspacePage).not.toMatch(/import \{ content \} from/);
    expect(customerWorkspacePage).not.toContain('workspace.activeTab');
    expect(sections).toMatch(/import \{ content \} from '\.\.\/\.\.\/\.\.\/\.\.\/components\/shared\/WorkspaceTabs'/);
  });

  it('WorkspaceTabs.tsx itself is otherwise untouched — same content() switch, same WorkspaceTabs component, only `content` gained an export keyword', () => {
    const workspaceTabsSrc = read('../../components/shared/WorkspaceTabs.tsx');
    expect(workspaceTabsSrc).toMatch(/export function content\(/);
    expect(workspaceTabsSrc).toContain("case 'tasks': return <UniversalTasksTab");
    expect(workspaceTabsSrc).toContain('export function WorkspaceTabs(');
  });

  it('Right Panel is a minimal placeholder — no new business-action system, no re-declared quick actions', () => {
    const rightPanelStart = customerWorkspacePage.indexOf('Right Panel');
    expect(rightPanelStart).toBeGreaterThan(-1);
    const rightPanelBlock = customerWorkspacePage.slice(rightPanelStart, rightPanelStart + 400);
    expect(rightPanelBlock).not.toContain('buildCustomerQuickActions');
    expect(rightPanelBlock).not.toContain('QuickAction');
  });
});

describe('CustomerWorkspace — Phase 3 Overview cleanup is conservative, not destructive', () => {
  // Scoped to the actual overview JSX block (not the whole file) — the
  // file's own doc comments legitimately mention "Customer Information" and
  // "Links & References" by name when explaining what moved and why.
  // Anchored on the overview JSX's own opening div rather than the old
  // `overview: (` object-literal key — the Left Panel/Tabs/Documents/Footer
  // UI standardization mission passes this same JSX as content()'s 2nd
  // positional argument instead of a `tabs.overview` prop, so that literal
  // key no longer appears in the source. (Deliberately NOT anchored on the
  // "Module-Specific Overview" comment just above this div — that comment's
  // own explanatory text legitimately quotes "Customer Information" when
  // describing what moved, which would otherwise poison the assertion below.)
  // p-4/space-y-4 (Premium UX Redesign mission's own further-tightened
  // rhythm — see customerWorkspaceCentralPanelRefinement.test.ts §1 for the
  // deliberate deviation from Lead's p-6/space-y-5).
  const overviewIdx = customerWorkspacePage.indexOf('<div className="p-4 space-y-4">');
  const overviewBlock = customerWorkspacePage.slice(overviewIdx);

  it('removed exactly the two blocks with a confirmed same-tab replacement (Customer Information, Links & References)', () => {
    expect(overviewIdx).toBeGreaterThan(-1);
    expect(overviewBlock).not.toContain('Customer Information');
    expect(overviewBlock).not.toContain('Links &amp; References');
  });

  it('kept the one block with no confirmed replacement (Notes, B2C-only since the Center Panel B2B Workflow Enhancement mission) — Financial Summary/Timeline & Activity/Related Records moved to their own tabs (Central Panel Refinement mission §2, see customerWorkspaceCentralPanelRefinement.test.ts)', () => {
    expect(overviewBlock).not.toContain('Financial Summary');
    expect(overviewBlock).not.toContain('Timeline &amp; Activity');
    expect(overviewBlock).not.toContain('>Related Records<');
    expect(overviewBlock).toMatch(/!centerBilling\.isB2B && customer\.notes && \(/);
  });

  it('CustomerCenterPanel (Phase 2) is still the first element of the Overview tab, untouched', () => {
    const centerPanelIdx = overviewBlock.indexOf('<CustomerCenterPanel');
    const notesIdx = overviewBlock.indexOf('{/* Notes —');
    expect(centerPanelIdx).toBeGreaterThan(-1);
    expect(centerPanelIdx).toBeLessThan(notesIdx);
  });
});

describe('Left Panel — no duplicate Firestore business logic, no new domain services', () => {
  it('CustomerContextPanel/RecordContextPanels/RelationshipContextPanel issue zero Firestore writes or reads', () => {
    for (const src of [contextPanel, recordPanels, relationshipPanel]) {
      expect(src).not.toMatch(/createDocWithId|updateDocById|deleteDoc|getAll\(/);
    }
  });

  it('TaskContextPanel reuses taskEngine.getTasksForEntity — the same function UniversalTasksTab calls — not a new task-fetching function', () => {
    expect(taskPanel).toContain('taskEngine.getTasksForEntity');
    expect(taskPanel).not.toMatch(/function getTasksForEntity/); // not redefined locally
  });

  it('permanent Left Panel (Left Panel/Tabs/Documents/Footer UI standardization mission) no longer branches per-tab, so it no longer needs its own useCustomerBillingContext call — that data still lives in CustomerWorkspaceKpis/CustomerCenterPanel, untouched', () => {
    expect(leftPanel).not.toContain('useCustomerBillingContext(');
    expect(leftPanel).not.toMatch(/getAll\(COLLECTIONS\.(ORDERS|QUOTATIONS|REGISTRATIONS|PROJECTS)/);
  });

  it('does not create a new global Left Panel reducer/engine — Phase 5 scope, untouched', () => {
    expect(leftPanel).not.toMatch(/useReducer|CustomerWorkspaceEngine/);
  });
});

describe('Regression — Phase 0/1/2 remain intact', () => {
  it('Premium UX Redesign mission: CUSTOMER_TABS and its workspaceConfig.ts file are gone — the 5 tabs that were still in active use (Documents/Activity/Order History/Linked Records/Tasks; Invoices was confirmed dead code, Orders/Overview folded into the always-open pipeline) are all reachable via CustomerWorkspaceSections instead', () => {
    expect(existsSync(resolve(__dirname, '../../features/customers/utils/workspaceConfig.ts'))).toBe(false);
    for (const name of ['Documents', 'Activity', 'Order History', 'Linked Records', 'Tasks']) {
      expect(sections).toContain(name);
    }
  });

  it('buildCustomerQuickActions was retired, not reintroduced (Remove Unnecessary Actions & Tabs mission)', () => {
    expect(customerWorkspacePage).not.toContain('buildCustomerQuickActions(');
    expect(customerWorkspacePage).not.toMatch(/function buildCustomerQuickActions/);
  });

  it('CustomerCenterPanel (Phase 2) still routes to the same 4 embedded forms plus the B2C workflow cards', () => {
    // As of Phase 3, this file was unmodified. Phase 4 later made it a
    // controlled component (accepts `workflow` instead of owning its own
    // view state — see customerWorkspacePhase4.test.ts) so the Right Panel's
    // Quick Actions can drive the same state; the routing itself, checked
    // here, is unchanged (the default view's own component was later
    // replaced by CustomerB2CWorkflowCards — see customerWorkspaceB2BB2CLifecycle.test.ts).
    for (const form of ['CustomerQuotationForm', 'CustomerOrderForm', 'CustomerLoanApplicationForm', 'CustomerProjectForm', 'CustomerB2CWorkflowCards']) {
      expect(centerPanel).toContain(`<${form}`);
    }
  });

  it('CustomerWorkspaceKpis (Phase 1/2) still sources from useCustomerBillingContext, untouched by Phase 3', () => {
    expect(kpis).toContain('useCustomerBillingContext(');
  });

  it('module exports the component function', async () => {
    const mod = await import('../CustomerWorkspace');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
    // 240s: cold import of the full CustomerWorkspace graph under full-suite
    // parallel load (verified: passes isolated/grouped within 15-30s; the
    // full-suite parallel scheduler can push a cold compile past 170s on slow
    // machines). 240s keeps the module-existence assertion meaningful.
  }, 240000);
});

describe('Scope control — no mobile files, no unrelated page redesigns', () => {
  it('CustomerWorkspace.tsx does not import or reference any Mobile* component', () => {
    expect(customerWorkspacePage).not.toMatch(/Mobile[A-Z]\w*/);
  });

  it('Left Panel components do not import any Mobile* component', () => {
    for (const src of [leftPanel, contextPanel, taskPanel, recordPanels, relationshipPanel]) {
      expect(src).not.toMatch(/Mobile[A-Z]\w*/);
    }
  });
});
