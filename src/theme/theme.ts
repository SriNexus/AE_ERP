export type ThemeMode = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'neozy-theme-mode';
export const THEME_CYCLE: ThemeMode[] = ['light', 'dark', 'system'];
export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? getSystemTheme() : mode;
}
export function applyThemeToDOM(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}
export function loadThemeMode(): ThemeMode {
  try { const s = localStorage.getItem(THEME_STORAGE_KEY); if (s === 'light' || s === 'dark' || s === 'system') return s; } catch { }
  return 'system';
}
export function saveThemeMode(mode: ThemeMode): void { try { localStorage.setItem(THEME_STORAGE_KEY, mode); } catch { } }
export function nextThemeMode(current: ThemeMode): ThemeMode { return THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length]; }
export interface TenantBrandTokens { primaryColor?: string; accentColor?: string; }
export function applyTenantBranding(tokens: TenantBrandTokens): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  if (tokens.primaryColor) { r.style.setProperty('--color-primary', tokens.primaryColor); r.style.setProperty('--color-primary-text', tokens.primaryColor); r.style.setProperty('--color-sidebar-active-bg', tokens.primaryColor); r.style.setProperty('--color-focus-ring', tokens.primaryColor); }
  if (tokens.accentColor) { r.style.setProperty('--color-accent', tokens.accentColor); r.style.setProperty('--color-accent-hover', tokens.accentColor); }
}
export function clearTenantBranding(): void {
  if (typeof document === 'undefined') return;
  ['--color-primary','--color-primary-text','--color-sidebar-active','--color-focus-ring','--color-accent','--color-accent-hover'].forEach(p => document.documentElement.style.removeProperty(p));
}
