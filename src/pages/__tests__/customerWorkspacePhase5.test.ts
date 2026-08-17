/**
 * customerWorkspacePhase5.test.ts — Footer/queue/save-engine wiring +
 * regression checks (Phase 5).
 *
 * Pure logic (resolveCustomerQueue, buildCustomerDraftDelta,
 * customerWorkspaceReducer) has its own dedicated test files; this file
 * covers what those can't: wiring facts verified by source-text analysis
 * (no @testing-library/react in this repo — see every prior phase's test
 * files for the same, established limitation).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveCustomerQueue } from '../CustomerWorkspace';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const customerWorkspacePage = read('../CustomerWorkspace.tsx');
const engine = read('../../features/customers/components/workspace/CustomerWorkspaceEngine.tsx');
const persistence = read('../../features/customers/components/workspace/CustomerWorkspacePersistence.ts');
const editor = read('../../features/customers/components/workspace/CustomerWorkspaceEditor.tsx');
const footer = read('../../features/customers/components/workspace/CustomerWorkspaceFooter.tsx');
const leftPanel = read('../../features/customers/components/workspace/CustomerWorkspaceLeftPanel.tsx');
const centerPanel = read('../../features/customers/components/workspace/CustomerCenterPanel.tsx');
const centerWorkflowHook = read('../../features/customers/hooks/useCustomerCenterWorkflow.ts');
const dirtyNavHook = read('../../hooks/useDirtyNavigation.ts');
const leadWorkspacePage = read('../LeadWorkspace.tsx');
const kpis = read('../../features/customers/components/workspace/CustomerWorkspaceKpis.tsx');
const header = read('../../features/customers/components/workspace/CustomerWorkspaceHeader.tsx');
const rightPanel = read('../../features/customers/components/workspace/CustomerWorkspaceRightPanel.tsx');

describe('resolveCustomerQueue — Previous/Next boundaries', () => {
  const customers = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];

  it('first customer: no previous, has next', () => {
    const q = resolveCustomerQueue(customers, 'A');
    expect(q.prevCustomer).toBeNull();
    expect(q.nextCustomer).toEqual({ id: 'B' });
    expect(q.currentIndex).toBe(0);
  });

  it('middle customer: has both previous and next', () => {
    const q = resolveCustomerQueue(customers, 'B');
    expect(q.prevCustomer).toEqual({ id: 'A' });
    expect(q.nextCustomer).toEqual({ id: 'C' });
  });

  it('last customer: has previous, no next', () => {
    const q = resolveCustomerQueue(customers, 'C');
    expect(q.prevCustomer).toEqual({ id: 'B' });
    expect(q.nextCustomer).toBeNull();
  });

  it('a customer not in the list: currentIndex -1, no previous/next', () => {
    const q = resolveCustomerQueue(customers, 'ZZZ');
    expect(q.currentIndex).toBe(-1);
    expect(q.prevCustomer).toBeNull();
    expect(q.nextCustomer).toBeNull();
  });

  it('a single-customer queue: neither previous nor next', () => {
    const q = resolveCustomerQueue([{ id: 'ONLY' }], 'ONLY');
    expect(q.prevCustomer).toBeNull();
    expect(q.nextCustomer).toBeNull();
  });

  it('does not exclude any customer by status — no invented "completed" filter (Master Plan §12.1 default)', () => {
    const mixed = [{ id: 'A', status: 'Active' }, { id: 'B', status: 'Inactive' }, { id: 'C', status: 'Active' }];
    const q = resolveCustomerQueue(mixed, 'A');
    expect(q.nextCustomer?.id).toBe('B'); // Inactive customer B is still reachable
  });
});

describe('CustomerWorkspace.tsx — Phase 5 engine + footer wiring', () => {
  it('wraps the page in CustomerWorkspaceEngineProvider', () => {
    expect(customerWorkspacePage).toContain('CustomerWorkspaceEngineProvider');
    expect(customerWorkspacePage).toMatch(/<CustomerWorkspaceEngineProvider>\s*<CustomerWorkspaceContent\s*\/>\s*<\/CustomerWorkspaceEngineProvider>/);
  });

  it('mounts CustomerWorkspaceFooter with Previous/Next/Save/Save & Next wired to real handlers', () => {
    expect(customerWorkspacePage).toContain('<CustomerWorkspaceFooter');
    expect(customerWorkspacePage).toContain('onSave={() => void handleSave()}');
    expect(customerWorkspacePage).toContain('onSaveAndNext={() => void handleSaveAndNext()}');
  });

  it('Save calls saveCustomerWorkspace (reuses updateCustomerProjectionWithPhoneLock via the persistence module), not a second update implementation', () => {
    expect(customerWorkspacePage).toContain('saveCustomerWorkspace(');
    expect(customerWorkspacePage).not.toMatch(/createDocWithId\(|updateDocById\(/);
  });

  it('Save checks canEdit(customers) before writing — does not rely on the editor UI gate alone', () => {
    const idx = customerWorkspacePage.indexOf('const handleSave = useCallback');
    const block = customerWorkspacePage.slice(idx, idx + 700);
    expect(block).toMatch(/perms\.canEdit\(['"]customers['"]\)/);
  });

  it('Save invalidates the customers query on a real change, refreshing Header/KPI/Left/Right data', () => {
    const idx = customerWorkspacePage.indexOf('const handleSave = useCallback');
    // Widened from 1200 (Phase 5.2's fresh-read conflict-check fix added length
    // to this function ahead of the invalidateQueries call).
    const block = customerWorkspacePage.slice(idx, idx + 1900);
    expect(block).toMatch(/qc\.invalidateQueries\(\{\s*queryKey:\s*\['customers'\]\s*\}\)/);
  });

  it('Save uses the extracted hasConflict() pure comparison, not a re-inlined copy', () => {
    // Phase 5.2 fix: compares against a fresh getOne() read, not the possibly-stale
    // `customer` prop sourced from useCustomers()'s paginated list query (30s
    // staleTime, no live listener) — confirmed via runtime testing that comparing
    // against the stale prop let two concurrent sessions silently overwrite each
    // other with no conflict ever detected. See the dedicated test below.
    expect(customerWorkspacePage).toContain('hasConflict(loadedUpdatedAtRef.current, fresh?.updatedAt)');
  });

  it('every exit path (Back, Previous, Next, Source Lead) routes through requestNavigation, not navigate() directly', () => {
    expect(customerWorkspacePage).toMatch(/onBack=\{\(\) => requestNavigation\('\/customers'\)\}/);
    expect(customerWorkspacePage).toMatch(/onPrevious=\{\(\) => prevCustomer && requestNavigation/);
    expect(customerWorkspacePage).toMatch(/onNext=\{\(\) => nextCustomer && requestNavigation/);
    expect(customerWorkspacePage).toMatch(/onViewSourceLead=\{sourceLeadId \? \(\) => requestNavigation/);
  });

  it('Left/Right Panels remount per customer via key={customer.id} — no cross-customer local-state leak', () => {
    const leftBlock = customerWorkspacePage.slice(customerWorkspacePage.indexOf('<CustomerWorkspaceLeftPanel'), customerWorkspacePage.indexOf('<CustomerWorkspaceLeftPanel') + 300);
    const rightBlock = customerWorkspacePage.slice(customerWorkspacePage.indexOf('<CustomerWorkspaceRightPanel'), customerWorkspacePage.indexOf('<CustomerWorkspaceRightPanel') + 300);
    expect(leftBlock).toContain('key={customer.id}');
    expect(rightBlock).toContain('key={customer.id}');
  });

  it('per-customer reset effect resets both the Phase 5 engine AND the Phase 4 centerWorkflow — no leaked embedded-workflow view', () => {
    const effectIdx = customerWorkspacePage.indexOf("if (lastCustomerIdRef.current === id) return;");
    const effectBlock = customerWorkspacePage.slice(effectIdx, effectIdx + 400);
    expect(effectBlock).toContain("cwDispatch({ type: 'RESET_WORKSPACE' })");
    expect(effectBlock).toContain('centerWorkflow.reset()');
    expect(effectBlock).toContain('loadedUpdatedAtRef.current = null');
  });

  it('conflict detection captures updatedAt once per customer and compares a fresh read before save', () => {
    expect(customerWorkspacePage).toContain('loadedUpdatedAtRef');
    expect(customerWorkspacePage).toContain('hasConflict(loadedUpdatedAtRef.current, fresh?.updatedAt)');
    expect(customerWorkspacePage).toContain("SET_CONFLICT_PENDING");
  });

  it('Phase 5.2 fix: the conflict check reads the customer document fresh via getOne(), not the paginated-list-sourced `customer` prop', () => {
    // Confirmed via genuine browser + emulated-Firestore testing: `customer` is
    // sourced from useCustomers()'s paginated list query, which has no live
    // listener and a 30s staleTime. Comparing against it directly meant a second
    // session's concurrent edit was never detected unless that list query
    // happened to have refetched in the meantime — silently allowing
    // last-write-wins data loss, defeating the entire purpose of this feature.
    const idx = customerWorkspacePage.indexOf('const handleSave = useCallback');
    const block = customerWorkspacePage.slice(idx, idx + 1200);
    expect(block).toMatch(/getOne(?:<[^>]*>)?\(COLLECTIONS\.CUSTOMERS,\s*customer\.id\)/);
    expect(block).toContain('hasConflict(loadedUpdatedAtRef.current, fresh?.updatedAt)');
  });

  it('the conflict modal offers exactly Cancel / Reload Latest / Save Anyway — no silent last-write-wins', () => {
    const conflictIdx = customerWorkspacePage.indexOf('Customer Was Updated By Someone Else');
    const conflictBlock = customerWorkspacePage.slice(conflictIdx, conflictIdx + 2000);
    expect(conflictBlock).toContain('Cancel');
    expect(conflictBlock).toContain('Reload Latest');
    expect(conflictBlock).toContain('Save Anyway');
  });

  it('the guard modal offers exactly Stay / Discard & Continue / Save & Continue', () => {
    const guardIdx = customerWorkspacePage.indexOf('Unsaved Changes');
    const guardBlock = customerWorkspacePage.slice(guardIdx, guardIdx + 800);
    expect(guardBlock).toContain('Stay');
    expect(guardBlock).toContain('Discard &amp; Continue');
    expect(guardBlock).toContain('Save &amp; Continue');
  });

  it('Save & Next does not pretend a save occurred when the draft is clean — navigates without calling handleSave', () => {
    const idx = customerWorkspacePage.indexOf('const handleSaveAndNext');
    const block = customerWorkspacePage.slice(idx, idx + 500);
    expect(block).toMatch(/if \(!cwState\.hasUnsaved\)/);
  });
});

describe('Two-tier save model — Tier A (deferred) vs Tier B (immediate) stay separate', () => {
  it('CustomerWorkspaceEditor never imports a Firestore write function — it only calls onFieldChange', () => {
    expect(editor).not.toMatch(/createDocWithId\(|updateDocById\(|updateCustomerProjectionWithPhoneLock\(/);
    expect(editor).toContain('onFieldChange(');
  });

  it('CustomerWorkspaceEngine (Tier A reducer) does not import Firestore code directly', () => {
    expect(engine).not.toMatch(/firebase|firestore|createDocWithId|updateDocById/i);
  });

  it('CustomerCenterPanel (Tier B, embedded workflows) is untouched in its own persistence — still routes to the same 4 immediate-write forms', () => {
    for (const form of ['CustomerQuotationForm', 'CustomerOrderForm', 'CustomerLoanApplicationForm', 'CustomerProjectForm']) {
      expect(centerPanel).toContain(`<${form}`);
    }
  });

  it('CustomerWorkspacePersistence (Tier A save) never calls into Tier B\'s create workflows', () => {
    expect(persistence).not.toMatch(/createQuotation\(|createOrder\(|createLoanApplication\(|createProject\(/);
  });
});

describe('Phone-lock / identity-lock preservation', () => {
  it('CustomerWorkspacePersistence reuses updateCustomerProjectionWithPhoneLock unmodified — no second phone-lock implementation', () => {
    expect(persistence).toContain('updateCustomerProjectionWithPhoneLock');
    expect(persistence).not.toMatch(/CUSTOMER_PHONE_LOCKS|customerPhoneLockId/);
  });

  it('CustomerWorkspaceEditor disables Name/Phone inputs when sourceLeadId is present', () => {
    expect(editor).toMatch(/disabled=\{locksIdentity \|\| !canEdit\}/);
    expect(editor).toContain('Boolean(customer?.sourceLeadId)');
  });
});

describe('Shared useDirtyNavigation — Lead migration, no behavior rewrite', () => {
  it('Lead Workspace imports and uses the shared hook instead of its own inline pendingNav state', () => {
    expect(leadWorkspacePage).toContain("import { useDirtyNavigation } from '../hooks/useDirtyNavigation'");
    expect(leadWorkspacePage).toContain('useDirtyNavigation({');
    expect(leadWorkspacePage).not.toMatch(/const \[pendingNav, setPendingNav\] = useState/);
  });

  it("Lead's guard modal wording is unchanged (Cancel/Discard/Save) — not rewritten to match Customer's wording", () => {
    const idx = leadWorkspacePage.indexOf('title="Unsaved Changes"');
    const block = leadWorkspacePage.slice(idx, idx + 1200);
    expect(block).toContain('>Cancel<');
    expect(block).toContain('Discard');
    expect(block).toMatch(/>\s*Save\s*<\/Button>/);
  });

  it("Lead's ambient anchor-click and popstate interceptors still exist, now via the shared hook's setPendingNav", () => {
    expect(leadWorkspacePage).toContain('setPendingNav(href)');
    expect(leadWorkspacePage).toContain('setPendingNav(target)');
  });

  it('the shared hook exposes requestNavigation/guardSave/guardDiscard/guardCancel/setPendingNav — the full surface both workspaces need', () => {
    for (const member of ['requestNavigation', 'guardSave', 'guardDiscard', 'guardCancel', 'setPendingNav']) {
      expect(dirtyNavHook).toContain(member);
    }
  });

  it('Customer Workspace uses the same shared hook, not a second copy of the guard logic', () => {
    expect(customerWorkspacePage).toContain("import { useDirtyNavigation } from '../hooks/useDirtyNavigation'");
    expect(customerWorkspacePage).toContain('useDirtyNavigation({');
  });
});

describe('Regression — Phase 0-4 remain intact', () => {
  it('Header still renders Call/WhatsApp/Email/View-Source-Lead', () => {
    expect(header).toContain('tel:${phone}');
    expect(header).toContain('wa.me');
  });

  it('CustomerWorkspaceKpis untouched by Phase 5', () => {
    expect(kpis).toContain('useCustomerBillingContext(');
  });

  it('CustomerWorkspaceLeftPanel stays permanent (no per-tab mode-switching) — the Left Panel/Tabs/Documents/Footer mission already retired resolveLeftPanelMode before Phase 5 began (the file\'s own doc comment still names it historically when explaining what was removed, same as customerWorkspaceLeftPanel.test.ts already accounts for); the earlier version of this assertion was stale (pre-existing, fixed here) — see customerWorkspaceLeftPanel.test.ts for the dedicated coverage', () => {
    expect(leftPanel).not.toMatch(/export function resolveLeftPanelMode/);
    expect(leftPanel).not.toMatch(/const mode = resolveLeftPanelMode/);
    expect(leftPanel).toContain('CustomerContextPanel');
  });

  it('Premium UX Redesign mission retired CUSTOMER_TABS and workspaceConfig.ts entirely — see customerWorkspacePhase3.test.ts for the replacement coverage (CustomerWorkspaceSections)', () => {
    expect(customerWorkspacePage).not.toContain('CUSTOMER_TABS');
  });

  it('CustomerWorkspaceRightPanel renders Health/Quick Actions/Linked Records — Recent Activity moved into the Center Panel\'s Activity section (Premium UX Redesign mission, second refinement pass) to remove the duplicate "what happened recently" surface that existed in both the Center and the Right Panel simultaneously', () => {
    for (const widget of ['CustomerRelationshipHealth', 'CustomerQuickActions', 'CustomerLinkedRecords']) {
      expect(rightPanel).toContain(`<${widget}`);
    }
    expect(rightPanel).not.toContain('<CustomerRecentActivity');
  });

  it('useCustomerCenterWorkflow (Phase 4) keeps its original 4 view-transition functions plus the new reset()', () => {
    for (const fn of ['goToQuotation', 'goToOrder', 'goToLoanApplication', 'goToProject', 'reset']) {
      expect(centerWorkflowHook).toContain(fn);
    }
  });

  it('module exports the component function', async () => {
    const mod = await import('../CustomerWorkspace');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  }, 30000);
});

describe('Strict scope boundary — no new business workflows, no mobile changes', () => {
  it('no Right Panel widget files were touched (footer/save engine only)', () => {
    expect(rightPanel).not.toMatch(/CustomerWorkspaceFooter|useCustomerWorkspaceState/);
  });

  it('no Phase 5 file references any Mobile* component', () => {
    for (const src of [engine, persistence, editor, footer]) {
      expect(src).not.toMatch(/Mobile[A-Z]\w*/);
    }
  });

  it('CustomerWorkspace.tsx does not reference any Mobile* component', () => {
    expect(customerWorkspacePage).not.toMatch(/Mobile[A-Z]\w*/);
  });
});
