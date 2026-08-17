import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_THEME_IDS } from '../../../theme/presetIds';
import { getPreset, normalizeBuiltInTheme, THEME_PRESETS } from '../../../theme/presets';
import { validateThemeSettings } from '../validation';
import { useAppStore } from '../../../store/useAppStore';

const mocks = vi.hoisted(() => ({
  getOne: vi.fn(), updateDocById: vi.fn(), createDocWithId: vi.fn(),
}));

vi.mock('../../../lib/firestore', () => ({
  getOne: mocks.getOne,
  updateDocById: mocks.updateDocById,
  createDocWithId: mocks.createDocWithId,
  genId: { generic: vi.fn(() => 'AUD-theme') },
  resolveWriteCompanyId: () => useAppStore.getState().activeCompanyId || useAppStore.getState().user?.companyId || '',
}));
vi.mock('../../../lib/firebase', () => ({ COLLECTIONS: { SETTINGS: 'settings', AUDIT_LOGS: 'audit_logs' } }));
vi.mock('../../../lib/sanitizer', () => ({ sanitizePayload: (value: unknown) => value }));
vi.mock('../permissions', () => ({ canEditSection: () => true }));

import { getSectionScope, loadSettings, resetSettings, saveSettings } from '../services/settingsService';

function themePayload(id: typeof BUILT_IN_THEME_IDS[number]) {
  const preset = getPreset(id)!;
  return {
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
    themeOverrides: { colors: { primary: '#000000' } },
  };
}

describe('Theme & Appearance canonical lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeCompanyId: 'company-1',
      user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com', role: 'Admin', companyId: 'company-1', isSuperAdmin: true },
      isAuthenticated: true,
    });
  });

  it('uses one canonical list of exactly five IDs and validates each', () => {
    expect(BUILT_IN_THEME_IDS).toEqual(['classic', 'royal-indigo', 'emerald-pro', 'amber-enterprise', 'slate-graphite']);
    expect(THEME_PRESETS.map((preset) => preset.id)).toEqual(BUILT_IN_THEME_IDS);
    for (const id of BUILT_IN_THEME_IDS) expect(validateThemeSettings(themePayload(id))).toEqual({ valid: true, errors: {} });
  });

  it('normalizes every supported ID unchanged and maps legacy values to classic', () => {
    for (const id of BUILT_IN_THEME_IDS) expect(normalizeBuiltInTheme(themePayload(id) as any).selectedTheme).toBe(id);
    for (const legacy of ['enterprise', 'solar-green', 'classic-blue', 'enterprise-dark', 'emerald', 'purple', 'modern-gray', 'custom']) {
      const normalized = normalizeBuiltInTheme({ ...themePayload('classic'), selectedTheme: legacy } as any);
      expect(normalized.selectedTheme).toBe('classic');
      expect(normalized.themeOverrides).toEqual({ colors: {} });
    }
  });

  it('keeps arbitrary invalid IDs invalid', () => {
    expect(validateThemeSettings({ ...themePayload('classic'), selectedTheme: 'random-theme' })).toMatchObject({ valid: false, errors: { selectedTheme: 'Invalid theme selection' } });
    expect(normalizeBuiltInTheme({ ...themePayload('classic'), selectedTheme: 'random-theme' } as any).selectedTheme).toBe('random-theme');
  });

  it('persists every canonical theme through the company-scoped settings document', async () => {
    expect(getSectionScope('theme-ui')).toBe('company');
    for (const id of BUILT_IN_THEME_IDS) {
      mocks.getOne.mockResolvedValueOnce(null);
      await saveSettings('theme-ui', themePayload(id) as any);
      const settingsCall = mocks.createDocWithId.mock.calls.find((call) => call[0] === 'settings' && call[1] === 'company-1_settings_theme-ui');
      expect(settingsCall?.[2]).toMatchObject({ companyId: 'company-1', section: 'theme-ui', data: { selectedTheme: id, themeOverrides: { colors: {} } } });
      mocks.createDocWithId.mockClear();
    }
  });

  it('reloads saved themes, normalizes legacy documents, and resets to classic', async () => {
    mocks.getOne.mockResolvedValueOnce({ data: themePayload('classic') });
    await expect(loadSettings('theme-ui')).resolves.toMatchObject({ selectedTheme: 'classic' });
    mocks.getOne.mockResolvedValueOnce({ data: { ...themePayload('classic'), selectedTheme: 'solar-green' as any } });
    await expect(loadSettings('theme-ui')).resolves.toMatchObject({ selectedTheme: 'classic', themeOverrides: { colors: {} } });
    mocks.getOne.mockResolvedValueOnce({ id: 'company-1_settings_theme-ui' });
    await resetSettings('theme-ui');
    expect(mocks.updateDocById).toHaveBeenCalledWith('settings', 'company-1_settings_theme-ui', expect.objectContaining({ data: expect.objectContaining({ selectedTheme: 'classic' }) }));
  });
});