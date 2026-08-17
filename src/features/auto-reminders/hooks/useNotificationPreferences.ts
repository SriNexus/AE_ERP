/**
 * P10-03 — Notification Preferences Hook
 *
 * Manages per-user notification preferences via the existing settings service.
 * User-scoped settings (section: 'notifications') persisted to Firestore.
 *
 * Follows the same pattern as useSettingsSection.ts but for user-level prefs.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAppStore } from '../../../store/useAppStore';
import { loadSettings, saveSettings } from '../../../features/settings/services/settingsService';
import type { NotificationPreference, UserNotificationPreferences } from '../types';

export const DEFAULT_EVENTS: NotificationPreference[] = [
  { eventType: 'stuck_project', label: 'Project stuck in stage', inApp: true, email: false },
  { eventType: 'task_overdue', label: 'Task overdue', inApp: true, email: false },
  { eventType: 'lead_followup', label: 'Lead follow-up due', inApp: true, email: false },
  { eventType: 'service_ticket_stuck', label: 'Service ticket stuck', inApp: true, email: false },
  { eventType: 'escalation_critical', label: 'Critical escalation', inApp: true, email: true },
  { eventType: 'reminder_info', label: 'Info reminders', inApp: true, email: false },
  { eventType: 'project_assigned', label: 'Project assigned to me', inApp: true, email: false },
  { eventType: 'task_assigned', label: 'New task assigned', inApp: true, email: false },
];

export const DEFAULT_PREFERENCES: UserNotificationPreferences = {
  userId: '',
  events: DEFAULT_EVENTS,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
};

/**
 * Load user notification preferences from settings.
 */
export function useNotificationPreferences() {
  const user = useAppStore((s) => s.user);
  const userId = user?.id || 'system';

  return useQuery<UserNotificationPreferences>({
    queryKey: ['notification-preferences', userId],
    queryFn: async () => {
      const raw = await loadSettings('notifications');
      const prefs = raw?.notificationPreferences as UserNotificationPreferences | undefined;
      if (prefs) {
        return {
          ...DEFAULT_PREFERENCES,
          ...prefs,
          userId,
          events: DEFAULT_EVENTS.map((defaultEvent) => {
            const saved = prefs.events?.find((e) => e.eventType === defaultEvent.eventType);
            return saved || defaultEvent;
          }),
        };
      }
      return { ...DEFAULT_PREFERENCES, userId };
    },
    staleTime: 60_000,
  });
}

/**
 * Save user notification preferences.
 */
export function useSaveNotificationPreferences() {
  const qc = useQueryClient();
  const user = useAppStore((s) => s.user);
  const userId = user?.id || 'system';

  return useMutation({
    mutationFn: async (prefs: UserNotificationPreferences) => {
      await saveSettings('notifications', {
        notificationPreferences: { ...prefs, userId },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-preferences', userId] });
      toast.success('Notification preferences saved');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save preferences');
    },
  });
}
