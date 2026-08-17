import { useEffect, useMemo, useState } from 'react';
import { Monitor, Moon, RotateCcw, Save, Sun, Type, Contrast, Eye, Sidebar, Zap, LayoutGrid, PanelLeft } from 'lucide-react';
import { useSettingsSection, useSaveSettings, useResetSettings } from '../../../features/settings/hooks/useSettingsSection';
import { DEFAULT_APPEARANCE_SETTINGS } from '../../../features/settings/defaults';
import type { AppearanceSettings } from '../../../features/settings/types';
import { validateAppearanceSettings } from '../../../features/settings/validation';
import { useUnsavedChangesGuard } from '../../../features/settings/hooks/useUnsavedChangesGuard';
import { SettingsSection } from '../SettingsSection';
import { SettingsCard } from '../SettingsCard';
import { Button } from '../../ui/Button';
import { cn } from '../../../utils/cn';
import { applyThemeToDOM, resolveTheme } from '../../../theme/theme';
import { useAppStore } from '../../../store/useAppStore';
import { fontScaleFor } from '../../../features/settings/appearanceRuntime';

/**
 * Apply appearance preview changes to the DOM instantly.
 * Font-scale source of truth is appearanceRuntime.ts, shared with
 * ThemeProvider.tsx's authoritative (post-save) application — see that
 * module's header comment for why this used to drift out of sync.
 */
function applyAppearancePreview(value: AppearanceSettings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  applyThemeToDOM(resolveTheme(value.themeMode));
  root.classList.toggle('high-contrast', value.highContrast);
  root.classList.toggle('compact-ui', value.compactMode);
  root.classList.toggle('reduce-motion', value.reducedMotion);
  root.style.setProperty('--personal-font-scale', fontScaleFor(value.fontSize));
  root.setAttribute('data-sidebar-behavior', value.sidebarBehavior === 'click' ? 'click' : 'auto');
}

