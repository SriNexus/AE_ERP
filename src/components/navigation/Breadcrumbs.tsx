import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, ChevronRight } from 'lucide-react';
import { resolveBreadcrumb } from './breadcrumb.config';
import { ERP_NAV_ITEMS, type NavItem } from '../layout/navigationConfig';
import { usePermissions } from '../../lib/permissions';
import { useOwnerAccess } from '../auth/OwnerRoute';

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const perms = usePermissions();
  const hasOwnerAccess = useOwnerAccess();
  const { label, section } = resolveBreadcrumb(pathname);

  // Base path for the current page (e.g. /leads/workspace/x → /leads), so the
  // active crumb navigates/refreshes its own list view.
  const basePath = '/' + pathname.split('/')[1];

  // The section crumb ("Sales") opens the existing Sales navigation group —
  // sourced straight from ERP_NAV_ITEMS, not a second nav system.
  const sectionGroup: NavItem | undefined = section
    ? ERP_NAV_ITEMS.find((item) => item.label === section && Array.isArray(item.children))
    : undefined;
  const sectionChildren = (sectionGroup?.children ?? []).filter((child) => {
    if (child.ownerOnly && !hasOwnerAccess) return false;
    return !child.module || perms.canView(child.module);
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const linkCls =
    'text-[var(--color-text-muted)] font-medium transition-colors hover:text-[var(--color-text)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]';

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden sm:flex items-center gap-1.5 text-sm select-none"
    >
      {/* Home — navigates to the dashboard */}
      <button type="button" onClick={() => navigate('/')} className={`${linkCls} inline-flex items-center gap-1.5`}>
        <Home className="h-3.5 w-3.5 shrink-0" />
        <span>Home</span>
      </button>

      {section && (
        <>
          <ChevronRight className="h-3 w-3 text-[var(--color-text-disabled)] shrink-0" />
          {sectionChildren.length > 0 ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className={`${linkCls} inline-flex items-center gap-0.5`}
              >
                <span>{section}</span>
                <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${menuOpen ? 'rotate-90' : ''}`} />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full mt-1.5 z-50 min-w-[180px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-dropdown)] py-1.5 overflow-hidden"
                >
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">{section}</p>
                  {sectionChildren.map((child) => (
                    <NavLink
                      key={child.path}
                      to={child.path!}
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors ${
                          isActive
                            ? 'text-[var(--color-primary-text)] bg-[var(--color-primary-light)] font-semibold'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]'
                        }`
                      }
                    >
                      <span className="opacity-70">{child.icon}</span>
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-[var(--color-text-muted)]">{section}</span>
          )}
        </>
      )}

      <ChevronRight className="h-3 w-3 text-[var(--color-text-disabled)] shrink-0" />

      {/* Current page — navigates/refreshes its own list view */}
      <button
        type="button"
        onClick={() => navigate(basePath)}
        aria-current="page"
        className="font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
      >
        {label}
      </button>
    </nav>
  );
}

export default Breadcrumbs;
