/**
 * PlatformShell — shared layout for the Super Admin Control Plane (§6.1).
 *
 * Provides the platform sub-navigation header shared by every /platform/*
 * screen (Dashboard, Groups, Companies, Users, Security, Settings) and a
 * consistent page container. Route gating lives in the router
 * (SuperAdminRoute wraps every /platform/* route — this shell never re-checks
 * identity, the route guard is the boundary).
 */

import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Building2, Users, Shield, Settings, Boxes, Globe } from 'lucide-react';
import { cn } from '../../utils/cn';

const NAV: Array<{ to: string; label: string; icon: ReactNode }> = [
  { to: '/platform', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/platform/groups', label: 'Groups', icon: <Globe className="h-4 w-4" /> },
  { to: '/platform/companies', label: 'Companies', icon: <Building2 className="h-4 w-4" /> },
  { to: '/platform/users', label: 'Users', icon: <Users className="h-4 w-4" /> },
  { to: '/platform/security', label: 'Security', icon: <Shield className="h-4 w-4" /> },
  { to: '/platform/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

export function PlatformShell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-6 pt-5">
        <div className="flex items-center gap-2 mb-1">
          <Boxes className="h-4 w-4 text-[var(--color-primary)]" />
          <h1 className="text-lg font-bold text-[var(--color-text)]">{title || 'Platform Control Plane'}</h1>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          Super Admin platform management — Groups, Companies, Users, security events and platform settings.
        </p>
        <nav className="flex gap-1 overflow-x-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/platform'}
              className={({ isActive }) => cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap',
                isActive
                  ? 'border-[var(--color-primary)] text-[var(--color-primary-text)] bg-[var(--color-primary-light)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]',
              )}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  );
}

export default PlatformShell;
