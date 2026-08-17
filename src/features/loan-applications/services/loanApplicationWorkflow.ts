/**
 * loanApplicationWorkflow.ts — Loan Application Workflow Automation
 *
 * Phase REG-2: Task auto-creation, notifications, audit logging,
 * payment integration, project creation, and case integration.
 */

import { taskEngine } from '../../../engines/TaskEngine';
import { sendNotification, notifyRoleUsers } from '../../../lib/notifications';
import { logUpdate } from '../../../lib/auditLogger';
import { createDocWithId, genId, getOne, getAll, updateDocById, resolveWriteCompanyId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import { logActivity } from '../../../lib/workflow';
import { NotificationType } from '../../../types';
import { createProject } from '../../../lib/projectWorkflow';
import { propagateCaseIdFromChain } from '../../../lib/casePropagation';
import { canDo } from '../../../lib/permissions';
import type { ProjectFormValues } from '../../projects/types';
import type { ProjectSiteAddress } from '../../../types';

// ── Status → Auto Task Mapping ────────────────────────────

interface AutoTaskSpec {
  title: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  slaMinutes?: number;
  description?: string;
  /** Only create this task if the condition evaluates to true */
  condition?: (reg: any) => boolean;
}

const STATUS_AUTO_TASKS: Record<string, AutoTaskSpec[]> = {
  'Draft': [
    { title: 'Process loan application documents', priority: 'medium', description: 'Review and process the loan application documents for bank submission.' },
  ],
  'Digital Sign Pending': [
    { title: "Collect customer's digital signature", priority: 'high', description: 'Customer needs to sign the loan application documents digitally.' },
  ],
  'Submitted To Bank': [
    { title: 'Follow up with bank', priority: 'high', slaMinutes: 5 * 24 * 60, description: 'Follow up with the bank to check application status.' },
  ],
  'Under Review': [
    { title: 'Bank approval delayed', priority: 'high', description: 'Application has been under bank review for more than 5 days. Escalate.', condition: (reg) => {
      const hours = getHoursSince(reg.submissionDate || reg.createdAt);
      return hours >= 5 * 24;
    }},
  ],
  'Approved': [
    { title: 'Collect payment', priority: 'high', description: 'Bank has approved the loan application. Collect the payment from customer.' },
    { title: 'Proceed to project creation', priority: 'medium', description: 'Create project now that loan application is approved and payment is pending.' },
  ],
  'Rejected': [
    { title: 'Reprocess application', priority: 'high', description: 'Bank has rejected the application. Review and resubmit.' },
  ],
  'Payment Received': [
    { title: 'Close all loan application tasks', priority: 'low', description: 'Payment received. Close all open loan application tasks.', condition: () => false },
  ],
};

// ── Notification Templates ─────────────────────────────────

const STATUS_NOTIFICATIONS: Record<string, { title: string; body: (r: any) => string; recipients: string[] }> = {
  'Draft': {
    title: 'Loan Application Created',
    body: (r) => `Loan application ${r.registrationId} created for ${r.customerName}. Bank: ${r.bankName || 'TBD'}.`,
    recipients: ['assignee', 'manager', 'owner'],
  },
  'Digital Sign Pending': {
    title: 'Digital Sign Required',
    body: (r) => `Digital signature pending for ${r.customerName} (${r.registrationId}).`,
    recipients: ['assignee', 'manager'],
  },
  'Submitted To Bank': {
    title: 'Bank Submission Complete',
    body: (r) => `Loan application ${r.registrationId} for ${r.customerName} submitted to ${r.bankName}.`,
    recipients: ['assignee', 'manager', 'owner'],
  },
  'Approved': {
    title: 'Loan Application Approved',
    body: (r) => `Loan application ${r.registrationId} for ${r.customerName} approved by ${r.bankName}. Collect payment.`,
    recipients: ['assignee', 'manager', 'owner', 'accounts'],
  },
  'Rejected': {
    title: 'Loan Application Rejected',
    body: (r) => `Loan application ${r.registrationId} for ${r.customerName} was rejected by ${r.bankName}. Needs reprocessing.`,
    recipients: ['assignee', 'manager', 'owner'],
  },
  'Payment Received': {
    title: 'Payment Received',
    body: (r) => `Payment received for loan application ${r.registrationId} (${r.customerName}). Ready for project creation.`,
    recipients: ['assignee', 'manager', 'owner', 'operations'],
  },
};

// ── Helpers ────────────────────────────────────────────────

function getContext() {
  const state = useAppStore.getState();
  return {
    userId: state.user?.id || 'system',
    userName: state.user?.name || 'System',
    // Canonical tenant resolution — never the neutral 'default' placeholder.
    companyId: resolveWriteCompanyId(),
  };
}

/** Get hours elapsed since a date value */
export function getHoursSince(value: any): number {
  if (!value) return 0;
  const d = typeof value === 'object' && typeof value.toDate === 'function' ? value.toDate()
    : typeof value === 'object' && value.seconds ? new Date(value.seconds * 1000)
    : new Date(value);
  if (isNaN(d.getTime())) return 0;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60);
}

