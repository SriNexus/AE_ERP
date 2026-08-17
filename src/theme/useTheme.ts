import { useCallback, useEffect, useState } from 'react';
import {
  type ThemeMode,
  applyThemeToDOM,
  loadThemeMode,
  nextThemeMode,
  resolveTheme,
  saveThemeMode,
} from './theme';
import { useSettingsSection, useSaveSettings } from '../features/settings/hooks/useSettingsSection';
import { settingsDocumentExists } from '../features/settings/services/settingsService';
import { DEFAULT_APPEARANCE_SETTINGS } from '../features/settings/defaults';
import type { AppearanceSettings } from '../features/settings/types';
import { useAppStore } from '../store/useAppStore';

const migrationChecked = new Set<string>();

// ═══════════════════════════════════════════════════════════
//  useTheme — Single source of truth for theme state
//
//  Architecture:
//    localStorage['neozy-theme-mode'] → ThemeMode ('light'|'dark'|'system')
//    resolveTheme(mode)               → 'light' | 'dark'  (actual applied)
//    applyThemeToDOM(resolved)        → toggles html.dark class
//
//  NO Zustand involvement. Theme is a UI concern, not app state.
//  index.html inline script handles pre-React DOM application (no FOUC).
// ═══════════════════════════════════════════════════════════

export function useTheme() {
  // Initialize from localStorage — same key as index.html script
  const [mode, setModeState] = useState<ThemeMode>(() => loadThemeMode());
  const userId = useAppStore((state) => state.user?.id);
  const appearance = useSettingsSection('appearance', { enabled: Boolean(userId) });
  const saveAppearance = useSaveSettings();

  useEffect(() => {
    const remoteMode = (appearance.data as Partial<AppearanceSettings> | undefined)?.themeMode;
    if (remoteMode === 'light' || remoteMode === 'dark' || remoteMode === 'system') {
      setModeState(remoteMode); saveThemeMode(remoteMode); applyThemeToDOM(resolveTheme(remoteMode));
    }
  }, [appearance.data]);

  useEffect(() => {
    if (!userId || migrationChecked.has(userId)) return;
    migrationChecked.add(userId);
    void settingsDocumentExists('appearance').then((exists) => {
      if (!exists) saveAppearance.mutate({ section: 'appearance', data: { ...DEFAULT_APPEARANCE_SETTINGS, themeMode: loadThemeMode() } });
    }).catch(() => migrationChecked.delete(userId));
  }, [userId]); // migration is intentionally once per authenticated user

  // On mount: synchronize DOM class with localStorage value.
  // The index.html script already applied it, but React StrictMode
  // double-invokes effects in dev — this ensures consistency.
  useEffect(() => {
    const resolved = resolveTheme(mode);
    applyThemeToDOM(resolved);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // React to OS preference changes when mode is 'system'
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyThemeToDOM(resolveTheme('system'));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    const previous = mode;
    setModeState(next);
    saveThemeMode(next);
    applyThemeToDOM(resolveTheme(next));
    if (userId) saveAppearance.mutate({ section: 'appearance', data: { ...DEFAULT_APPEARANCE_SETTINGS, ...(appearance.data || {}), themeMode: next } }, { onError: () => { setModeState(previous); saveThemeMode(previous); applyThemeToDOM(resolveTheme(previous)); } });
  }, [appearance.data, mode, saveAppearance, userId]);

  const cycleTheme = useCallback(() => {
    setMode(nextThemeMode(mode));
  }, [mode, setMode]);

  const resolved = resolveTheme(mode);

  return {
    mode,              // 'light' | 'dark' | 'system'  (user's choice)
    resolved,          // 'light' | 'dark'              (actual applied)
    isDark: resolved === 'dark',
    setMode,
    cycleTheme,
  } as const;
}
