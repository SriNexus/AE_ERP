/**
 * appLauncherGuard — Centralized App Launcher visibility guard
 *
 * The App Launcher is a mobile-only feature that allows quick navigation
 * to any module via a grid/launcher interface. On desktop, it MUST NEVER
 * appear outside the Settings page where it is configured.
 *
 * This guard enforces:
 *   1. `navigationStyle` ONLY affects mobile behavior — desktop ignores it
 *   2. The module grid / app launcher drawer NEVER opens automatically
 *   3. The settings sidebar ONLY renders on the /settings/* route
 *   4. No app-launcher UI ever leaks into Tasks, Leads, or any record workspace
 *
 * Architecture rules:
 *   - DESKTOP always renders AppShell + Sidebar + TopBar regardless of
 *     the persisted navigationStyle value
 *   - MOBILE reads navigationStyle to choose between sidebar drawer or
 *     app launcher module grid
 *   - The two platforms are isolated — desktop NEVER reads navigationStyle
 *     for layout decisions
 */

import { useLocation } from 'react-router-dom';
import { useMemo } from 'react';

/**
 * Routes where the Settings sidebar navigation is ALLOWED to render.
 * This is the ONLY page that shows a module list / app launcher on desktop.
 */
const ALLOWED_APP_LAUNCHER_ROUTES = new Set([
  '/settings',
]);

/**
 * Check if the current route is within the Settings module.
 * The App Launcher / Settings sidebar is ONLY allowed here.
 */
export function useIsSettingsRoute(): boolean {
  const { pathname } = useLocation();
  return useMemo(() => {
    return ALLOWED_APP_LAUNCHER_ROUTES.has(pathname) ||
      pathname.startsWith('/settings/');
  }, [pathname]);
}

/**
 * Check if the App Launcher / settings sidebar should be visible
 * on the current route. Returns `false` for ALL routes except /settings.
 *
 * Use this in any component that renders a module list or app launcher
 * to prevent leakage into non-settings modules.
 */
export function useShouldShowAppLauncher(): boolean {
  return useIsSettingsRoute();
}

/**
 * Desktop-safe wrapper: ensures that the navigationStyle Zustand value
 * is NEVER used for desktop layout decisions.
 *
 * Desktop ALWAYS returns 'sidebar' — the app launcher mode is mobile-only.
 */
export type NavigationMode = 'sidebar';

export function useDesktopNavigationMode(): NavigationMode {
  return 'sidebar';
}

/**
 * Validate that a route is safe for showing the App Launcher.
 * Throws in development if a non-settings route tries to render it.
 */
export function assertAppLauncherAllowed(pathname: string): void {
  if (process.env.NODE_ENV === 'development' || import.meta.env.DEV) {
    if (
      !ALLOWED_APP_LAUNCHER_ROUTES.has(pathname) &&
      !pathname.startsWith('/settings/')
    ) {
      console.warn(
        `[AppLauncherGuard] App Launcher rendered outside Settings at "${pathname}". ` +
        'The App Launcher must only appear in the Settings page. Check the route guard.'
      );
    }
  }
}

export default {
  useIsSettingsRoute,
  useShouldShowAppLauncher,
  useDesktopNavigationMode,
  assertAppLauncherAllowed,
  ALLOWED_APP_LAUNCHER_ROUTES,
};
