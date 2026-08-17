/**
 * ThemeUISection — ERP Theme Selection (cleaned).
 *
 * Following the Theme & Appearance audit (Phase 1.6):
 *   - REMOVED: UI Settings tab (borderRadius, shadowStyle, font, cardStyle,
 *     kpiStyle, sidebarStyle, density, animation — these were CSS-var-only
 *     controls with no visible UI effect in components).
 *   - REMOVED: Preview tab (cosmetic only).
 *   - KEPT: 5 personality-driven theme cards with visual preview.
 *
 * The Theme Engine (applyThemeOverrides) still applies all preset values
 * internally; only the user-facing controls have been removed.
 *
 * Company identity (colors, logo) is managed exclusively via Companies module.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Check, Save } from 'lucide-react';
import { useSettingsSection, useSaveSettings } from '../../../features/settings/hooks/useSettingsSection';
import { useUnsavedChangesGuard } from '../../../features/settings/hooks/useUnsavedChangesGuard';
import { useAppStore } from '../../../store/useAppStore';
import { normalizeBuiltInTheme, THEME_PRESETS, type ThemePresetId } from '../../../theme/presets';
import { applyThemeOverrides } from '../../../theme/applyThemeOverrides';
import type { ThemeSettings } from '../../../features/settings/types';
import { SettingsSection } from '../SettingsSection';
import { cn } from '../../../utils/cn';

// ── Admin/Management check ────────────────────────────────────
function useCanEditTheme(): boolean {
  const role = useAppStore((s) => s.user?.role);
  if (!role) return false;
  return ['Super Admin', 'Admin', 'Management'].includes(role);
}

// ── Default theme state ───────────────────────────────────────
const DEFAULT_THEME: ThemeSettings = {
  selectedTheme: 'classic',
  borderRadius: 'medium',
  cardStyle: 'elevated',
  sidebarStyle: 'default',
  kpiStyle: 'bordered',
  density: 'comfortable',
  animation: true,
  shadowStyle: 'medium',
  font: 'inter',
  chartPaletteId: 'default',
  customChartPalette: undefined,
  themeOverrides: { colors: {} },
};

// ── Personality metadata for theme cards ──────────────────────
const THEME_META: Record<string, { bg: string; accent: string; label: string }> = {
  'classic':          { bg: '#4f46e5', accent: '#10b981', label: 'Flagship' },
  'royal-indigo':     { bg: '#7c3aed', accent: '#f59e0b', label: 'Premium' },
  'emerald-pro':      { bg: '#059669', accent: '#d97706', label: 'Organic' },
  'amber-enterprise': { bg: '#d97706', accent: '#6366f1', label: 'Enterprise' },
  'slate-graphite':   { bg: '#475569', accent: '#06b6d4', label: 'Minimal' },
};

function cardGradient(color: string, accent: string) {
  return `linear-gradient(135deg, ${color} 0%, ${color}cc 60%, ${accent}33 100%)`;
}

export function ThemeUISection() {
  const canEdit = useCanEditTheme();
  const { data: savedTheme, isLoading } = useSettingsSection('theme-ui');
  const saveMutation = useSaveSettings();

  const [theme, setTheme] = useState<ThemeSettings>(DEFAULT_THEME);
  const [isDirty, setIsDirty] = useState(false);
  const persistedRef = useRef<ThemeSettings>(DEFAULT_THEME);
  useUnsavedChangesGuard(isDirty);

  // Load saved theme
  useEffect(() => {
    if (savedTheme && Object.keys(savedTheme).length > 0) {
      const persisted = normalizeBuiltInTheme({ ...DEFAULT_THEME, ...savedTheme } as ThemeSettings);
      persistedRef.current = persisted;
      setTheme(persisted);
    }
  }, [savedTheme]);

  // Live preview on selection change
  useEffect(() => {
    applyThemeOverrides(theme);
  }, [theme.selectedTheme]);

  // Restore persisted on unmount
  useEffect(() => () => {
    applyThemeOverrides(persistedRef.current);
  }, []);

  function handleSelectPreset(id: ThemePresetId) {
    if (!canEdit) return;
    const preset = THEME_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setTheme((prev) => ({
      ...prev,
      selectedTheme: id,
      borderRadius: preset.values.borderRadius,
      cardStyle: preset.values.cardStyle,
      sidebarStyle: preset.values.sidebarStyle,
      kpiStyle: preset.values.kpiStyle,
      density: preset.values.density,
      animation: preset.values.animation,
      shadowStyle: preset.values.shadowStyle,
      font: preset.values.font,
      chartPaletteId: preset.values.chartPaletteId,
      customChartPalette: undefined,
      themeOverrides: { colors: {} },
    }));
    setIsDirty(true);
  }

  async function handleSave() {
    const payload = { ...theme, customChartPalette: undefined, themeOverrides: { colors: {} } };
    try {
      await saveMutation.mutateAsync({ section: 'theme-ui', data: payload as unknown as Record<string, unknown> });
      persistedRef.current = payload;
      setIsDirty(false);
    } catch {
      // keep draft dirty on failure
    }
  }

  function handleCancel() {
    const persisted = persistedRef.current;
    setTheme(persisted);
    setIsDirty(false);
  }

  if (isLoading) {
    return <SettingsSection title="ERP Theme" isLoading />;
  }

  const currentPreset = THEME_PRESETS.find((p) => p.id === theme.selectedTheme);
  const meta = THEME_META[theme.selectedTheme] || THEME_META.classic;

  return (
    <SettingsSection
      title="ERP Theme"
      description="Choose the visual identity of your ERP interface"
    >
      {/* ── Save bar ── */}
      {canEdit && isDirty && (
        <div className="flex items-center justify-between mb-6 px-5 py-3 rounded-xl bg-[var(--color-primary-light)] border border-[var(--color-primary-muted)] animate-fadeIn">
          <span className="text-sm font-medium text-[var(--color-primary-text)]">You have unsaved theme changes</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saveMutation.isPending}
              className="px-4 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text)] disabled:opacity-50 hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={saveMutation.isPending}
              className="px-4 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity inline-flex items-center gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {saveMutation.isPending ? 'Saving...' : 'Save Theme'}
            </button>
          </div>
        </div>
      )}

      {/* ── Current Theme Hero ── */}
      {currentPreset && (
        <div
          className="mb-6 p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
          style={{ borderLeft: `4px solid ${meta.bg}` }}
        >
          <div className="flex items-center gap-4">
            <div
              className="h-12 w-12 rounded-xl flex items-center justify-center text-white text-lg font-bold shadow-md shrink-0"
              style={{ background: cardGradient(meta.bg, meta.accent) }}
            >
              {currentPreset.label.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[var(--color-text)]">{currentPreset.label}</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">{meta.label}</span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{currentPreset.description}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Theme Selection Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {THEME_PRESETS.map((preset) => {
          const isActive = theme.selectedTheme === preset.id;
          const pMeta = THEME_META[preset.id] || meta;

          return (
            <button
              key={preset.id}
              onClick={() => handleSelectPreset(preset.id)}
              disabled={!canEdit}
              className={cn(
                'relative flex flex-col rounded-xl border-2 transition-all duration-300 overflow-hidden text-left',
                isActive
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] shadow-lg scale-[1.02]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] hover:shadow-md hover:-translate-y-0.5',
                !canEdit && 'cursor-default opacity-80',
              )}
            >
              {/* Preview strip */}
              <div
                className="h-16 w-full relative flex items-end p-3"
                style={{ background: cardGradient(pMeta.bg, pMeta.accent) }}
              >
                <span className="text-white text-xs font-bold drop-shadow-sm">{preset.label}</span>
                <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-white/20 text-white backdrop-blur-sm">
                  {pMeta.label}
                </span>
              </div>

              {/* Info */}
              <div className="flex flex-col gap-1.5 p-3">
                <p className="text-[10px] text-[var(--color-text-muted)] leading-snug line-clamp-2">{preset.description}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="h-1.5 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${pMeta.bg}, ${pMeta.bg}88)` }} />
                  <div className="h-1.5 flex-1 rounded-full bg-[var(--color-border-subtle)]" />
                  <div className="h-1.5 flex-1 rounded-full bg-[var(--color-border-subtle)]" />
                </div>
              </div>

              {isActive && (
                <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center shadow-md animate-scaleIn">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </div>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-[var(--color-text-muted)] italic">
        Company branding (primary colors, logo) is managed in{' '}
        <a href="/companies" className="text-[var(--color-primary)] underline hover:no-underline">Companies</a>.
      </p>
    </SettingsSection>
  );
}
