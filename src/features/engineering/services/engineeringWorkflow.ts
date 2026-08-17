import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, genId, getAll, getOne, softDelete, updateDocById } from '../../../lib/firestore';
import { canDo } from '../../../lib/permissions';
import { useAppStore } from '../../../store/useAppStore';
import { NotificationType } from '../../../types';
import { logActivity, notifyUsers, resolveWorkflowCompanyId, usersByRole } from '../../../lib/workflow';
import { propagateCaseIdFromChain } from '../../../lib/casePropagation';
import { createCaseDocument } from '../../../lib/caseDocuments';
import { buildProjectStageAdvancePatch } from '../../../lib/projectLifecycle';
import type { ProjectRecord } from '../../projects/types';
import type { SurveyRecord } from '../../surveys/types';
import type { DesignInput, DesignUpdateInput, EngineeringDesignRecord, EngineeringDocument, EngineeringSurveySnapshot } from '../types';

/** Surfaces this design's drawings in the ONE shared case Documents system
 * (lib/caseDocuments.ts) — the SAME collection Project/Customer/Lead
 * Workspace's Documents sections read, and the same pattern
 * submitSurveyReport() already uses for Survey photos. Each drawing
 * becomes ONE record (id = the EngineeringDocument's own id, so re-saving
 * an unchanged drawing merges into the same record rather than
 * duplicating it) — no re-upload, no re-compression, no second document
 * system. Best-effort: a Documents write failure must never make an
 * already-successful design save look like it failed. */
async function mirrorEngineeringDocuments(project: ProjectRecord, design: { id: string; surveyId: string }, documents: EngineeringDocument[]) {
  if (!documents.length) return;
  try {
    const scope = {
      projectId: project.id,
      customerId: project.customerId || undefined,
      leadId: project.leadId || undefined,
      caseId: (project as any)?.caseId || undefined,
    };
    await Promise.all(documents.map((doc) => createCaseDocument({
      ...scope,
      id: doc.id,
      name: doc.name,
      url: doc.url,
      mimeType: doc.contentType,
      size: doc.size,
      uploadedAt: doc.uploadedAt,
      label: doc.category === 'single-line-diagram' ? 'Single-Line Diagram' : 'Structural Drawing',
      sourceEntityType: 'project',
    })));
  } catch (err) {
    console.warn('[engineeringWorkflow] failed to create shared documents for design drawings', err);
  }
}

function requirePermission(action: 'create' | 'edit' | 'delete' | 'approve') {
  if (!canDo(action, 'engineering')) throw new Error(`You do not have permission to ${action} engineering designs.`);
}

async function requireDesign(id: string) {
  const design = await getOne<EngineeringDesignRecord>(COLLECTIONS.ENGINEERING_DESIGNS, id);
  if (!design) throw new Error('Engineering design not found or outside your project access.');
  return design;
}

export function validateDesignInput(input: DesignInput | DesignUpdateInput) {
  if ('surveyId' in input && !input.surveyId) throw new Error('An approved survey is required.');
  if (!input.designerId) throw new Error('Designer assignment is required.');
  if (!Number.isInteger(input.panelCount) || input.panelCount <= 0) throw new Error('Panel count must be a positive whole number.');
  if (!Number.isFinite(input.panelWattage) || input.panelWattage <= 0) throw new Error('Panel wattage must be greater than zero.');
  if (!input.inverterSpec.trim()) throw new Error('Inverter specification is required.');
  if (!Number.isFinite(input.systemCapacityKw) || input.systemCapacityKw <= 0) throw new Error('System capacity must be greater than zero.');
  if (!input.documents.some((document) => document.category === 'single-line-diagram')) throw new Error('Single-line diagram is required.');
}

export function buildSurveySnapshot(survey: SurveyRecord): EngineeringSurveySnapshot {
  return {
    roofType: survey.roofType || '',
    roofAreaSqm: Number(survey.roofAreaSqm || 0),
    shadingNotes: survey.shadingNotes || '',
    structuralNotes: survey.structuralNotes || '',
    photos: [...(survey.photos || [])],
    capturedAt: survey.completedDate || new Date().toISOString(),
  };
}

