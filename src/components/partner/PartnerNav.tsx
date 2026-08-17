/**
 * PartnerNav — Horizontal navigation strip for the Partner Portal
 *
 * Pill-style NavLink tabs that highlight the active route.
 * Rendered inside PartnerLayout above the page content.
 * No ERP sidebar — this is the primary navigation for partners.
 */

import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Target,
  Users,
  FolderKanban,
  ClipboardCheck,
  Wallet,
  DollarSign,
  FileText,
  User,
} from 'lucide-react';
import { cn } from '../../utils/cn';

interface NavTab {
  label: string;
  path: string;
  icon: React.ReactNode;
}

const NAV_TABS: NavTab[] = [
  { label: 'Dashboard',    path: '/partner/dashboard',  icon: <LayoutDashboard className="h-4 w-4" /> },
  { label: 'Leads',        path: '/partner/leads',      icon: <Target className="h-4 w-4" /> },
  { label: 'Customers',    path: '/partner/customers',  icon: <Users className="h-4 w-4" /> },
  { label: 'Projects',     path: '/partner/projects',   icon: <FolderKanban className="h-4 w-4" /> },
  { label: 'Wallet',       path: '/partner/wallet',     icon: <Wallet className="h-4 w-4" /> },
  { label: 'Commissions',  path: '/partner/commissions', icon: <DollarSign className="h-4 w-4" /> },
  { label: 'Documents',    path: '/partner/documents',  icon: <FileText className="h-4 w-4" /> },
  { label: 'Registration', path: '/partner/registration', icon: <ClipboardCheck className="h-4 w-4" /> },
  { label: 'Profile',      path: '/partner/profile',    icon: <User className="h-4 w-4" /> },
];

const ACTIVE_CLS =
  'bg-[var(--color-primary)] text-white shadow-sm';
const INACTIVE_CLS =
  'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]';

export function PartnerNav() {
  return (
    <nav
      className="flex items-center gap-1 overflow-x-auto px-4 py-2 scrollbar-none"
      aria-label="Partner portal navigation"
    >
      {NAV_TABS.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          end={tab.path === '/partner/dashboard'}
          className={({ isActive }) =>
            cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-all duration-150',
              isActive ? ACTIVE_CLS : INACTIVE_CLS,
            )
          }
        >
          <span className="shrink-0">{tab.icon}</span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default PartnerNav;
