/**
 * caseDocuments.test.ts — Shared Documents Architecture mission.
 *
 * Source-text analysis (this codebase's established convention — no
 * @testing-library/react) PLUS real unit tests for the pure functions
 * (resolveDocumentsFor). Covers: the ONE shared COLLECTIONS.DOCUMENTS
 * collection replacing the prior "copy into 3 arrays" mirror, the
 * relationship model (leadId/customerId/projectId/caseId, not caseId
 * alone — a Customer/Project created without a source Lead may have no
 * caseId at all), legacy-array preservation in each workspace's
 * DocumentsSection adapter, and the permissions carve-out that keeps a
 * shared document visible to every teammate, not just its uploader.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveDocumentsFor, type CaseDocument } from '../caseDocuments';
import { applyAccessFilters } from '../firestore';
import { COLLECTIONS } from '../firebase';
import { useAppStore } from '../../store/useAppStore';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const caseDocumentsSrc = read('../caseDocuments.ts');
const firestoreSrc = read('../firestore.ts');
const firebaseSrc = read('../firebase.ts');
const queryKeysSrc = read('../queryKeys.ts');
const projectDocsSection = read('../../features/projects/components/workspace/ProjectWorkspaceDocumentsSection.tsx');
const customerDocsSection = read('../../features/customers/components/workspace/CustomerWorkspaceDocumentsSection.tsx');
const leadDocsSection = read('../../features/leads/components/workspace/LeadWorkspaceDocumentsSection.tsx');
const surveyWorkflow = read('../../features/surveys/services/surveyWorkflow.ts');
const engineeringWorkflow = read('../../features/engineering/services/engineeringWorkflow.ts');

function makeDoc(overrides: Partial<CaseDocument>): CaseDocument {
  return {
    id: 'DOC-1',
    companyId: 'c1',
    name: 'file.pdf',
    url: 'https://example.test/file.pdf',
    ...overrides,
  } as CaseDocument;
}

describe('resolveDocumentsFor — real matching/de-duplication logic (not just source-text)', () => {
  it('matches a document that shares ANY of leadId/customerId/projectId/caseId with the scope', () => {
    const docs = [
      makeDoc({ id: 'A', projectId: 'P1' }),
      makeDoc({ id: 'B', customerId: 'C1' }),
      makeDoc({ id: 'C', leadId: 'L1' }),
      makeDoc({ id: 'D', caseId: 'CASE1' }),
      makeDoc({ id: 'E', projectId: 'OTHER' }),
    ];
    const result = resolveDocumentsFor({ projectId: 'P1', customerId: 'C1', leadId: 'L1', caseId: 'CASE1' }, docs);
    expect(result.map((d) => d.id).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('never returns the same document twice even if it matches multiple keys at once', () => {
    const docs = [makeDoc({ id: 'A', projectId: 'P1', customerId: 'C1', caseId: 'CASE1' })];
    const result = resolveDocumentsFor({ projectId: 'P1', customerId: 'C1', caseId: 'CASE1' }, docs);
    expect(result).toHaveLength(1);
  });

  it('a Customer/Project with no caseId (created directly, no source Lead) still gets correct direct-relationship matches — caseId is not required', () => {
    const docs = [makeDoc({ id: 'A', projectId: 'P1' })];
    const result = resolveDocumentsFor({ projectId: 'P1' }, docs);
    expect(result.map((d) => d.id)).toEqual(['A']);
  });

  it('an empty scope matches nothing (never leaks unrelated documents)', () => {
    const docs = [makeDoc({ id: 'A', projectId: 'P1' })];
    expect(resolveDocumentsFor({}, docs)).toEqual([]);
  });
});

describe('One real collection, not three private arrays — the actual anti-pattern this mission rejects', () => {
  it('COLLECTIONS.DOCUMENTS exists as a real, dedicated collection', () => {
    expect(firebaseSrc).toContain("DOCUMENTS:          'documents',");
  });

  it('createCaseDocument writes ONE record via createDocWithId, never per-entity duplicate writes', () => {
    expect(caseDocumentsSrc).toContain('export async function createCaseDocument');
    expect(caseDocumentsSrc).toContain('createDocWithId(COLLECTIONS.DOCUMENTS, id, payload');
  });

  it('createCaseDocument accepts an explicit id so a source record with its own stable id (e.g. a SurveyPhoto) merges instead of duplicating on retry', () => {
    expect(caseDocumentsSrc).toContain('const id = input.id || genId.generic(\'DOC\')');
  });

  it('deleteCaseDocument soft-deletes via the same softDelete() primitive every other archivable entity already uses', () => {
    expect(caseDocumentsSrc).toContain("await softDelete(COLLECTIONS.DOCUMENTS, id)");
  });

  it('queryKeys has a dedicated company-scoped key for the shared collection', () => {
    expect(queryKeysSrc).toContain("caseDocumentsRoot: ['documents', c] as const");
    expect(queryKeysSrc).toContain("caseDocumentsAll:  ['documents', c, 'all'] as const");
  });
});

describe('Permissions — a shared document has no per-uploader owner; visibility is inherited from the parent entity, not re-gated per document', () => {
  // GAP-04 remediation (independent Vendor Lock audit, 2026-08-14/16): this
  // test was a brittle source-text-position assertion comparing the
  // character offset of `if (col === COLLECTIONS.DOCUMENTS) return true;`
  // against a literal string, `const ownerId = docData.assignedToId ||
  // docData.createdBy;`, that no longer exists verbatim — the ownership
  // candidate check was correctly evolved (Phase 3 ownership propagation) to
  // `const candidateIds = [docData.assignedToId, docData.createdBy,
  // docData.partnerId]` so partner-owned records stay visible to their
  // partner. The implementation is correct; only the test's assumption about
  // exact source text was stale. Replaced with a real behavioral proof of
  // the promised contract — a document with NO ownership/team/partner
  // relationship to the viewer must still be visible — which fails if the
  // carve-out (or the equivalent DOCUMENTS-is-ownership-exempt visibility
  // resolution) regresses, and is agnostic to internal refactors.
  beforeEach(() => {
    useAppStore.setState({
      user: { id: 'me', name: 'Current User', email: 'me@test.erp', role: 'Sales', companyId: 'COMP-1' } as any,
      roleData: { name: 'Sales', schemaVersion: 1, permissions: {} } as any,
      teamMemberIds: [],
      activeCompanyId: 'COMP-1',
    });
  });

  it('applyAccessFilters never hides a shared document based on uploader/assignee/partner ownership (a teammate\'s upload stays visible)', () => {
    const teammatesDoc = {
      id: 'DOC-1',
      companyId: 'COMP-1',
      assignedToId: 'someone-else',
      createdBy: 'someone-else',
      partnerId: 'PART-OTHER',
      isDeleted: false,
    };
    const visible = applyAccessFilters(COLLECTIONS.DOCUMENTS, [teammatesDoc], null);
    expect(visible.map((d) => d.id)).toContain('DOC-1');
  });

  it('the same non-owned record WOULD be hidden under the generic self/team ownership filter for an ordinary (non-exempt) collection — proving the carve-out is load-bearing, not accidental', () => {
    const notMine = {
      id: 'LEAD-1',
      companyId: 'COMP-1',
      assignedToId: 'someone-else',
      createdBy: 'someone-else',
      partnerId: 'PART-OTHER',
      isDeleted: false,
    };
    const visible = applyAccessFilters(COLLECTIONS.LEADS, [notMine], null);
    expect(visible.map((d) => d.id)).not.toContain('LEAD-1');
  });

  it('COLLECTIONS.DOCUMENTS is present in the ownership-exempt set backing the carve-out (structural sanity check, not a position assertion)', () => {
    expect(firestoreSrc).toContain('COLLECTIONS.DOCUMENTS');
    expect(firestoreSrc).toMatch(/OWNERSHIP_EXEMPT_COLLECTIONS\s*=\s*new Set<string>\(\[[^\]]*COLLECTIONS\.DOCUMENTS[^\]]*\]\)/);
  });
});

describe('Each of Lead/Customer/Project Workspace\'s DocumentsSection now reads/writes the ONE shared collection, merged with (never destructively replacing) its own legacy array', () => {
  it('Project: scoped by projectId + customerId + leadId + caseId; legacy project.documents is merged in, never deleted', () => {
    expect(projectDocsSection).toContain("import { useCaseDocuments, useInvalidateCaseDocuments, resolveDocumentsFor, createCaseDocument, deleteCaseDocument");
    expect(projectDocsSection).toContain('projectId: project?.id');
    expect(projectDocsSection).toContain("customerId: project?.customerId || undefined");
    expect(projectDocsSection).toContain('function normalizeProjectDocuments(project: ProjectRecord)');
    expect(projectDocsSection).not.toContain('await updateDocById(COLLECTIONS.PROJECTS, project.id, { documents: next })');
  });

  it('Customer: scoped by customerId + sourceLeadId + caseId; legacy slot-flattening behavior is preserved for legacy-only deletes', () => {
    expect(customerDocsSection).toContain('customerId: customer?.id');
    expect(customerDocsSection).toContain("leadId: customer?.sourceLeadId || undefined");
    expect(customerDocsSection).toContain('LEGACY_SLOTS.forEach((slot) => {');
  });

  it('Lead: scoped by leadId + convertedCustomerId + caseId; legacy slot-flattening behavior is preserved for legacy-only deletes', () => {
    expect(leadDocsSection).toContain('leadId: lead?.id');
    expect(leadDocsSection).toContain("customerId: lead?.convertedCustomerId || undefined");
    expect(leadDocsSection).toContain('LEGACY_SLOTS.forEach((slot) => {');
  });

  it('all three adapters diff added/removed entries against the merged list, routing new uploads to the shared collection and legacy-only deletes back to the entity\'s own array', () => {
    for (const section of [projectDocsSection, customerDocsSection, leadDocsSection]) {
      expect(section).toContain('const added = next.filter((d) => !prevIds.has(d.id));');
      expect(section).toContain('createCaseDocument({');
    }
  });
});

describe('Survey and Engineering documents both flow into the ONE shared system — no second document system for either', () => {
  it('submitSurveyReport creates shared documents (not per-entity array mirrors) for submitted photos', () => {
    expect(surveyWorkflow).toContain("import { createCaseDocument } from '../../../lib/caseDocuments'");
    expect(surveyWorkflow).toContain('createCaseDocument({');
    expect(surveyWorkflow).not.toContain('mergeNewDocuments');
  });

  it('createDesign/updateDesign mirror drawings into the same shared system via mirrorEngineeringDocuments()', () => {
    expect(engineeringWorkflow).toContain("import { createCaseDocument } from '../../../lib/caseDocuments'");
    expect(engineeringWorkflow).toContain('async function mirrorEngineeringDocuments(');
    expect(engineeringWorkflow).toContain('void mirrorEngineeringDocuments(project, { id: designId, surveyId: survey.id }, documents);');
    expect(engineeringWorkflow).toContain('if (project) void mirrorEngineeringDocuments(project, design, input.documents);');
  });

  it('both mirrors are non-fatal (try/catch) — a shared-Documents write failure must never make an already-successful Survey/Engineering save look failed', () => {
    expect(surveyWorkflow).toContain("console.warn('[submitSurveyReport] failed to create shared documents for survey photos'");
    expect(engineeringWorkflow).toContain("console.warn('[engineeringWorkflow] failed to create shared documents for design drawings'");
  });
});
