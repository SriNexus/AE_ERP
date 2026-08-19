/**
 * GroupShell — shared layout for the Group Admin surfaces (Phase 5, Master
 * Plan §7).
 *
 * Provides the "Group Administration" sub-navigation header shared by every
 * /group/* screen (Overview, Companies, Warehouses, Users, Teams, Roles,
 * Audit Log, Settings) plus a consistent page container. Route gating lives
 * in the router (GroupAdminRoute wraps every /group/* route — this shell
 * never re-checks identity, the route guard is the boundary).
 *
 * Naming follows §7 exactly: the summary screen is "Group Overview" and the
 * section is "Group Administration". The string "Super Admin" never appears
 * here (§16 hard rule).
 */

import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Building2, Warehouse, Users, UsersRound, Shield, ScrollText, Settings } from 'lucide-react';
import { cn } from '../../utils/cn';

const NAV: Array<{ to: string; label: string; icon: ReactNode }> = [
  { to: '/group', label: 'Group Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/group/companies', label: 'Companies', icon: <Building2 className="h-4 w-4" /> },
  { to: '/group/warehouses', label: 'Warehouses', icon: <Warehouse className="h-4 w-4" /> },
  { to: '/group/users', label: 'Users', icon: <Users className="h-4 w-4" /> },
  { to: '/group/teams', label: 'Teams', icon: <UsersRound className="h-4 w-4" /> },
  { to: '/group/roles', label: 'Roles', icon: <Shield className="h-4 w-4" /> },
  { to: '/group/audit-log', label: 'Audit Log', icon: <ScrollText className="h-4 w-4" /> },
  { to: '/group/settings', label: 'Group Settings', icon: <Settings className="h-4 w-4" /> },
];

export function GroupShell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-6 pt-5">
        <div className="flex items-center gap-2 mb-1">
          <UsersRound className="h-4 w-4 text-[var(--color-primary)]" />
          <h1 className="text-lg font-bold text-[var(--color-text)]">{title || 'Group Administration'}</h1>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          Group Administration — manage your Group&apos;s Companies, Warehouses, Users, Teams and activity.
        </p>
        <nav className="flex gap-1 overflow-x-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/group'}
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

export default GroupShell;