// ── Main Entry Point ───────────────────────────────────────

/**
 * Called after a loan application's status is updated.
 * Handles task auto-creation, notification, and audit logging.
 */
export async function onLoanApplicationStatusChange(
  registrationId: string,
  oldStatus: string,
  newStatus: string,
): Promise<void> {
  if (oldStatus === newStatus && oldStatus !== '') return;

  const { userId, userName, companyId } = getContext();
  const reg = await getOne<any>(COLLECTIONS.LOAN_APPLICATIONS, registrationId);
  if (!reg || reg.isDeleted) return;

  const r = { ...reg, registrationId: reg.registrationId || reg.id };

  try {
    // 1. Auto-create tasks for the new status
    const tasks = STATUS_AUTO_TASKS[newStatus] || [];
    for (const spec of tasks) {
      if (spec.title === 'Close all loan application tasks') {
        await closeLoanApplicationTasks(registrationId, companyId);
        continue;
      }
      // Check conditional tasks (e.g. Under Review delay)
      if (spec.condition && !spec.condition(r)) {
        continue;
      }
      await taskEngine.createTask({
        title: spec.title,
        description: spec.description || '',
        assigneeId: r.assignedToId || userId,
        assigneeName: r.assignedToName || userName,
        priority: spec.priority,
        dueDate: new Date(Date.now() + (spec.slaMinutes || 7 * 24 * 60) * 60 * 1000).toISOString().split('T')[0],
        linkedEntityId: registrationId,
        linkedEntityType: 'registration',
        companyId,
        slaMinutes: spec.slaMinutes,
      });
    }

    // 2. Send notifications
    const notif = STATUS_NOTIFICATIONS[newStatus];
    if (notif) {
      const body = notif.body(r);
      const notifyRecipients = async () => {
        const promises: Promise<void>[] = [];
        if (notif.recipients.includes('assignee') && r.assignedToId) {
          promises.push(sendNotification(
            r.assignedToId, NotificationType.ORDER_UPDATED, notif.title, body,
            'registration', registrationId, companyId,
          ));
        }
        for (const role of ['manager', 'owner', 'accounts', 'operations']) {
          if (notif.recipients.includes(role)) {
            promises.push(notifyRoleUsers(
              [role === 'owner' ? 'owner' : role === 'manager' ? 'Manager' : role === 'accounts' ? 'Accounts' : 'Operations'],
              NotificationType.ORDER_UPDATED, notif.title, body,
              'registration', registrationId, companyId,
            ));
          }
        }
        await Promise.allSettled(promises);
      };
      void notifyRecipients();
    }

    // 3. Field-level audit tracking
    const fieldChanges: Record<string, unknown> = {};
    const fieldOlds: Record<string, unknown> = {};
    // Track status change
    if (oldStatus !== newStatus) {
      fieldChanges.status = newStatus;
      fieldOlds.status = oldStatus;
    }
    
    // 4. Audit log with all tracked changes
    await logUpdate(
      'registration',
      registrationId,
      Object.keys(fieldOlds).length > 0 ? fieldOlds : { status: oldStatus },
      Object.keys(fieldChanges).length > 0 ? fieldChanges : { status: newStatus },
      'registrations',
    );

    // 5. Activity log
    await logActivity('Loan Applications', `Status: ${newStatus}`, registrationId, {
      entityName: r.customerName || registrationId,
      actionLabel: `Loan application ${registrationId} status changed from ${oldStatus} to ${newStatus}`,
      oldStatus,
      newStatus,
    });

    // 6. Propagate caseId on approval
    if (newStatus === 'Approved' && r.customerId) {
      void propagateCaseIdFromChain('registrations', registrationId);
    }

  } catch (error) {
    console.warn('[loanApplicationWorkflow] Error on status change:', error);
  }
}