export function buildEngineeringDraftPayload(
  survey: SurveyRecord,
  project: ProjectRecord,
  designerId: string,
  designId: string,
) {
  const handoffAt = new Date().toISOString();
  return {
    designId,
    projectId: project.id,
    surveyId: survey.id,
    designerId,
    panelCount: 0,
    panelWattage: 0,
    inverterSpec: '',
    systemCapacityKw: 0,
    singleLineDiagramUrl: '',
    structuralDrawingUrl: '',
    documents: [],
    status: 'Draft' as const,
    revisionNumber: 1,
    revisionHistory: [],
    surveySnapshot: buildSurveySnapshot(survey),
    handoffCreatedAt: handoffAt,
    handoffCreatedBy: designerId,
    assignedSurveyor: project.assignedSurveyor || survey.surveyorId || '',
    assignedInstaller: project.assignedInstaller || '',
    salesOwner: project.salesOwner || '',
  };
}

/** Idempotently creates the P05-03 Engineering draft for an approved Survey handoff. */
export async function createEngineeringDraftFromSurvey(survey: SurveyRecord, designerId: string) {
  requirePermission('create');
  if (survey.status !== 'Completed' || !['Pending', 'Approved'].includes(survey.approvalStatus)) {
    throw new Error('Only a completed survey being approved can create an engineering draft.');
  }
  if (!designerId) throw new Error('An approving Engineer is required for the handoff.');
  const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, survey.projectId);
  if (!project) throw new Error('Linked project not found or outside your access.');
  const visibleDesigns = await getAll<EngineeringDesignRecord>(COLLECTIONS.ENGINEERING_DESIGNS);
  const existing = visibleDesigns.find((design) => design.surveyId === survey.id);
  if (existing) return existing;
  const designId = genId.generic('ENG');
  const design = await createDocWithId(
    COLLECTIONS.ENGINEERING_DESIGNS,
    designId,
    buildEngineeringDraftPayload(survey, project, designerId, designId),
  ) as unknown as EngineeringDesignRecord;
  notifyUsers([{ id: designerId }], NotificationType.TASK_ASSIGNED, 'Engineering draft assigned', `Survey ${survey.surveyId} was approved and design ${designId} is ready.`, 'engineering_design', designId, resolveWorkflowCompanyId(), project.id);
  await logActivity('engineering', 'draft_created_from_survey', designId, { projectId: project.id, surveyId: survey.id, designerId });
  // Phase 3B: Propagate caseId from project to engineering design
  void propagateCaseIdFromChain('engineering_designs', designId);
  return design;
}

export async function createDesign(input: DesignInput) {
  requirePermission('create');
  validateDesignInput(input);
  const survey = await getOne<SurveyRecord>(COLLECTIONS.SURVEYS, input.surveyId);
  if (!survey || survey.approvalStatus !== 'Approved') throw new Error('Designs can only originate from an approved survey.');
  const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, survey.projectId);
  if (!project) throw new Error('Linked project not found or outside your access.');
  const visibleDesigns = await getAll<EngineeringDesignRecord>(COLLECTIONS.ENGINEERING_DESIGNS);
  if (visibleDesigns.some((design) => design.surveyId === survey.id)) throw new Error('An engineering design already exists for this survey.');
  const designId = genId.generic('ENG');
  const documents = input.documents;
  const design = await createDocWithId(COLLECTIONS.ENGINEERING_DESIGNS, designId, {
    designId,
    projectId: project.id,
    surveyId: survey.id,
    designerId: input.designerId,
    panelCount: input.panelCount,
    panelWattage: input.panelWattage,
    inverterSpec: input.inverterSpec.trim(),
    systemCapacityKw: input.systemCapacityKw,
    singleLineDiagramUrl: documents.find((document) => document.category === 'single-line-diagram')?.url || '',
    structuralDrawingUrl: documents.find((document) => document.category === 'structural-drawing')?.url || '',
    documents,
    status: 'Draft',
    revisionNumber: 1,
    revisionHistory: [],
    surveySnapshot: buildSurveySnapshot(survey),
    assignedSurveyor: project.assignedSurveyor || '',
    assignedInstaller: project.assignedInstaller || '',
    salesOwner: project.salesOwner || '',
  });
  await logActivity('engineering', 'created', designId, { projectId: project.id, surveyId: survey.id, designerId: input.designerId });
  // Phase 3B: Propagate caseId from project to engineering design
  void propagateCaseIdFromChain('engineering_designs', designId);
  void mirrorEngineeringDocuments(project, { id: designId, surveyId: survey.id }, documents);
  return design as unknown as EngineeringDesignRecord;
}

