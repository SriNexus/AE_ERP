import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_PRESETS } from '../../theme/presets';
import { applyThemeOverrides } from '../../theme/applyThemeOverrides';
import type { ThemeSettings } from '../../features/settings/types';

describe('ERP Theme & Appearance preset runtime', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      documentElement: {
        // applyThemeOverrides calls getCurrentMode(), which reads
        // data-theme off the root element — default to 'light'.
        getAttribute: vi.fn(() => null),
        style: {
          setProperty: vi.fn(),
          removeProperty: vi.fn(),
        },
      },
    } as any);
  });

  it('defines exactly five distinct built-in presets that map to real runtime token combinations', () => {
    expect(THEME_PRESETS).toHaveLength(5);
    expect(THEME_PRESETS.map((preset) => preset.label)).toEqual(['Neozy Blue', 'Royal Indigo', 'Emerald Pro', 'Amber Enterprise', 'Slate Graphite']);
    expect(new Set(THEME_PRESETS.map((preset) => preset.id)).size).toBe(5);
    expect(new Set(THEME_PRESETS.map((preset) => JSON.stringify(preset.values))).size).toBe(5);
  });

  it('applies a distinct ERP-wide palette and layout tokens for every preset', () => {
    const expectedPrimary: Record<string, string> = {
      'classic': '#4f46e5',
      'royal-indigo': '#7c3aed',
      'emerald-pro': '#059669',
      'amber-enterprise': '#d97706',
      'slate-graphite': '#64748b',
    };
    const signatures = new Set<string>();
    for (const preset of THEME_PRESETS) {
      const style = (globalThis as any).document.documentElement.style;
      style.setProperty.mockClear();
      applyThemeOverrides({
        selectedTheme: preset.id,
        borderRadius: preset.values.borderRadius,
        cardStyle: preset.values.cardStyle,
        sidebarStyle: preset.values.sidebarStyle,
        kpiStyle: preset.values.kpiStyle,
        density: preset.values.density,
        animation: preset.values.animation,
        shadowStyle: preset.values.shadowStyle,
        font: preset.values.font,
        chartPaletteId: preset.values.chartPaletteId,
        themeOverrides: { colors: { primary: '#000000' } },
      });
      expect(style.setProperty).toHaveBeenCalledWith('--color-primary', expectedPrimary[preset.id]);
      expect(style.setProperty).not.toHaveBeenCalledWith('--theme-custom-primary', '#000000');
      signatures.add(JSON.stringify(style.setProperty.mock.calls));
    }
    expect(signatures.size).toBe(5);
  });
  it('applies the selected preset to runtime CSS variables and ignores stale custom overrides for preset modes', () => {
    const theme: ThemeSettings = {
      selectedTheme: 'amber-enterprise',
      borderRadius: 'medium',
      cardStyle: 'flat',
      sidebarStyle: 'compact',
      kpiStyle: 'shadowed',
      density: 'compact',
      animation: true,
      shadowStyle: 'subtle',
      font: 'inter',
      chartPaletteId: 'finance',
      customChartPalette: undefined,
      themeOverrides: { colors: { primary: '#000000' } },
    };

    applyThemeOverrides(theme);

    // applyThemeOverrides now uses getCurrentMode() which reads from DOM
    // Since document.documentElement.getAttribute is not mocked, it defaults to 'light'
    const style = (globalThis as any).document.documentElement.style;
    expect(style.setProperty).toHaveBeenCalledWith('--theme-card-shadow', 'none');
    expect(style.setProperty).toHaveBeenCalledWith('--theme-sidebar-collapsed-width', '48px');
    expect(style.setProperty).toHaveBeenCalledWith('--theme-kpi-border-width', '0px');
    expect(style.setProperty).toHaveBeenCalledWith('--color-primary', '#d97706');
    expect(style.setProperty).not.toHaveBeenCalledWith('--theme-custom-primary', '#000000');
  });

  it('keeps visible theme consumers CSS-var driven so live preset changes can update without a rerender', () => {
    const card = readFileSync('src/components/ui/Card.tsx', 'utf8');
    const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
    const filterBar = readFileSync('src/components/ui/FilterBar.tsx', 'utf8');

    expect(card).toContain("boxShadow: 'var(--theme-card-shadow, var(--theme-shadow-md))'");
    expect(sidebar).toContain("var(--theme-sidebar-expanded-width, var(--shell-sidebar-expanded))");
    expect(filterBar).toContain("borderLeftWidth: 'var(--theme-kpi-border-width, 4px)'");
  });
});
