/**
 * P10-03 — Automation Section
 *
 * Settings UI for auto-reminder configuration.
 * Follows the same pattern as NotificationsSection.tsx.
 */

import React, { useState, useEffect } from 'react';
import {
  Bell,
  BellOff,
  Play,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Settings2,
} from 'lucide-react';
import { SettingsSection } from '../SettingsSection';
import { SettingsCard } from '../SettingsCard';
import { Button, Card, CardBody } from '../../ui';
import {
  useReminderConfig,
  useSaveReminderConfig,
  usePreviewReminders,
  useExecuteReminders,
} from '../../../features/auto-reminders/hooks/useAutoReminders';
import { DEFAULT_REMINDER_CONFIG } from '../../../lib/autoReminderWorkflow';
import type { ReminderRule } from '../../../features/auto-reminders/types';

export function AutomationSection() {
  const { data: config = DEFAULT_REMINDER_CONFIG, isLoading } = useReminderConfig();
  const saveMutation = useSaveReminderConfig();
  const previewMutation = usePreviewReminders();
  const executeMutation = useExecuteReminders();

  const [localEnabled, setLocalEnabled] = useState(config.enabled);
  const [localRules, setLocalRules] = useState(config.rules);
  const [previewResult, setPreviewResult] = useState<{ results: any[]; summary: string } | null>(null);
  const [executeResult, setExecuteResult] = useState<{ results: any[]; tasksCreated: number; notificationsSent: number } | null>(null);

  // Sync local state when config loads
  useEffect(() => {
    if (config) {
      setLocalEnabled(config.enabled);
      setLocalRules(config.rules);
    }
  }, [config]);

  const hasChanges = localEnabled !== config.enabled
    || JSON.stringify(localRules) !== JSON.stringify(config.rules);

  function toggleRule(id: string) {
    setLocalRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  }

  function toggleAllRules(enabled: boolean) {
    setLocalRules((prev) => prev.map((r) => ({ ...r, enabled })));
  }

  function resetToDefaults() {
    setLocalEnabled(DEFAULT_REMINDER_CONFIG.enabled);
    setLocalRules(DEFAULT_REMINDER_CONFIG.rules);
    setPreviewResult(null);
    setExecuteResult(null);
  }

  function handleSave() {
    saveMutation.mutate({
      ...config,
      enabled: localEnabled,
      rules: localRules,
    });
  }

  function handlePreview() {
    setExecuteResult(null);
    previewMutation.mutate(
      { ...config, enabled: localEnabled, rules: localRules },
      {
        onSuccess: (data) => setPreviewResult(data),
      },
    );
  }

  function handleExecute() {
    setPreviewResult(null);
    executeMutation.mutate({
      ...config,
      enabled: localEnabled,
      rules: localRules,
    });
  }

  const enabledCount = localRules.filter((r) => r.enabled).length;

  if (isLoading) {
    return (
      <SettingsSection title="Automation" description="Scheduler, triggers & workflows">
        <SettingsCard title="Loading...">
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-muted)]" />
          </div>
        </SettingsCard>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Automation" description="Scheduler, triggers & workflows">
      {/* Global toggle */}
      <SettingsCard
        title="Auto-Reminder Engine"
        description="Automatically detect stuck projects, overdue tasks, and pending follow-ups"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${localEnabled ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
              {localEnabled ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {localEnabled ? 'Reminders Active' : 'Reminders Paused'}
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {enabledCount} of {localRules.length} rules active
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={localEnabled}
              onChange={(e) => setLocalEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className={[
              'w-11 h-6 rounded-full peer',
              'bg-[var(--color-bg-sunken)]',
              'peer-focus:outline-none',
              "after:content-[''] after:absolute after:top-[2px] after:left-[2px]",
              'after:bg-surface after:border after:rounded-full after:h-5 after:w-5 after:transition-all',
              'peer-checked:after:translate-x-full peer-checked:after:border-white',
              'peer-checked:bg-indigo-600',
            ].join(' ')} />
          </label>
        </div>

        {config.lastEvalAt && (
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            Last evaluation: {new Date(config.lastEvalAt).toLocaleString('en-IN')}
            {config.lastEvalSummary && ` — ${config.lastEvalSummary}`}
          </p>
        )}
      </SettingsCard>

      {/* Action buttons */}
      <SettingsCard title="Actions">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={<RotateCcw className="h-4 w-4" />}
            onClick={handlePreview}
            loading={previewMutation.isPending}
            disabled={!localEnabled}
          >
            Preview
          </Button>
          <Button
            size="sm"
            icon={<Play className="h-4 w-4" />}
            onClick={handleExecute}
            loading={executeMutation.isPending}
            disabled={!localEnabled}
          >
            Run Now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Settings2 className="h-4 w-4" />}
            onClick={resetToDefaults}
          >
            Reset Defaults
          </Button>
          {hasChanges && (
            <Button
              size="sm"
              variant="primary"
              onClick={handleSave}
              loading={saveMutation.isPending}
            >
              Save Changes
            </Button>
          )}
        </div>
      </SettingsCard>

      {/* Preview / Execute Results */}
      {previewResult && (
        <SettingsCard title="Preview Results">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-[var(--color-text)]">{previewResult.summary}</p>
            {previewResult.results.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {previewResult.results.map((r, i) => (
                  <div
                    key={`${r.ruleId}-${r.entityId}-${i}`}
                    className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-xs"
                  >
                    <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${
                      r.escalationLevel === 'critical' ? 'text-red-500' :
                      r.escalationLevel === 'warning' ? 'text-amber-500' :
                      'text-blue-500'
                    }`} />
                    <span className="flex-1 truncate">
                      <span className="font-semibold">{r.ruleLabel}</span>
                      : {r.entityLabel} — {r.stuckDays}d in {r.stage}
                    </span>
                    <span className={`text-[10px] font-semibold uppercase ${
                      r.escalationLevel === 'critical' ? 'text-red-600' :
                      r.escalationLevel === 'warning' ? 'text-amber-600' :
                      'text-blue-600'
                    }`}>{r.escalationLevel}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SettingsCard>
      )}

      {executeResult && (
        <SettingsCard title="Execution Results">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {executeResult.results.length} items triggered
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {executeResult.tasksCreated} tasks created · {executeResult.notificationsSent} notifications sent
              </p>
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Rules table */}
      <SettingsCard
        title="Reminder Rules"
        description="Configure which stages trigger reminders and how they escalate"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[var(--color-text-muted)]">
            {enabledCount} active · {localRules.length - enabledCount} disabled
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => toggleAllRules(true)}
              className="text-xs font-semibold text-indigo-600 hover:underline"
            >
              Enable All
            </button>
            <button
              onClick={() => toggleAllRules(false)}
              className="text-xs font-semibold text-gray-500 hover:underline"
            >
              Disable All
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="text-left py-2 px-2 font-semibold text-[var(--color-text-muted)]">Rule</th>
                <th className="text-left py-2 px-2 font-semibold text-[var(--color-text-muted)]">Entity</th>
                <th className="text-left py-2 px-2 font-semibold text-[var(--color-text-muted)]">Stage</th>
                <th className="text-right py-2 px-2 font-semibold text-[var(--color-text-muted)]">Threshold</th>
                <th className="text-left py-2 px-2 font-semibold text-[var(--color-text-muted)]">Escalation</th>
                <th className="text-center py-2 px-2 font-semibold text-[var(--color-text-muted)]">Active</th>
              </tr>
            </thead>
            <tbody>
              {localRules.map((rule) => (
                <tr
                  key={rule.id}
                  className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-sunken)] transition-colors"
                >
                  <td className="py-2.5 px-2 font-semibold text-[var(--color-text)]">{rule.label}</td>
                  <td className="py-2.5 px-2 text-[var(--color-text-secondary)]">{rule.entityType}</td>
                  <td className="py-2.5 px-2 text-[var(--color-text-secondary)]">{rule.stage || 'Any'}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{rule.thresholdDays}d</td>
                  <td className="py-2.5 px-2">
                    <div className="flex gap-1">
                      {rule.escalations.map((e, i) => (
                        <span
                          key={i}
                          className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                            e.level === 'critical' ? 'bg-red-100 text-red-700' :
                            e.level === 'warning' ? 'bg-amber-100 text-amber-700' :
                            'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {e.level} {e.afterDays > 0 ? `+${e.afterDays}d` : ''}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => toggleRule(rule.id)}
                        className="sr-only peer"
                      />
                      <div className={[
                        'w-8 h-4 rounded-full peer',
                        'bg-[var(--color-bg-sunken)]',
                        "after:content-[''] after:absolute after:top-[1px] after:left-[1px]",
                        'after:bg-surface after:rounded-full after:h-3.5 after:w-3.5 after:transition-all',
                        'peer-checked:after:translate-x-full',
                        'peer-checked:bg-indigo-600',
                      ].join(' ')} />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsCard>

      <p className="text-xs text-[var(--color-text-muted)] italic">
        Auto-reminders run on-demand or every {config.autoEvalMinutes} minutes if enabled.
        Each triggered rule can create a task and send in-app notifications to configured roles.
      </p>
    </SettingsSection>
  );
}