// ── Close all tasks for a loan application ─────────────────────

async function closeLoanApplicationTasks(registrationId: string, companyId: string): Promise<void> {
  try {
    const tasks = await taskEngine.getTasksForEntity(registrationId, 'registration', companyId);
    await Promise.all(
      tasks
        .filter((t) => t.status === 'open' || t.status === 'in_progress')
        .map((t) => taskEngine.completeTask(t.id).catch(() => {})),
    );
  } catch {
    // Best-effort
  }
}

// ── Create Loan Application ─────────────────────────────────────

export interface CreateLoanApplicationInput {
  /** Raw form values (LOAN_APPLICATION_FORM_DEFAULT shape). */
  form: Record<string, any>;
  createdById: string;
  createdByName: string;
}

/** Creates a new Loan Application document. Extracted verbatim from the create
 * branch of LoanApplicationsWorkspace.tsx's own `save` mutation (PRE-EXISTING
 * BEHAVIOR, unchanged) so a second caller (Customer Workspace) can create a
 * registration without duplicating this logic. Editing an existing
 * registration is intentionally NOT covered here — LoanApplicationsWorkspace.tsx
 * keeps that branch inline, since only creation is embedded elsewhere.
 *
 * Unlike the Quotation/Order extractions (Phase 0), the post-create status
 * workflow call (`onLoanApplicationStatusChange`) is folded in here rather than
 * left to the caller's `onSuccess` — it's a universal, always-wanted
 * consequence of any loan application being created (auto-creates the Draft
 * follow-up task, sends the creation notification), not a page-specific UI
 * concern, matching how `convertQuotationToOrder` already calls
 * `propagateCaseIdFromChain` internally rather than leaving it to its caller. */
export async function createLoanApplication(input: CreateLoanApplicationInput) {
  // RBAC service-layer guard — this module had zero canDo() check despite
  // survey/engineering/quotation/dispatch workflows all having one; only
  // UI-level RoleRoute/button visibility kept an unauthorized role out.
  if (!canDo('create', 'loan_applications')) {
    throw new Error('You do not have permission to create loan applications.');
  }

  // Phase 16: defense-in-depth guard, mirroring projectWorkflow.ts's
  // createProject() (Phase 4). Loan Application creation is currently only
  // reachable through CustomerB2CWorkflowCards.tsx's "Start Loan Application"
  // button — B2B customers render CustomerB2BWorkflowPipeline instead and
  // never see it — but that is UI-level gating only; this is the true
  // lowest-level check so no current or future call site (a direct API
  // call, a future UI change) can bypass it and create a Loan Application
  // (Neozy's B2C-only pre-Project financing module) for a B2B customer.
  const customerId = String(input.form?.customerId || '').trim();
  if (customerId) {
    const customer = await getOne<{ type?: string }>(COLLECTIONS.CUSTOMERS, customerId);
    if (customer?.type === 'B2B') {
      throw new Error('B2B customers cannot have a Loan Application — Loan Applications is a B2C-exclusive financing workflow.');
    }
  }

  const id = genId.registration();
  const logEntry = {
    id: genId.generic('LOG'), type: 'Creation', desc: 'Loan application created',
    date: new Date().toISOString(), userName: input.createdByName,
  };
  const createdReg = {
    ...input.form, id, registrationId: id, createdBy: input.createdById, isDeleted: false,
    activityLog: [logEntry],
  };
  await createDocWithId(COLLECTIONS.LOAN_APPLICATIONS, id, createdReg);
  void onLoanApplicationStatusChange(id, '', input.form.status || 'Draft');
  return createdReg;
}

// ── Create Payment from Loan Application ───────────────────────

