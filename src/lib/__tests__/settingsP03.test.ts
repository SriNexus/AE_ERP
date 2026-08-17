import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE_SETTINGS, DEFAULT_GENERAL_SETTINGS } from '../../features/settings/defaults';
import { formatGeneralDate, formatGeneralNumber, getGeneralSettingsRuntime, setGeneralSettingsRuntime } from '../../features/settings/generalRuntime';
import { validateAppearanceSettings, validateGeneralSettings } from '../../features/settings/validation';
import { readFileSync } from 'node:fs';

describe('P03 General settings', () => {
  beforeEach(() => setGeneralSettingsRuntime(DEFAULT_GENERAL_SETTINGS));
  it('preserves the legacy default date and Indian number rendering', () => {
    expect(formatGeneralDate(new Date('2026-07-12T12:00:00Z'))).toBe('12/07/2026');
    expect(formatGeneralNumber(1234567.89)).toBe('12,34,567.89');
  });
  it('consumes customized date, number and timezone settings', () => {
    setGeneralSettingsRuntime({ ...DEFAULT_GENERAL_SETTINGS, dateFormat: 'MM/DD/YYYY', numberFormat: 'en-US', timezone: 'America/New_York' });
    expect(formatGeneralDate(new Date('2026-07-12T01:00:00Z'))).toBe('07/11/2026');
    expect(formatGeneralNumber(1234567.89)).toBe('1,234,567.89');
    expect(getGeneralSettingsRuntime().timezone).toBe('America/New_York');
  });
  it('validates every persisted General field', () => {
    expect(validateGeneralSettings(DEFAULT_GENERAL_SETTINGS as unknown as Record<string, unknown>).valid).toBe(true);
    const result = validateGeneralSettings({ language: 'xx', timezone: 'not/a-zone', dateFormat: 'invalid', numberFormat: 'xx', firstDayOfWeek: 9 });
    expect(Object.keys(result.errors)).toEqual(expect.arrayContaining(['language', 'timezone', 'dateFormat', 'numberFormat', 'firstDayOfWeek']));
  });
  it('is company-scoped in the canonical settings service', () => {
    const source = readFileSync('src/features/settings/services/settingsService.ts', 'utf8');
    expect(source).toMatch(/general:\s*'company'/);
  });
});

describe('P03 Appearance settings', () => {
  it('validates canonical appearance preferences', () => {
    expect(validateAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS as unknown as Record<string, unknown>).valid).toBe(true);
    expect(validateAppearanceSettings({ ...DEFAULT_APPEARANCE_SETTINGS, themeMode: 'neon', fontSize: 'huge' }).errors).toMatchObject({ themeMode: expect.any(String), fontSize: expect.any(String) });
  });
  it('renders real General and Appearance sections instead of placeholders', () => {
    const source = readFileSync('src/components/settings/SettingsSectionRenderer.tsx', 'utf8');
    expect(source).toContain("case 'general':");
    expect(source).toContain('<GeneralSettingsSection />');
    expect(source).toContain("case 'appearance':");
    expect(source).toContain('<AppearanceSection />');
  });
  it('keeps Firestore canonical and localStorage as the pre-hydration cache', () => {
    const source = readFileSync('src/theme/useTheme.ts', 'utf8');
    expect(source).toContain("useSettingsSection('appearance'");
    expect(source).toContain('settingsDocumentExists');
    expect(source).toContain('saveThemeMode');
  });
  it('has a narrow self-write rule without weakening admin-only company settings', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    expect(rules).toContain('isOwnPersonalSettings');
    expect(rules).toContain("isOwnPersonalSettings(request.resource.data, 'appearance')");
    expect(rules).toContain('isAdmin() && sameCompany(request.resource.data)');
  });
});
