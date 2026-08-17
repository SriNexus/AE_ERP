/**
 * applyThemeOverrides — Applies ERP Theme & UI CSS variables to the DOM.
 *
 * Token layering (each layer overwrites matching keys in the layer below):
 *   1. Base Fallback (tokens.css) — safe defaults, always present
 *   2. Theme Preset Palette (applyPaletteFromPreset) — full --color-* token set
 *   3. Company Branding (applyTenantBranding, called separately) — primary + accent
 *   4. User Theme Overrides (--theme-custom-*) — temporary UI tweaks
 *
 * NOTE: In the current ThemeProvider implementation, applyThemeOverrides (Layer 2)
 *       runs AFTER applyTenantBranding (Layer 3), so theme presets currently win
 *       over company branding. Future phases may reverse this for multi-tenant
 *       SaaS where each company's brand should take priority over the theme.
 *
 * The critical architectural change from v1: tokens.css no longer owns
 * the primary/accent/surface values. Those are now set by this function
 * from the active theme preset, respecting the current data-theme (light/dark).
 *
 * RELIES ON: document.documentElement having [data-theme="light"|"dark"]
 * CALLED BY: ThemeProvider (on theme change, on mode change, on mount)
 *
 * Use --theme-* prefix for all theme-controlled variables.
 */

import type { ThemeSettings } from '../features/settings/types';
import { getPreset, normalizeBuiltInTheme } from './presets';
import type { ThemePaletteSet } from './presets';

const THEME_VAR_PREFIX = '--theme-';

/**
 * Map border-radius values to actual CSS values
 */
function mapRadius(value: string): string {
  switch (value) {
    case 'none': return '0px';
    case 'small': return '4px';
    case 'medium': return '8px';
    case 'large': return '16px';
    default: return '8px';
  }
}

/**
 * Map shadow values to actual CSS shadows
 */
function mapShadow(value: string): string {
  switch (value) {
    case 'subtle': return '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)';
    case 'medium': return '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)';
    case 'strong': return '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.08)';
    default: return '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)';
  }
}

/**
 * Map density to spacing scale
 */
function mapDensity(value: string): string {
  switch (value) {
    case 'comfortable': return '1';
    case 'compact': return '0.75';
    default: return '1';
  }
}

function mapCardShadow(cardStyle: string, shadowStyle: string): string {
  if (cardStyle === 'flat' || cardStyle === 'border') return 'none';
  return mapShadow(shadowStyle);
}

function mapSidebarWidths(sidebarStyle: string): { collapsed: string; expanded: string } {
  switch (sidebarStyle) {
    case 'compact':
      return { collapsed: '48px', expanded: '180px' };
    case 'expanded':
      return { collapsed: '72px', expanded: '280px' };
    default:
      return { collapsed: 'var(--shell-sidebar-collapsed)', expanded: 'var(--shell-sidebar-expanded)' };
  }
}

function mapKpiTokens(kpiStyle: string): { borderWidth: string; shadow: string } {
  if (kpiStyle === 'minimal') return { borderWidth: '0px', shadow: 'none' };
  if (kpiStyle === 'shadowed') return { borderWidth: '0px', shadow: 'var(--theme-shadow-md)' };
  return { borderWidth: '4px', shadow: 'var(--theme-shadow-md)' };
}

/**
 * Get the current mode from the DOM
 */
function getCurrentMode(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
}

/**
 * Clear all theme CSS variables from the DOM
 */
