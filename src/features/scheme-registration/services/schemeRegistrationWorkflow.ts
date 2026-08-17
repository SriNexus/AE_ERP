/**
 * schemeRegistrationWorkflow — Vendor Lock / Scheme Registration (Channel
 * Partner) canonical workflow service.
 *
 * Follows the existing Neozy workflow conventions (surveyWorkflow /
 * subsidyWorkflow / netMeteringWorkflow): permission-gated, ownership-safe,
 * with statusHistory, actor/timestamp capture, audit activity, caseId
 * propagation and the existing notification infrastructure.
 *
 * Collection: COLLECTIONS.SCHEME_REGISTRATIONS ('scheme_registrations').
 * NEVER the Loan Application 'registrations' collection.
 *
 * Status machine (authoritative — types.ts, spec §13, 8 statuses):
 *   Draft → Submitted → UnderVerification → VendorLocked → Completed
 *   Rejected → Submitted (resubmit); Failed → Draft/Submitted (retry);
 *   any pre-Completed → Cancelled (partner only before submission); lock
 *   also legal directly from Submitted; Admin-only audited reopen of
 *   Completed/VendorLocked → Submitted. Every transition validates the
 *   current state, rejects invalid transitions, appends statusHistory,
 *   records the actor/timestamp, and respects ownership/RBAC.
 *
 * Manual portal operation (§10/§11 LOCKED default): there is NO external
 * portal API. An authorized operator records the portal outcome in Neozy
 * (applicationNumber / portalReference / registrationDate). The service is
 * the single integration seam if automation is ever approved.
 *
 * Ownership (§9.3): partnerId/partnerName/userId/managerId are DERIVED from
 * the Project's canonical ownership chain inside this service — a partner
 * can only create a registration for a project they own, and can only act
 * on registrations carrying their own partnerId. Staff actions
 * (verification, approve/lock, complete, reject, fail) require the
 * 'approve' permission and are never available to a partner actor at the
 * service boundary.
 *
 * Survey gate (§17): scheduleSurvey (surveys service) consults
 * getSchemeRegistrationForProject + isSurveyGateSatisfied — a Survey may be
 * scheduled only when the related Registration is VendorLocked or Completed
 * with the vendor-lock data contract complete.
 */
import { COLLECTIONS } from '../../../lib/firebase';
import {
  createDocWithId, genId, getAll, getOne, updateDocById,
} from '../../../lib/firestore';
import { canDo } from '../../../lib/permissions';
import { useAppStore } from '../../../store/useAppStore';
import { resolveCurrentPartnerDocId } from '../../../lib/partnerOwnership';
import { propagateCaseIdFromChain } from '../../../lib/casePropagation';
import { buildProjectStageAdvancePatch, projectStageIndex } from '../../../lib/projectLifecycle';
import { logActivity, resolveWorkflowCompanyId } from '../../../lib/workflow';
import { notifyPartnerTeam } from '../../../lib/partnerNotifications';
import { logEntityChange } from '../../../lib/auditLogger';
import { NotificationType } from '../../../types';
import type { ProjectRecord } from '../../projects/types';
import {
  allRequiredDocumentsLinked,
  isValidSchemeRegistrationTransition,
  isPartnerSideTransition,
  isSurveyGateSatisfied,
  PARTNER_SIDE_TRANSITIONS,
  SCHEME_REGISTRATION_REQUIRED_DOCUMENTS,
  STAFF_APPROVE_TRANSITIONS,
  type SchemeRegistrationCreateInput,
  type SchemeRegistrationRecord,
  type SchemeRegistrationStatus,
  type SchemeRegistrationTransitionOptions,
} from '../types';

function requirePermission(action: 'create' | 'edit' | 'approve') {
  if (!canDo(action, 'scheme_registration')) {
    throw new Error(`You do not have permission to ${action} scheme registrations.`);
  }
}

async function requireRegistration(id: string): Promise<SchemeRegistrationRecord> {
  const record = await getOne<SchemeRegistrationRecord>(COLLECTIONS.SCHEME_REGISTRATIONS, id);
  if (!record) throw new Error('Scheme registration not found or is outside your access.');
  return record;
}

async function requireProject(id: string): Promise<ProjectRecord> {
  const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, id);
  if (!project) throw new Error('Project not found or is outside your access.');
  return project;
}

const TRANSITION_LOG_VERBS: Record<SchemeRegistrationStatus, string> = {
  Draft: 'created',
  Submitted: 'submitted',
  UnderVerification: 'verification_started',
  VendorLocked: 'vendor_locked',
  Completed: 'completed',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
  Failed: 'failed',
};

