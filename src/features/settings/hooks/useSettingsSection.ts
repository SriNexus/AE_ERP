/**
 * useSettingsSection — React Query hook for loading a single settings section.
 *
 * Architecture:
 *   - Uses React Query for caching, loading, error, and retry.
 *   - Calls settingsService.loadSettings() — no direct Firestore access.
 *   - Merges with defaults automatically.
 *
 * Related hooks:
 *   - useSaveSettings — mutation for saving settings
 *   - useResetSettings — mutation for resetting to defaults
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAppStore } from '../../../store/useAppStore';
import { getSectionScope, loadSettings, saveSettings, resetSettings } from '../services/settingsService';
import { queryKeys } from '../../../lib/queryKeys';
import { type SettingsSectionId } from '../config';

/**
 * Resolve the current companyId for cache scoping.
 *
 * Mirrors resolveWriteCompanyId()'s real-value priority (lib/firestore.ts) —
 * the previous `activeCompanyId !== 'all'` check treated the neutral
 * 'default' placeholder as a real id, so during boot (activeCompanyId still
 * 'default' pre-useGlobalBoot) the cache key was literally 'default', then
 * jumped to the real company id once resolved — a spurious query-key change
 * that re-triggered loadSettings() a second time for the same section
 * (Admin settings runtime-storm contributor). 'unresolved' is a distinct,
 * stable sentinel so devtools/logs never confuse it with a real company id.
 */
function isRealId(id: string | undefined | null): id is string {
  return !!id && id !== 'all' && id !== 'default';
}

function useCompanyId(): string {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const userCompanyId = useAppStore((s) => s.user?.companyId);
  const company = useAppStore((s) => s.company);
  if (isRealId(activeCompanyId)) return activeCompanyId;
  if (isRealId(userCompanyId)) return userCompanyId;
  if (isRealId(company?.id)) return company!.id;
  return 'unresolved';
}

function useSettingsScopeId(section?: SettingsSectionId): string {
  const companyId = useCompanyId();
  const userId = useAppStore((state) => state.user?.id || 'system');
  return section && getSectionScope(section) === 'user' ? userId : companyId;
}

/**
 * Load settings for a single section.
 *
 * @param section - The settings section to load
 * @param options.enabled - Whether the query is enabled (default: true)
 */
export function useSettingsSection(
  section: SettingsSectionId,
  options?: { enabled?: boolean },
) {
  const scopeId = useSettingsScopeId(section);
  return useQuery<Record<string, unknown>>({
    queryKey: ['settings', scopeId, section],
    queryFn: () => loadSettings(section),
    staleTime: 30 * 1000,  // 30 seconds (P02: more responsive for settings changes)
    retry: 2,
    enabled: options?.enabled ?? true,
    // Always return a valid object — never crash on missing data
    placeholderData: {},
  });
}

/**
 * Mutation hook for saving settings for a section.
 * Invalidates the settings cache on success.
 */
export function useSaveSettings() {
  const qc = useQueryClient();
  const companyId = useCompanyId();
  const userId = useAppStore((state) => state.user?.id || 'system');

  return useMutation({
    mutationFn: async ({
      section,
      data,
    }: {
      section: SettingsSectionId;
      data: Record<string, unknown>;
    }) => {
      await saveSettings(section, data);
      return { section };
    },
    onSuccess: ({ section }) => {
      const scopeId = getSectionScope(section) === 'user' ? userId : companyId;
      qc.invalidateQueries({ queryKey: ['settings', scopeId, section] });
      qc.invalidateQueries({ queryKey: ['settings', companyId, 'all'] });
      toast.success('Settings saved');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save settings');
    },
  });
}

/**
 * Mutation hook for resetting settings to defaults.
 */
export function useResetSettings() {
  const qc = useQueryClient();
  const companyId = useCompanyId();
  const userId = useAppStore((state) => state.user?.id || 'system');

  return useMutation({
    mutationFn: async (section: SettingsSectionId) => {
      await resetSettings(section);
      return { section };
    },
    onSuccess: ({ section }) => {
      const scopeId = getSectionScope(section) === 'user' ? userId : companyId;
      qc.invalidateQueries({ queryKey: ['settings', scopeId, section] });
      qc.invalidateQueries({ queryKey: ['settings', companyId, 'all'] });
      toast.success('Settings reset to defaults');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to reset settings');
    },
  });
}