export function clearThemeOverrides(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const themeVars = [
    // Base UI tokens
    '--theme-radius', '--theme-shadow-sm', '--theme-shadow-md', '--theme-shadow-lg',
    '--theme-card-shadow', '--theme-sidebar-collapsed-width', '--theme-sidebar-expanded-width',
    '--theme-kpi-border-width', '--theme-kpi-shadow', '--theme-density',
    '--theme-card-style', '--theme-sidebar-style', '--theme-kpi-style',
    '--theme-font', '--theme-chart-palette',
    // Palette tokens (these are now owned by presets)
    '--color-primary', '--color-primary-hover', '--color-primary-light', '--color-primary-muted',
    '--color-primary-text', '--color-accent', '--color-accent-hover', '--color-accent-light',
    '--color-surface', '--color-surface-hover', '--color-bg', '--color-bg-elevated', '--color-bg-sunken',
    '--color-sidebar-bg', '--color-sidebar-border', '--color-sidebar-active',
    '--color-sidebar-active-text', '--color-sidebar-item-hover',
    '--color-topbar-bg', '--color-topbar-border',
    '--color-border', '--color-border-strong', '--color-border-subtle',
    '--color-text', '--color-text-secondary', '--color-text-muted',
    '--color-text-disabled', '--color-text-inverse', '--color-overlay',
    '--color-focus-ring',
    // Table-specific tokens
    '--color-table-header-bg', '--color-table-header-text', '--color-table-header-sort',
    '--color-table-row-hover', '--color-table-row-selected', '--color-table-row-stripe',
    '--color-table-checkbox', '--color-table-checkbox-bg', '--color-table-focus-ring',
    '--color-pagination-bg', '--color-pagination-active', '--color-pagination-active-text',
    '--color-pagination-hover', '--color-table-footer-bg', '--color-table-scrollbar',
    '--color-table-selection-bar',
    // Custom override colors
    '--theme-custom-primary', '--theme-custom-accent', '--theme-custom-success',
    '--theme-custom-warning', '--theme-custom-danger', '--theme-custom-info',
    '--theme-custom-sidebar', '--theme-custom-background', '--theme-custom-card',
    '--theme-custom-border', '--theme-custom-button',
  ];
  themeVars.forEach((v) => root.style.removeProperty(v));
}

/**
 * Apply the palette from the active theme preset to the DOM.
 * Respects the current data-theme mode (light/dark).
 */
function applyPaletteFromPreset(themeId: string, mode: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const preset = getPreset(themeId);
  if (!preset) return;

  const palette: ThemePaletteSet = preset.values.palette[mode];
  const r = document.documentElement.style;

  // ── Core brand ────────────────────────────────────────
  r.setProperty('--color-primary', palette.primary);
  r.setProperty('--color-primary-hover', palette.primaryHover);
  r.setProperty('--color-primary-light', palette.primaryLight);
  r.setProperty('--color-primary-muted', palette.primaryMuted);
  r.setProperty('--color-primary-text', palette.primary);
  r.setProperty('--color-focus-ring', palette.primary);

  r.setProperty('--color-accent', palette.accent);
  r.setProperty('--color-accent-hover', palette.accentHover);
  r.setProperty('--color-accent-light', palette.accentLight);

  // ── Surfaces ──────────────────────────────────────────
  r.setProperty('--color-surface', palette.surface);
  r.setProperty('--color-surface-hover', palette.surfaceHover);
  r.setProperty('--color-bg', palette.bg);
  r.setProperty('--color-bg-elevated', palette.bgElevated);
  r.setProperty('--color-bg-sunken', palette.bgSunken);

  // ── Sidebar ───────────────────────────────────────────
  r.setProperty('--color-sidebar-bg', palette.sidebarBg);
  r.setProperty('--color-sidebar-border', palette.sidebarBorder);
  r.setProperty('--color-sidebar-active', palette.sidebarActive);
  r.setProperty('--color-sidebar-active-text', palette.sidebarActiveText);
  r.setProperty('--color-sidebar-item-hover', palette.sidebarItemHover);

  // ── Topbar ────────────────────────────────────────────
  r.setProperty('--color-topbar-bg', palette.topbarBg);
  r.setProperty('--color-topbar-border', palette.topbarBorder);

  // ── Borders ───────────────────────────────────────────
  r.setProperty('--color-border', palette.border);
  r.setProperty('--color-border-strong', palette.borderStrong);
  r.setProperty('--color-border-subtle', palette.borderSubtle);

  // ── Text ──────────────────────────────────────────────
  r.setProperty('--color-text', palette.text);
  r.setProperty('--color-text-secondary', palette.textSecondary);
  r.setProperty('--color-text-muted', palette.textMuted);
  r.setProperty('--color-text-disabled', palette.textDisabled);
  r.setProperty('--color-text-inverse', palette.textInverse);

  // ── Overlay ───────────────────────────────────────────
  r.setProperty('--color-overlay', palette.overlay);

  // ── Table Tokens ──────────────────────────────────────
  r.setProperty('--color-table-header-bg', palette.tableHeaderBg);
  r.setProperty('--color-table-header-text', palette.tableHeaderText);
  r.setProperty('--color-table-header-sort', palette.tableHeaderSort);
  r.setProperty('--color-table-row-hover', palette.tableRowHover);
  r.setProperty('--color-table-row-selected', palette.tableRowSelected);
  r.setProperty('--color-table-row-stripe', palette.tableRowStripe);
  r.setProperty('--color-table-checkbox', palette.tableCheckbox);
  r.setProperty('--color-table-checkbox-bg', palette.tableCheckboxBg);
  r.setProperty('--color-table-focus-ring', palette.tableFocusRing);
  r.setProperty('--color-pagination-bg', palette.paginationBg);
  r.setProperty('--color-pagination-active', palette.paginationActive);
  r.setProperty('--color-pagination-active-text', palette.paginationActiveText);
  r.setProperty('--color-pagination-hover', palette.paginationHover);
  r.setProperty('--color-table-footer-bg', palette.tableFooterBg);
  r.setProperty('--color-table-scrollbar', palette.tableScrollbar);
  r.setProperty('--color-table-selection-bar', palette.tableSelectionBar);
}

