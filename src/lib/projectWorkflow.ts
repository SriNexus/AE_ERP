import { createDocWithId, genId, getOne, updateDocById } from './firestore';
import { COLLECTIONS } from './firebase';
import { logActivity, resolveWorkflowCompanyId } from './workflow';
import type { ProjectRecord } from '../features/projects/types';
import type { ProjectFormValues } from '../features/projects/types';
import { projectFormToAddress } from '../features/projects/utils/projectDisplay';
import { useAppStore } from '../store/useAppStore';
import { sendNotification, notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { propagateCaseId } from './casePropagation';
import { canDo } from './permissions';
import { resolveCurrentPartnerDocId } from './partnerOwnership';

type ProjectCreateContext = {
  customerName?: string;
  /** Phase 3 (§9.2 rule 3): partner ownership propagated from the customer. */
  partnerId?: string;
  partnerName?: string;
};

function toNumber(value: string | number | null | undefined) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export function buildProjectCreatePayload(
  form: ProjectFormValues,
  context: { projectId: string; companyId: string; userId: string; partnerId?: string; partnerName?: string; leadId?: string }
): ProjectRecord {
  const capacityKw = toNumber(form.capacityKw);
  if (!form.customerId.trim()) {
    throw new Error('Customer is required');
  }
  if (capacityKw <= 0) {
    throw new Error('Project capacity must be greater than zero');
  }
  // Phase 4: Project Type (Residential/Commercial/Industrial) is mandatory for
  // every NEW Project — matches the existing customerId/capacityKw validation
  // pattern immediately above. Existing Projects created before this phase
  // keep whatever value (including empty) they already have; this only
  // prevents new ones from being saved without it (Blueprint's "grandfather"
  // migration decision — never retroactively enforced on historical records).
  if (!form.projectType?.trim()) {
    throw new Error('Project Type is required');
  }

  const now = new Date().toISOString();
  return {
    id: context.projectId,
    projectId: context.projectId,
    companyId: context.companyId,
    createdBy: context.userId,
    updatedBy: context.userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    customerId: form.customerId.trim(),
    leadId: context.leadId?.trim() || form.leadId.trim() || undefined,
    // Phase 3 (§9.2 rule 3): partner ownership survives Customer → Project.
    partnerId: context.partnerId?.trim() || undefined,
    partnerName: context.partnerName?.trim() || undefined,
    capacityKw,
    siteAddress: projectFormToAddress(form.siteAddress),
    currentStage: 'New',
    stageHistory: [{
      stage: 'New',
      changedAt: now,
      changedBy: context.userId,
      note: 'Project created',
    }],
    assignedSurveyor: form.assignedSurveyor.trim() || undefined,
    assignedInstaller: form.assignedInstaller.trim() || undefined,
    salesOwner: form.salesOwner.trim() || undefined,
    projectType: form.projectType?.trim() || undefined,
    notes: form.notes?.trim() || undefined,
    linkedQuotationIds: [],
    linkedOrderIds: [],
    linkedDispatchIds: [],
  };
}

export function buildProjectUpdatePayload(form: ProjectFormValues) {
  const capacityKw = toNumber(form.capacityKw);
  if (!form.customerId.trim()) {
    throw new Error('Customer is required');
  }
  if (capacityKw <= 0) {
    throw new Error('Project capacity must be greater than zero');
  }

  return {
    customerId: form.customerId.trim(),
    leadId: form.leadId.trim() || undefined,
    capacityKw,
    siteAddress: projectFormToAddress(form.siteAddress),
    assignedSurveyor: form.assignedSurveyor.trim() || undefined,
    assignedInstaller: form.assignedInstaller.trim() || undefined,
    salesOwner: form.salesOwner.trim() || undefined,
    projectType: form.projectType?.trim() || undefined,
    notes: form.notes?.trim() || undefined,
  };
}

export function buildProjectArchivePayload(project: ProjectRecord, reason = 'Archived from Projects page') {
  const now = new Date().toISOString();
  return {
    currentStage: 'Archived' as const,
    archivedAt: now,
    archiveReason: reason,
    stageHistory: [
      ...(project.stageHistory || []),
      {
        stage: 'Archived' as const,
        changedAt: now,
        changedBy: useAppStore.getState().user?.id,
        note: reason,
      },
    ],
  };
}

export async function createProject(form: ProjectFormValues, context: ProjectCreateContext = {}) {
  const state = useAppStore.getState();
  const companyId = resolveWorkflowCompanyId();
  const userId = state.user?.id || 'system';

  // RBAC service-layer guard — previously createProject() only enforced the
  // B2B/B2C business rule below and relied entirely on RoleRoute/button
  // visibility to keep unauthorized roles out, unlike surveyWorkflow.ts/
  // engineeringWorkflow.ts, which both already call canDo() here. A role
  // with no 'create' permission on 'projects' could still call this
  // function directly (e.g. via console) and create a real Project.
  if (!canDo('create', 'projects')) {
    throw new Error('You do not have permission to create projects.');
  }

  // Phase 4: defense-in-depth guard — "B2B customers must NEVER have a
  // Project" is a locked, non-negotiable business rule. UI-level gating
  // (filterCustomersForProjectCreation in the customer picker, the !isB2B
  // check on the Customer Workspace's "Create Project" entry points) already
  // keeps this out of the normal flow; this is the true lowest-level check
  // so no current or future call site can bypass it and create a Project
  // for a B2B customer.
  // Phase 3 (§9.2 rule 3): the SAME customer fetch also carries the partner
  // ownership chain forward (partnerId/partnerName from the customer) and
  // restores the originating leadId from the customer's sourceLeadId when the
  // form did not supply one — ownership must survive Customer → Project.
  let customerPartnerId: string | undefined;
  let customerPartnerName: string | undefined;
  let customerSourceLeadId: string | undefined;
  if (form.customerId?.trim()) {
    const customer = await getOne<{ type?: string; partnerId?: string; partnerName?: string; sourceLeadId?: string }>(
      COLLECTIONS.CUSTOMERS,
      form.customerId.trim(),
    );
    if (customer?.type === 'B2B') {
      throw new Error('B2B customers cannot have a Project — Projects are a B2C-exclusive workflow.');
    }
    customerPartnerId = customer?.partnerId;
    customerPartnerName = customer?.partnerName;
    customerSourceLeadId = customer?.sourceLeadId;

    // Phase 5 (§9.3): a linked Channel Partner may only create a Project for
    // a customer they own. The customer's partnerId is authoritative (it was
    // stamped at Lead → Customer conversion or at partner customer creation)
    // — a partner who submits another partner's customerId gets the project
    // rejected outright, so ownership can never be claimed across partners.
    // Non-partner actors (internal Sales/Admin) have no resolved link and are
    // unaffected; a partner-owned customer kept the chain intact.
    const authenticatedPartnerId = await resolveCurrentPartnerDocId();
    const customerOwner = String(customerPartnerId || '').trim();
    if (authenticatedPartnerId && customerOwner && authenticatedPartnerId !== customerOwner) {
      throw new Error('Cannot create a Project for another partner\'s customer.');
    }
  }

  const projectId = genId.project();
  const payload = buildProjectCreatePayload(form, {
    projectId,
    companyId,
    userId,
    partnerId: customerPartnerId,
    partnerName: customerPartnerName,
    leadId: customerSourceLeadId,
  });

  await createDocWithId(COLLECTIONS.PROJECTS, projectId, payload);

  // Phase 3B: Propagate caseId to project via customer chain; also try direct from lead
  void propagateCaseId('projects', projectId, 'customers', form.customerId);
  if (form.leadId) {
    void propagateCaseId('projects', projectId, 'leads', form.leadId);
  }

  await logActivity('Projects', 'Created Project', projectId, {
    entityName: context.customerName || projectId,
    actionLabel: `Created project ${projectId}`,
    customerId: form.customerId,
    customerName: context.customerName || '',
  });

  // Notify relevant roles about new project
  await notifyRoleUsers(
    ['Admin', 'Director', 'Operations', 'Sales'],
    NotificationType.TASK_ASSIGNED,
    'New project created',
    `Project ${projectId} was created for ${context.customerName || form.customerId}.`,
    'project',
    projectId,
    companyId,
  ).catch(() => {});

  // Notify assigned team members
  if (form.assignedSurveyor) {
    await sendNotification(
      form.assignedSurveyor,
      NotificationType.TASK_ASSIGNED,
      'Surveyor assigned to project',
      `You have been assigned as surveyor for project ${projectId}.`,
      'project',
      projectId,
      companyId,
    ).catch(() => {});
  }
  if (form.salesOwner) {
    await sendNotification(
      form.salesOwner,
      NotificationType.TASK_ASSIGNED,
      'Project assigned',
      `Project ${projectId} has been assigned to you.`,
      'project',
      projectId,
      companyId,
    ).catch(() => {});
  }

  return payload;
}

export async function updateProject(projectId: string, form: ProjectFormValues) {
  const current = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, projectId);
  if (!current) {
    throw new Error('Project not found');
  }

  const payload = buildProjectUpdatePayload(form);
  await updateDocById(COLLECTIONS.PROJECTS, projectId, payload);
  await logActivity('Projects', 'Updated Project', projectId, {
    entityName: current.projectId || projectId,
    actionLabel: `Updated project ${current.projectId || projectId}`,
    customerId: form.customerId,
  });

  // Notify assigned team members of changes
  if (form.assignedSurveyor && form.assignedSurveyor !== current.assignedSurveyor) {
    await sendNotification(
      form.assignedSurveyor,
      NotificationType.TASK_ASSIGNED,
      'Surveyor assigned to project',
      `You have been assigned as surveyor for project ${projectId}.`,
      'project',
      projectId,
      current.companyId,
    ).catch(() => {});
  }

  return { ...current, ...payload, id: projectId, projectId };
}

export async function archiveProject(projectId: string, reason = 'Archived from Projects page') {
  const current = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, projectId);
  if (!current) {
    throw new Error('Project not found');
  }

  const payload = buildProjectArchivePayload(current, reason);
  await updateDocById(COLLECTIONS.PROJECTS, projectId, payload);
  await logActivity('Projects', 'Archived Project', projectId, {
    entityName: current.projectId || projectId,
    actionLabel: `Archived project ${current.projectId || projectId}`,
    reason,
  });

  // Notify admins about archival
  await notifyRoleUsers(
    ['Admin', 'Director'],
    NotificationType.ORDER_UPDATED,
    'Project archived',
    `Project ${current.projectId || projectId} was archived. Reason: ${reason}`,
    'project',
    projectId,
    current.companyId,
  ).catch(() => {});

  return { ...current, ...payload, id: projectId, projectId };
}

