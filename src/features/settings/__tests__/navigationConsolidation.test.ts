import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalSettingsSectionId, DEFAULT_SECTION, SETTINGS_SECTIONS } from '../config';

describe('Settings navigation consolidation', () => {
  it('exposes the required navigation order with My Profile first and no Overview', () => {
    const visible = SETTINGS_SECTIONS.filter((section) => section.showInNavigation !== false && section.visible !== false);
    expect(visible.map((section) => section.label)).toEqual([
      'My Profile', 'General', 'Theme & Appearance', 'Notifications',
      'Users & Permissions', 'Automation', 'Documents', 'Email', 'About ERP',
    ]);
    expect(DEFAULT_SECTION).toBe('my-profile');
  });

  it('redirects legacy overview and theme URLs to canonical sections', () => {
    expect(canonicalSettingsSectionId('overview')).toBe('my-profile');
    expect(canonicalSettingsSectionId('theme-ui')).toBe('theme-appearance');
    expect(canonicalSettingsSectionId('appearance')).toBe('theme-appearance');
  });

  it('composes both existing theme sections without merging persistence domains', () => {
    const merged = readFileSync('src/components/settings/sections/ThemeAppearanceSection.tsx', 'utf8');
    const companyTheme = readFileSync('src/components/settings/sections/ThemeUISection.tsx', 'utf8');
    const personalAppearance = readFileSync('src/components/settings/sections/AppearanceSection.tsx', 'utf8');
    const renderer = readFileSync('src/components/settings/SettingsSectionRenderer.tsx', 'utf8');
    expect(renderer).toContain("case 'theme-appearance':");
    expect(renderer).toContain('<ThemeAppearanceSection />');
    expect(merged).toContain('<ThemeUISection />');
    expect(merged).toContain('<AppearanceSection />');
    expect(companyTheme).toContain("useSettingsSection('theme-ui')");
    expect(personalAppearance).toContain("useSettingsSection('appearance')");
    expect(personalAppearance).toContain("section: 'appearance'");
  });

  it('uses the same centralized navigation filter on desktop and mobile', () => {
    const desktop = readFileSync('src/components/settings/SettingsSidebar.tsx', 'utf8');
    const mobile = readFileSync('src/components/mobile/settings/MobileSettingsWorkspace.tsx', 'utf8');
    for (const source of [desktop, mobile]) {
      expect(source).toContain('section.showInNavigation !== false');
      expect(source).toContain('canViewSection(section.id)');
    }
  });
});