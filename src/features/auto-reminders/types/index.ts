/**
 * P10-03 — Auto-Reminders & Automation: Type Definitions
 *
 * Types for reminder rules, escalation policies, and user notification preferences.
 */

/** Entities that can trigger reminders. */
export type ReminderEntityType =
  | 'project'
  | 'lead'
  | 'task'
  | 'service_ticket'
  | 'net_metering_application'
  | 'subsidy_application';

/** Severity level for escalation. */
export type EscalationLevel = 'info' | 'warning' | 'critical';

/** Escalation step — what happens after a certain number of days stuck. */
export interface EscalationStep {
  /** Days after the threshold to apply this escalation. */
  afterDays: number;
  /** Severity level. */
  level: EscalationLevel;
  /** Action to take. */
  action: 'notify' | 'create_task' | 'notify_manager' | 'notify_admin';
  /** Custom message template (supports {{stage}}, {{days}}, {{projectId}} placeholders). */
  messageTemplate?: string;
}

/** A single reminder rule configuration. */
export interface ReminderRule {
  /** Unique identifier for this rule. */
  id: string;
  /** Which entity type this rule applies to. */
  entityType: ReminderEntityType;
  /** Human-readable label. */
  label: string;
  /** Which stage/status to monitor (empty = any non-terminal stage). */
  stage?: string;
  /** Number of days in stage before triggering. */
  thresholdDays: number;
  /** Whether this rule is active. */
  enabled: boolean;
  /** Escalation steps (applied in order after thresholdDays). */
  escalations: EscalationStep[];
  /** Roles to notify. */
  notifyRoles: string[];
  /** Whether to create a task for the assigned person. */
  createTask: boolean;
}

/** Overall reminder automation configuration for a company. */
export interface ReminderConfig {
  /** Whether the reminder system is enabled. */
  enabled: boolean;
  /** List of reminder rules. */
  rules: ReminderRule[];
  /** Frequency of automatic evaluation (in minutes; 0 = manual only). */
  autoEvalMinutes: number;
  /** Last evaluation timestamp. */
  lastEvalAt?: string;
  /** Last evaluation result summary. */
  lastEvalSummary?: string;
}

/** Channel for receiving notifications. */
export type NotificationChannel = 'in_app' | 'email';

/** Per-event-type notification preference for a user. */
export interface NotificationPreference {
  /** The event type key (e.g. 'stuck_project', 'task_overdue', 'lead_followup'). */
  eventType: string;
  /** Human-readable label. */
  label: string;
  /** Whether in-app notifications are enabled. */
  inApp: boolean;
  /** Whether email notifications are enabled (placeholder for future). */
  email: boolean;
}

/** User-level notification preferences bundle. */
export interface UserNotificationPreferences {
  /** User id. */
  userId: string;
  /** Per-event-type preferences. */
  events: NotificationPreference[];
  /** Quiet hours start (HH:mm, 24h). */
  quietHoursStart?: string;
  /** Quiet hours end (HH:mm, 24h). */
  quietHoursEnd?: string;
  /** Whether quiet hours are enabled. */
  quietHoursEnabled: boolean;
}

/** Result of a single reminder evaluation. */
export interface ReminderEvaluationResult {
  ruleId: string;
  ruleLabel: string;
  entityType: ReminderEntityType;
  entityId: string;
  entityLabel: string;
  stage: string;
  stuckDays: number;
  triggered: boolean;
  escalationLevel: EscalationLevel;
  tasksCreated: number;
  notificationsSent: number;
}