/**
 * Apply theme overrides to the DOM.
 * Call this after applyTenantBranding() to layer theme on top of company branding.
 *
 * @param theme - The full ThemeSettings object from the settings service
 */
export function applyThemeOverrides(theme: ThemeSettings): void {
  if (typeof document === 'undefined') return;
  theme = normalizeBuiltInTheme(theme);
  const root = document.documentElement;
  const r = root.style;
  root.setAttribute?.('data-erp-theme', theme.selectedTheme);

  // Clear previous theme vars first
  clearThemeOverrides();

  // ── Apply palette for current mode ────────────────────
  const mode = getCurrentMode();
  applyPaletteFromPreset(theme.selectedTheme, mode);

  // ── Base UI tokens from theme (preset or user-selected) ────
  r.setProperty(`${THEME_VAR_PREFIX}radius`, mapRadius(theme.borderRadius));
  r.setProperty(`${THEME_VAR_PREFIX}shadow-sm`, mapShadow('subtle'));
  r.setProperty(`${THEME_VAR_PREFIX}shadow-md`, mapShadow(theme.shadowStyle));
  r.setProperty(`${THEME_VAR_PREFIX}shadow-lg`, mapShadow(theme.shadowStyle === 'strong' ? 'strong' : 'medium'));
  r.setProperty(`${THEME_VAR_PREFIX}card-shadow`, mapCardShadow(theme.cardStyle, theme.shadowStyle));
  const sidebarWidths = mapSidebarWidths(theme.sidebarStyle);
  r.setProperty(`${THEME_VAR_PREFIX}sidebar-collapsed-width`, sidebarWidths.collapsed);
  r.setProperty(`${THEME_VAR_PREFIX}sidebar-expanded-width`, sidebarWidths.expanded);
  const kpiTokens = mapKpiTokens(theme.kpiStyle);
  r.setProperty(`${THEME_VAR_PREFIX}kpi-border-width`, kpiTokens.borderWidth);
  r.setProperty(`${THEME_VAR_PREFIX}kpi-shadow`, kpiTokens.shadow);
  r.setProperty(`${THEME_VAR_PREFIX}density`, mapDensity(theme.density));
  r.setProperty(`${THEME_VAR_PREFIX}card-style`, theme.cardStyle);
  r.setProperty(`${THEME_VAR_PREFIX}sidebar-style`, theme.sidebarStyle);
  r.setProperty(`${THEME_VAR_PREFIX}kpi-style`, theme.kpiStyle);
  r.setProperty(`${THEME_VAR_PREFIX}font`, theme.font);
  r.setProperty(`${THEME_VAR_PREFIX}chart-palette`, theme.chartPaletteId);
}

/**
 * Re-apply the current theme palette for the current mode.
 * Called when the user switches between light and dark mode.
 */
export function reapplyThemeForMode(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const themeId = root.getAttribute('data-erp-theme') || 'classic';
  const mode = getCurrentMode();
  applyPaletteFromPreset(themeId, mode);
}
