import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Module, usePermissions } from '../../lib/permissions';
import { useAppStore } from '../../store/useAppStore';
import { isDemoHiddenModule, isDemoUser } from '../../lib/demoCapabilityPolicy';
import { isModuleAllowedForBusinessMode, resolveBusinessMode } from '../../lib/companyBusinessMode';
import React, { useEffect, useRef } from 'react';

// Blank-screen safety net: while permissions are still loading, show a
// visible spinner instead of `return null` — a bare `null` here (combined
// with Sidebar's nav filter also being empty during this exact window,
// since both key off the same permissionCache.ready flag) previously
// rendered as a completely blank main panel with no indication anything was
// happening, for as long as the roles bootstrap took.
function RoleRouteLoading() {
  return (
    <div className="flex items-center justify-center h-full min-h-[40vh]">
      <div className="h-8 w-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// Blank-screen safety net, failure case: useGlobalBoot.ts marks
// permissionCache.ready even when the roles_global query permanently fails
// (bounded fail-closed, see its own comment), tagging the diagnostics with
// 'roles-query-failed:...'. Previously that failure was invisible — the app
// silently denied every module with no explanation. This surfaces it as a
// recoverable state instead.
function RoleRoutePermissionLoadError() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[40vh] text-center px-6">
      <p className="text-sm font-semibold text-[var(--color-text)] mb-1">Couldn't load your permissions</p>
      <p className="text-xs text-[var(--color-text-muted)] mb-4 max-w-sm">
        This is usually a temporary connection issue. Try again — if it keeps happening, contact an administrator.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-text-inverse)] text-xs font-semibold rounded-lg transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

function useDemoRestrictionToast(module: Module) {
  const user = useAppStore((state) => state.user);
  const notified = useRef(false);

  useEffect(() => {
    if (user && isDemoUser(user) && isDemoHiddenModule(module) && !notified.current) {
      notified.current = true;
      toast.error('Not available in Demo Mode', { duration: 3000 });
    }
  }, [user, module]);
}

function useBusinessModeRestrictionToast(blocked: boolean) {
  const notified = useRef(false);

  useEffect(() => {
    if (blocked && !notified.current) {
      notified.current = true;
      toast.error('Not available for this company’s business mode', { duration: 3000 });
    }
  }, [blocked]);
}

export function RoleRoute({ module, children }: { module: Module; children: React.ReactNode }) {
  const user = useAppStore((state) => state.user);
  const company = useAppStore((state) => state.company);
  const perms = usePermissions();
  const cacheReady = useAppStore((state) => state.permissionCache.ready);
  const cacheDiagnostics = useAppStore((state) => state.permissionCache.diagnostics);

  useDemoRestrictionToast(module);

  const businessModeBlocked = !isModuleAllowedForBusinessMode(module, resolveBusinessMode(company));
  useBusinessModeRestrictionToast(businessModeBlocked);

  if (!cacheReady || !perms.ready) {
    return <RoleRouteLoading />;
  }

  if (cacheDiagnostics.some((entry) => entry.startsWith('roles-query-failed:'))) {
    return <RoleRoutePermissionLoadError />;
  }

  // Demo users cannot access hidden modules (users/roles/companies)
  if (user && isDemoUser(user) && isDemoHiddenModule(module)) {
    return <Navigate to="/" replace />;
  }

  if (!perms.canView(module)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Phase 1: Company Business Mode — a B2B-mode company never sees B2C-only
  // workflow pages (Projects, Survey, Engineering, Installation, QC, etc).
  if (businessModeBlocked) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export const PermissionGuard = RoleRoute;
