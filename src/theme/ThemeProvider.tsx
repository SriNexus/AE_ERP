import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useTheme } from './useTheme';
import { type ThemeMode, applyTenantBranding } from './theme';
import { applyThemeOverrides, clearThemeOverrides, reapplyThemeForMode } from './applyThemeOverrides';
import { useSettingsSection } from '../features/settings/hooks/useSettingsSection';
import { useAppStore } from '../store/useAppStore';
import type { ThemeSettings } from '../features/settings/types';
import { normalizeBuiltInTheme } from './presets';
import type { AppearanceSettings, GeneralSettings } from '../features/settings/types';
import { setGeneralSettingsRuntime } from '../features/settings/generalRuntime';
import { fontScaleFor } from '../features/settings/appearanceRuntime';

interface ThemeContextValue { mode: ThemeMode; resolved: 'light'|'dark'; isDark: boolean; setMode:(m:ThemeMode)=>void; cycleTheme:()=>void; }
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const company = useAppStore((s) => s.company);
  const user = useAppStore((s) => s.user);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const sidebarAppliedFor = useRef<string | undefined>(undefined);
  const { data: generalSettings } = useSettingsSection('general', { enabled: Boolean(user) });
  const { data: appearanceSettings } = useSettingsSection('appearance', { enabled: Boolean(user) });

  useEffect(() => { if (generalSettings) setGeneralSettingsRuntime(generalSettings as unknown as GeneralSettings); }, [generalSettings]);
  useEffect(() => {
    if (typeof document === 'undefined' || !appearanceSettings) return;
    const value = appearanceSettings as unknown as AppearanceSettings;
    const root = document.documentElement;
    root.classList.toggle('high-contrast', value.highContrast === true);
    root.classList.toggle('compact-ui', value.compactMode === true);
    root.classList.toggle('reduce-motion', value.reducedMotion === true);
    // fontSize legacy-label migration already happened in
    // settingsService.loadSettings() (the single place with access to the raw
    // pre-defaults-merge document — see appearanceRuntime.ts). value.fontSize
    // here is always already canonical; this just derives the CSS scale.
    root.style.setProperty('--personal-font-scale', fontScaleFor(value.fontSize));
    // Sidebar behavior: 'auto' (default, opens on first load as before)
    // or 'click' (stays collapsed until explicitly opened)
    // Set sidebar behavior as a DOM attribute for the Sidebar component to read
    root.setAttribute('data-sidebar-behavior', value.sidebarBehavior === 'click' ? 'click' : 'auto');
    if (user?.id && sidebarAppliedFor.current !== user.id) {
      if (value.sidebarBehavior === 'click') {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(value.sidebarCollapsed !== true);
      }
      sidebarAppliedFor.current = user.id;
    }
  }, [appearanceSettings, user?.id, setSidebarOpen]);

  // Layer 1: Company branding (unchanged)
  useEffect(() => {
    if (company?.primaryColor || company?.accentColor) {
      applyTenantBranding({ primaryColor: company.primaryColor, accentColor: company.accentColor });
    }
  }, [company?.primaryColor, company?.accentColor]);

  // Layer 2: ERP Theme & UI overrides on top of company branding (runs after branding intentionally)
  // Gated on Boolean(user) like general/appearance above — this was previously
  // unconditionally `enabled: true`, firing on every app mount (including the
  // login page, and mid-boot before the ERP identity/tenant context existed
  // at all) and producing a "Missing or insufficient permissions" read against
  // the company-scoped 'theme-ui' settings doc. ThemeProvider sits above the
  // router, so this fired on every route, not just /settings (Admin
  // /users+settings runtime-storm root cause).
  const { data: themeSettings } = useSettingsSection('theme-ui', { enabled: Boolean(user) });
  useEffect(() => {
    if (themeSettings && Object.keys(themeSettings).length > 0) {
      applyThemeOverrides(normalizeBuiltInTheme(themeSettings as unknown as ThemeSettings));
    }
    return () => clearThemeOverrides();
  }, [themeSettings]);

  // Layer 2b: Re-apply theme palette when mode (light/dark) changes
  // This ensures each theme's carefully designed dark palette is used
  // instead of a generic dark mode inversion.
  useEffect(() => {
    reapplyThemeForMode();
  }, [theme.resolved]);

  // Layer 3: Apply font family globally
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const fontMap: Record<string, string> = {
      inter: "'Inter', system-ui, -apple-system, sans-serif",
      system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      geist: "'Geist', system-ui, -apple-system, sans-serif",
    };
    const theme = themeSettings as unknown as ThemeSettings | undefined;
    const fontKey = theme?.font || 'inter';
    root.style.setProperty('--theme-font-family', fontMap[fontKey] || fontMap.inter);
    root.style.setProperty('font-family', fontMap[fontKey] || fontMap.inter);
  }, [themeSettings]);

  // Layer 4: Animation toggle — disable all transitions when animation is off
  // This is the single place that controls animation state.
  // Components consume --transition-duration CSS variable.
  // applyThemeOverrides also sets --theme-animation for the same purpose.
  // Both are synchronized from the same theme.animation source.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const theme = themeSettings as unknown as ThemeSettings | undefined;
    const enabled = theme?.animation !== false;
    root.style.setProperty('--transition-duration', enabled ? '200ms' : '0s');
  }, [themeSettings]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used within ThemeProvider');
  return ctx;
}