export async function createPaymentFromLoanApplication(
  registrationId: string,
  amount: number,
  mode: string,
  date: string,
  reference?: string,
  notes?: string,
): Promise<string | null> {
  const reg = await getOne<any>(COLLECTIONS.LOAN_APPLICATIONS, registrationId);
  if (!reg || reg.isDeleted) return null;
  if (!reg.customerId) throw new Error('Loan application has no linked customer');

  const { userId, userName, companyId } = getContext();
  const now = new Date().toISOString();
  const paymentId = genId.payment();

  await createDocWithId(COLLECTIONS.PAYMENTS, paymentId, {
    id: paymentId, companyId, customerId: reg.customerId,
    customerName: reg.customerName || '', registrationId,
    amount, mode, reference: reference || '', notes: notes || '', date,
    status: 'Pending',
    statusHistory: [{ status: 'Pending', changedAt: now, changedBy: userId }],
    createdBy: userId, createdAt: now, updatedBy: userId, updatedAt: now, isDeleted: false,
  });

  await updateDocById(COLLECTIONS.LOAN_APPLICATIONS, registrationId, {
    paymentId, paymentAmount: amount, paymentDate: date, paymentMode: mode,
    status: 'Payment Received', updatedBy: userId,
    activityLog: [...(reg.activityLog || []), { id: genId.generic('LOG'), type: 'Payment', desc: `Payment of ${amount} recorded`, date: now, userName }],
  });

  await logActivity('Loan Applications', 'Payment Received', registrationId, {
    entityName: reg.customerName || registrationId, actionLabel: `Payment of ${amount} recorded for ${registrationId}`,
    amount, mode,
  });

  void sendNotification(reg.assignedToId || userId, NotificationType.PAYMENT_RECORDED,
    'Payment recorded', `Payment of ${amount} recorded for loan application ${registrationId}.`,
    'registration', registrationId, companyId);

  // Trigger workflow
  void onLoanApplicationStatusChange(registrationId, reg.status || 'Approved', 'Payment Received');

  return paymentId;
}

// ── Create Project from Loan Application ───────────────────────

export async function createProjectFromLoanApplication(
  registrationId: string,
  capacityKw: number,
  // Phase 4: Project Type is mandatory (Blueprint §4 rule 3 / Phase 4's
  // completion criteria) — previously this path silently created every
  // loan-application-sourced Project with an empty projectType regardless of
  // what the caller's form actually collected. Required, not defaulted:
  // Loan Application has no property/project-type field of its own to fall
  // back to, so the caller must supply the real value. Moved ahead of the
  // optional siteAddressInput param — a required parameter cannot follow
  // an optional one (TS1016).
  projectType: string,
  siteAddressInput?: string,
): Promise<string | null> {
  const reg = await getOne<any>(COLLECTIONS.LOAN_APPLICATIONS, registrationId);
  if (!reg || reg.isDeleted) return null;
  if (!reg.customerId) throw new Error('Loan application has no linked customer');

  const { userId, companyId } = getContext();

  // Check for existing project
  try {
    const { getAll } = await import('../../../lib/firestore');
    const existing = await getAll<any>(COLLECTIONS.PROJECTS);
    const dup = existing.find((p: any) => p.registrationId === registrationId && !p.isDeleted);
    if (dup) throw new Error(`Project ${dup.projectId} already exists for this loan application`);
  } catch (err: any) {
    if (err.message?.includes('already exists')) throw err;
  }

  const siteAddressText = siteAddressInput || reg.customerAddress || '';
  const siteAddr: ProjectSiteAddress = {
    line1: siteAddressText.split(',').slice(0, 2).join(',').trim(),
    city: '',
    district: '',
    state: '',
    pincode: '',
    country: 'India',
  };

  const projectForm: ProjectFormValues = {
    customerId: reg.customerId,
    leadId: '',
    capacityKw: String(Number(capacityKw) || 1),
    projectType,
    salesOwner: reg.assignedToName || '',
    assignedSurveyor: reg.assignedToId || '',
    assignedInstaller: '',
    notes: '',
    siteAddress: siteAddr,
  };

  const project = await createProject(projectForm, { customerName: reg.customerName || '' });
  const projectId = project.projectId || project.id;

  await updateDocById(COLLECTIONS.LOAN_APPLICATIONS, registrationId, { projectId, updatedBy: userId });
  await updateDocById(COLLECTIONS.PROJECTS, projectId, { registrationId });

  await logActivity('Loan Applications', 'Project Created', registrationId, {
    entityName: reg.customerName || registrationId,
    actionLabel: `Project ${projectId} created from loan application ${registrationId}`, projectId,
  });

  void sendNotification(reg.assignedToId || userId, NotificationType.TASK_ASSIGNED,
    'Project created from loan application', `Project ${projectId} has been created from loan application ${registrationId}.`,
    'project', projectId, companyId);

  return projectId;
}