const PARTNER_NOTIFICATION_TITLES: Record<SchemeRegistrationStatus, string> = {
  Draft: 'Registration draft created',
  Submitted: 'Registration submitted',
  UnderVerification: 'Registration under verification',
  VendorLocked: 'Registration vendor locked',
  Completed: 'Registration completed',
  Rejected: 'Registration rejected',
  Cancelled: 'Registration cancelled',
  Failed: 'Registration verification failed',
};

/**
 * Creates a Scheme Registration (Vendor Lock) record in Draft state.
 *
 * Ownership is stamped from the Project's canonical chain:
 *   - partner actor: project.partnerId MUST equal the authenticated partner's
 *     doc id, otherwise rejected (§9.3 — no spoofing partnerId from the form).
 *   - staff actor: partnerId/partnerName inherited from the project record.
 * userId (the partner's linked user) and managerId (the partner's TL/Manager)
 * are resolved from the channel_partners document. A new Case is NOT created
 * here — the registration joins the Project's existing case via caseId
 * propagation. One project has ONE active registration (§16) — a second
 * record is rejected while a non-voided one exists.
 */
export async function createSchemeRegistration(
  input: SchemeRegistrationCreateInput,
): Promise<SchemeRegistrationRecord> {
  if (!input.projectId?.trim()) throw new Error('Project is required.');
  if (input.applicantPhone && !/^\d{10}$/.test(input.applicantPhone.trim())) {
    throw new Error('A valid 10-digit mobile number is required.');
  }
  requirePermission('create');

  const project = await requireProject(input.projectId.trim());
  // Lifecycle guard: the Vendor Lock / Scheme Registration window is exactly
  // New → SchemeRegistration (before Survey). A project already past that
  // window (or Archived) has no registration step ahead of it — creating one
  // would contradict the canonical lifecycle and would wrongly gate-block
  // its already-schedulable Survey.
  if (projectStageIndex(project.currentStage) > projectStageIndex('SchemeRegistration')) {
    throw new Error('A scheme registration can only be created while the project is in the New or Registration stage.');
  }

  // One active registration per project (§16). Terminal/voided (Cancelled)
  // records release the slot so a fresh draft can be filed.
  const existing = await getAll<SchemeRegistrationRecord>(COLLECTIONS.SCHEME_REGISTRATIONS);
  const active = existing.find((r) => r.projectId === project.id && !r.isDeleted && r.status !== 'Cancelled');
  if (active) {
    throw new Error(`A scheme registration already exists for this project (${active.registrationId}).`);
  }

  const actor = useAppStore.getState().user;
  const actorId = actor?.id || 'system';
  const now = new Date().toISOString();

  // ── Canonical ownership (§9.3) — never trust the client payload ──
  const authenticatedPartnerId = await resolveCurrentPartnerDocId();
  if (authenticatedPartnerId) {
    if (String(project.partnerId ?? '') !== authenticatedPartnerId) {
      throw new Error('You can only create a registration for a project you own.');
    }
  }
  const partnerId = authenticatedPartnerId ?? project.partnerId ?? undefined;
  const partnerName = project.partnerName ?? undefined;

  // Partner's linked user + TL/Manager — resolved from the canonical
  // channel_partners document (never from client input) so staff transitions
  // can notify them and team visibility can resolve.
  let linkedUserId: string | undefined;
  let managerId: string | undefined;
  if (partnerId) {
    const partner = await getOne<{ userId?: string; managerId?: string }>(COLLECTIONS.CHANNEL_PARTNERS, partnerId);
    linkedUserId = partner?.userId ?? undefined;
    managerId = partner?.managerId ?? undefined;
  }

  const registrationId = genId.schemeRegistration();
  const record: SchemeRegistrationRecord = {
    id: registrationId,
    registrationId,
    projectId: project.id,
    customerId: project.customerId ?? undefined,
    customerName: (project as any).customerName ?? undefined,
    customerPhone: (project as any).customerPhone ?? undefined,
    leadId: project.leadId ?? undefined,
    caseId: (project as any).caseId ?? undefined,
    companyId: resolveWorkflowCompanyId(),
    partnerId,
    partnerName,
    managerId,
    userId: linkedUserId,
    vendorId: input.vendorId ?? undefined,
    vendorName: input.vendorName?.trim() || undefined,
    schemeName: input.schemeName?.trim() || undefined,
    portalType: input.portalType ?? undefined,
    discom: input.discom?.trim() || undefined,
    applicationNumber: input.applicationNumber?.trim() || undefined,
    portalReference: input.portalReference?.trim() || undefined,
    registrationDate: input.registrationDate?.trim() || undefined,
    applicantName: input.applicantName?.trim() || undefined,
    applicantPhone: input.applicantPhone?.trim() || undefined,
    applicantEmail: input.applicantEmail?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    // Who performed the portal operation (§12) — the actor filing the
    // registration (partner or staff).
    responsibleUserId: actorId,
    responsibleUserName: actor?.name,
    requiredDocuments: SCHEME_REGISTRATION_REQUIRED_DOCUMENTS.map((d) => ({ ...d })),
    documents: [],
    status: 'Draft',
    statusHistory: [{ status: 'Draft', changedAt: now, changedBy: actorId, changedByName: actor?.name, note: 'Registration created' }],
    createdAt: now,
    createdBy: actorId,
    createdByName: actor?.name,
    updatedAt: now,
    updatedBy: actorId,
  };

  await createDocWithId(COLLECTIONS.SCHEME_REGISTRATIONS, registrationId, record);
  // Join the Project's existing Case (parent = project via projectId).
  void propagateCaseIdFromChain('scheme_registrations', registrationId);
  await logActivity('scheme_registration', 'created', registrationId, {
    projectId: project.id, partnerId, actorId,
  });
  // Structured audit (§25) — canonical company/actor identity comes from the
  // store; partner/project/case context from the derived record chain.
  await logEntityChange(
    'scheme_registration', registrationId, 'scheme_registration',
    {}, { status: 'Draft', projectId: project.id },
    `Scheme registration ${registrationId} created`,
    { projectId: project.id, caseId: record.caseId, partnerId, actorId, actorRole: actor?.role },
  );
  // §18: notify the partner's TL/Manager that a registration draft exists on
  // their team (the partner is the actor and is never self-notified).
  try {
    await notifyPartnerTeam({
      partnerUserId: linkedUserId,
      managerUserId: managerId,
      actorUserId: actorId,
      type: NotificationType.PARTNER_MILESTONE,
      title: 'Registration draft created',
      body: `Registration ${registrationId} was created for project ${project.projectId ?? project.id}.`,
      entityType: 'scheme_registration', entityId: registrationId,
      companyId: record.companyId, projectId: project.id,
    });
  } catch (err) {
    console.warn('[schemeRegistrationWorkflow] notification failed', err);
  }
  return record;
}

