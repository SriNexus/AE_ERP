import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, genId, getOne, softDelete, updateDocById } from '../../../lib/firestore';
import { canDo } from '../../../lib/permissions';
import { useAppStore } from '../../../store/useAppStore';
import type { ProjectRecord } from '../../projects/types';
import type { ScheduleSurveyInput, SurveyRecord, SurveyReportInput } from '../types';
import { logActivity, notifyUsers, resolveWorkflowCompanyId, usersByRole } from '../../../lib/workflow';
import { NotificationType } from '../../../types';
import { createEngineeringDraftFromSurvey } from '../../engineering/services/engineeringWorkflow';
import { propagateCaseIdFromChain } from '../../../lib/casePropagation';
import { createCaseDocument } from '../../../lib/caseDocuments';
import { buildProjectStageAdvancePatch } from '../../../lib/projectLifecycle';
// Phase 6: the Survey gate consults the project's Scheme Registration
// (Vendor Lock / scheme_registrations) before a Survey can be scheduled.
import { assertSchemeRegistrationSurveyGate, getSchemeRegistrationForProject } from '../../scheme-registration/services/schemeRegistrationWorkflow';

function requirePermission(action: 'create' | 'edit' | 'delete' | 'approve') {
  if (!canDo(action, 'surveys')) throw new Error(`You do not have permission to ${action} surveys.`);
}

async function requireSurvey(id: string) {
  const survey = await getOne<SurveyRecord>(COLLECTIONS.SURVEYS, id);
  if (!survey) throw new Error('Survey not found or is outside your project access.');
  return survey;
}

async function requireProject(id: string) {
  const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, id);
  if (!project) throw new Error('Project not found or is outside your project access.');
  return project;
}

export function validateScheduleInput(input: ScheduleSurveyInput) {
  if (!input.projectId) throw new Error('Project is required.');
  if (!input.surveyorId) throw new Error('Surveyor assignment is required.');
  if (!input.scheduledDate || Number.isNaN(new Date(input.scheduledDate).getTime())) throw new Error('A valid survey date is required.');
}

export function validateSurveyReport(input: SurveyReportInput) {
  if (!input.roofType.trim()) throw new Error('Roof type is required.');
  if (!Number.isFinite(input.roofAreaSqm) || input.roofAreaSqm <= 0) throw new Error('Roof area must be greater than zero.');
  if (!input.photos.length) throw new Error('At least one site photo is required.');
}

export async function scheduleSurvey(input: ScheduleSurveyInput) {
  requirePermission('create');
  validateScheduleInput(input);
  const project = await requireProject(input.projectId);
  // Phase 6 (Channel Partner — Vendor Lock / Scheme Registration) Survey
  // gate, enforced at the SERVICE boundary (never UI-only): a Survey may
  // only be scheduled once the project's related Scheme Registration is
  // VendorLocked or Completed. Projects with NO registration record (e.g.
  // internal non-partner flows) are unaffected — the gate is vacuous and
  // existing Survey behavior is unchanged.
  // Phase 6 (Channel Partner — Vendor Lock / Scheme Registration) Survey
  // gate, enforced at the SERVICE boundary (never UI-only): a Survey may
  // only be scheduled once the project's related Scheme Registration is
  // VendorLocked or Completed WITH the vendor-lock data contract complete
  // (spec §17 — vendor selected + lock date recorded). Projects with NO
  // registration record (e.g. internal non-partner flows) are unaffected —
  // the gate is vacuous and existing Survey behavior is unchanged.
  const schemeRegistration = await getSchemeRegistrationForProject(project.id);
  assertSchemeRegistrationSurveyGate(project, schemeRegistration);
  const surveyId = genId.generic('SRV');
  const survey = await createDocWithId(COLLECTIONS.SURVEYS, surveyId, {
    surveyId,
    projectId: project.id,
    surveyorId: input.surveyorId,
    assignedSurveyor: input.surveyorId,
    scheduledDate: new Date(input.scheduledDate).toISOString(),
    notes: input.notes?.trim() || '',
    photos: [],
    status: 'Scheduled',
    approvalStatus: 'NotSubmitted',
  });
  // Phase 6: forward-only via the shared projectLifecycle guard (Blueprint
  // Phase 5) — previously this unconditionally set currentStage:'Survey'
  // regardless of how far the project had already progressed, which would
  // silently regress a Project already past Survey (e.g. at Order or later)
  // back to Survey if a second Survey were ever scheduled against it.
  const scheduleUserId = useAppStore.getState().user?.id || 'system';
  await updateDocById(COLLECTIONS.PROJECTS, project.id, {
    assignedSurveyor: input.surveyorId,
    ...buildProjectStageAdvancePatch(project, 'Survey', scheduleUserId, `Survey ${surveyId} scheduled`),
  });
  await logActivity('surveys', 'scheduled', surveyId, { projectId: project.id, surveyorId: input.surveyorId });
  // Phase 3B: Propagate caseId from project to survey
  void propagateCaseIdFromChain('surveys', surveyId);
  return survey as unknown as SurveyRecord;
}

