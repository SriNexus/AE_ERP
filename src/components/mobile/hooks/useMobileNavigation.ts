/**
 * useMobileNavigation — Mobile navigation framework
 *
 * Single source of truth for tab↔route mapping, active tab derivation,
 * and App tab module history tracking.
 *
 * Integrates with ContextResolver for module context persistence:
 * - Active tab DERIVED from current route (never stored)
 * - Module context READ from ContextResolver (sessionStorage-backed)
 * - Module context UPDATED on route change via ContextResolver
 * - NavigateToTab replaces the current history entry (no stack buildup)
 *
 * Architecture:
 *   ContextResolver (persists module state)
 *        ↕ reads/writes
 *   useMobileNavigation (derives active tab, provides navigation)
 *        ↕ consumes
 *   MobileBottomNav (renders tabs, handles clicks)
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { MobileTab } from '../types';
import { APP_MODULE_ROUTES, READ_ONLY_MODULES } from '../types';
import { useContextResolver } from '../context/ContextResolver';

// ── Route ↔ Tab mapping helpers ───────────────────────────────

/**
 * Map a route path to the active bottom-nav tab.
 * Returns `null` for auth pages (no tab should be highlighted).
 */
function getTabFromPath(pathname: string): MobileTab | null {
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname === '/tasks' || pathname.startsWith('/tasks/')) return 'tasks';
  if (pathname === '/create')  return 'create';
  if (pathname === '/dashboards' || pathname === '/recent') return 'recent';
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings';

  // Module routes (leads, customers, projects, etc.) belong to the tasks tab
  // so the 2nd nav dynamically shows the selected module.
  if (pathname.startsWith('/login')) return null;

  return 'tasks';
}

/**
 * Get the default route path for a given tab.
 * For the App tab, reads the current module from ContextResolver.
 */
function getTabDefaultPath(tab: MobileTab, currentModule?: string | null): string {
  switch (tab) {
    case 'home':
      return '/';
    case 'tasks':
      // Navigate to the active module so the Tasks tab returns the user
      // to their current workspace. Falls back to '/tasks' by default.
      // The App Launcher (ModuleGrid at '/app') is NEVER the default destination.
      return currentModule || '/tasks';
    case 'create':
      // For read-only modules (e.g. performance, reports), stay on the
      // records view instead of appending ?create=1 — the module doesn't
      // support entity creation.
      if (currentModule && READ_ONLY_MODULES.has(currentModule)) {
        return currentModule;
      }
      return currentModule ? `${currentModule}?create=1` : '/create';
    case 'recent':
      return '/dashboards';
    case 'settings':
      return '/settings';
  }
}

/**
 * Determine if a route path is a module route (belongs to App tab).
 */
function resolveModuleRoute(pathname: string): string | null {
  if (APP_MODULE_ROUTES.has(pathname)) return pathname;
  const base = `/${pathname.split('/').filter(Boolean)[0] || ''}`;
  return APP_MODULE_ROUTES.has(base) ? base : null;
}

// ── Hook ──────────────────────────────────────────────────────

export function useMobileNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentModule, setModule } = useContextResolver();

  // Derive active tab from the current route
  const activeTab = useMemo<MobileTab | null>(
    () => getTabFromPath(location.pathname),
    [location.pathname],
  );

  // Sync module context on route change — ContextResolver handles
  // sessionStorage persistence. This ensures that if the user navigates
  // to a module URL directly (bookmark, deep link, browser address bar),
  // the context stays correct.
  //
  // CRITICAL: DO NOT call setModule(null) for '/' or '/app' routes — that
  // would destroy the persisted module context from sessionStorage when
  // the user switches tabs. Module state must persist until the user
  // explicitly selects a different module via the ModuleGrid or NavDrawer.
  useEffect(() => {
    const moduleRoute = resolveModuleRoute(location.pathname);
    if (moduleRoute) setModule(moduleRoute);
  }, [location.pathname, setModule]);

  /**
   * Navigate to a tab's default route, replacing the current history
   * entry to prevent tab-switch history buildup.
   */
  const navigateToTab = useCallback(
    (tab: MobileTab) => {
      const path = getTabDefaultPath(tab, currentModule);
      navigate(path, { replace: true });
    },
    [currentModule, navigate],
  );

  return { activeTab, navigateToTab } as const;
}

export default useMobileNavigation;
