import { describe, it, expect } from 'vitest';
import {
  evaluateRule,
  DEFAULT_REMINDER_RULES,
  DEFAULT_REMINDER_CONFIG,
} from '../autoReminderWorkflow';
import type { ReminderRule } from '../../features/auto-reminders/types';

// ── Helpers ───────────────────────────────────────────────

function daysAgo(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
}

function makeProject(overrides: Record<string, any> = {}) {
  return {
    id: 'p1',
    projectId: 'PRJ-001',
    currentStage: 'Survey',
    stageHistory: [
      { stage: 'Survey', changedAt: daysAgo(30), changedBy: 'u1' },
    ],
    createdAt: daysAgo(60),
    isDeleted: false,
    companyId: 'test-co',
    ...overrides,
  };
}

function makeLead(overrides: Record<string, any> = {}) {
  return {
    id: 'l1',
    name: 'Test Lead',
    status: 'Follow-up',
    createdAt: daysAgo(14),
    isDeleted: false,
    companyId: 'test-co',
    ...overrides,
  };
}

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: 't1',
    title: 'Test Task',
    status: 'Open',
    dueDate: daysAgo(5),
    createdAt: daysAgo(10),
    isDeleted: false,
    companyId: 'test-co',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────

const surveyRule = DEFAULT_REMINDER_RULES.find((r) => r.id === 'project-stuck-survey')!;
const leadRule = DEFAULT_REMINDER_RULES.find((r) => r.id === 'lead-followup')!;
const taskRule = DEFAULT_REMINDER_RULES.find((r) => r.id === 'task-overdue')!;

describe('DEFAULT_REMINDER_RULES', () => {
  it('has expected rules', () => {
    expect(DEFAULT_REMINDER_RULES.length).toBeGreaterThanOrEqual(8);
    expect(surveyRule).toBeDefined();
    expect(leadRule).toBeDefined();
    expect(taskRule).toBeDefined();
    expect(DEFAULT_REMINDER_RULES.find((r) => r.id === 'service-ticket-stuck')).toBeDefined();
  });

  it('all rules have unique ids', () => {
    const ids = DEFAULT_REMINDER_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('DEFAULT_REMINDER_CONFIG', () => {
  it('has valid structure', () => {
    expect(DEFAULT_REMINDER_CONFIG.enabled).toBe(false);
    expect(DEFAULT_REMINDER_CONFIG.rules).toEqual(DEFAULT_REMINDER_RULES);
    expect(DEFAULT_REMINDER_CONFIG.autoEvalMinutes).toBe(60);
  });
});

describe('evaluateRule', () => {
  it('triggers when project is stuck past threshold', () => {
    const results = evaluateRule(surveyRule, [
      makeProject({ stageHistory: [{ stage: 'Survey', changedAt: daysAgo(14), changedBy: 'u1' }] }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
    expect(results[0].stuckDays).toBeGreaterThanOrEqual(7);
  });

  it('does not trigger when project is within threshold', () => {
    const results = evaluateRule(surveyRule, [
      makeProject({ stageHistory: [{ stage: 'Survey', changedAt: daysAgo(3), changedBy: 'u1' }] }),
    ]);
    expect(results).toHaveLength(0);
  });

  it('skips deleted projects', () => {
    const results = evaluateRule(surveyRule, [
      makeProject({ isDeleted: true }),
    ]);
    expect(results).toHaveLength(0);
  });

  it('only matches specified stage', () => {
    const results = evaluateRule(surveyRule, [
      makeProject({ currentStage: 'Installation', stageHistory: [{ stage: 'Installation', changedAt: daysAgo(5), changedBy: 'u1' }] }),
    ]);
    // Survey rule only checks Survey stage, so Installation projects don't match
    expect(results).toHaveLength(0);
  });

  it('escalates to warning level by default', () => {
    const results = evaluateRule(surveyRule, [
      makeProject({ stageHistory: [{ stage: 'Survey', changedAt: daysAgo(10), changedBy: 'u1' }] }),
    ]);
    expect(results[0].escalationLevel).toBe('warning');
  });

  it('escalates to critical when significantly past threshold', () => {
    // Survey rule threshold is 7 days, with critical escalation at +14 days
    // So total threshold for critical = 7 + 14 = 21 days
    const results = evaluateRule(surveyRule, [
      makeProject({ stageHistory: [{ stage: 'Survey', changedAt: daysAgo(30), changedBy: 'u1' }] }),
    ]);
    expect(results[0].escalationLevel).toBe('critical');
  });

  it('handles empty records array', () => {
    const results = evaluateRule(surveyRule, []);
    expect(results).toHaveLength(0);
  });

  it('generates correct entityLabel from projectId', () => {
    const results = evaluateRule(surveyRule, [
      makeProject({ projectId: 'PRJ-999', stageHistory: [{ stage: 'Survey', changedAt: daysAgo(14), changedBy: 'u1' }] }),
    ]);
    expect(results[0].entityLabel).toBe('PRJ-999');
  });

  it('sets correct ruleId and ruleLabel in results', () => {
    const results = evaluateRule(surveyRule, [
      makeProject({ stageHistory: [{ stage: 'Survey', changedAt: daysAgo(14), changedBy: 'u1' }] }),
    ]);
    expect(results[0].ruleId).toBe(surveyRule.id);
    expect(results[0].ruleLabel).toBe(surveyRule.label);
  });
});

describe('evaluateRule — lead follow-up', () => {
  it('triggers for leads stuck in Follow-up', () => {
    const results = evaluateRule(leadRule, [
      makeLead({ status: 'Follow-up', createdAt: daysAgo(14) }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].entityType).toBe('lead');
  });

  it('does not trigger for leads in other stages', () => {
    const results = evaluateRule(leadRule, [
      makeLead({ status: 'New', createdAt: daysAgo(14) }),
    ]);
    // Lead rule says stage: 'Follow-up', so New leads don't match
    expect(results).toHaveLength(0);
  });
});

describe('evaluateRule — task overdue', () => {
  it('triggers for tasks past due date', () => {
    const results = evaluateRule(taskRule, [
      makeTask({ dueDate: daysAgo(5), status: 'Open' }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].entityType).toBe('task');
  });
});

describe('evaluateRule — disabled rule', () => {
  it('does not evaluate when rule is disabled (caller responsibility)', () => {
    // evaluateRule doesn't check enabled — it's the caller's job
    const disabledRule = { ...surveyRule, enabled: false };
    const results = evaluateRule(disabledRule, [
      makeProject({ stageHistory: [{ stage: 'Survey', changedAt: daysAgo(14), changedBy: 'u1' }] }),
    ]);
    expect(results).toHaveLength(1);
  });
});
