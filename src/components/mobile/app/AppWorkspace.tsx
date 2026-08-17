/**
 * AppWorkspace — Context-aware entry point for the App tab
 *
 * Renders the ModuleGrid (default state) when no module is selected,
 * or passes through to the module's workspace when a module is active.
 *
 * This component is placed at the `/app` route. Module routes
 * (/leads, /customers, etc.) render independently via MobileRoutes.
 * ContextResolver is updated by useMobileNavigation's route sync effect.
 *
 * Flow:
 *   1. User taps App tab → navigateToTab('app')
 *   2. If currentModule is null → navigates to /app → renders ModuleGrid
 *   3. User taps a module card → AppWorkspace calls setModule() + navigate()
 *   4. Route changes to /leads → useMobileNavigation syncs context
 *   5. App tab now shows the module's placeholder content
 */

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ModuleGrid } from './ModuleGrid';
import { useContextResolver } from '../context/ContextResolver';

export function AppWorkspace() {
  const navigate = useNavigate();
  const { setModule } = useContextResolver();

  const handleSelectModule = useCallback(
    (route: string) => {
      // Update ContextResolver BEFORE navigation so the App tab
      // state is ready when the route change triggers re-renders
      setModule(route);
      navigate(route, { replace: true });
    },
    [navigate, setModule],
  );

  return (
    <div className="space-y-4 pb-4">
      {/* App tab header — compact, no icon, just title + subtitle */}
      <div className="px-1 pt-1">
        <h1 className="text-lg font-bold text-[var(--color-text)]">App</h1>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Select a module to get started</p>
      </div>

      {/* Module Grid */}
      <ModuleGrid onSelectModule={handleSelectModule} />
    </div>
  );
}

export default AppWorkspace;
