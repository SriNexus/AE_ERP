/**
 * Sidebar — hover-expand ERP sidebar
 * Phase P1: Full semantic token compliance. No raw gray/slate hardcodes.
 */
import { useState, useRef, useCallback, memo, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn';
import { usePermissions } from '../../lib/permissions';
import { ERP_NAV_ITEMS, type NavItem } from './navigationConfig';
import { CompanySwitcher } from '../../features/company/components/CompanySwitcher';
import React from 'react';
import { useOwnerAccess } from '../auth/OwnerRoute';
import { isDemoHiddenModule, isDemoUser } from '../../lib/demoCapabilityPolicy';
import { isModuleAllowedForBusinessMode, resolveBusinessMode } from '../../lib/companyBusinessMode';
import { useAppStore } from '../../store/useAppStore';
import { DEMO_LOGO_URLS } from '../../config/demoCompany';

// Semantic token class strings — NO raw gray/slate
const ACTIVE_CLS   = 'bg-[var(--color-sidebar-active)] text-[var(--color-sidebar-active-text)] shadow-sm';
const INACTIVE_CLS = 'text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text)]';
const CHILD_CLS    = 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-sidebar-item-hover)]';
const GROUP_ACTIVE = 'text-[var(--color-primary-text)] bg-[var(--color-primary-light)]';
const GROUP_BASE   = 'text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text)]';

// Deliberate hover delay before opening expanded submenus (ms)
// Quick cursor passes across module rows will NOT trigger a submenu switch.
const SUBMENU_HOVER_DELAY = 800;

const NavLeaf = memo(function NavLeaf({ item, expanded, isChild=false }: { item:NavItem; expanded:boolean; isChild?:boolean }) {
  return (
    <NavLink
      to={item.path!}
      end={item.path==='/'||item.path==='/dashboards'}
      className={({ isActive }) => cn(
        'flex items-center gap-2.5 rounded-lg transition-all duration-150 overflow-hidden whitespace-nowrap',
        isChild ? 'py-1.5 pl-3 pr-2 text-[13px]' : 'py-2 px-2 text-sm font-medium',
        isActive ? ACTIVE_CLS : isChild ? CHILD_CLS : INACTIVE_CLS
      )}
    >
      <span className={cn('shrink-0 flex items-center justify-center', !expanded&&!isChild&&'mx-auto')}>{item.icon}</span>
      <span className={cn('transition-all duration-200 overflow-hidden', expanded?'opacity-100 max-w-[160px]':'opacity-0 max-w-0 pointer-events-none')}>{item.label}</span>
    </NavLink>
  );
});

