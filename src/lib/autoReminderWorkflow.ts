/**
 * P10-03 — Auto-Reminders & Automation: Workflow Engine
 *
 * Evaluates reminder rules against project/lead/task data using existing
 * Firestore queries. Creates tasks + sends notifications via the existing
 * notification infrastructure (lib/notifications.ts, lib/tasks.ts).
 *
 * Follows the same pattern as autoSettlementScheduler.ts:
 *   - Config stored in Entities collection
 *   - evaluateAllRules() returns results without side effects
 *   - executeRules() creates tasks + sends notifications
 *   - Manual or periodic trigger (no cron — client-side app)
 */

import { getAll, getOne, createDocWithId, genId, updateDocById, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { NotificationType } from '../types';
import { sendNotification, notifyRoleUsers } from './notifications';
import { createTask } from './tasks';
import { safeDate, daysBetween } from './analyticsCore';
import type {
  ReminderConfig,
  ReminderRule,
  ReminderEvaluationResult,
} from '../features/auto-reminders/types';
import { nowInGeneralTimezone } from '../features/settings/generalRuntime';

// ═══════════════════════════════════════════════════════════
//  DEFAULTS
// ═══════════════════════════════════════════════════════════

export const STUCK_THRESHOLD_DAYS: Record<string, number> = {
  Survey: 7,
  Engineering: 14,
  Quotation: 14,
  Order: 7,
  Procurement: 21,
  Dispatch: 7,
  Installation: 30,
  QC: 7,
  Commissioning: 14,
  NetMetering: 21,
  Subsidy: 30,
  Handover: 14,
  AMC: 365,
  Service: 14,
  Monitoring: 90,
  New: 14,
};

const LEAD_FOLLOWUP_THRESHOLD_DAYS = 7;
const SERVICE_TICKET_STUCK_DAYS = 14;
const TASK_OVERDUE_DAYS = 2;

export const DEFAULT_REMINDER_RULES: ReminderRule[] = [
  {
    id: 'project-stuck-survey',
    entityType: 'project',
    label: 'Project stuck in Survey',
    stage: 'Survey',
    thresholdDays: STUCK_THRESHOLD_DAYS.Survey,
    enabled: true,
    escalations: [
      { afterDays: 0, level: 'warning', action: 'notify', messageTemplate: 'Project {{projectId}} has been in Survey for {{days}} days.' },
      { afterDays: 14, level: 'critical', action: 'notify_admin', messageTemplate: 'URGENT: Project {{projectId}} stuck in Survey for {{days}} days.' },
    ],
    notifyRoles: ['Surveyor', 'Admin'],
    createTask: true,
  },
  {
    id: 'project-stuck-engineering',
    entityType: 'project',
    label: 'Project stuck in Engineering',
    stage: 'Engineering',
    thresholdDays: STUCK_THRESHOLD_DAYS.Engineering,
    enabled: true,
    escalations: [
      { afterDays: 0, level: 'warning', action: 'notify', messageTemplate: 'Project {{projectId}} has been in Engineering for {{days}} days.' },
      { afterDays: 14, level: 'critical', action: 'notify_admin' },
    ],
    notifyRoles: ['Engineer', 'Admin'],
    createTask: true,
  },
  {
    id: 'project-stuck-procurement',
    entityType: 'project',
    label: 'Project stuck in Procurement',
    stage: 'Procurement',
    thresholdDays: STUCK_THRESHOLD_DAYS.Procurement,
    enabled: true,
    escalations: [
      { afterDays: 0, level: 'warning', action: 'notify' },
      { afterDays: 15, level: 'critical', action: 'notify_admin' },
    ],
    notifyRoles: ['Admin'],
    createTask: true,
  },
  {
    id: 'project-stuck-installation',
    entityType: 'project',
    label: 'Project stuck in Installation',
    stage: 'Installation',
    thresholdDays: STUCK_THRESHOLD_DAYS.Installation,
    enabled: true,
    escalations: [
      { afterDays: 0, level: 'warning', action: 'notify' },
      { afterDays: 15, level: 'critical', action: 'notify_admin' },
    ],
    notifyRoles: ['InstallationLead', 'Admin'],
    createTask: true,
  },
  {
    id: 'project-stuck-netmetering',
    entityType: 'project',
    label: 'Net Metering application pending',
    stage: 'NetMetering',
    thresholdDays: STUCK_THRESHOLD_DAYS.NetMetering,
    enabled: true,
    escalations: [
      { afterDays: 0, level: 'warning', action: 'notify' },
      { afterDays: 15, level: 'critical', action: 'notify_admin' },
    ],
    notifyRoles: ['Admin'],
    createTask: false,
  },
  {
    id: 'lead-followup',
    entityType: 'lead',
    label: 'Lead needs follow-up',
    stage: 'Follow-up',
    thresholdDays: LEAD_FOLLOWUP_THRESHOLD_DAYS,
    enabled: true,
    escalations: [
      { afterDays: 0, level: 'info', action: 'notify' },
      { afterDays: 7, level: 'warning', action: 'create_task' },
    ],
    notifyRoles: ['Sales'],
    createTask: false,
  },
  {
    id: 'task-overdue',
    entityType: 'task',
    label: 'Task overdue',
    thresholdDays: TASK_OVERDUE_DAYS,
    enabled: true,
    escalations: [
      { afterDays: 0, level: 'warning', action: 'notify' },
      { afterDays: 5, level: 'critical', action: 'notify_admin' },
    ],
    notifyRoles: ['Admin'],
    createTask: false,
  },
  {
    id: 'service-ticket-stuck',
    entityType: 'service_ticket',
    label: 'Service ticket unresolved',
    stage: 'InProgress',
    thresholdDays: SERVICE_TICKET_STUCK_DAYS,
    enabled: true,
    escalations: [
      { afterDays: 0, level: 'warning', action: 'notify' },
      { afterDays: 7, level: 'critical', action: 'notify_admin' },
    ],
    notifyRoles: ['ServiceTechnician', 'Admin'],
    createTask: false,
  },
];

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: false,
  rules: DEFAULT_REMINDER_RULES,
  autoEvalMinutes: 60,
};

