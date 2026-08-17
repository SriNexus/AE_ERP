/**
 * customerWorkspaceB2BB2CLifecycle.test.ts — B2B long-term relationship hub
 * vs B2C one-time project lifecycle.
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: quotations now available to B2C, Create
 * Order never leaking into B2C, and — since the B2C Project Timeline &
 * Workspace UX Specification mission — CustomerB2CWorkflowCards' independent
 * per-record gating (replacing the retired CustomerCenterSnapshot/
 * CustomerProjectStatusPanel pair, whose "Work on This Customer" card used to
 * fully vanish once a Project existed), Quick Actions' matching independent
 * gating, and CustomerProjectTimelinePanel now owning the Go to Project
 * Workspace navigation button.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const billingContext = read('../../features/customers/hooks/useCustomerBillingContext.ts');
const b2cCards = read('../../features/customers/components/workspace/CustomerB2CWorkflowCards.tsx');
const centerPanel = read('../../features/customers/components/workspace/CustomerCenterPanel.tsx');
const projectTimeline = read('../../features/customers/components/workspace/CustomerProjectTimelinePanel.tsx');
const quickActions = read('../../features/customers/components/workspace/rightPanel/CustomerQuickActions.tsx');
const rightPanel = read('../../features/customers/components/workspace/CustomerWorkspaceRightPanel.tsx');
const customerWorkspacePage = read('../CustomerWorkspace.tsx');
const useProjectStageSrc = read('../../hooks/useProjectStage.ts');

describe('useCustomerBillingContext — Quotations available to B2C, Orders remain B2B-only', () => {
  it('quotations query is enabled for both customer types (no isB2B gate)', () => {
    const quotationsBlock = billingContext.slice(billingContext.indexOf('customer-kpi-quotations'), billingContext.indexOf('customer-kpi-quotations') + 300);
    expect(quotationsBlock).toMatch(/enabled:\s*!!customerId/);
    expect(quotationsBlock).not.toMatch(/enabled:\s*isB2B/);
  });

  it('orders query remains B2B-only — Orders is genuinely a B2B-only concept', () => {
    const ordersBlock = billingContext.slice(billingContext.indexOf('customer-kpi-orders'), billingContext.indexOf('customer-kpi-orders') + 300);
    expect(ordersBlock).toMatch(/enabled:\s*isB2B\s*&&\s*!!customerId/);
  });
});

describe('CustomerB2CWorkflowCards — B2C "Work on This Customer" now offers ONLY the Project entry', () => {
  it('offers only the Project action — Quotation and Loan Application were removed from this section (their functionality remains via their own pages/records), reusing the same workflow.goToProject the Right Panel Quick Actions also call', () => {
    expect(b2cCards).toMatch(/Create Project/);
    expect(b2cCards).toContain('workflow.goToProject');
    expect(b2cCards).not.toContain('Create Quotation');
    expect(b2cCards).not.toContain('Start Registration');
    expect(b2cCards).not.toContain('workflow.goToQuotation');
    expect(b2cCards).not.toContain('workflow.goToLoanApplication');
  });

  it('never offers Create Order — that stays exclusively in the B2B pipeline', () => {
    expect(b2cCards).not.toContain('Create Order');
    expect(b2cCards).not.toContain('onCreateOrder');
  });

  it('the Project entry is one-time: its Create action is only active when no Project exists yet, gated on the projects permission', () => {
    expect(b2cCards).toMatch(/active:\s*!project\s*&&\s*canCreateProjects/);
  });

  it('keeps the shared record-card primitive — a created record can render itself as a clickable summary row, never a vanished section', () => {
    expect(b2cCards).toContain('onOpenRecord');
    expect(b2cCards).toMatch(/state:\s*'actionable'\s*\|\s*'done'/);
  });

  it('keeps the real Loan Application→Project fast-path copy (Payment Received + no Project) without re-surfacing a Loan Application card', () => {
    expect(b2cCards).toContain('canCreateProjectFromLoanApplication');
    expect(b2cCards).toContain('Create Project from Loan Application');
  });

  it('does not reimplement date selection — no mostRecentByDate definition of its own', () => {
    expect(b2cCards).not.toMatch(/function mostRecentByDate/);
  });
});

describe('CustomerCenterPanel — B2C always renders CustomerB2CWorkflowCards, never a separate tracking view', () => {
  it('imports and renders CustomerB2CWorkflowCards for B2C, not the retired CustomerCenterSnapshot/CustomerProjectStatusPanel pair', () => {
    expect(centerPanel).toContain('import CustomerB2CWorkflowCards');
    expect(centerPanel).toContain('<CustomerB2CWorkflowCards');
    expect(centerPanel).not.toContain('CustomerCenterSnapshot');
    expect(centerPanel).not.toContain('CustomerProjectStatusPanel');
  });

  it('B2C is no longer routed to a separate tracking view once a Project exists — that used to make "Work on This Customer" appear to vanish', () => {
    expect(centerPanel).not.toMatch(/if \(!billing\.isB2B && latestProject\)/);
  });

  it('the create-view checks (Quotation/Order/Loan Application/Project forms) are still checked before the default view, so an in-progress create form is never yanked away', () => {
    const b2cCardsIdx = centerPanel.indexOf('<CustomerB2CWorkflowCards');
    const createProjectViewIdx = centerPanel.indexOf("view === 'create-project'");
    expect(createProjectViewIdx).toBeGreaterThan(-1);
    expect(b2cCardsIdx).toBeGreaterThan(createProjectViewIdx);
  });
});

describe('CustomerProjectTimelinePanel — two-panel operational tracking, owns Go to Project Workspace', () => {
  it('still reuses resolveProjectWorkspaceStages() rather than reimplementing stage/timeline computation', () => {
    expect(projectTimeline).toContain("import { resolveProjectWorkspaceStages");
    expect(projectTimeline).not.toMatch(/const LIFECYCLE\s*[:=]/);
  });

  it('renders its own "Go to Project Workspace" button (moved here from CustomerWorkspace.tsx\'s card header) and navigates to the real Project Workspace route', () => {
    expect(projectTimeline).toContain('Go to Project Workspace');
    expect(projectTimeline).toMatch(/navigate\(`\/projects\/\$\{encodeURIComponent\(project\.id\)\}`\)/);
  });

  it('exports a pure resolveStageDetail() helper that never invents data — completed-stage info comes only from project.stageHistory, never a new Firestore query', () => {
    expect(projectTimeline).toContain('export function resolveStageDetail');
    expect(projectTimeline).not.toMatch(/useQuery\(|getAll\(|getOne\(/);
  });

  it('still never adds per-stage navigation (href/onClick to real sub-workspaces) — the one path into the real work stays Go to Project Workspace', () => {
    expect(projectTimeline).not.toMatch(/stageHref|stageForNavigation/);
  });
});

describe('useProjectStage — confirmed pre-existing engine this mission reuses, not invents', () => {
  it('resolveProjectWorkspaceStages is exported and returns real stage status, the exact shape CustomerProjectTimelinePanel consumes', () => {
    expect(useProjectStageSrc).toContain('export function resolveProjectWorkspaceStages');
  });
});

describe('CustomerQuickActions — Project creation gated independently; Start Registration removed entirely', () => {
  it('never shows Create Quotation or Create Order, for either B2B or B2C', () => {
    expect(quickActions).not.toContain('Create Quotation');
    expect(quickActions).not.toContain('Create Order');
  });

  it('Start Registration is removed from this panel entirely — Registration stays fully available via its own /loan-applications page and records (no longer re-surfaced in the B2C "Work on This Customer" section either)', () => {
    expect(quickActions).not.toContain('Start Registration');
    expect(quickActions).not.toContain('hasRegistration');
    expect(quickActions).not.toContain('goToLoanApplication');
    expect(b2cCards).not.toContain('Start Registration');
  });

  it('Create Project is gated on !isB2B && !hasProject', () => {
    expect(quickActions).toMatch(/!isB2B\s*&&\s*!hasProject/);
    expect(quickActions).toContain('Create Project');
  });

  it('accepts a hasProject prop, no equivalent hasRegistration prop anymore', () => {
    expect(quickActions).toMatch(/hasProject\??:\s*boolean/);
    expect(quickActions).not.toMatch(/hasRegistration\??:\s*boolean/);
  });

  it('Call/WhatsApp/Email were also removed from this panel (Header keeps its own copies, untouched)', () => {
    expect(quickActions).not.toMatch(/label="Call"/);
    expect(quickActions).not.toMatch(/label="WhatsApp"/);
    expect(quickActions).not.toMatch(/label="Email"/);
  });

  it('adds an Add Note action writing via CustomerDomainService.update — same customer.notes field the Left Panel Edit Customer form uses, not a second note system', () => {
    expect(quickActions).toContain('label="Add Note"');
    expect(quickActions).toContain('CustomerDomainService.update(customer.id, { notes: note })');
  });
});

describe('CustomerWorkspaceRightPanel — computes hasProject from the same billing context, no new query', () => {
  it('passes hasProject to CustomerQuickActions, derived from billing.projects via the shared mostRecentByDate; no hasRegistration plumbing left behind', () => {
    expect(rightPanel).toContain('hasProject={hasProject}');
    expect(rightPanel).not.toContain('hasRegistration');
    expect(rightPanel).toContain("import { mostRecentByDate } from './CustomerWorkspaceKpis'");
  });
});

describe('CustomerWorkspace.tsx — B2C "Work on This Customer" always renders with the single Project entry', () => {
  it('no longer switches its title to "Project Status" just because a Project exists', () => {
    expect(customerWorkspacePage).not.toContain('Project Status');
    expect(customerWorkspacePage).not.toContain("centerLatestProject ? 'Project Status' : 'Work on This Customer'");
  });

  it('renders "Work on This Customer" for B2C with no completion-based hide — the section now holds the single Project entry in both its create and done states, keeping the required hierarchy intact at all times', () => {
    expect(customerWorkspacePage).toContain('Work on This Customer');
    expect(customerWorkspacePage).not.toContain('b2cAllRecordsComplete');
    expect(customerWorkspacePage).not.toMatch(/!b2cProjectComplete/);
    expect(customerWorkspacePage).toMatch(/<CustomerCenterPanel\s+customer=\{customer\}\s+workflow=\{centerWorkflow\}\s*\/>/);
  });

  it('Project Timeline is always mounted for B2C — it owns its own Go to Project Workspace button now, not this page', () => {
    expect(customerWorkspacePage).toContain('<CustomerProjectTimelinePanel project={centerLatestProject} />');
    expect(customerWorkspacePage).not.toMatch(/navigate\(`\/projects\/\$\{encodeURIComponent\(centerLatestProject\.id\)\}`\)/);
  });

  it('derives centerLatestProject from the same useCustomerBillingContext hook (query-key dedup), not a second Firestore query', () => {
    expect(customerWorkspacePage).toContain('useCustomerBillingContext(customer)');
    expect(customerWorkspacePage).toMatch(/centerLatestProject\s*=\s*!centerBilling\.isB2B\s*\?\s*mostRecentByDate\(centerBilling\.projects/);
  });
});

describe('Scope control — retired components are actually gone', () => {
  it('CustomerCenterSnapshot.tsx and CustomerProjectStatusPanel.tsx no longer exist as files', () => {
    expect(existsSync(resolve(__dirname, '../../features/customers/components/workspace/CustomerCenterSnapshot.tsx'))).toBe(false);
    expect(existsSync(resolve(__dirname, '../../features/customers/components/workspace/CustomerProjectStatusPanel.tsx'))).toBe(false);
  });
});