const NavGroup = memo(function NavGroup({ item, expanded }: { item:NavItem; expanded:boolean }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  const isChildActive = item.children?.some(c => c.path && location.pathname.startsWith(c.path) && c.path!=='/') ?? false;

  // Collapsed mode (flyout popup) → open immediately on hover.
  // Expanded mode (inline children) → open after a deliberate hover delay.
  // Click always toggles immediately.

  const handleEnter = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (!expanded) {
      // collapsed flyout: immediate, standard UX
      setOpen(true);
    } else {
      // expanded inline: delayed to prevent accidental switching
      hoverTimer.current = setTimeout(() => setOpen(true), SUBMENU_HOVER_DELAY);
    }
  }, [expanded]);

  const handleLeave = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    hoverTimer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  const handleClick = useCallback(() => {
    // Cancel any pending hover timer
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setOpen(v => !v);
  }, []);

  if (!expanded) {
    return (
      <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
        <button aria-expanded={open} aria-label={item.label} onClick={handleClick}
          className={cn('w-full flex items-center justify-center py-2 px-2 rounded-lg transition-all duration-150', isChildActive ? GROUP_ACTIVE : GROUP_BASE)}>
          {item.icon}
        </button>
        {open && (
          <div className="absolute left-full top-0 ml-2 z-50 min-w-[160px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-dropdown)] py-1.5 overflow-hidden"
            onMouseEnter={handleEnter} onMouseLeave={handleLeave} role="menu">
            <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">{item.label}</p>
            {item.children?.map(child => (
              <NavLink key={child.path} to={child.path!} role="menuitem"
                className={({ isActive }) => cn('flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors',
                  isActive ? 'text-[var(--color-primary-text)] bg-[var(--color-primary-light)] font-semibold'
                           : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]')}>
                <span className="opacity-70">{child.icon}</span>{child.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button aria-expanded={open} onClick={handleClick}
        className={cn('w-full flex items-center gap-2.5 py-2 px-2 rounded-lg text-sm font-medium transition-all duration-150 overflow-hidden', isChildActive ? GROUP_ACTIVE : GROUP_BASE)}>
        <span className="shrink-0">{item.icon}</span>
        <span className={cn('flex-1 text-left transition-all duration-200 overflow-hidden whitespace-nowrap', expanded?'opacity-100 max-w-[120px]':'opacity-0 max-w-0')}>{item.label}</span>
        <span className={cn('ml-auto transition-all duration-200 text-[var(--color-text-disabled)]', expanded?'opacity-100':'opacity-0', isChildActive&&'text-[var(--color-primary-text)] opacity-70')}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"
            className={cn('transition-transform duration-200', open?'rotate-180':'')}><path d="M1.5 3.5L5 7L8.5 3.5"/></svg>
        </span>
      </button>
      <div className={cn('ml-3 pl-3 border-l border-[var(--color-border-subtle)] overflow-hidden transition-all duration-200', open?'max-h-96 opacity-100 mt-0.5 mb-1':'max-h-0 opacity-0')}>
        <div className="flex flex-col gap-0.5 py-0.5">
          {item.children?.map(child => <NavLeaf key={child.path} item={child} expanded={expanded} isChild />)}
        </div>
      </div>
    </div>
  );
});

/**
 * Resolve sidebar widths from the theme CSS variables.
 * The values are applied by ThemeProvider and update live without a rerender.
 */
function useSidebarWidths() {
  return {
    collapsed: 'var(--theme-sidebar-collapsed-width, var(--shell-sidebar-collapsed))',
    expanded: 'var(--theme-sidebar-expanded-width, var(--shell-sidebar-expanded))',
  };
}

export function Sidebar() {
  const { collapsed: collapsedWidth, expanded: expandedWidth } = useSidebarWidths();
  const perms = usePermissions();
  const user = useAppStore((state) => state.user);
  const businessMode = resolveBusinessMode(useAppStore((state) => state.company));
  const hasOwnerAccess = useOwnerAccess();

  // ── Interaction mode: 'hover' (automatic) vs 'click' ──
  // Source of truth is the persisted Appearance "Sidebar Opening Behavior"
  // setting (sidebarBehavior: 'auto' | 'click'), which ThemeProvider already
  // mirrors onto document.documentElement's `data-sidebar-behavior` attribute
  // for exactly this component to read. That attribute isn't React state, so
  // it's mirrored into real state via MutationObserver — the same pattern
  // already used a few lines below for isDarkTheme — to make mode switches
  // reactive during render instead of only visible inside event callbacks.
  const [isClickMode, setIsClickMode] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-sidebar-behavior') === 'click'
  );
  useEffect(() => {
    const sync = () => setIsClickMode(document.documentElement.getAttribute('data-sidebar-behavior') === 'click');
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-sidebar-behavior'] });
    return () => observer.disconnect();
  }, []);

  // ── Click-mode open/closed state ──
  // Reuses useAppStore's existing sidebarOpen (already persisted, already
  // initialized correctly on login by ThemeProvider based on this same
  // setting) instead of introducing a second, competing piece of state.
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  // ── Hover-mode transient expansion (automatic mode only) ──
  // Unchanged behavior from before this fix — collapsed by default, expands
  // while the cursor is over the sidebar, collapses ~150ms after it leaves.
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const enter = useCallback(() => {
    if (isClickMode) return;  // click mode: hover never controls state
    if (timer.current) clearTimeout(timer.current);
    setHoverExpanded(true);
  }, [isClickMode]);
  const leave = useCallback(() => {
    if (isClickMode) return;  // click mode: hover never controls state
    timer.current = setTimeout(() => setHoverExpanded(false), 150);
  }, [isClickMode]);

  // Single derived open/closed value used for all rendering, in either mode.
  const expanded = isClickMode ? sidebarOpen : hoverExpanded;

  const asideRef = useRef<HTMLElement>(null);

  // Sidebar-surface click: toggles open/closed in click mode. Clicks that
  // land on an actual interactive element (nav link, nav-group button, the
  // company switcher trigger, the bottom arrow) are deliberately excluded —
  // they must only run their own behavior (navigate / open a menu / toggle
  // via their own handler), never the container's toggle as well.
  const handleSurfaceClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isClickMode) return;
    const target = e.target as HTMLElement;
    if (target.closest('a, button')) return;
    toggleSidebar();
  }, [isClickMode, toggleSidebar]);

  const handleArrowClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSidebar();
  }, [toggleSidebar]);

  // Outside click closes the sidebar in click mode. Only attached while
  // click mode is active AND the sidebar is actually open, so it never
  // fires — and never even needs to be a blanket document-wide toggle — in
  // any other state. The CompanySwitcher's own dropdown is portaled to
  // document.body (outside this component's DOM subtree), so a click inside
  // it is explicitly excluded too; without that, selecting a company while
  // the sidebar happens to be open in click mode would also collapse it.
  useEffect(() => {
    if (!isClickMode || !sidebarOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as Node;
      if (asideRef.current?.contains(target)) return;
      if ((target as HTMLElement)?.closest?.('[role="menu"]')) return;
      setSidebarOpen(false);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isClickMode, sidebarOpen, setSidebarOpen]);

  const currentUser = useAppStore((state) => state.user);
  const isDemo = isDemoUser(currentUser);

  // Theme-aware logo for demo mode
  const [isDarkTheme, setIsDarkTheme] = useState(() =>
    document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const sync = () => setIsDarkTheme(document.documentElement.classList.contains('dark'));
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const demoFullLogo = isDarkTheme ? DEMO_LOGO_URLS.logoDark : DEMO_LOGO_URLS.logoLight;

  // Phase 5 (§7): Group Admin navigation — visible only to GroupAdmin actors.
  const isGroupAdmin = user?.role === 'GroupAdmin';

  const visibleNav = ERP_NAV_ITEMS.reduce<NavItem[]>((acc, item) => {
    if (item.path) {
      if (item.ownerOnly && !hasOwnerAccess) return acc;
      if (item.groupAdminOnly && !isGroupAdmin) return acc;
      if (isDemo && item.module && isDemoHiddenModule(item.module)) return acc;
      if (item.module && !perms.canView(item.module)) return acc;
      if (item.module && !isModuleAllowedForBusinessMode(item.module, businessMode)) return acc;
      acc.push(item);
      return acc;
    }
    const kids = (item.children||[]).filter(c => {
      if (c.ownerOnly && !hasOwnerAccess) return false;
      if (c.groupAdminOnly && !isGroupAdmin) return false;
      if (isDemo && c.module && isDemoHiddenModule(c.module)) return false;
      if (c.module && !isModuleAllowedForBusinessMode(c.module, businessMode)) return false;
      return !c.module || perms.canView(c.module);
    });
    if (kids.length === 0) return acc;
    acc.push({...item, children: kids});
    return acc;
  }, []);

  return (
    <aside ref={asideRef} onMouseEnter={enter} onMouseLeave={leave} onClick={handleSurfaceClick}
      role="navigation" aria-label="Main navigation"
      style={{ width: expanded ? expandedWidth : collapsedWidth }}
      className="h-screen flex flex-col shrink-0 z-30 bg-[var(--color-sidebar-bg)] border-r border-[var(--color-sidebar-border)] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width]">

      {/* Brand */}
      <div className={cn('shrink-0 flex items-center justify-center border-b border-[var(--color-border-subtle)] transition-all duration-300 overflow-hidden', expanded?'h-[72px] px-4':'h-[64px] px-2.5')}>
        <div className={cn('flex items-center justify-center transition-all duration-300 ease-in-out', expanded?'w-full':'w-10')}>
          {isDemo ? (
            /* Demo mode: show static demo logo — no company switcher */
            <img
              src={expanded ? demoFullLogo : DEMO_LOGO_URLS.iconLogo}
              alt="Demo"
              className={cn(
                'object-contain select-none',
                expanded ? 'h-9 w-auto max-w-[140px]' : 'h-9 w-9'
              )}
              draggable={false}
            />
          ) : (
            /* Production mode: show company switcher with logo dropdown */
            <CompanySwitcher variant="logoOnly" sidebarExpanded={expanded} />
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2.5 flex flex-col gap-0.5 scroll-smooth" aria-label="Modules">
        {visibleNav.map(item => item.path
          ? <NavLeaf key={item.label} item={item} expanded={expanded}/>
          : <NavGroup key={item.label} item={item} expanded={expanded}/>
        )}
      </nav>

      {/* Click-mode open/close control — only meaningful (and only shown)
          when hover isn't already the affordance for this. */}
      {isClickMode && (
        <div className="shrink-0 border-t border-[var(--color-border-subtle)] px-2 py-1.5">
          <button
            type="button"
            onClick={handleArrowClick}
            aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className={cn(
              'w-full flex items-center rounded-lg py-1.5 transition-colors duration-150',
              'text-[var(--color-text-muted)] hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
              expanded ? 'justify-end px-2' : 'justify-center',
            )}
          >
            {expanded ? <ChevronLeft className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      )}

      {/* Accent bar */}
      <div className={cn('h-0.5 shrink-0 transition-opacity duration-300 bg-gradient-to-r from-[var(--color-primary)] via-violet-500 to-[var(--color-primary)]', expanded?'opacity-40':'opacity-20')} />
    </aside>
  );
}