export async function startSurvey(id: string) {
  requirePermission('edit');
  const survey = await requireSurvey(id);
  if (survey.status !== 'Scheduled' && survey.status !== 'Rejected') throw new Error('Only scheduled or rejected surveys can be started.');
  await updateDocById(COLLECTIONS.SURVEYS, id, { status: 'InProgress', rejectionReason: '', approvalStatus: 'NotSubmitted' });
}

export async function submitSurveyReport(id: string, report: SurveyReportInput) {
  requirePermission('edit');
  validateSurveyReport(report);
  const survey = await requireSurvey(id);
  if (!['Scheduled', 'InProgress', 'Rejected'].includes(survey.status)) throw new Error('This survey cannot be submitted in its current status.');
  const userId = useAppStore.getState().user?.id || 'system';
  await updateDocById(COLLECTIONS.SURVEYS, id, {
    ...report,
    completedDate: new Date().toISOString(),
    completedBy: userId,
    status: 'Completed',
    approvalStatus: 'Pending',
    rejectionReason: '',
  });
  // Mirror the captured GPS (and its best-effort reverse-geocoded label, if
  // resolved in time) onto the Project's own siteAddress — the existing
  // lat/lng fields already defined on ProjectSiteAddress (src/types/index.ts)
  // that nothing previously populated, plus surveyedLocationLabel (distinct
  // from the Project's own registered address fields — never overwrites
  // them). Dot-path keys update only these nested fields, leaving the rest
  // of siteAddress untouched. Not a second GPS system — same
  // SurveyLocation capture, just also surfaced where Project Information
  // can read it.
  //
  // This is a supplementary side effect, not the point of submission — the
  // Survey record above has already been durably marked Completed. It must
  // never be allowed to fail the whole submission (e.g. if the caller's
  // role can write 'surveys' but a Firestore rule denies writing
  // 'projects'), which would otherwise leave a genuinely completed Survey
  // looking like a failed submission to the user. Caught and logged, not
  // silently ignored.
  if (report.location) {
    try {
      const gpsPatch: Record<string, unknown> = {
        'siteAddress.latitude': report.location.latitude,
        'siteAddress.longitude': report.location.longitude,
      };
      if (report.location.address) gpsPatch['siteAddress.surveyedLocationLabel'] = report.location.address;
      await updateDocById(COLLECTIONS.PROJECTS, survey.projectId, gpsPatch);
    } catch (err) {
      console.warn('[submitSurveyReport] failed to mirror GPS onto project siteAddress', err);
    }
  }
  // Surface the submitted report's photos in the ONE shared case Documents
  // system (lib/caseDocuments.ts) — the SAME collection Project/Customer/
  // Lead Workspace's Documents sections all read. Each photo becomes ONE
  // record (id = the SurveyPhoto's own id, so a rejected-then-resubmitted
  // survey merges into the same record instead of duplicating it), tagged
  // with every relationship key this Project resolves to — no re-upload,
  // no re-compression (same url/size uploadSurveyPhotos() already
  // produced), and no per-entity copy to keep synchronized. Best-effort,
  // like the GPS mirror above — a Documents write failure must never make
  // an already-successful Survey submission look like it failed.
  if (report.photos.length) {
    try {
      const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, survey.projectId);
      const scope = {
        projectId: survey.projectId,
        customerId: project?.customerId || undefined,
        leadId: project?.leadId || undefined,
        caseId: (project as any)?.caseId || (survey as any)?.caseId || undefined,
      };
      await Promise.all(report.photos.map((photo) => createCaseDocument({
        ...scope,
        id: photo.id,
        name: photo.name,
        url: photo.url,
        mimeType: photo.contentType,
        size: photo.size,
        uploadedAt: photo.capturedAt,
        uploadedBy: userId,
        uploaderName: useAppStore.getState().user?.name,
        label: 'Survey Photo',
        sourceEntityType: 'project',
      })));
    } catch (err) {
      console.warn('[submitSurveyReport] failed to create shared documents for survey photos', err);
    }
  }
  const companyId = resolveWorkflowCompanyId();
  notifyUsers(await usersByRole('Engineer'), NotificationType.TASK_STATUS_CHANGED, 'Survey awaiting approval', `Survey ${survey.surveyId} is ready for review.`, 'survey', id, companyId, survey.projectId);
  await logActivity('surveys', 'submitted', id, { projectId: survey.projectId });
}

