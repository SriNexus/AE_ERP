import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Module, usePermissions } from '../../lib/permissions';
import { useAppStore } from '../../store/useAppStore';
import { isDemoHiddenModule, isDemoUser } from '../../lib/demoCapabilityPolicy';
import { isModuleAllowedForBusinessMode, resolveBusinessMode } from '../../lib/companyBusinessMode';
import React, { useEffect, useRef } from 'react';

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

  useDemoRestrictionToast(module);

  const businessModeBlocked = !isModuleAllowedForBusinessMode(module, resolveBusinessMode(company));
  useBusinessModeRestrictionToast(businessModeBlocked);

  if (!cacheReady || !perms.ready) {
    return null;
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