export async function updateDesign(id: string, input: DesignUpdateInput) {
  requirePermission('edit');
  validateDesignInput(input);
  const design = await requireDesign(id);
  if (!['Draft', 'Revised'].includes(design.status)) throw new Error('Only draft or revised designs can be edited.');
  await updateDocById(COLLECTIONS.ENGINEERING_DESIGNS, id, {
    ...input,
    inverterSpec: input.inverterSpec.trim(),
    singleLineDiagramUrl: input.documents.find((document) => document.category === 'single-line-diagram')?.url || '',
    structuralDrawingUrl: input.documents.find((document) => document.category === 'structural-drawing')?.url || '',
  });
  await logActivity('engineering', 'updated', id, { projectId: design.projectId });
  const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, design.projectId);
  if (project) void mirrorEngineeringDocuments(project, design, input.documents);
}

export async function submitForReview(id: string) {
  requirePermission('edit');
  const design = await requireDesign(id);
  if (!['Draft', 'Revised'].includes(design.status)) throw new Error('Only draft or revised designs can be submitted.');
  await updateDocById(COLLECTIONS.ENGINEERING_DESIGNS, id, { status: 'InReview', submittedAt: new Date().toISOString(), revisionReason: '' });
  notifyUsers(await usersByRole('Engineer'), NotificationType.TASK_STATUS_CHANGED, 'Design awaiting approval', `Design ${design.designId} is ready for review.`, 'engineering_design', id, resolveWorkflowCompanyId(), design.projectId);
  await logActivity('engineering', 'submitted_for_review', id, { projectId: design.projectId });
}

export async function approveDesign(id: string, note = '') {
  requirePermission('approve');
  const design = await requireDesign(id);
  if (design.status !== 'InReview') throw new Error('Only designs in review can be approved.');
  const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, design.projectId);
  if (!project) throw new Error('Linked project not found or outside your access.');
  const userId = useAppStore.getState().user?.id || 'system';
  await updateDocById(COLLECTIONS.ENGINEERING_DESIGNS, id, { status: 'Approved', approvedAt: new Date().toISOString(), approvedBy: userId, approvalNote: note.trim() });
  // Phase 7: forward-only via the shared projectLifecycle guard (Blueprint
  // Phase 5) — previously this unconditionally set currentStage:'Quotation'
  // and unconditionally appended a new stageHistory entry regardless of how
  // far the project had already progressed, which would silently regress a
  // Project already past Quotation (e.g. at Order or later) back to
  // Quotation if a design were ever (re-)approved against it — the same bug
  // category found and fixed in surveyWorkflow.ts during Phase 6.
  await updateDocById(COLLECTIONS.PROJECTS, project.id, buildProjectStageAdvancePatch(project, 'Quotation', userId, `Engineering design ${design.designId} approved`));
  notifyUsers(await usersByRole('Sales'), NotificationType.TASK_STATUS_CHANGED, 'Design approved', `Design ${design.designId} is ready to reference in a quotation.`, 'engineering_design', id, resolveWorkflowCompanyId(), design.projectId);
  await logActivity('engineering', 'approved', id, { projectId: project.id });
}

export async function requestDesignRevision(id: string, reason: string) {
  requirePermission('approve');
  if (!reason.trim()) throw new Error('Revision reason is required.');
  const design = await requireDesign(id);
  if (design.status !== 'InReview') throw new Error('Only designs in review can be revised.');
  const userId = useAppStore.getState().user?.id || 'system';
  const retained = { revisionNumber: design.revisionNumber, panelCount: design.panelCount, panelWattage: design.panelWattage, inverterSpec: design.inverterSpec, systemCapacityKw: design.systemCapacityKw, singleLineDiagramUrl: design.singleLineDiagramUrl, structuralDrawingUrl: design.structuralDrawingUrl, retainedAt: new Date().toISOString(), retainedBy: userId, reason: reason.trim() };
  await updateDocById(COLLECTIONS.ENGINEERING_DESIGNS, id, { status: 'Revised', revisionNumber: design.revisionNumber + 1, revisionReason: reason.trim(), revisionHistory: [...(design.revisionHistory || []), retained] });
  await logActivity('engineering', 'revision_requested', id, { projectId: design.projectId, reason: reason.trim() });
}

export async function archiveDesign(id: string) {
  requirePermission('delete');
  const design = await requireDesign(id);
  if (design.status === 'Approved') throw new Error('Approved designs must be retained as the project source of truth.');
  await softDelete(COLLECTIONS.ENGINEERING_DESIGNS, id);
}