export async function approveSurvey(id: string, note = '') {
  requirePermission('approve');
  const survey = await requireSurvey(id);
  const userId = useAppStore.getState().user?.id || 'system';
  if (survey.status !== 'Completed' || !['Pending', 'Approved'].includes(survey.approvalStatus)) throw new Error('Only completed surveys awaiting approval can be approved.');
  const designerId = survey.approvedBy || userId;
  const draft = await createEngineeringDraftFromSurvey(survey, designerId);
  if (survey.approvalStatus === 'Approved' && survey.engineeringDesignId === draft.id) return draft;
  const project = await requireProject(survey.projectId);
  const approvedAt = survey.approvedAt || new Date().toISOString();
  await updateDocById(COLLECTIONS.SURVEYS, id, { approvalStatus: 'Approved', approvedAt, approvedBy: designerId, approvalNote: note.trim() || survey.approvalNote || '', engineeringDesignId: draft.id, engineeringHandoffAt: draft.handoffCreatedAt || approvedAt });
  // Phase 6: same forward-only guard as scheduleSurvey() above — a Project
  // that has already progressed past Engineering must never be regressed.
  await updateDocById(COLLECTIONS.PROJECTS, project.id, buildProjectStageAdvancePatch(project, 'Engineering', userId, `Survey ${survey.surveyId} approved`));
  await logActivity('surveys', 'approved_with_engineering_handoff', id, { projectId: project.id, engineeringDesignId: draft.id, designerId });
  return draft;
}

export async function rejectSurvey(id: string, reason: string) {
  requirePermission('approve');
  if (!reason.trim()) throw new Error('Rejection reason is required.');
  const survey = await requireSurvey(id);
  if (survey.status !== 'Completed' || survey.approvalStatus !== 'Pending') throw new Error('Only surveys awaiting approval can be rejected.');
  await updateDocById(COLLECTIONS.SURVEYS, id, { status: 'Rejected', approvalStatus: 'Rejected', rejectionReason: reason.trim() });
  await logActivity('surveys', 'rejected', id, { projectId: survey.projectId, reason: reason.trim() });
}

export async function archiveSurvey(id: string) {
  requirePermission('delete');
  await requireSurvey(id);
  await softDelete(COLLECTIONS.SURVEYS, id);
}
