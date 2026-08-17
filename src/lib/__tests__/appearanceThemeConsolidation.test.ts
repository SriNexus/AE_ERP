import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyThemeToDOM, loadThemeMode, nextThemeMode, resolveTheme, saveThemeMode } from '../../theme/theme';

describe('P06 appearance/theme consolidation', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
    } as any);

    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: vi.fn(),
        classList: {
          toggle: vi.fn(),
        },
        style: {
          setProperty: vi.fn(),
        },
      },
    } as any);

    vi.stubGlobal('window', {
      matchMedia: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    } as any);
  });

  it('keeps the theme cache on localStorage and resolves the effective theme correctly', () => {
    expect(loadThemeMode()).toBe('system');
    saveThemeMode('dark');
    expect(loadThemeMode()).toBe('dark');
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
    expect(nextThemeMode('light')).toBe('dark');
    expect(nextThemeMode('dark')).toBe('system');
  });

  it('applies the resolved theme to the DOM without inventing a second theme system', () => {
    applyThemeToDOM('dark');

    const root = (globalThis as any).document.documentElement;
    expect(root.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    expect(root.classList.toggle).toHaveBeenCalledWith('dark', true);
  });

  it('keeps Firestore canonical with localStorage pre-hydration in useTheme', () => {
    const source = readFileSync('src/theme/useTheme.ts', 'utf8');
    expect(source).toContain("useSettingsSection('appearance'");
    expect(source).toContain('settingsDocumentExists');
    expect(source).toContain('loadThemeMode()');
    expect(source).toContain('saveThemeMode');
    expect(source).toContain('applyThemeToDOM');
  });

  it('keeps the real Appearance section and ThemeProvider wiring in place', () => {
    const section = readFileSync('src/components/settings/sections/AppearanceSection.tsx', 'utf8');
    const provider = readFileSync('src/theme/ThemeProvider.tsx', 'utf8');

    expect(section).toContain('Theme Mode');
    expect(section).not.toContain('SettingsPlaceholder');
    expect(section).toContain('useSettingsSection(\'appearance\'');
    expect(section).toContain('applyAppearancePreview');
    expect(section).toContain('applyThemeToDOM(resolveTheme(value.themeMode))');
    expect(section).toContain("classList.toggle('high-contrast'");
    expect(section).toContain("classList.toggle('compact-ui'");
    expect(section).toContain("classList.toggle('reduce-motion'");
    expect(section).toContain("style.setProperty('--personal-font-scale'");
    expect(section).toContain("reset.mutateAsync('appearance')");
    expect(section).toContain("section: 'appearance'");
    expect(provider).toContain('highContrast');
    expect(provider).toContain('compactMode');
    expect(provider).toContain('reducedMotion');
    expect(provider).toContain('sidebarCollapsed');
    expect(provider).toContain('fontSize');
  });

  it('regression: High Contrast, Reduce Motion, and Compact Density are real clickable controls — they previously rendered as toggle-switch-styled <label> elements with NO onClick handler at all (confirmed live: clicking them did nothing, Save never enabled)', () => {
    const section = readFileSync('src/components/settings/sections/AppearanceSection.tsx', 'utf8');
    // Each must be wired through the shared set() handler.
    expect(section).toMatch(/onClick=\{\(\) => \{ set\(key, !form\[key\]\); \}\}/);
    expect(section).toMatch(/onClick=\{\(\) => \{ set\('compactMode', !form\.compactMode\); \}\}/);
  });

  it('regression: fontSize scale/migration is a single shared module, not duplicated inline tables in AppearanceSection.tsx and ThemeProvider.tsx — the duplication (kept in sync only by a comment) is exactly what let one copy diverge and reapply migration to already-current data, silently downgrading a saved "large" to "medium" on the next load', () => {
    const section = readFileSync('src/components/settings/sections/AppearanceSection.tsx', 'utf8');
    const provider = readFileSync('src/theme/ThemeProvider.tsx', 'utf8');
    expect(section).toContain("from '../../../features/settings/appearanceRuntime'");
    expect(provider).toContain("from '../features/settings/appearanceRuntime'");
    expect(section).not.toMatch(/FS_SCALE|FS_MIGRATE/);
    expect(provider).not.toMatch(/const MIGRATE:|const SCALE:/);
  });

  it('regression: the setForm updater in AppearanceSection.tsx does not call another store\'s setState (setSidebarOpen/setNavigationStyle) from inside it — nesting a cross-store update inside a setState updater produced a real, reproducible console error ("Cannot update a component (CompanySwitcher) while rendering a different component (AppearanceSection)"), confirmed live and fixed by moving those calls out to run alongside setForm instead of inside its callback', () => {
    const section = readFileSync('src/components/settings/sections/AppearanceSection.tsx', 'utf8');
    // Captures only the inner setForm((old) => { ... }); callback body, up to
    // its own closing `});` — NOT the outer set() function's closing `};`,
    // which would wrongly include the (correctly-external) side-effect calls.
    const updaterMatch = section.match(/setForm\(\(old\) => \{[\s\S]*?\n {4}\}\);/);
    expect(updaterMatch).not.toBeNull();
    const updaterBody = updaterMatch![0];
    expect(updaterBody).not.toContain('setSidebarOpen');
    expect(updaterBody).not.toContain('setNavigationStyle');
    // And confirm the side-effect calls DO still exist, just outside it.
    expect(section).toContain('setSidebarOpen(value !== \'click\')');
    expect(section).toContain("setNavigationStyle(value as 'sidebar' | 'app-launcher')");
  });
});
