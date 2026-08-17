/**
 * customerWorkspaceLeadStandardization.test.ts — Left Panel + Tab Navigation
 * + Documents + Footer UI standardization mission.
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers the mission's four in-scope areas — Left
 * Panel visual language, workspace-level tabs, Documents (with no
 * Lead→Customer duplication), and Footer sizing — plus a scope-control check
 * that no out-of-scope Customer logic was touched.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const customerWorkspacePage = read('../CustomerWorkspace.tsx');
const leftPanel = read('../../features/customers/components/workspace/CustomerWorkspaceLeftPanel.tsx');
const contextPanel = read('../../features/customers/components/workspace/leftPanel/CustomerContextPanel.tsx');
const customerDocsSection = read('../../features/customers/components/workspace/CustomerWorkspaceDocumentsSection.tsx');
const leadDocsSection = read('../../features/leads/components/workspace/LeadWorkspaceDocumentsSection.tsx');
const footer = read('../../features/customers/components/workspace/CustomerWorkspaceFooter.tsx');
const leadWorkspacePage = read('../LeadWorkspace.tsx');
const leadWorkflow = read('../../lib/leadWorkflow.ts');
const workspaceTabsSrc = read('../../components/shared/WorkspaceTabs.tsx');
const sections = read('../../features/customers/components/workspace/CustomerWorkspaceSections.tsx');

describe('1. Left Panel — Premium UX Redesign mission reverses the earlier Lead-matching flat InfoRow pattern', () => {
  it('CustomerContextPanel no longer uses the flat label/value InfoRow ledger (grid-cols-[100px_1fr] per field) — the redesign brief explicitly calls this pattern out as a "Word document" feel to eliminate; it now groups fields into scannable clusters (Business/Identity, Contact, Location, Ownership, Source, Note)', () => {
    expect(contextPanel).not.toContain('grid grid-cols-[100px_1fr]');
    expect(contextPanel).toContain('function Cluster(');
    expect(contextPanel).toContain('function IconRow(');
  });

  it('every cluster label still comes from the exact same field-resolution rules as before (Business/Identity vs Contact vs Location), just rendered densely instead of as a repeated label column', () => {
    expect(contextPanel).toMatch(/label=\{isB2B \? 'Business' : 'Identity'\}/);
    expect(contextPanel).toContain('label="Contact"');
  });

  it('Left Panel is permanent — same customer-specific B2B/B2C fields still resolved by resolveCustomerContextFields, untouched', () => {
    expect(contextPanel).toContain('export function resolveCustomerContextFields');
    expect(contextPanel).toContain("customer?.type || 'B2B'");
  });
});

describe('2. Workspace-level Tabs — Premium UX Redesign mission retires them entirely', () => {
  it('no workspace-level <nav role="tablist"> exists between the Header and the 3-column body anymore — CUSTOMER_TABS/workspace.activeTab (and the workspaceConfig.ts file that held them) are gone; no KPI bar either (Final UI Cleanup mission removed that earlier)', () => {
    expect(customerWorkspacePage).not.toContain('role="tablist"');
    expect(customerWorkspacePage).not.toContain('CUSTOMER_TABS');
    expect(customerWorkspacePage).not.toContain('workspace.activeTab');
    expect(customerWorkspacePage).not.toContain('<CustomerWorkspaceKpis');
  });

  it('the always-open pipeline/snapshot and CustomerWorkspaceSections\' accordion now live directly inside the Center column instead of behind a tab switch', () => {
    const bodyIdx = customerWorkspacePage.indexOf('BODY (Left 25%');
    const headerIdx = customerWorkspacePage.indexOf('<CustomerWorkspaceHeader');
    expect(headerIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(headerIdx);
    expect(customerWorkspacePage).toContain('<CustomerCenterPanel');
    expect(customerWorkspacePage).toContain('<CustomerWorkspaceSections');
  });
});

describe('3. Documents — Customer gets a proper Documents section, reusing Lead\'s architecture', () => {
  it('CustomerWorkspaceDocumentsSection exists and wraps the same generic DocumentManager Lead uses', () => {
    expect(customerDocsSection).toContain("import DocumentManager");
    expect(customerDocsSection).toContain('<DocumentManager');
  });

  it('Document System + Panel Standardization mission: Documents moved OUT of the Left Panel into its own workspace-level tab (was too cramped for real document management)', () => {
    expect(leftPanel).not.toMatch(/import CustomerWorkspaceDocumentsSection/);
    expect(leftPanel).not.toMatch(/<CustomerWorkspaceDocumentsSection/);
    // Premium UX Redesign mission: Documents moved again, from a workspace-level
    // tab into CustomerWorkspaceSections' Documents row (still the spacious
    // Center column, just accordion-style instead of tab-style) — same
    // component, same data, only the mounting point changed.
    expect(sections).toMatch(/import CustomerWorkspaceDocumentsSection/);
    expect(sections).toContain('<CustomerWorkspaceDocumentsSection');
    expect(customerWorkspacePage).not.toContain('<CustomerWorkspaceDocumentsSection');
  });

  it('no duplicate document system: convertLeadToCustomer() carries the lead\'s normalized document list onto the new customer record (same reference, not a re-upload) in both the demo-mode and Firebase-transaction branches', () => {
    expect(leadWorkflow).toContain("import { normalizeDocuments } from '../features/leads/components/workspace/LeadWorkspaceDocumentsSection'");
    const occurrences = leadWorkflow.match(/documents: normalizeDocuments\(/g) || [];
    expect(occurrences.length).toBe(2);
  });

  it('normalizeDocuments is exported from Lead\'s adapter (one additive keyword) so the conversion flow can reuse it directly, instead of a second parallel implementation', () => {
    expect(leadDocsSection).toContain('export function normalizeDocuments(');
  });

  it('Customer\'s own document adapter persists via CustomerDomainService.update — the customer\'s existing unrestricted write path, not a new save primitive', () => {
    expect(customerDocsSection).toContain('CustomerDomainService.update(');
  });
});

describe('4. Footer — same visual dimensions as Lead', () => {
  it('button sizing/padding/shadow/hover-lift classes match Lead\'s FooterActionButton exactly', () => {
    const sharedButtonClasses = [
      'inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12px] font-semibold shadow-sm transition-all',
      'hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm',
      'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none',
    ];
    for (const cls of sharedButtonClasses) {
      expect(leadWorkspacePage).toContain(cls);
      expect(footer).toContain(cls);
    }
  });

  it('icon sizes match Lead\'s footer (h-4 w-4, not the old h-3.5 w-3.5)', () => {
    expect(footer).not.toContain('h-3.5 w-3.5');
    expect((footer.match(/h-4 w-4/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('Premium UX Redesign mission (second refinement pass) reverses the earlier always-visible-but-disabled Save/Save & Next behavior: Save controls now render only during an active edit session (isEditing), resolving the "is this a view page or an edit page?" ambiguity the always-present button created', () => {
    expect(footer).toMatch(/\{isEditing && \(/);
    expect(footer).toMatch(/disabled=\{!hasUnsaved \|\| saving\}/);
  });
});

describe('Scope control — existing Customer logic is untouched', () => {
  it('does not reference Firestore mutation primitives directly in the restyled Left Panel components (writes still go through CustomerDomainService/CustomerWorkspacePersistence, unchanged)', () => {
    for (const src of [contextPanel]) {
      expect(src).not.toMatch(/createDocWithId|updateDocById|deleteDoc\(/);
    }
  });

  it('WorkspaceTabs.tsx content() dispatch is unchanged for every other module — same switch, same Universal*Tab components', () => {
    expect(workspaceTabsSrc).toContain("case 'documents': return <UniversalDocumentsTab");
    expect(workspaceTabsSrc).toContain("case 'linked_records': return <UniversalLinkedRecordsTab");
  });

  it('CustomerWorkspace.tsx does not import or reference any Mobile* component', () => {
    expect(customerWorkspacePage).not.toMatch(/Mobile[A-Z]\w*/);
  });
});