/**
 * Applies a legal status transition (see SCHEME_REGISTRATION_TRANSITIONS).
 *
 * - Rejects invalid transitions.
 * - Enforces the permission boundary: staff-approval targets
 *   (UnderVerification/VendorLocked/Completed/Rejected/Failed) require the
 *   'approve' action; partner-side targets (Submitted/Cancelled/Draft)
 *   require 'edit'.
 * - Enforces §9.3: a partner actor must own the record and can only perform
 *   partner-side transitions (isPartnerSideTransition) — staff actions are
 *   never available to them at the service boundary.
 * - Appends statusHistory with the actor's user id/name and timestamps.
 * - Submit precondition (§13): an applicationNumber OR portalReference must
 *   be recorded and every required document linked (manual portal workflow).
 * - Vendor Lock is irreversible: VendorLocked requires a vendor selection +
 *   vendorLockDate; the machine exposes NO unlock transition.
 * - Completed requires every required document linked (§15).
 * - Advancing the Project New → SchemeRegistration happens on submit via the
 *   canonical forward-only buildProjectStageAdvancePatch (idempotent).
 * - Notifies approvers on submission; notifies the owning partner on every
 *   staff outcome, using the existing notification infrastructure.
 */
export async function transitionSchemeRegistrationStatus(
  id: string,
  newStatus: SchemeRegistrationStatus,
  options: SchemeRegistrationTransitionOptions = {},
): Promise<SchemeRegistrationRecord> {
  const record = await requireRegistration(id);

  if (!isValidSchemeRegistrationTransition(record.status, newStatus)) {
    throw new Error(`Cannot move a scheme registration from ${record.status} to ${newStatus}.`);
  }

  if (STAFF_APPROVE_TRANSITIONS.has(newStatus)) {
    requirePermission('approve');
  } else {
    requirePermission('edit');
  }

  // §9.3 — partner actors may only act on their own record AND only via
  // partner-side transitions; staff actions require approval rights.
  const authenticatedPartnerId = await resolveCurrentPartnerDocId();
  if (authenticatedPartnerId) {
    if (String(record.partnerId ?? '') !== authenticatedPartnerId) {
      throw new Error('You can only manage your own scheme registrations.');
    }
    if (!isPartnerSideTransition(record.status, newStatus)) {
      throw new Error('This action requires staff approval rights.');
    }
  }

  const actor = useAppStore.getState().user;
  const actorId = actor?.id || 'system';
  const now = new Date().toISOString();

  const patch: Record<string, unknown> = {
    status: newStatus,
    statusHistory: [
      ...(record.statusHistory || []),
      {
        status: newStatus,
        changedAt: now,
        changedBy: actorId,
        changedByName: actor?.name,
        note: options.note?.trim() || undefined,
      },
    ],
    updatedAt: now,
    updatedBy: actorId,
  };

  switch (newStatus) {
    case 'Submitted': {
      // Manual portal workflow (§11): the submit action records the portal
      // application/reference — one of them is required before submission.
      const applicationNumber = options.applicationNumber?.trim() || record.applicationNumber;
      const portalReference = options.portalReference?.trim() || record.portalReference;
      if (!applicationNumber && !portalReference) {
        throw new Error('Application number or portal reference is required before submitting.');
      }
      if (!allRequiredDocumentsLinked(record.requiredDocuments)) {
        throw new Error('All required documents must be attached before submitting.');
      }
      patch.submittedAt = now;
      patch.submittedBy = actorId;
      if (applicationNumber) patch.applicationNumber = applicationNumber;
      if (portalReference) patch.portalReference = portalReference;
      if (record.status === 'Rejected') patch.rejectionReason = '';   // resubmit clears
      if (record.status === 'Failed') patch.failureReason = '';        // retry-to-submit clears
      break;
    }
    case 'Draft': // retry from Failed → a fresh draft
      patch.retriedAt = now;
      patch.failureReason = '';
      break;
    case 'UnderVerification':
      patch.verificationStartedAt = now;
      patch.verificationStartedBy = actorId;
      break;
    case 'VendorLocked': {
      // Vendor Lock is irreversible — require the locked vendor data +
      // the business lock date (§13/§17 data contract).
      const vendorName = options.vendorName?.trim() || record.vendorName;
      const vendorId = options.vendorId?.trim() || record.vendorId;
      if (!vendorName && !vendorId) {
        throw new Error('Select a vendor before locking the registration.');
      }
      if (vendorName) patch.vendorName = vendorName;
      if (vendorId) patch.vendorId = vendorId;
      patch.vendorLockDate = options.vendorLockDate?.trim() || now;
      patch.vendorLockedAt = now;
      patch.vendorLockedBy = actorId;
      break;
    }
    case 'Completed':
      if (!allRequiredDocumentsLinked(record.requiredDocuments)) {
        throw new Error('All required registration documents must be attached before completing the registration.');
      }
      patch.completedAt = now;
      patch.completedBy = actorId;
      break;
    case 'Rejected': {
      const reason = options.rejectionReason?.trim();
      if (!reason) throw new Error('Rejection reason is required.');
      patch.rejectedAt = now;
      patch.rejectionReason = reason;
      break;
    }
    case 'Cancelled': {
      const note = options.note?.trim();
      if (!note) throw new Error('Cancellation note is required.');
      patch.cancelledAt = now;
      patch.cancelledBy = actorId;
      break;
    }
    case 'Failed':
      patch.failedAt = now;
      patch.failureReason = options.failureReason?.trim() || options.note?.trim() || undefined;
      break;
    default:
      break;
  }

  // Advance the project New → SchemeRegistration on submit — a SEPARATE,
  // forward-only write to the projects collection via the canonical
  // buildProjectStageAdvancePatch (idempotent: a resubmission while already
  // at SchemeRegistration produces an empty patch and no write). Mirrors the
  // scheduleSurvey pattern; the registration document never carries project
  // lifecycle fields.
  if (newStatus === 'Submitted') {
    const project = await requireProject(record.projectId);
    const advancePatch = buildProjectStageAdvancePatch(
      project, 'SchemeRegistration', actorId, `Scheme registration ${id} submitted`,
    );
    if (Object.keys(advancePatch).length > 0) {
      await updateDocById(COLLECTIONS.PROJECTS, record.projectId, advancePatch);
    }
  }

  // Capture the PRE-write state explicitly — the audit's oldValues must never
  // depend on the record object not having been mutated by the write.
  const previousStatus = record.status;
  await updateDocById(COLLECTIONS.SCHEME_REGISTRATIONS, id, patch);
  // Structured audit (Vendor Lock spec: every transition audits via
  // logUpdate('scheme_registration', …) + logActivity). The thin verb activity
  // entry below follows the repo convention; logEntityChange adds the
  // structured old→new record with full §25 metadata (actor, role, company,
  // project/case, partner, vendor, note/reason).
  await logEntityChange(
    'scheme_registration', id, 'scheme_registration',
    { status: previousStatus },
    { status: newStatus },
    `Scheme registration ${id} ${TRANSITION_LOG_VERBS[newStatus]}`,
    {
      projectId: record.projectId, caseId: record.caseId, partnerId: record.partnerId,
      vendorName: (patch as any).vendorName ?? record.vendorName,
      note: options.note?.trim(),
      rejectionReason: options.rejectionReason?.trim(),
      failureReason: options.failureReason?.trim(),
      actorId, actorRole: actor?.role,
    },
  );
  await logActivity('scheme_registration', TRANSITION_LOG_VERBS[newStatus], id, {
    projectId: record.projectId, from: record.status, to: newStatus, actorId,
  });

  // ── Notifications (§18 canonical matrix — Partner + TL/Manager ONLY;
  // Management/Admin are NOT recipients for Registration events) ──
  // Recipients are derived from the record's own chain (userId + managerId,
  // stamped at creation) — team-scoped, actor-skipped, deduplicated. A
  // submission nudges the TL/Manager verification queue; every staff outcome
  // notifies the owning partner AND their TL/Manager.
  try {
    await notifyPartnerTeam({
      partnerUserId: record.userId,
      managerUserId: record.managerId,
      actorUserId: actorId,
      type: newStatus === 'Submitted' ? NotificationType.TASK_STATUS_CHANGED : NotificationType.PARTNER_MILESTONE,
      title: newStatus === 'Submitted' ? 'Scheme registration awaiting verification' : PARTNER_NOTIFICATION_TITLES[newStatus],
      body: `Scheme registration ${id} for project ${record.projectId} is now ${newStatus}.`,
      entityType: 'scheme_registration', entityId: id,
      companyId: record.companyId, projectId: record.projectId,
    });
  } catch (err) {
    // Best-effort — a notification failure must never fail a completed
    // status transition.
    console.warn('[schemeRegistrationWorkflow] notification failed', err);
  }

  return { ...record, ...patch } as SchemeRegistrationRecord;
}