// ── Banking Intelligence ───────────────────────────────────

export interface BankMetrics {
  bankName: string;
  totalApplications: number;
  approved: number;
  rejected: number;
  underReview: number;
  approvalRate: number;
  rejectionRate: number;
  avgApprovalDays: number;
  pendingCases: number;
}

export function calculateBankMetrics(registrations: any[]): BankMetrics[] {
  const bankGroups = new Map<string, any[]>();
  for (const reg of registrations) {
    const bank = reg.bankName || 'Unknown';
    if (!bankGroups.has(bank)) bankGroups.set(bank, []);
    bankGroups.get(bank)!.push(reg);
  }

  const metrics: BankMetrics[] = [];
  for (const [bankName, group] of bankGroups) {
    const approved = group.filter((r) => ['Approved', 'Payment Received', 'Closed'].includes(r.status)).length;
    const rejected = group.filter((r) => r.status === 'Rejected').length;
    const underReview = group.filter((r) => ['Under Review', 'Submitted To Bank'].includes(r.status)).length;
    const approvedWithDates = group.filter((r) => r.approvalDate && r.createdAt);
    let totalDays = 0;
    let datedCount = 0;
    for (const r of approvedWithDates) {
      const approvalTime = r.approvalDate?.toDate ? r.approvalDate.toDate().getTime() : new Date(r.approvalDate).getTime();
      const createdTime = r.createdAt?.toDate ? r.createdAt.toDate().getTime() : new Date(r.createdAt).getTime();
      if (!isNaN(approvalTime) && !isNaN(createdTime)) {
        totalDays += (approvalTime - createdTime) / (1000 * 60 * 60 * 24);
        datedCount++;
      }
    }

    const totalDecided = approved + rejected;
    metrics.push({
      bankName,
      totalApplications: group.length,
      approved,
      rejected,
      underReview,
      approvalRate: totalDecided > 0 ? Math.round((approved / totalDecided) * 100) : 0,
      rejectionRate: totalDecided > 0 ? Math.round((rejected / totalDecided) * 100) : 0,
      avgApprovalDays: datedCount > 0 ? Math.round(totalDays / datedCount) : 0,
      pendingCases: group.filter((r) => !['Approved', 'Rejected', 'Payment Received', 'Closed'].includes(r.status)).length,
    });
  }

  return metrics.sort((a, b) => b.totalApplications - a.totalApplications);
}

export function getDashboardMetrics(registrations: any[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pending = registrations.filter((r) => ['Under Review', 'Bank Submission Pending', 'Submitted To Bank'].includes(r.status));
  const approved = registrations.filter((r) => r.status === 'Approved');
  const paymentReceived = registrations.filter((r) => ['Payment Received', 'Closed'].includes(r.status));
  const rejected = registrations.filter((r) => r.status === 'Rejected');
  const closed = registrations.filter((r) => r.status === 'Closed');
  const digitalSignPending = registrations.filter((r) => r.status === 'Digital Sign Pending');

  const bankMetrics = calculateBankMetrics(registrations);
  const topBank = bankMetrics.length > 0
    ? bankMetrics.reduce((best, curr) => curr.approved > best.approved ? curr : best, bankMetrics[0])
    : null;

  return {
    totalRegistrations: registrations.length,
    pendingBankApproval: pending.length,
    approvedToday: approved.filter((r) => {
      const d = r.approvalDate ? new Date(r.approvalDate) : null;
      return d && d.getTime() >= today.getTime();
    }).length,
    paymentsPending: approved.length,
    paymentsReceived: paymentReceived.length,
    rejectedTotal: rejected.length,
    digitalSignPending: digitalSignPending.length,
    approvalsRate: registrations.length > 0
      ? Math.round(((approved.length + paymentReceived.length + closed.length) / registrations.length) * 100)
      : 0,
    topBank: topBank ? { name: topBank.bankName, approvalRate: topBank.approvalRate } : null,
    bankMetrics,
    pendingCases: pending.length + digitalSignPending.length,
  };
}