export function AppearanceSection() {
  const query = useSettingsSection('appearance');
  const save = useSaveSettings();
  const reset = useResetSettings();
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setNavigationStyle = useAppStore((s) => s.setNavigationStyle);
  const [form, setForm] = useState<AppearanceSettings>(DEFAULT_APPEARANCE_SETTINGS);

  // Load persisted data. fontSize legacy-label migration already happened in
  // settingsService.loadSettings() — the single place with access to the RAW
  // pre-defaults-merge document, which is required to tell a legacy document
  // apart from a current one (see appearanceRuntime.ts). query.data here is
  // always already canonical; this effect only merges in any fields a very
  // old document might still be missing.
  useEffect(() => {
    if (query.data && Object.keys(query.data).length) {
      const loaded = { ...DEFAULT_APPEARANCE_SETTINGS, ...query.data } as AppearanceSettings;
      setForm(loaded);
      // Sync navigationStyle to Zustand store on load
      if (loaded.navigationStyle) {
        setNavigationStyle(loaded.navigationStyle);
      }
    }
  }, [query.data, setNavigationStyle]);

  const confirmed = useMemo(() => ({ ...DEFAULT_APPEARANCE_SETTINGS, ...(query.data || {}) } as AppearanceSettings), [query.data]);

  const dirty = JSON.stringify(form) !== JSON.stringify(confirmed);
  useUnsavedChangesGuard(dirty);
  const validation = validateAppearanceSettings(form as unknown as Record<string, unknown>);

  // Cross-store side effects (setSidebarOpen/setNavigationStyle) MUST run
  // outside the setForm updater, not inside it. React treats a setState
  // updater as effectively part of the render cycle and may invoke it more
  // than once (StrictMode does, deliberately, to catch exactly this); a
  // DIFFERENT store's setState call nested inside one produced a real,
  // reproducible console error — "Cannot update a component (CompanySwitcher)
  // while rendering a different component (AppearanceSection)" — confirmed
  // live for the sidebarBehavior path. Keeping the updater itself limited to
  // computing and returning the next form state (plus the idempotent DOM
  // preview write) avoids it.
  const set = <K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) => {
    setForm((old) => {
      const next = { ...old, [key]: value };
      applyAppearancePreview(next);
      return next;
    });
    if (key === 'sidebarBehavior') {
      setSidebarOpen(value !== 'click');
    }
    if (key === 'navigationStyle') {
      setNavigationStyle(value as 'sidebar' | 'app-launcher');
    }
  };

  async function saveAppearance() {
    try { await save.mutateAsync({ section: 'appearance', data: form as unknown as Record<string, unknown> }); } catch { /* keep draft */ }
  }

  async function resetAppearance() {
    try {
      await reset.mutateAsync('appearance');
      setForm(DEFAULT_APPEARANCE_SETTINGS);
      applyAppearancePreview(DEFAULT_APPEARANCE_SETTINGS);
    } catch { /* keep draft */ }
  }

  if (query.isLoading) return <div className="h-72 animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />;
  if (query.isError) return (
    <div className="rounded-xl border border-[var(--color-danger)] p-5">
      <p className="text-sm text-[var(--color-danger)]">Appearance settings could not be loaded.</p>
      <Button className="mt-3" variant="outline" onClick={() => query.refetch()}>Retry</Button>
    </div>
  );

  return (
    <SettingsSection title="Appearance" description="Personal presentation preferences synchronized across devices.">
      {/* ── 1. Home Logo Action ── */}
      <SettingsCard title="Home Logo Action">
        <p className="text-[11px] text-[var(--color-text-muted)] mb-3">Choose what happens when you tap the top-left ERP logo</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            { value: 'sidebar' as const, label: 'Open Sidebar', description: 'Logo click opens the sidebar navigation drawer. Default option.', Icon: PanelLeft },
            { value: 'app-launcher' as const, label: 'Open App Launcher', description: 'Logo click opens the App Launcher (module grid).', Icon: LayoutGrid },
          ]).map(({ value, label, description, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => { set('navigationStyle', value); }}
              className={cn(
                'relative flex items-start gap-3 min-h-[64px] rounded-xl border-2 px-4 py-3 text-left transition-all duration-200',
                form.navigationStyle === value
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] shadow-md'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] hover:shadow-sm hover:-translate-y-0.5',
              )}
            >
              <div className={cn('p-2 rounded-lg transition-colors', form.navigationStyle === value ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]')}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <span className={cn('text-sm font-bold', form.navigationStyle === value ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text)]')}>{label}</span>
                <p className={cn('text-[11px] leading-snug mt-0.5', form.navigationStyle === value ? 'text-[var(--color-primary-text)]/80' : 'text-[var(--color-text-muted)]')}>{description}</p>
              </div>
              {form.navigationStyle === value && (
                <div className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center shadow-md">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </SettingsCard>

      {/* ── 2. Theme Mode ── */}
      <SettingsCard title="Theme Mode">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([
            { mode: 'light' as const, label: 'Light', description: 'Bright interface for daytime use', Icon: Sun },
            { mode: 'dark' as const, label: 'Dark', description: 'Easy on the eyes in low light', Icon: Moon },
            { mode: 'system' as const, label: 'System', description: 'Follows your device preference', Icon: Monitor },
          ]).map(({ mode, label, description, Icon }) => (
            <button
              key={mode}
              type="button"
              onClick={() => { set('themeMode', mode); }}
              className={cn(
                'relative flex items-start gap-3 min-h-[72px] rounded-xl border-2 px-4 py-3 text-left transition-all duration-200',
                form.themeMode === mode
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] shadow-md'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] hover:shadow-sm hover:-translate-y-0.5',
              )}
            >
              <div className={cn('p-2 rounded-lg transition-colors', form.themeMode === mode ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]')}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <span className={cn('text-sm font-bold', form.themeMode === mode ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text)]')}>{label}</span>
                <p className={cn('text-[11px] leading-snug mt-0.5', form.themeMode === mode ? 'text-[var(--color-primary-text)]/80' : 'text-[var(--color-text-muted)]')}>{description}</p>
              </div>
              {form.themeMode === mode && (
                <div className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center shadow-md">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
              )}
            </button>
          ))}
        </div>
        {validation.errors.themeMode && <p className="mt-2 text-xs text-[var(--color-danger)]">{validation.errors.themeMode}</p>}
      </SettingsCard>

      {/* ── 2. Display Preferences (Text Size only) ── */}
      <SettingsCard title="Display Preferences">
        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] mb-2">
            <Type className="h-3.5 w-3.5" /> Text Size
          </label>
          <div className="flex gap-1.5">
            {[
              { value: 'small', label: 'Small', desc: '14px — Compact' },
              { value: 'medium', label: 'Medium', desc: '17px — Default' },
              { value: 'large', label: 'Large', desc: '20px — Readable' },
            ].map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => { set('fontSize', value as AppearanceSettings['fontSize']); }}
                className={cn(
                  'flex-1 flex flex-col items-center gap-0.5 min-h-[56px] rounded-xl border px-3 py-2 transition-all duration-200',
                  form.fontSize === value
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] shadow-sm'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]',
                )}
              >
                <span className={cn(
                  'font-bold transition-all',
                  form.fontSize === value ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text)]',
                  value === 'small' ? 'text-xs' : value === 'large' ? 'text-sm' : 'text-[13px]',
                )}>{label}</span>
                <span className="text-[9px] text-[var(--color-text-muted)]">{desc}</span>
              </button>
            ))}
          </div>
          {validation.errors.fontSize && <p className="mt-1 text-xs text-[var(--color-danger)]">{validation.errors.fontSize}</p>}
        </div>
      </SettingsCard>

      {/* ── 3. Accessibility ── */}
      <SettingsCard title="Accessibility">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {([
            { key: 'highContrast' as const, label: 'High Contrast', desc: 'Enhanced contrast for better readability', icon: <Contrast className="h-4 w-4" /> },
            { key: 'reducedMotion' as const, label: 'Reduce Motion', desc: 'Minimize animations across the interface', icon: <Zap className="h-4 w-4" /> },
          ]).map(({ key, label, desc, icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={form[key]}
              onClick={() => { set(key, !form[key]); }}
              className={cn(
                'flex items-start gap-3 rounded-xl border px-4 py-3 text-left cursor-pointer transition-all duration-200',
                form[key] ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]',
              )}
            >
              <div className={cn('p-2 rounded-lg transition-colors', form[key] ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]')}>
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <span className={cn('text-sm font-semibold', form[key] ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text)]')}>{label}</span>
                  <div className={cn('relative w-10 h-5 rounded-full transition-colors duration-200 shrink-0', form[key] ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border-strong)]')}>
                    <div className={cn('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200', form[key] && 'translate-x-5')} />
                  </div>
                </div>
                <p className={cn('text-[11px] leading-snug mt-0.5', form[key] ? 'text-[var(--color-primary-text)]/80' : 'text-[var(--color-text-muted)]')}>{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </SettingsCard>

      {/* ── 4. Workspace Preferences ── */}
      <SettingsCard title="Workspace Preferences">
        <div className="space-y-4">
          {/* Compact Density — toggle switch (consistent with Accessibility) */}
          <button
            type="button"
            aria-pressed={form.compactMode}
            onClick={() => { set('compactMode', !form.compactMode); }}
            className={cn(
              'flex items-start gap-3 w-full rounded-xl border px-4 py-3 text-left cursor-pointer transition-all duration-200',
              form.compactMode ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]',
            )}
          >
            <div className={cn('p-2 rounded-lg transition-colors', form.compactMode ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]')}>
              <LayoutGrid className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <span className={cn('text-sm font-semibold', form.compactMode ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text)]')}>Compact Density</span>
                <div className={cn('relative w-10 h-5 rounded-full transition-colors duration-200 shrink-0', form.compactMode ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border-strong)]')}>
                  <div className={cn('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200', form.compactMode && 'translate-x-5')} />
                </div>
              </div>
              <p className={cn('text-[11px] leading-snug mt-0.5', form.compactMode ? 'text-[var(--color-primary-text)]/80' : 'text-[var(--color-text-muted)]')}>Tighter spacing for data-dense views</p>
            </div>
          </button>

          {/* Sidebar Behavior */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] mb-2">
              <Sidebar className="h-3.5 w-3.5" /> Sidebar Opening Behavior
            </label>
            <p className="text-[11px] text-[var(--color-text-muted)] mb-2">Control how the sidebar opens</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([
                { value: 'auto' as const, label: 'Automatic', description: 'Sidebar responds naturally — expands on hover. Best for dynamic navigation.', Icon: Sidebar },
                { value: 'click' as const, label: 'Click to Open', description: 'Sidebar stays collapsed until you explicitly click it. No accidental triggers.', Icon: Eye },
              ]).map(({ value, label, description, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { set('sidebarBehavior', value); }}
                  className={cn(
                    'relative flex items-start gap-3 min-h-[64px] rounded-xl border-2 px-4 py-3 text-left transition-all duration-200',
                    form.sidebarBehavior === value
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] shadow-md'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] hover:shadow-sm hover:-translate-y-0.5',
                  )}
                >
                  <div className={cn('p-2 rounded-lg transition-colors', form.sidebarBehavior === value ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]')}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <span className={cn('text-sm font-bold', form.sidebarBehavior === value ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text)]')}>{label}</span>
                    <p className={cn('text-[11px] leading-snug mt-0.5', form.sidebarBehavior === value ? 'text-[var(--color-primary-text)]/80' : 'text-[var(--color-text-muted)]')}>{description}</p>
                  </div>
                  {form.sidebarBehavior === value && (
                    <div className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center shadow-md">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>

      {/* ── Action Bar ── */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} loading={reset.isPending} onClick={() => { void resetAppearance(); }}>Reset to Defaults</Button>
        <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty || !validation.valid} onClick={() => { void saveAppearance(); }}>Save Changes</Button>
      </div>
    </SettingsSection>
  );
}
