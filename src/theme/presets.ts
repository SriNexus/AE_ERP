/**
 * Five premium ERP themes consumed by the theme runtime.
 *
 * Each theme has:
 *   - A distinct personality (no two feel similar)
 *   - Full light palette
 *   - Full dark palette (carefully designed, not inverted)
 *   - All tokens required by the Universal Table Design System
 *   - All tokens required by all ERP components
 *
 * Token naming convention:
 *   color-{category}-{variant}
 *   table-{element}
 *   pagination-{element}
 */

import type { ThemeSettings } from '../features/settings/types';
import { DEFAULT_BUILT_IN_THEME_ID, isBuiltInThemeId, isLegacyThemeId, type BuiltInThemeId } from './presetIds';

export type ThemePresetId = BuiltInThemeId;

export interface ThemePaletteSet {
  primary: string; primaryHover: string; primaryLight: string; primaryMuted: string;
  accent: string; accentHover: string; accentLight: string;
  surface: string; surfaceHover: string;
  bg: string; bgElevated: string; bgSunken: string;
  sidebarBg: string; sidebarBorder: string; sidebarActive: string; sidebarActiveText: string; sidebarItemHover: string;
  topbarBg: string; topbarBorder: string;
  border: string; borderStrong: string; borderSubtle: string;
  text: string; textSecondary: string; textMuted: string; textDisabled: string; textInverse: string;
  overlay: string;
  tableHeaderBg: string; tableHeaderText: string; tableHeaderSort: string;
  tableRowHover: string; tableRowSelected: string; tableRowStripe: string;
  tableCheckbox: string; tableCheckboxBg: string; tableFocusRing: string;
  paginationBg: string; paginationActive: string; paginationActiveText: string; paginationHover: string;
  tableFooterBg: string; tableScrollbar: string; tableSelectionBar: string;
}

export interface ThemePreset {
  id: ThemePresetId;
  label: string;
  description: string;
  previewColor: string;
  values: Pick<ThemeSettings, 'borderRadius' | 'cardStyle' | 'sidebarStyle' | 'kpiStyle' | 'density' | 'animation' | 'shadowStyle' | 'font' | 'chartPaletteId'> & {
    palette: {
      light: ThemePaletteSet;
      dark: ThemePaletteSet;
    };
  };
}

// ── Helper to generate preview colors ├──
const colors = {
  indigo600: '#4f46e5', indigo500: '#6366f1', indigo700: '#4338ca',
  emerald500: '#10b981', emerald600: '#059669', amber500: '#f59e0b',
  teal500: '#14b8a6', slate500: '#64748b', slate400: '#94a3b8',
  violet600: '#7c3aed', violet700: '#6d28d9', violet500: '#8b5cf6',
  cyan500: '#06b6d4', forestGreen700: '#20744a', forestGreen600: '#15803d',
};

