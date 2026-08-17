/**
 * phase14DocumentsExpansion.test.ts — Phase 14 (Documents / Activities /
 * Linked Records) regression tests.
 *
 * Mirrors caseDocuments.test.ts's existing structure (pure unit tests for
 * resolveDocumentsFor() + source-text verification for the wiring this
 * codebase's convention already uses elsewhere) for the five newly-scoped
 * entity types: Order, Quotation, ProformaInvoice(Invoice), Dispatch,
 * Payment.
 *
 * Also covers the fresh-audit finding this phase surfaced beyond the
 * Blueprint's original framing: UniversalDocumentsTab.tsx (the generic
 * 'documents' tab mounted by ~19 modules via WorkspaceShell) never
 * persisted uploads/deletes anywhere — it read/wrote `record.documents[]`/
 * `record.attachments[]` in local React state only. Phase 14 fixed this for
 * the five entity types it owns while leaving every other module's
 * (pre-existing, unchanged) behavior alone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveDocumentsFor, type CaseDocument } from '../caseDocuments';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const caseDocumentsSrc = read('../caseDocuments.ts');
const universalDocumentsTabSrc = read('../../components/shared/UniversalTabs/UniversalDocumentsTab.tsx');
const entityDocumentsPanelSrc = read('../../components/shared/EntityDocumentsPanel.tsx');
const workspaceConfigDirs = [
  '../../features/orders/utils/workspaceConfig.ts',
  '../../features/quotations/utils/workspaceConfig.ts',
  '../../features/invoices/utils/workspaceConfig.ts',
  '../../features/dispatch/utils/workspaceConfig.ts',
  '../../features/payments/utils/workspaceConfig.ts',
];

function makeDoc(overrides: Partial<CaseDocument>): CaseDocument {
  return {
    id: 'DOC-1',
    companyId: 'c1',
    name: 'file.pdf',
    url: 'https://example.test/file.pdf',
    ...overrides,
  } as CaseDocument;
}

describe('resolveDocumentsFor — Phase 14 scope fields (orderId/quotationId/invoiceId/dispatchId/paymentId)', () => {
  it('matches a document that shares ANY of the five new relationship keys with the scope', () => {
    const docs = [
      makeDoc({ id: 'A', orderId: 'ORD-1' }),
      makeDoc({ id: 'B', quotationId: 'QUO-1' }),
      makeDoc({ id: 'C', invoiceId: 'INV-1' }),
      makeDoc({ id: 'D', dispatchId: 'DSP-1' }),
      makeDoc({ id: 'E', paymentId: 'PAY-1' }),
      makeDoc({ id: 'F', orderId: 'OTHER-ORDER' }),
    ];
    const result = resolveDocumentsFor(
      { orderId: 'ORD-1', quotationId: 'QUO-1', invoiceId: 'INV-1', dispatchId: 'DSP-1', paymentId: 'PAY-1' },
      docs,
    );
    expect(result.map((d) => d.id).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('cross-links correctly — a document uploaded against a Payment (carrying both paymentId and its linked invoiceId) is also visible from the Invoice scope', () => {
    const docs = [makeDoc({ id: 'A', paymentId: 'PAY-1', invoiceId: 'INV-1', orderId: 'ORD-1' })];
    expect(resolveDocumentsFor({ invoiceId: 'INV-1' }, docs).map((d) => d.id)).toEqual(['A']);
    expect(resolveDocumentsFor({ orderId: 'ORD-1' }, docs).map((d) => d.id)).toEqual(['A']);
    expect(resolveDocumentsFor({ paymentId: 'PAY-1' }, docs).map((d) => d.id)).toEqual(['A']);
    // A completely unrelated Order must never see it.
    expect(resolveDocumentsFor({ orderId: 'ORD-UNRELATED' }, docs)).toEqual([]);
  });

  it('never returns the same document twice even when it matches several of the five new keys plus a legacy key at once', () => {
    const docs = [makeDoc({ id: 'A', orderId: 'ORD-1', quotationId: 'QUO-1', projectId: 'P1' })];
    const result = resolveDocumentsFor({ orderId: 'ORD-1', quotationId: 'QUO-1', projectId: 'P1' }, docs);
    expect(result).toHaveLength(1);
  });
});

describe('caseDocuments.ts — schema and write-path extended for the five Phase 14 entities, no parallel mechanism', () => {
  it('CaseDocument/CaseDocumentScope declare orderId/quotationId/invoiceId/dispatchId/paymentId', () => {
    for (const field of ['orderId', 'quotationId', 'invoiceId', 'dispatchId', 'paymentId']) {
      expect(caseDocumentsSrc).toContain(`${field}?: string;`);
    }
  });

  it('sourceEntityType widened to include the five new entity kinds', () => {
    expect(caseDocumentsSrc).toContain("'lead' | 'customer' | 'project' | 'order' | 'quotation' | 'invoice' | 'dispatch' | 'payment'");
  });

  it('createCaseDocument persists all five new fields onto the one shared COLLECTIONS.DOCUMENTS write — still ONE createDocWithId call, not five', () => {
    const fnBody = caseDocumentsSrc.slice(caseDocumentsSrc.indexOf('export async function createCaseDocument'), caseDocumentsSrc.indexOf('export async function', caseDocumentsSrc.indexOf('export async function createCaseDocument') + 1));
    for (const field of ['orderId', 'quotationId', 'invoiceId', 'dispatchId', 'paymentId']) {
      expect(fnBody).toContain(`${field}: input.${field} || undefined`);
    }
    expect((fnBody.match(/createDocWithId\(/g) || []).length).toBe(1);
  });
});

describe('EntityDocumentsPanel — the one real, shared-architecture adapter for the five Phase 14 entities', () => {
  it('reuses resolveDocumentsFor/createCaseDocument/deleteCaseDocument — no parallel document system', () => {
    expect(entityDocumentsPanelSrc).toContain("from '../../lib/caseDocuments'");
    expect(entityDocumentsPanelSrc).toContain('resolveDocumentsFor(scope, allCaseDocs)');
    expect(entityDocumentsPanelSrc).toContain('createCaseDocument({');
    expect(entityDocumentsPanelSrc).toContain('deleteCaseDocument(doc.id)');
  });

  it('renders through the same shared DocumentManager UI component Lead/Customer/Project already use', () => {
    expect(entityDocumentsPanelSrc).toContain("import DocumentManager from './DocumentManager'");
  });

  it('maps each of the five entity types to its own real FK field, matching the actual schema (invoiceId, not an invented piId)', () => {
    expect(entityDocumentsPanelSrc).toContain("orders: 'orderId'");
    expect(entityDocumentsPanelSrc).toContain("quotations: 'quotationId'");
    expect(entityDocumentsPanelSrc).toContain("invoices: 'invoiceId'");
    expect(entityDocumentsPanelSrc).toContain("dispatch: 'dispatchId'");
    expect(entityDocumentsPanelSrc).toContain("payments: 'paymentId'");
  });

  it('reads cross-link fields (customerId/projectId/leadId/orderId/quotationId/invoiceId/dispatchId/paymentId) defensively off the record for relationship discoverability', () => {
    for (const field of ['customerId', 'projectId', 'leadId', 'orderId', 'quotationId', 'invoiceId', 'dispatchId', 'paymentId']) {
      expect(entityDocumentsPanelSrc).toContain(`readStringField(record, '${field}')`);
    }
  });
});

describe('UniversalDocumentsTab — fixed for the five Phase 14 entities; legacy (broken, non-persistent) behavior explicitly preserved for every other module still mounting this tab', () => {
  it('branches to the real ScopedDocumentsTab (EntityDocumentsPanel) only for the five Phase 14 entity types', () => {
    expect(universalDocumentsTabSrc).toContain('isScopedDocumentEntityType(props.entityType)');
    expect(universalDocumentsTabSrc).toContain('<ScopedDocumentsTab {...props} />');
    expect(universalDocumentsTabSrc).toContain('<LegacyLocalDocumentsTab {...props} />');
  });

  it('the preserved legacy path still reads from record.documents[]/record.attachments[] — confirms it is untouched, not silently upgraded, for out-of-scope modules', () => {
    const legacyBody = universalDocumentsTabSrc.slice(universalDocumentsTabSrc.indexOf('function LegacyLocalDocumentsTab'));
    expect(legacyBody).toContain('(record as any).documents || (record as any).attachments || []');
  });
});

describe('Orders — the canonical /orders/:id workspace (post-migration) is the single Order detail surface that carries the documents + linked-invoices capability', () => {
  it('mounts the shared workspace with the Documents tab resolved for the real order id', () => {
    const workspaceConfigSrc = read('../../features/orders/utils/workspaceConfig.ts');
    const ordersWorkspaceSrc = read('../../pages/OrdersWorkspace.tsx');
    // The list-page detail modal was retired during the Order Workspace
    // migration: rows navigate to /orders/:id, which owns the Documents tab
    // (UniversalDocumentsTab branches to EntityDocumentsPanel for 'orders').
    expect(workspaceConfigSrc).toContain("id: 'documents'");
    expect(workspaceConfigSrc).toContain("label: 'Documents'");
    expect(ordersWorkspaceSrc).toContain("entityType: 'orders'");
    expect(ordersWorkspaceSrc).toContain('entityId: id ||');
    expect(universalDocumentsTabSrc).toContain('isScopedDocumentEntityType(props.entityType)');
    expect(entityDocumentsPanelSrc).toContain("orders: 'orderId'");
  });

  it('preserves the linked-Proforma-Invoices list on the canonical Order workspace (relabeled "Invoices", not removed)', () => {
    const ordersWorkspaceSrc = read('../../pages/OrdersWorkspace.tsx');
    // The linked-invoices list (previously "Linked Proforma Invoices" in the
    // retired list-page modal) survives on /orders/:id as the real
    // order-scoped invoices list — same data, relabeled, not removed.
    expect(ordersWorkspaceSrc).toContain('const orderInvoices = useMemo');
    expect(ordersWorkspaceSrc).toContain('Invoices ({orderInvoices.length})');
    expect(ordersWorkspaceSrc).toContain('pi.orderId === order.id || pi.sourceOrderId === order.id');
  });
});

describe('All five Phase 14 entity workspaces mount the documents tab that now resolves to the real, persisted implementation', () => {
  it.each(workspaceConfigDirs)('%s declares a documents tab', (path) => {
    const src = read(path);
    expect(src).toContain("id: 'documents'");
  });
});
