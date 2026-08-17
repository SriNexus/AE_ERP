/**
 * useSettings — Centralized Settings hook.
 *
 * Shared between Desktop and Mobile.
 * Business logic lives here; only layout differs between platforms.
 *
 * Phase 1: Architecture only.
 * Phase 2: Full section enumeration from config.
 * Phase 3: Wired to settingsService for persistence.
 *
 * The Companies module is the single source of truth for all company data.
 * App Settings no longer owns company information.
 *
 * P02: Section navigation is now URL-driven via /settings/:sectionId.
 * activeSection state is removed in favor of useParams() from react-router-dom.
 * Consumers should NOT import activeSection/setActiveSection from this hook.
 * SettingsPage and MobileSettingsWorkspace derive activeSection from the URL.
 */

import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { type SettingsSectionId, DEFAULT_SECTION } from '../config';
import { useSettingsSection } from './useSettingsSection';
import { saveSettings, resetSettings } from '../services/settingsService';

export interface UseSettingsReturn {
  /** Data for the currently active section (loaded via React Query) */
  sectionData: Record<string, unknown>;
  /** Whether the section data is loading */
  isLoading: boolean;
  /** Whether the section data load failed */
  isError: boolean;
  /** Generic save handler — dispatches to settingsService */
  save: (section: string, data: Record<string, unknown>) => Promise<Record<string, unknown> | void>;
  /** Generic reset handler — dispatches to settingsService */
  reset: (section: string) => void;
  /** True while any save is in-flight */
  isSaving: boolean;
  /** Resolve the currently active section from URL params */
  activeSection: SettingsSectionId;
  /** Navigate to a settings section (wraps URL navigation) */
  setActiveSection: (section: SettingsSectionId) => void;
}

/**
 * useSettings
 *
 * Shared settings hook for both Desktop and Mobile.
 * The active section is derived from URL params (/settings/:sectionId).
 *
 * @returns UseSettingsReturn
 */
export function useSettings(): UseSettingsReturn {
  const { sectionId } = useParams<{ sectionId: SettingsSectionId }>();
  const activeSection: SettingsSectionId = sectionId || DEFAULT_SECTION;
  const [isSaving, setIsSaving] = useState(false);

  // Load data for the active section via React Query
  const {
    data: sectionData = {},
    isLoading,
    isError,
  } = useSettingsSection(activeSection);

  const save = useCallback(async (section: string, data: Record<string, unknown>) => {
    setIsSaving(true);
    try {
      await saveSettings(section as SettingsSectionId, data);
      toast.success('Setting saved');
      return data;
    } catch (err: any) {
      toast.error(err.message || 'Failed to save setting');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, []);

  const reset = useCallback(async (section: string) => {
    setIsSaving(true);
    try {
      await resetSettings(section as SettingsSectionId);
      toast.success('Settings reset to defaults');
    } catch (err: any) {
      toast.error(err.message || 'Failed to reset settings');
    } finally {
      setIsSaving(false);
    }
  }, []);

  return {
    activeSection,
    setActiveSection: () => {}, // Deprecated — section switching is now done via navigate()
    sectionData,
    isLoading,
    isError,
    save,
    reset,
    isSaving,
  };
}
