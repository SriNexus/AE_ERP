/**
 * projectWorkspaceQuotationIntegration.test.ts — Quotation Workspace
 * Migration (Stage 3 — Quotation card gets a real operational workspace;
 * project-linked quotations are viewed/edited/converted inside the Project
 * Workspace) PLUS the 2026-08-25 list-page popup reinstatement (Quotations.tsx's
 * row click now opens a QuotationDetailModal preview popup, matching the
 * existing Invoice list UX, instead of navigating away — see the first
 * describe block below).
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: STAGE_WORKSPACES registers the quotation
 * workspace, the workspace reuses the EXISTING quotation hooks/services/
 * components verbatim (no parallel system), the post-Order lock is enforced
 * at the service layer (updateQuotation) AND surfaced in the UI
 * (isQuotationLocked), the list page's preview popup reuses existing
 * infrastructure (no parallel document-preview system), and every OTHER
 * quotation-viewing entry point (the /quotations/:id detail page's own
 * ?edit= deep link, B2B Customer Workspace's "View Latest", quotation
 * notifications) is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const quotationWorkspace = read('../../features/projects/components/workspace/stages/ProjectQuotationWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const quotationWorkflow = read('../../lib/quotationWorkflow.ts');
const notificationRoutes = read('../../lib/notificationRoutes.ts');
const quotationsPage = read('../Quotations.tsx');
const quotationsWorkspacePage = read('../QuotationsWorkspace.tsx');
const b2bPipeline = read('../../features/customers/components/workspace/CustomerB2BWorkflowPipeline.tsx');
const mobileQuotation = read('../../components/mobile/quotations/MobileQuotationWorkspace.tsx');

describe('Quotation stage — registered operational workspace (Stage 3)', () => {
  it('STAGE_WORKSPACES registers the quotation workspace', () => {
    expect(stageRegistry).toContain('quotation: ProjectQuotationWorkspace');
  });

  it('ProjectWorkOnThisProject mounts it through the shared ProjectStageCard shell (same accordion mechanism as Survey/Engineering)', () => {
    expect(workOnThisProject).toContain('const StageWorkspace = STAGE_WORKSPACES[stage.id]');
    // Vendor Lock GAP-04 remediation (independent audit, 2026-08-14/16): see
    // the matching note in projectWorkspaceEngineeringIntegration.test.ts —
    // this was the same stale full-ternary-literal assertion (stale
    // 'registrationSummary' name/ordering from before the Registration stage
    // card was correctly inserted). Replaced with a targeted check of the
    // quotation branch this test actually verifies, plus proof the
    // Registration branch also exists in the same ternary.
    expect(workOnThisProject).toContain("stage.id === 'quotation' ? quotationCardSummary");
    expect(workOnThisProject).toMatch(/stage\.id === 'registration' \? \w+/);
  });
});

describe('Quotation workspace reuses the existing Quotation system verbatim (no parallel implementation)', () => {
  it('uses the exact same useQuotations() hook as the Quotations list page, scoped to THIS project', () => {
    expect(quotationWorkspace).toContain("import { useQuotations, QT_STATUSES } from '../../../../sales/hooks/useSales'");
    expect(quotationWorkspace).toContain('q.projectId === project.id');
  });

  it('reuses createQuotation / updateQuotation / isQuotationLocked / synchronizeQuotationProjectLink / quotationItemsFromEngineering from lib/quotationWorkflow.ts', () => {
    expect(quotationWorkspace).toContain('createQuotation');
    expect(quotationWorkspace).toContain('updateQuotation');
    expect(quotationWorkspace).toContain('isQuotationLocked');
    expect(quotationWorkspace).toContain('synchronizeQuotationProjectLink');
    expect(quotationWorkspace).toContain('quotationItemsFromEngineering');
  });

  it('reuses the shared QuotationItemsEditor and the exact conversion mutation (useConvertQuotationToOrder)', () => {
    expect(quotationWorkspace).toContain('import { QuotationItemsEditor }');
    expect(quotationWorkspace).toContain("import { useConvertQuotationToOrder } from '../../../../quotations/hooks/useQuotations'");
  });

  it('guards the create form against a pagination gap — no create form while the project has linked quotations that have not loaded (no duplicate records)', () => {
    expect(quotationWorkspace).toContain('const hasLinkedQuotations = (project.linkedQuotationIds || []).length > 0;');
  });
});

describe('Post-Order lock — enforced at the service layer and surfaced in the UI', () => {
  it('lib/quotationWorkflow.ts exposes isQuotationLocked (status Converted to Order / convertedOrderId) and a lock-guarded updateQuotation', () => {
    expect(quotationWorkflow).toContain('export function isQuotationLocked');
    expect(quotationWorkflow).toContain("quote?.status === 'Converted to Order' || Boolean(quote?.convertedOrderId)");
    expect(quotationWorkflow).toContain('export async function updateQuotation');
    expect(quotationWorkflow).toContain('can no longer be edited');
  });

  it('the workspace gates Edit and Convert to Order on the real lock state and renders a locked banner after conversion', () => {
    expect(quotationWorkspace).toContain('const locked = isQuotationLocked(activeQuotation)');
    expect(quotationWorkspace).toContain("{!locked && perms.canEdit('quotations')");
    expect(quotationWorkspace).toContain("{!locked && perms.canCreate('orders')");
    expect(quotationWorkspace).toContain('has been converted to an Order and is locked');
    expect(quotationWorkspace).toContain('View Order');
  });

  it('the legacy list-page edit path and the mobile edit path both route through updateQuotation — the lock cannot be bypassed via another component', () => {
    expect(quotationsPage).toContain('await updateQuotation(editId, payload)');
    expect(mobileQuotation).toContain('await updateQuotation(editingQuotation.id, quotationPayload)');
  });
});

describe('Quotation list preview popup — reinstated to match the Invoice list UX (2026-08-25)', () => {
  // The original "retired popup" migration (this file's remaining describe
  // blocks below) intentionally moved quotation viewing off a popup and onto
  // navigation (Project Workspace / /quotations/:id). That decision has since
  // been explicitly reversed for the LIST PAGE's click behavior only, by
  // direct product request: "clicking a quotation should open a preview
  // popup, the same way Invoice already works" — not a regression, a
  // deliberate UX parity fix. QuotationDetailModal.tsx mirrors
  // InvoiceDetailModal.tsx's structure (same Modal size, header, tabs,
  // footer button row, DetailCard/Field building blocks) rather than
  // inventing a new popup design. Project Workspace access is preserved as
  // an explicit in-popup action (onOpenProject), not the default click
  // target. The OTHER entry points this file protects below — the
  // /quotations/:id detail page's own ?edit= deep link, the B2B pipeline's
  // "View Latest", and quotation notifications — were NOT touched and still
  // route exactly as before.
  it('Quotations.tsx has the QuotationDetailModal preview popup, wired through viewItem/?open= (mirrors InvoicesWorkspace.tsx\'s viewItem/openInvoice/closeInvoiceDetails pattern)', () => {
    expect(quotationsPage).toContain('import { QuotationDetailModal }');
    expect(quotationsPage).toContain('const [viewItem, setViewItem] = useState<any>(null)');
    expect(quotationsPage).toContain("const openParam = searchParams.get('open') || ''");
    expect(quotationsPage).toContain('function closeQuotationDetails()');
    expect(quotationsPage).toContain('<QuotationDetailModal');
  });

  it('row click / View opens the preview popup (openQuotationPreview) — no automatic navigation to Project Workspace or /quotations/:id', () => {
    expect(quotationsPage).toContain('function openQuotationPreview(q: any)');
    expect(quotationsPage).toContain('onClick={(e) => handleRowClick(e, q)}');
    expect(quotationsPage).toContain('openQuotationPreview(quotation)');
    expect(quotationsPage).toContain('<QuotationActionStrip onView={() => openQuotationPreview(q)} />');
  });

  it('Project Workspace remains reachable — openQuotationDetails() is now an explicit in-popup action (onOpenProject), not the row-click target', () => {
    expect(quotationsPage).toContain('function openQuotationDetails(q: any)');
    expect(quotationsPage).toContain("navigate(`/projects/${encodeURIComponent(q.projectId)}`)");
    expect(quotationsPage).toContain('onOpenProject={viewItem?.projectId ? () => { closeQuotationDetails(); openQuotationDetails(viewItem); } : undefined}');
  });

  it('the popup reuses existing infrastructure — no duplicated business logic (doPrint mirrors InvoicesWorkspace.tsx\'s doPrint via DocumentTemplateResolver, sendQuotationEmail is the existing shared utility, Delete reuses the existing del mutation)', () => {
    expect(quotationsPage).toContain("const { DocumentTemplateResolver, triggerPrint } = await import('../templates/documents/resolver')");
    expect(quotationsPage).toContain("DocumentTemplateResolver(fullCompany as any, 'QUOTATION', quotation)");
    expect(quotationsPage).toContain('sendQuotationEmail(viewItem, customers, { company, emailSettings })');
    expect(quotationsPage).toContain('setDelId(viewItem.id)');
  });
});

describe('Old standalone quotation popup — retired for every entry point EXCEPT the list page\'s own row click (see above)', () => {
  it('the /quotations/:id workspace uses inline center-panel edit (startEdit) instead of navigating away', () => {
    expect(quotationsWorkspacePage).toContain('const [isEditing, setIsEditing] = useState(false)');
    expect(quotationsWorkspacePage).toContain('onClick={startEdit}');
    expect(quotationsWorkspacePage).toContain('QuotationItemsEditor');
  });

  it('B2B Customer Workspace "View Latest" opens the detail page, not the popup', () => {
    expect(b2bPipeline).toContain("navigate(`/quotations/${encodeURIComponent(latestQuotation.id)}`)");
    expect(b2bPipeline).not.toContain('&open=${encodeURIComponent(latestQuotation.id)}');
  });

  it('quotation notifications route to the detail page, not ?open=', () => {
    expect(notificationRoutes).toContain("`/quotations/${encodeURIComponent(entityId)}`");
  });
});