/**
 * Admin-only audited reopen (spec §13): reverses a Completed or VendorLocked
 * registration back to Submitted, appending a 'Reopened' history entry with
 * the audit note. The project stage is NOT regressed (§27.6 default — the
 * project stays where it is). Never available to a partner or Manager.
 */
export async function reopenSchemeRegistration(id: string, note: string): Promise<SchemeRegistrationRecord> {
  const record = await requireRegistration(id);
  if (!canDo('approve', 'scheme_registration')) {
    throw new Error('You do not have permission to reopen scheme registrations.');
  }
  const actor = useAppStore.getState().user;
  if (actor?.role !== 'Admin') {
    throw new Error('Only an Admin can reopen a completed registration.');
  }
  if (!note.trim()) throw new Error('A reopen reason is required for the audit trail.');
  if (record.status !== 'Completed' && record.status !== 'VendorLocked') {
    throw new Error('Only Completed or VendorLocked registrations can be reopened.');
  }
  const actorId = actor.id || 'system';
  const now = new Date().toISOString();

  const patch = {
    status: 'Submitted' as const,
    statusHistory: [
      ...(record.statusHistory || []),
      {
        status: 'Reopened' as const,
        changedAt: now,
        changedBy: actorId,
        changedByName: actor.name,
        note: `Admin reopened: ${note.trim()}`,
      },
      {
        status: 'Submitted' as const,
        changedAt: now,
        changedBy: actorId,
        changedByName: actor.name,
        note: 'Reopened by Admin',
      },
    ],
    reopenedAt: now,
    reopenedBy: actorId,
    submittedAt: now,
    submittedBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  };
  const previousStatus = record.status;
  await updateDocById(COLLECTIONS.SCHEME_REGISTRATIONS, id, patch);
  await logActivity('scheme_registration', 'reopened', id, {
    projectId: record.projectId, from: previousStatus, note: note.trim(), actorId,
  });
  await logEntityChange(
    'scheme_registration', id, 'scheme_registration',
    { status: previousStatus }, { status: 'Submitted', reopened: true },
    `Scheme registration ${id} reopened by Admin`,
    {
      projectId: record.projectId, caseId: record.caseId, partnerId: record.partnerId,
      note: note.trim(), actorId, actorRole: actor.role,
    },
  );
  // §18: the owning partner AND their TL/Manager are notified of the Admin
  // override (Admin itself is not a Registration notification recipient).
  try {
    await notifyPartnerTeam({
      partnerUserId: record.userId,
      managerUserId: record.managerId,
      actorUserId: actorId,
      type: NotificationType.PARTNER_MILESTONE,
      title: 'Registration reopened',
      body: `Scheme registration ${id} was reopened by Admin and is back for submission.`,
      entityType: 'scheme_registration', entityId: id,
      companyId: record.companyId, projectId: record.projectId,
    });
  } catch (err) {
    console.warn('[schemeRegistrationWorkflow] notification failed', err);
  }
  return { ...record, ...patch } as SchemeRegistrationRecord;
}

