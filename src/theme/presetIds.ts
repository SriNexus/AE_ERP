export const BUILT_IN_THEME_IDS = ['classic', 'royal-indigo', 'emerald-pro', 'amber-enterprise', 'slate-graphite'] as const;
export type BuiltInThemeId = typeof BUILT_IN_THEME_IDS[number];
export const DEFAULT_BUILT_IN_THEME_ID: BuiltInThemeId = 'classic';

// Legacy IDs map to 'classic' via normalizeBuiltInTheme
export const LEGACY_THEME_IDS = ['enterprise', 'solar-green', 'classic-blue', 'enterprise-dark', 'emerald', 'purple', 'modern-gray', 'custom'] as const;

export function isBuiltInThemeId(value: unknown): value is BuiltInThemeId {
  return typeof value === 'string' && (BUILT_IN_THEME_IDS as readonly string[]).includes(value);
}

export function isLegacyThemeId(value: unknown): boolean {
  return typeof value === 'string' && (LEGACY_THEME_IDS as readonly string[]).includes(value);
}