// ═══════════════════════════════════════════════════════════
//  CONFIG STORAGE
// ═══════════════════════════════════════════════════════════

const REMINDER_CONFIG_DOC_ID = 'auto_reminder_config';

/**
 * Load reminder configuration from the entities collection.
 */
export async function loadReminderConfig(): Promise<ReminderConfig> {
  const doc = await getOne<{ config: ReminderConfig }>(COLLECTIONS.ENTITIES, REMINDER_CONFIG_DOC_ID);
  if (doc?.config) {
    return { ...DEFAULT_REMINDER_CONFIG, ...doc.config };
  }
  return { ...DEFAULT_REMINDER_CONFIG };
}

/**
 * Save reminder configuration.
 */
export async function saveReminderConfig(config: ReminderConfig): Promise<void> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  const existing = await getOne(COLLECTIONS.ENTITIES, REMINDER_CONFIG_DOC_ID);
  if (existing) {
    await updateDocById(COLLECTIONS.ENTITIES, REMINDER_CONFIG_DOC_ID, {
      config,
      updatedAt: new Date().toISOString(),
      updatedBy: state.user?.id || 'system',
    });
  } else {
    await createDocWithId(COLLECTIONS.ENTITIES, REMINDER_CONFIG_DOC_ID, {
      id: REMINDER_CONFIG_DOC_ID,
      entityType: 'reminder_config',
      companyId,
      config,
      createdAt: new Date().toISOString(),
      createdBy: state.user?.id || 'system',
      updatedAt: new Date().toISOString(),
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  EVALUATION ENGINE
// ═══════════════════════════════════════════════════════════

/** Internal type for entity records with stage/status. */
interface StageAwareRecord {
  id: string;
  projectId?: string;
  currentStage?: string;
  status?: string;
  stageHistory?: Array<{ stage: string; changedAt: string; changedBy: string }>;
  createdAt?: string;
  isDeleted?: boolean;
  assignedToId?: string;
  title?: string;
  name?: string;
  entityType?: string;
  dueDate?: string;
  companyId?: string;
}

/**
 * Evaluate a single reminder rule against all entity records.
 * Pure function — no side effects, no Firestore calls.
 */
export function evaluateRule(
  rule: ReminderRule,
  records: StageAwareRecord[],
): ReminderEvaluationResult[] {
  const now = nowInGeneralTimezone();
  const results: ReminderEvaluationResult[] = [];

  records.forEach((record) => {
    if (record.isDeleted) return;

    const stage = rule.stage
      ? (record.currentStage || record.status || '')
      : (record.currentStage || record.status || '');

    // If rule targets a specific stage, skip records not in that stage
    if (rule.stage && stage !== rule.stage) return;

    // Calculate how long the record has been in its current stage
    const enteredAt = findStageEntryDate(record, stage);
    if (!enteredAt) return;

    const stuckDays = daysBetween(enteredAt, now);
    if (stuckDays < rule.thresholdDays) return;

    // Determine escalation level
    const escalationLevel = getEscalationLevel(rule, stuckDays);

    results.push({
      ruleId: rule.id,
      ruleLabel: rule.label,
      entityType: rule.entityType,
      entityId: record.id,
      entityLabel: record.projectId || record.title || record.name || record.id,
      stage,
      stuckDays,
      triggered: true,
      escalationLevel,
      tasksCreated: 0,
      notificationsSent: 0,
    });
  });

  return results;
}

/**
 * Find when a record entered its current stage.
 */
function findStageEntryDate(record: StageAwareRecord, stage: string): Date | null {
  // If the record is a task with a dueDate, use that
  if (record.entityType === 'task' && record.dueDate) {
    const d = safeDate(record.dueDate);
    if (d) return d;
  }

  // Check stageHistory (for projects)
  if (record.stageHistory && record.stageHistory.length > 0) {
    // Find the most recent entry for the current stage
    const history = [...record.stageHistory].sort(
      (a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime(),
    );

    // Reverse search: find the last time this stage was entered
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].stage === stage) {
        return safeDate(history[i].changedAt);
      }
    }
  }

  // Fallback: use createdAt
  return safeDate(record.createdAt);
}

/**
 * Determine the escalation level based on how many days over threshold.
 */
function getEscalationLevel(rule: ReminderRule, stuckDays: number): 'info' | 'warning' | 'critical' {
  if (!rule.escalations || rule.escalations.length === 0) return 'warning';

  // Sort escalations by afterDays descending
  const sorted = [...rule.escalations].sort((a, b) => b.afterDays - a.afterDays);

  for (const escalation of sorted) {
    const totalDays = rule.thresholdDays + escalation.afterDays;
    if (stuckDays >= totalDays) {
      return escalation.level;
    }
  }

  return 'warning';
}

/**
 * Message template substitution.
 */
function applyTemplate(template: string, data: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = data[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

// ═══════════════════════════════════════════════════════════
//  EXECUTION
// ═══════════════════════════════════════════════════════════

/**
 * Execute reminder rules — creates tasks + sends notifications.
 * Returns results for each triggered rule.
 */
export async function executeReminderRules(
  config: ReminderConfig,
  projects: StageAwareRecord[],
  leads: StageAwareRecord[],
  tasks: StageAwareRecord[],
  serviceTickets: StageAwareRecord[],
  companyId: string,
): Promise<{
  results: ReminderEvaluationResult[];
  tasksCreated: number;
  notificationsSent: number;
}> {
  const allResults: ReminderEvaluationResult[] = [];
  let tasksCreated = 0;
  let notificationsSent = 0;

  for (const rule of config.rules) {
    if (!rule.enabled) continue;

    let records: StageAwareRecord[] = [];
    if (rule.entityType === 'project') records = projects;
    else if (rule.entityType === 'lead') records = leads;
    else if (rule.entityType === 'task') records = tasks;
    else if (rule.entityType === 'service_ticket') records = serviceTickets;

    const evaluations = evaluateRule(rule, records);

    for (const evalResult of evaluations) {
      allResults.push(evalResult);

      // Create task if enabled
      if (rule.createTask) {
        try {
          const ruleForTask = rule;
          const escalation = getEscalationStep(ruleForTask, evalResult.stuckDays);
          const template = escalation?.messageTemplate || '{{entityType}} {{entityLabel}} has been in {{stage}} for {{days}} days. Action needed.';
          const message = applyTemplate(template, {
            entityType: evalResult.entityType,
            entityLabel: evalResult.entityLabel,
            stage: evalResult.stage,
            days: evalResult.stuckDays,
            projectId: evalResult.entityLabel,
          });

          await createTask({
            title: `[Auto] ${evalResult.ruleLabel}`,
            description: message,
            // '' (not a fake sentinel like 'unassigned') — sendNotification()
            // inside createTask() already guards on `!recipientUserId` and
            // skips cleanly; a fake, non-existent user id previously caused
            // it to write a Notification doc to a recipient that can never
            // exist, and left the Task permanently unresolvable by any
            // real user's "my tasks" view. Real users still get notified
            // separately via notifyRoleUsers() below, when rule.notifyRoles
            // is configured.
            assignedToId: '',
            assignedToName: 'Auto-created',
            dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
            priority: evalResult.escalationLevel === 'critical' ? 'High' : 'Medium',
            entityType: evalResult.entityType,
            entityId: evalResult.entityId,
            companyId,
          });

          tasksCreated++;
          evalResult.tasksCreated++;
        } catch (err) {
          console.warn(`Failed to create task for rule ${rule.id}:`, err);
        }
      }

      // Send notifications
      try {
        // Notify the configured roles
        if (rule.notifyRoles && rule.notifyRoles.length > 0) {
          const levelLabel = evalResult.escalationLevel.toUpperCase();
          const template = `[${levelLabel}] ${evalResult.ruleLabel}: ${evalResult.entityLabel} has been in ${evalResult.stage} for ${evalResult.stuckDays} days.`;
          await notifyRoleUsers(
            rule.notifyRoles,
            evalResult.escalationLevel === 'critical' ? NotificationType.ESCALATION_CRITICAL : NotificationType.REMINDER,
            evalResult.escalationLevel === 'critical' ? `⚠️ Critical: ${evalResult.ruleLabel}` : `🔔 Reminder: ${evalResult.ruleLabel}`,
            template,
            evalResult.entityType,
            evalResult.entityId,
            companyId,
          );
          notificationsSent++;
          evalResult.notificationsSent++;
        }
      } catch (err) {
        console.warn(`Failed to send notification for rule ${rule.id}:`, err);
      }
    }
  }

  // Save last evaluation timestamp
  const updatedConfig: ReminderConfig = {
    ...config,
    lastEvalAt: new Date().toISOString(),
    lastEvalSummary: `${allResults.length} triggered, ${tasksCreated} tasks created, ${notificationsSent} notifications sent`,
  };
  await saveReminderConfig(updatedConfig);

  // Log activity
  await logActivity('Automation', 'Reminder Rules Evaluation', 'system', {
    rulesEvaluated: config.rules.filter((r) => r.enabled).length,
    triggered: allResults.length,
    tasksCreated,
    notificationsSent,
    actionLabel: `Reminder evaluation: ${allResults.length} triggered, ${tasksCreated} tasks, ${notificationsSent} notifications`,
  }).catch(() => {});

  return { results: allResults, tasksCreated, notificationsSent };
}

/**
 * Get the escalation step applicable for a given stuck duration.
 */
function getEscalationStep(rule: ReminderRule, stuckDays: number) {
  if (!rule.escalations || rule.escalations.length === 0) return undefined;

  // Find the highest applicable escalation
  const applicable = rule.escalations
    .filter((e) => stuckDays >= rule.thresholdDays + e.afterDays)
    .sort((a, b) => b.afterDays - a.afterDays);

  return applicable[0];
}

/**
 * Preview what would happen without executing.
 */
export async function previewReminderEvaluation(
  config: ReminderConfig,
  companyId: string,
): Promise<{
  results: ReminderEvaluationResult[];
  summary: string;
}> {
  const state = useAppStore.getState();

  // Fetch all relevant data
  const allProjects = await getAll<StageAwareRecord>(COLLECTIONS.PROJECTS);
  const allLeads = await getAll<StageAwareRecord>(COLLECTIONS.LEADS);
  const allTasks = await getAll<StageAwareRecord>('tasks');
  const allServiceTickets = await getAll<StageAwareRecord>(COLLECTIONS.SERVICE_TICKETS);

  // Company-scope
  const projects = allProjects.filter((p) => p.companyId === companyId && !p.isDeleted);
  const leads = allLeads.filter((l) => l.companyId === companyId && !l.isDeleted);
  const tasks = allTasks.filter((t) => (t as any).companyId === companyId && !t.isDeleted);
  const serviceTickets = allServiceTickets.filter((s) => s.companyId === companyId && !s.isDeleted);

  const allResults: ReminderEvaluationResult[] = [];

  for (const rule of config.rules) {
    if (!rule.enabled) continue;

    let records: StageAwareRecord[] = [];
    if (rule.entityType === 'project') records = projects;
    else if (rule.entityType === 'lead') records = leads;
    else if (rule.entityType === 'task') records = tasks;
    else if (rule.entityType === 'service_ticket') records = serviceTickets;

    const evaluations = evaluateRule(rule, records);
    allResults.push(...evaluations);
  }

  const summary = `${allResults.length} items need attention across ${config.rules.filter((r) => r.enabled).length} active rules.`;

  return { results: allResults, summary };
}