export const THEME_PRESETS: ThemePreset[] = [
  // ═══ THEME 1: Neozy Blue (Classic) — Flagship ═══
  {
    id: 'classic', label: 'Neozy Blue',
    description: 'Professional indigo identity with balanced spacing — the default ERP experience',
    previewColor: '#4f46e5',
    values: {
      borderRadius: 'medium', cardStyle: 'elevated', sidebarStyle: 'default', kpiStyle: 'bordered',
      density: 'comfortable', animation: true, shadowStyle: 'medium', font: 'inter', chartPaletteId: 'default',
      palette: {
        light: {
          primary: '#4f46e5', primaryHover: '#4338ca', primaryLight: '#eef2ff', primaryMuted: '#c7d2fe',
          accent: '#10b981', accentHover: '#059669', accentLight: '#d1fae5',
          surface: '#ffffff', surfaceHover: '#f8fafc',
          bg: '#f8fafc', bgElevated: '#ffffff', bgSunken: '#f1f5f9',
          sidebarBg: '#ffffff', sidebarBorder: 'rgba(226,232,240,0.80)', sidebarActive: '#4f46e5', sidebarActiveText: '#ffffff', sidebarItemHover: '#f1f5f9',
          topbarBg: 'rgba(255,255,255,0.80)', topbarBorder: 'rgba(226,232,240,0.80)',
          border: '#e2e8f0', borderStrong: '#cbd5e1', borderSubtle: '#f1f5f9',
          text: '#0f172a', textSecondary: '#475569', textMuted: '#94a3b8', textDisabled: '#cbd5e1', textInverse: '#ffffff',
          overlay: 'rgba(0,0,0,0.50)',
          tableHeaderBg: '#f1f5f9', tableHeaderText: '#475569', tableHeaderSort: '#94a3b8',
          tableRowHover: '#f8fafc', tableRowSelected: '#eef2ff', tableRowStripe: '#fafbfc',
          tableCheckbox: '#4f46e5', tableCheckboxBg: '#eef2ff', tableFocusRing: '#4f46e5',
          paginationBg: '#f8fafc', paginationActive: '#4f46e5', paginationActiveText: '#ffffff', paginationHover: '#eef2ff',
          tableFooterBg: '#f8fafc', tableScrollbar: '#cbd5e1', tableSelectionBar: '#eef2ff',
        },
        dark: {
          primary: '#6366f1', primaryHover: '#4f46e5', primaryLight: 'rgba(99,102,241,0.15)', primaryMuted: '#3730a3',
          accent: '#34d399', accentHover: '#10b981', accentLight: 'rgba(52,211,153,0.15)',
          surface: '#1e293b', surfaceHover: '#334155',
          bg: '#0f172a', bgElevated: '#0f172a', bgSunken: '#020617',
          sidebarBg: '#0f172a', sidebarBorder: 'rgba(51,65,85,0.60)', sidebarActive: '#4f46e5', sidebarActiveText: '#ffffff', sidebarItemHover: 'rgba(255,255,255,0.05)',
          topbarBg: 'rgba(15,23,42,0.80)', topbarBorder: 'rgba(51,65,85,0.60)',
          border: '#334155', borderStrong: '#475569', borderSubtle: '#1e293b',
          text: '#f1f5f9', textSecondary: '#94a3b8', textMuted: '#64748b', textDisabled: '#475569', textInverse: '#0f172a',
          overlay: 'rgba(0,0,0,0.70)',
          tableHeaderBg: '#1e293b', tableHeaderText: '#94a3b8', tableHeaderSort: '#64748b',
          tableRowHover: '#1e293b', tableRowSelected: 'rgba(99,102,241,0.15)', tableRowStripe: '#1a2332',
          tableCheckbox: '#6366f1', tableCheckboxBg: 'rgba(99,102,241,0.15)', tableFocusRing: '#6366f1',
          paginationBg: '#0f172a', paginationActive: '#6366f1', paginationActiveText: '#ffffff', paginationHover: 'rgba(99,102,241,0.15)',
          tableFooterBg: '#0f172a', tableScrollbar: '#475569', tableSelectionBar: 'rgba(99,102,241,0.12)',
        },
      },
    },
  },

  // ═══ THEME 2: Royal Indigo — Premium ═══
  {
    id: 'royal-indigo', label: 'Royal Indigo',
    description: 'Premium violet authority with warm amber accents — for leadership teams',
    previewColor: '#7c3aed',
    values: {
      borderRadius: 'medium', cardStyle: 'elevated', sidebarStyle: 'default', kpiStyle: 'bordered',
      density: 'comfortable', animation: true, shadowStyle: 'medium', font: 'inter', chartPaletteId: 'finance',
      palette: {
        light: {
          primary: '#7c3aed', primaryHover: '#6d28d9', primaryLight: '#f5f3ff', primaryMuted: '#c4b5fd',
          accent: '#f59e0b', accentHover: '#d97706', accentLight: '#fef3c7',
          surface: '#ffffff', surfaceHover: '#f5f3ff',
          bg: '#f5f3ff', bgElevated: '#ffffff', bgSunken: '#ede9fe',
          sidebarBg: '#ffffff', sidebarBorder: 'rgba(237,233,254,0.80)', sidebarActive: '#7c3aed', sidebarActiveText: '#ffffff', sidebarItemHover: '#f5f3ff',
          topbarBg: 'rgba(255,255,255,0.80)', topbarBorder: 'rgba(237,233,254,0.80)',
          border: '#e0e7ff', borderStrong: '#c4b5fd', borderSubtle: '#f5f3ff',
          text: '#1e1b4b', textSecondary: '#5b21b6', textMuted: '#8b5cf6', textDisabled: '#c4b5fd', textInverse: '#ffffff',
          overlay: 'rgba(0,0,0,0.50)',
          tableHeaderBg: '#ede9fe', tableHeaderText: '#5b21b6', tableHeaderSort: '#8b5cf6',
          tableRowHover: '#f5f3ff', tableRowSelected: '#ede9fe', tableRowStripe: '#faf5ff',
          tableCheckbox: '#7c3aed', tableCheckboxBg: '#ede9fe', tableFocusRing: '#7c3aed',
          paginationBg: '#f5f3ff', paginationActive: '#7c3aed', paginationActiveText: '#ffffff', paginationHover: '#ede9fe',
          tableFooterBg: '#f5f3ff', tableScrollbar: '#c4b5fd', tableSelectionBar: '#ede9fe',
        },
        dark: {
          primary: '#8b5cf6', primaryHover: '#7c3aed', primaryLight: 'rgba(139,92,246,0.15)', primaryMuted: '#5b21b6',
          accent: '#fbbf24', accentHover: '#f59e0b', accentLight: 'rgba(251,191,36,0.15)',
          surface: '#1e1b4b', surfaceHover: '#2e2860',
          bg: '#0f0a2e', bgElevated: '#1e1b4b', bgSunken: '#0f0a2e',
          sidebarBg: '#1e1b4b', sidebarBorder: 'rgba(76,29,149,0.60)', sidebarActive: '#7c3aed', sidebarActiveText: '#ffffff', sidebarItemHover: 'rgba(255,255,255,0.05)',
          topbarBg: 'rgba(30,27,75,0.80)', topbarBorder: 'rgba(76,29,149,0.60)',
          border: '#4c1d95', borderStrong: '#5b21b6', borderSubtle: '#2e2860',
          text: '#f1f5f9', textSecondary: '#a78bfa', textMuted: '#7c3aed', textDisabled: '#4c1d95', textInverse: '#0f0a2e',
          overlay: 'rgba(0,0,0,0.70)',
          tableHeaderBg: '#2e2860', tableHeaderText: '#a78bfa', tableHeaderSort: '#7c3aed',
          tableRowHover: '#2e2860', tableRowSelected: 'rgba(139,92,246,0.15)', tableRowStripe: '#252050',
          tableCheckbox: '#8b5cf6', tableCheckboxBg: 'rgba(139,92,246,0.15)', tableFocusRing: '#8b5cf6',
          paginationBg: '#0f0a2e', paginationActive: '#8b5cf6', paginationActiveText: '#ffffff', paginationHover: 'rgba(139,92,246,0.15)',
          tableFooterBg: '#0f0a2e', tableScrollbar: '#5b21b6', tableSelectionBar: 'rgba(139,92,246,0.12)',
        },
      },
    },
  },

  // ═══ THEME 3: Emerald Pro — Solar / Growth ═══
  {
    id: 'emerald-pro', label: 'Emerald Pro',
    description: 'Organic forest green with earthy gold — purpose-built for solar energy companies',
    previewColor: '#059669',
    values: {
      borderRadius: 'large', cardStyle: 'elevated', sidebarStyle: 'compact', kpiStyle: 'shadowed',
      density: 'comfortable', animation: true, shadowStyle: 'subtle', font: 'system', chartPaletteId: 'sales',
      palette: {
        light: {
          primary: '#059669', primaryHover: '#047857', primaryLight: '#d1fae5', primaryMuted: '#6ee7b7',
          accent: '#d97706', accentHover: '#b45309', accentLight: '#fef3c7',
          surface: '#ffffff', surfaceHover: '#ecfdf5',
          bg: '#ecfdf5', bgElevated: '#ffffff', bgSunken: '#d1fae5',
          sidebarBg: '#ffffff', sidebarBorder: 'rgba(209,250,229,0.80)', sidebarActive: '#059669', sidebarActiveText: '#ffffff', sidebarItemHover: '#ecfdf5',
          topbarBg: 'rgba(255,255,255,0.80)', topbarBorder: 'rgba(209,250,229,0.80)',
          border: '#d1fae5', borderStrong: '#6ee7b7', borderSubtle: '#ecfdf5',
          text: '#022c22', textSecondary: '#065f46', textMuted: '#6ee7b7', textDisabled: '#a7f3d0', textInverse: '#ffffff',
          overlay: 'rgba(0,0,0,0.50)',
          tableHeaderBg: '#d1fae5', tableHeaderText: '#065f46', tableHeaderSort: '#6ee7b7',
          tableRowHover: '#ecfdf5', tableRowSelected: '#d1fae5', tableRowStripe: '#f0fdf6',
          tableCheckbox: '#059669', tableCheckboxBg: '#d1fae5', tableFocusRing: '#059669',
          paginationBg: '#ecfdf5', paginationActive: '#059669', paginationActiveText: '#ffffff', paginationHover: '#d1fae5',
          tableFooterBg: '#ecfdf5', tableScrollbar: '#6ee7b7', tableSelectionBar: '#d1fae5',
        },
        dark: {
          primary: '#34d399', primaryHover: '#10b981', primaryLight: 'rgba(52,211,153,0.15)', primaryMuted: '#047857',
          accent: '#fbbf24', accentHover: '#f59e0b', accentLight: 'rgba(251,191,36,0.15)',
          surface: '#022c22', surfaceHover: '#064e3b',
          bg: '#001a12', bgElevated: '#022c22', bgSunken: '#001a12',
          sidebarBg: '#022c22', sidebarBorder: 'rgba(6,78,59,0.60)', sidebarActive: '#059669', sidebarActiveText: '#ffffff', sidebarItemHover: 'rgba(255,255,255,0.05)',
          topbarBg: 'rgba(2,44,34,0.80)', topbarBorder: 'rgba(6,78,59,0.60)',
          border: '#064e3b', borderStrong: '#065f46', borderSubtle: '#022c22',
          text: '#f1f5f9', textSecondary: '#6ee7b7', textMuted: '#34d399', textDisabled: '#065f46', textInverse: '#001a12',
          overlay: 'rgba(0,0,0,0.70)',
          tableHeaderBg: '#064e3b', tableHeaderText: '#6ee7b7', tableHeaderSort: '#34d399',
          tableRowHover: '#064e3b', tableRowSelected: 'rgba(52,211,153,0.15)', tableRowStripe: '#013827',
          tableCheckbox: '#34d399', tableCheckboxBg: 'rgba(52,211,153,0.15)', tableFocusRing: '#34d399',
          paginationBg: '#001a12', paginationActive: '#34d399', paginationActiveText: '#022c22', paginationHover: 'rgba(52,211,153,0.15)',
          tableFooterBg: '#001a12', tableScrollbar: '#065f46', tableSelectionBar: 'rgba(52,211,153,0.12)',
        },
      },
    },
  },

  // ═══ THEME 4: Amber Enterprise — Warm Premium ═══
  {
    id: 'amber-enterprise', label: 'Amber Enterprise',
    description: 'Warm amber authority with indigo contrast — enterprise trust meets energy',
    previewColor: '#d97706',
    values: {
      borderRadius: 'small', cardStyle: 'border', sidebarStyle: 'expanded', kpiStyle: 'bordered',
      density: 'compact', animation: true, shadowStyle: 'subtle', font: 'inter', chartPaletteId: 'finance',
      palette: {
        light: {
          primary: '#d97706', primaryHover: '#b45309', primaryLight: '#fffbeb', primaryMuted: '#fde68a',
          accent: '#6366f1', accentHover: '#4f46e5', accentLight: '#e0e7ff',
          surface: '#ffffff', surfaceHover: '#fffbeb',
          bg: '#fffbeb', bgElevated: '#ffffff', bgSunken: '#fef3c7',
          sidebarBg: '#1c1917', sidebarBorder: 'rgba(41,37,36,0.80)', sidebarActive: '#d97706', sidebarActiveText: '#ffffff', sidebarItemHover: 'rgba(255,255,255,0.08)',
          topbarBg: 'rgba(255,255,255,0.80)', topbarBorder: 'rgba(253,230,138,0.80)',
          border: '#fde68a', borderStrong: '#fcd34d', borderSubtle: '#fef3c7',
          text: '#1c1917', textSecondary: '#92400e', textMuted: '#f59e0b', textDisabled: '#fcd34d', textInverse: '#ffffff',
          overlay: 'rgba(0,0,0,0.50)',
          tableHeaderBg: '#fef3c7', tableHeaderText: '#92400e', tableHeaderSort: '#f59e0b',
          tableRowHover: '#fffbeb', tableRowSelected: '#fef3c7', tableRowStripe: '#fffdf5',
          tableCheckbox: '#d97706', tableCheckboxBg: '#fef3c7', tableFocusRing: '#d97706',
          paginationBg: '#fffbeb', paginationActive: '#d97706', paginationActiveText: '#ffffff', paginationHover: '#fef3c7',
          tableFooterBg: '#fffbeb', tableScrollbar: '#fcd34d', tableSelectionBar: '#fef3c7',
        },
        dark: {
          primary: '#f59e0b', primaryHover: '#d97706', primaryLight: 'rgba(245,158,11,0.15)', primaryMuted: '#b45309',
          accent: '#818cf8', accentHover: '#6366f1', accentLight: 'rgba(129,140,248,0.15)',
          surface: '#292524', surfaceHover: '#3a3533',
          bg: '#1c1917', bgElevated: '#292524', bgSunken: '#1c1917',
          sidebarBg: '#292524', sidebarBorder: 'rgba(68,64,60,0.60)', sidebarActive: '#d97706', sidebarActiveText: '#ffffff', sidebarItemHover: 'rgba(255,255,255,0.05)',
          topbarBg: 'rgba(41,37,36,0.80)', topbarBorder: 'rgba(68,64,60,0.60)',
          border: '#44403c', borderStrong: '#57534e', borderSubtle: '#292524',
          text: '#f1f5f9', textSecondary: '#fcd34d', textMuted: '#f59e0b', textDisabled: '#92400e', textInverse: '#1c1917',
          overlay: 'rgba(0,0,0,0.70)',
          tableHeaderBg: '#44403c', tableHeaderText: '#fcd34d', tableHeaderSort: '#f59e0b',
          tableRowHover: '#3a3533', tableRowSelected: 'rgba(245,158,11,0.15)', tableRowStripe: '#302c2a',
          tableCheckbox: '#f59e0b', tableCheckboxBg: 'rgba(245,158,11,0.15)', tableFocusRing: '#f59e0b',
          paginationBg: '#1c1917', paginationActive: '#f59e0b', paginationActiveText: '#1c1917', paginationHover: 'rgba(245,158,11,0.15)',
          tableFooterBg: '#1c1917', tableScrollbar: '#57534e', tableSelectionBar: 'rgba(245,158,11,0.12)',
        },
      },
    },
  },

  // ═══ THEME 5: Slate Graphite — Minimal High-Contrast ═══
  {
    id: 'slate-graphite', label: 'Slate Graphite',
    description: 'Monochromatic minimalism with cyan accents — for technical and dark-mode-first teams',
    previewColor: '#475569',
    values: {
      borderRadius: 'medium', cardStyle: 'elevated', sidebarStyle: 'default', kpiStyle: 'minimal',
      density: 'compact', animation: true, shadowStyle: 'subtle', font: 'inter', chartPaletteId: 'default',
      palette: {
        light: {
          primary: '#64748b', primaryHover: '#475569', primaryLight: '#f1f5f9', primaryMuted: '#94a3b8',
          accent: '#06b6d4', accentHover: '#0891b2', accentLight: '#cffafe',
          surface: '#ffffff', surfaceHover: '#f8fafc',
          bg: '#f8fafc', bgElevated: '#ffffff', bgSunken: '#f1f5f9',
          sidebarBg: '#ffffff', sidebarBorder: 'rgba(226,232,240,0.80)', sidebarActive: '#475569', sidebarActiveText: '#ffffff', sidebarItemHover: '#f1f5f9',
          topbarBg: 'rgba(255,255,255,0.80)', topbarBorder: 'rgba(226,232,240,0.80)',
          border: '#e2e8f0', borderStrong: '#cbd5e1', borderSubtle: '#f1f5f9',
          text: '#0f172a', textSecondary: '#334155', textMuted: '#94a3b8', textDisabled: '#cbd5e1', textInverse: '#ffffff',
          overlay: 'rgba(0,0,0,0.50)',
          tableHeaderBg: '#f1f5f9', tableHeaderText: '#334155', tableHeaderSort: '#94a3b8',
          tableRowHover: '#f8fafc', tableRowSelected: '#f1f5f9', tableRowStripe: '#fafbfc',
          tableCheckbox: '#64748b', tableCheckboxBg: '#f1f5f9', tableFocusRing: '#64748b',
          paginationBg: '#f8fafc', paginationActive: '#64748b', paginationActiveText: '#ffffff', paginationHover: '#f1f5f9',
          tableFooterBg: '#f8fafc', tableScrollbar: '#cbd5e1', tableSelectionBar: '#f1f5f9',
        },
        dark: {
          primary: '#94a3b8', primaryHover: '#64748b', primaryLight: 'rgba(148,163,184,0.12)', primaryMuted: '#475569',
          accent: '#22d3ee', accentHover: '#06b6d4', accentLight: 'rgba(34,211,238,0.15)',
          surface: '#1e293b', surfaceHover: '#334155',
          bg: '#020617', bgElevated: '#0f172a', bgSunken: '#020617',
          sidebarBg: '#0f172a', sidebarBorder: 'rgba(51,65,85,0.60)', sidebarActive: '#64748b', sidebarActiveText: '#ffffff', sidebarItemHover: 'rgba(255,255,255,0.05)',
          topbarBg: 'rgba(15,23,42,0.80)', topbarBorder: 'rgba(51,65,85,0.60)',
          border: '#334155', borderStrong: '#475569', borderSubtle: '#1e293b',
          text: '#f1f5f9', textSecondary: '#cbd5e1', textMuted: '#64748b', textDisabled: '#475569', textInverse: '#0f172a',
          overlay: 'rgba(0,0,0,0.70)',
          tableHeaderBg: '#0f172a', tableHeaderText: '#cbd5e1', tableHeaderSort: '#64748b',
          tableRowHover: '#1e293b', tableRowSelected: 'rgba(100,116,139,0.15)', tableRowStripe: '#131d2f',
          tableCheckbox: '#94a3b8', tableCheckboxBg: 'rgba(148,163,184,0.12)', tableFocusRing: '#94a3b8',
          paginationBg: '#0f172a', paginationActive: '#94a3b8', paginationActiveText: '#020617', paginationHover: 'rgba(148,163,184,0.15)',
          tableFooterBg: '#0f172a', tableScrollbar: '#475569', tableSelectionBar: 'rgba(148,163,184,0.10)',
        },
      },
    },
  },
];

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = DEFAULT_BUILT_IN_THEME_ID;

export function getPreset(id?: string): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

export function getPresetValues(id?: string): ThemePreset['values'] {
  return (getPreset(id) || getPreset(DEFAULT_THEME_PRESET_ID)!).values;
}

export function normalizeBuiltInTheme(theme: ThemeSettings | (Omit<ThemeSettings, 'selectedTheme'> & { selectedTheme: unknown })): ThemeSettings {
  if (isBuiltInThemeId(theme.selectedTheme)) return theme as ThemeSettings;
  if (!isLegacyThemeId(theme.selectedTheme)) return theme as ThemeSettings;
  const classic = getPreset(DEFAULT_THEME_PRESET_ID)!;
  const { palette: _palette, ...settingsValues } = classic.values;
  return {
    ...theme,
    selectedTheme: classic.id,
    ...settingsValues,
    customChartPalette: undefined,
    themeOverrides: { colors: {} },
  } as ThemeSettings;
}