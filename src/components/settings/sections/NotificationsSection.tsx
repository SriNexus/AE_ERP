/**
 * P10-03 — Notifications Section (Updated)
 *
 * Manages per-user in-app notification preferences with backend persistence.
 * Previously hardcoded static toggles; now loads from Firestore settings.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Moon, RotateCcw } from 'lucide-react';
import { SettingsSection } from '../SettingsSection';
import { SettingsCard } from '../SettingsCard';
import { Button } from '../../ui';
import {
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from '../../../features/auto-reminders/hooks/useNotificationPreferences';
import { DEFAULT_PREFERENCES } from '../../../features/auto-reminders/hooks/useNotificationPreferences';
import type { UserNotificationPreferences, NotificationPreference } from '../../../features/auto-reminders/types';

export function NotificationsSection() {
  const { data: prefs, isLoading } = useNotificationPreferences();
  const saveMutation = useSaveNotificationPreferences();
  const [localPrefs, setLocalPrefs] = useState<UserNotificationPreferences | null>(null);

  useEffect(() => {
    if (prefs) {
      setLocalPrefs(prefs);
    }
  }, [prefs]);

  const hasChanges = localPrefs && JSON.stringify(localPrefs) !== JSON.stringify(prefs);

  const toggleEvent = useCallback((eventType: string) => {
    setLocalPrefs((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        events: prev.events.map((e) =>
          e.eventType === eventType ? { ...e, inApp: !e.inApp } : e
        ),
      };
    });
  }, []);

  const toggleEmail = useCallback((eventType: string) => {
    setLocalPrefs((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        events: prev.events.map((e) =>
          e.eventType === eventType ? { ...e, email: !e.email } : e
        ),
      };
    });
  }, []);

  const toggleQuietHours = useCallback(() => {
    setLocalPrefs((prev) => {
      if (!prev) return prev;
      return { ...prev, quietHoursEnabled: !prev.quietHoursEnabled };
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    const user = { userId: prefs?.userId || '' };
    setLocalPrefs({ ...DEFAULT_PREFERENCES, ...user });
  }, [prefs]);

  const handleSave = useCallback(() => {
    if (localPrefs) {
      saveMutation.mutate(localPrefs);
    }
  }, [localPrefs, saveMutation]);

  const activeCount = localPrefs?.events.filter((e) => e.inApp).length ?? 0;

  if (isLoading || !localPrefs) {
    return (
      <SettingsSection title="Notifications" description="In-app alert preferences">
        <SettingsCard title="Loading...">
          <div className="flex items-center justify-center p-8">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        </SettingsCard>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Notifications" description="In-app alert preferences">
      <SettingsCard
        title="Notification Preferences"
        description="Toggle which events trigger in-app notifications"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Bell className="h-4 w-4" />
            <span>{activeCount} of {localPrefs.events.length} events active</span>
          </div>
          <div className="flex gap-2">
            <Button size="xs" variant="ghost" icon={<RotateCcw className="h-3 w-3" />} onClick={resetToDefaults}>
              Reset
            </Button>
            {hasChanges && (
              <Button size="xs" onClick={handleSave} loading={saveMutation.isPending}>
                Save
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-1">
          {localPrefs.events.map((event) => (
            <div
              key={event.eventType}
              className="flex items-center justify-between py-3 border-b border-[var(--color-border-subtle)] last:border-0"
            >
              <div className="flex-1">
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">{event.label}</p>
              </div>
              <div className="flex items-center gap-4 shrink-0 ml-3">
                {/* In-app toggle */}
                <label className="relative inline-flex items-center cursor-pointer shrink-0" title="In-app notification">
                  <input
                    type="checkbox"
                    checked={event.inApp}
                    onChange={() => toggleEvent(event.eventType)}
                    className="sr-only peer"
                  />
                  <div className={[
                    'w-9 h-5 rounded-full peer',
                    'bg-[var(--color-bg-sunken)]',
                    'peer-focus:outline-none',
                    "after:content-[''] after:absolute after:top-[1px] after:left-[1px]",
                    'after:bg-surface after:border-[var(--color-border)] after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all',
                    'peer-checked:after:translate-x-full peer-checked:after:border-white',
                    'peer-checked:bg-indigo-600',
                  ].join(' ')} />
                </label>
                {/* Email toggle (future) */}
                <label className="relative inline-flex items-center cursor-pointer shrink-0" title="Email notification (future)">
                  <input
                    type="checkbox"
                    checked={event.email}
                    onChange={() => toggleEmail(event.eventType)}
                    className="sr-only peer"
                  />
                  <div className={[
                    'w-9 h-5 rounded-full peer',
                    'bg-[var(--color-bg-sunken)]',
                    'peer-focus:outline-none',
                    "after:content-[''] after:absolute after:top-[1px] after:left-[1px]",
                    'after:bg-surface after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all',
                    'peer-checked:after:translate-x-full peer-checked:after:border-white',
                    'peer-checked:bg-purple-600',
                  ].join(' ')} />
                </label>
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>

      {/* Quiet hours */}
      <SettingsCard title="Quiet Hours" description="Suppress notifications during specified hours">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${localPrefs.quietHoursEnabled ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
              <Moon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {localPrefs.quietHoursEnabled ? 'Quiet Hours Active' : 'Quiet Hours Off'}
              </p>
              {localPrefs.quietHoursEnabled && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  {localPrefs.quietHoursStart} – {localPrefs.quietHoursEnd}
                </p>
              )}
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={localPrefs.quietHoursEnabled}
              onChange={toggleQuietHours}
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
      </SettingsCard>

      <p className="text-xs text-[var(--color-text-muted)] italic">
        Preferences are saved per user. Email and SMS notification channels will be available in a future phase.
      </p>
    </SettingsSection>
  );
}
