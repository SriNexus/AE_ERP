/**
 * ModuleNavDrawer — Full-height navigation drawer for mobile
 *
 * Opens from the left side as a full-height overlay when the user
 * single-taps the company logo in MobileTopBar.
 *
 * Supports TWO modes:
 *   'navigation'   (default) — Displays modules grouped by category
 *                    using ERP_NAV_ITEMS from the existing navigation
 *                    config. Each group shows module icon + name, and
 *                    expands to show child pages beneath each module.
 *   'app-launcher' — Displays the ModuleGrid (App Launcher) inside
 *                    the drawer container instead of navigation items.
 *
 * In both modes, a fixed logout button appears at the bottom.
 * Reuses existing routing via NavLink. No new routes or business
 * logic created — only the presentation layer differs.
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { X, ChevronDown, LogOut } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { canDo } from '../../../lib/permissions';
import { isModuleAllowedForBusinessMode, resolveBusinessMode } from '../../../lib/companyBusinessMode';
import { ERP_NAV_ITEMS, type NavItem } from '../../layout/navigationConfig';
import { CompanySwitcher } from '../../../features/company/components/CompanySwitcher';
import { ModuleGrid } from '../app/ModuleGrid';
import { useContextResolver } from '../context/ContextResolver';
import { useAppStore } from '../../../store/useAppStore';

type DrawerMode = 'navigation' | 'app-launcher';

interface ModuleNavDrawerProps {
  open: boolean;
  onClose: () => void;
  mode?: DrawerMode;
}

export function ModuleNavDrawer({ open, onClose, mode = 'navigation' }: ModuleNavDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Close on backdrop click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Close on route change
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Permission-filtered nav items (only used for 'navigation' mode)
  const businessMode = resolveBusinessMode(useAppStore((state) => state.company));
  const visibleNav = ERP_NAV_ITEMS.reduce<NavItem[]>((acc, item) => {
    if (item.path) {
      if (item.module && !canDo('view', item.module)) return acc;
      if (item.module && !isModuleAllowedForBusinessMode(item.module, businessMode)) return acc;
      acc.push(item);
      return acc;
    }
    const kids = (item.children || []).filter(c =>
      (!c.module || canDo('view', c.module)) &&
      (!c.module || isModuleAllowedForBusinessMode(c.module, businessMode))
    );
    if (kids.length === 0) return acc;
    acc.push({ ...item, children: kids });
    return acc;
  }, []);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-[var(--color-overlay)] z-40" />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={cn(
          'fixed left-0 top-0 bottom-0 w-[280px] max-w-[80vw] z-50',
          'bg-[var(--color-surface)]',
          'border-r border-[var(--color-border)]',
          'flex flex-col',
          'shadow-[var(--shadow-dropdown)]',
          'animate-slideIn',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--color-border-subtle)] shrink-0">
          <CompanySwitcher variant="logoOnly" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded-full p-2 border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === 'app-launcher' ? (
          /* App Launcher Mode — ModuleGrid inside drawer */
          <DrawerAppLauncherContent onClose={onClose} />
        ) : (
          /* Navigation Mode — filtered nav items */
          <DrawerNavContent visibleNav={visibleNav} onClose={onClose} />
        )}

        {/* Logout Button — fixed at bottom */}
        <DrawerLogout />
      </div>
    </>
  );
}

/* ── App Launcher Content ────────────── */

function DrawerAppLauncherContent({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { setModule } = useContextResolver();

  const handleSelectModule = useCallback(
    (route: string) => {
      setModule(route);
      navigate(route, { replace: true });
      onClose();
    },
    [navigate, setModule, onClose],
  );

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      <div className="mb-3 px-1">
        <h2 className="text-sm font-bold text-[var(--color-text)]">App Launcher</h2>
        <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">Select a module</p>
      </div>
      <ModuleGrid onSelectModule={handleSelectModule} />
    </div>
  );
}

/* ── Navigation Content ──────────────── */

function DrawerNavContent({ visibleNav, onClose }: { visibleNav: NavItem[]; onClose: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
      {visibleNav.map((item) =>
        item.path ? (
          <DrawerLeaf key={item.label} item={item} onClose={onClose} />
        ) : (
          <DrawerGroup key={item.label} item={item} onClose={onClose} />
        )
      )}
    </nav>
  );
}

/* ── Logout Button ───────────────────── */

function DrawerLogout() {
  const navigate = useNavigate();
  const logout = useAppStore((s) => s.logout);
  const { resetAll } = useContextResolver();

  const handleLogout = useCallback(() => {
    // Desktop pattern: logout() then navigate to /login
    logout();
    // Clear mobile context & session storage
    resetAll();
    // Redirect to login
    navigate('/login', { replace: true });
  }, [logout, resetAll, navigate]);

  return (
    <div className="shrink-0 border-t border-[var(--color-border-subtle)] px-3 py-3">
      <button
        type="button"
        onClick={handleLogout}
        aria-label="Sign out"
        className={cn(
          'flex items-center justify-center w-full rounded-lg px-3 py-3',
          'text-[var(--color-danger)]',
          'hover:bg-[var(--color-danger-light)]',
          'transition-colors duration-150',
          'active:scale-[0.98]',
        )}
      >
        <LogOut className="h-5 w-5" />
      </button>
    </div>
  );
}

/* ── Leaf Item ─────────────────────── */

function DrawerLeaf({ item, onClose }: { item: NavItem; onClose: () => void }) {
  return (
    <NavLink
      to={item.path!}
      end={item.path === '/' || item.path === '/dashboards'}
      onClick={onClose}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-sm font-medium',
          'transition-colors duration-150',
          isActive
            ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]',
        )
      }
    >
      <span className="shrink-0 opacity-80">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

/* ── Group Item ────────────────────── */

function DrawerGroup({ item, onClose }: { item: NavItem; onClose: () => void }) {
  const location = useLocation();
  const isChildActive = item.children?.some(
    (c) => c.path && location.pathname.startsWith(c.path) && c.path !== '/'
  );
  const [open, setOpen] = useState(isChildActive ?? false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-sm font-semibold',
          'transition-colors duration-150',
          isChildActive
            ? 'text-[var(--color-primary-text)] bg-[var(--color-primary-medium)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]',
        )}
      >
        <span className="shrink-0 opacity-80">{item.icon}</span>
        <span className="flex-1 text-left truncate">{item.label}</span>
        <ChevronDown
          className={cn(
            'h-4.5 w-4.5 shrink-0 transition-transform duration-200 text-[var(--color-text-muted)]',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="ml-6 pl-4 border-l border-[var(--color-border-subtle)] space-y-1 py-1">
          {item.children?.map((child) => (
            <NavLink
              key={child.path}
              to={child.path!}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm',
                  'transition-colors duration-150',
                  isActive
                    ? 'text-[var(--color-primary-text)] bg-[var(--color-primary-light)] font-semibold'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
                )
              }
            >
              <span className="shrink-0 opacity-60">{child.icon}</span>
              <span className="truncate">{child.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default ModuleNavDrawer;