/**
 * Links a shared-document record (created via createCaseDocument —
 * caseDocuments.ts) to a required-document category on the registration. The
 * caller uploads the file and creates the shared document first; this
 * service keeps the checklist + documents[] refs authoritative and applies
 * the same §9.3 ownership guard.
 */
export async function attachRegistrationDocument(
  registrationId: string,
  category: string,
  documentId: string,
  options: { uploadedByName?: string } = {},
): Promise<SchemeRegistrationRecord> {
  const record = await requireRegistration(registrationId);
  requirePermission('edit');
  const authenticatedPartnerId = await resolveCurrentPartnerDocId();
  if (authenticatedPartnerId && String(record.partnerId ?? '') !== authenticatedPartnerId) {
    throw new Error('You can only manage your own scheme registrations.');
  }
  const actor = useAppStore.getState().user;
  const actorId = actor?.id || 'system';
  const now = new Date().toISOString();
  const uploaderName = options.uploadedByName || actor?.name;

  const requiredDocuments = (record.requiredDocuments || []).map((d) => (
    d.category === category
      ? { ...d, documentId, uploadedByName: uploaderName, uploadedAt: now }
      : d
  ));
  const documents = [
    ...(record.documents || []).filter((d) => d.category !== category),
    { documentId, category, uploadedByName: uploaderName, uploadedAt: now },
  ];
  const patch = { requiredDocuments, documents, updatedAt: now, updatedBy: actorId };
  const previousDocumentCount = (record.documents || []).length;
  await updateDocById(COLLECTIONS.SCHEME_REGISTRATIONS, registrationId, patch);
  await logActivity('scheme_registration', 'document_attached', registrationId, {
    category, documentId, actorId,
  });
  // §25: document attachment is an audit event (no notification — the §18
  // document row covers required/verified/rejected states, not uploads).
  await logEntityChange(
    'scheme_registration', registrationId, 'scheme_registration',
    { documents: previousDocumentCount }, { documents: documents.length },
    `Document attached to scheme registration ${registrationId}`,
    {
      projectId: record.projectId, caseId: record.caseId, partnerId: record.partnerId,
      category, documentId, actorId, actorRole: actor?.role,
    },
  );
  return { ...record, ...patch } as SchemeRegistrationRecord;
}

/**
 * Resolves the most recent (non-deleted) Scheme Registration for a project,
 * or null when none exists. Used by the Survey gate and the Project
 * Workspace's Registration stage card.
 */
export async function getSchemeRegistrationForProject(
  projectId: string,
): Promise<SchemeRegistrationRecord | null> {
  const all = await getAll<SchemeRegistrationRecord>(COLLECTIONS.SCHEME_REGISTRATIONS);
  return all
    .filter((r) => r.projectId === projectId && !r.isDeleted)
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))[0]
    ?? null;
}

/**
 * Survey gate (§17) — service-layer assertion shared by the Survey workflow.
 * `registration` == null (no record) is vacuous and passes, preserving
 * existing non-partner flows.
 */
export function assertSchemeRegistrationSurveyGate(
  project: { id: string },
  registration: SchemeRegistrationRecord | null | undefined,
): void {
  if (registration && !isSurveyGateSatisfied(registration.status, registration)) {
    throw new Error('A Survey can be scheduled only after the Registration (Vendor Lock) is Vendor Locked or Completed.');
  }
}
