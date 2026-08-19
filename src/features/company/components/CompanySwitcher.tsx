/**
 * CompanySwitcher — Premium workspace-switcher dropdown.
 * Phase P2: Full semantic token compliance on all themed surfaces/text.
 * VALID palette: indigo/purple avatar gradients, indigo focus ring, indigo active
 *   row tint (normalized to --color-primary-light), indigo checkmarks.
 */

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Building2, Check, Search, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAppStore } from '../../../store/useAppStore';
import { useCurrentUser } from '../../../store/useAppStore';
import { useCompanies, useGroupCompanies, type CompanyDoc } from '../hooks/useCompanies';
import { cn } from '../../../utils/cn';
import { b64ToSrc } from '../../../templates/documents/shared/utils';
import { DEMO_LOGO_URLS } from '../../../config/demoCompany';

const ALL_COMPANIES_ID = 'all';
// Phase 5 (Master Plan §7.2): the Group-view sentinel — "All Companies (Group
// view)" sets activeCompanyId to 'group' (parallel to the Super Admin 'all'
// sentinel). The query layer (companyScopedQuery/getAll) already translates it
// to where('groupId','==',actorGroupId) (Phase 2 §9.4).
const GROUP_VIEW_ID = 'group';

export interface CompanySwitcherProps {
  /** External open state (controlled mode) — when provided, parent controls open/close */
  isOpen?: boolean;
  /** Callback when open state should change (controlled mode) */
  onOpenChange?: (open: boolean) => void;
  /** Logo-only trigger for the mobile sidebar header. Default preserves desktop UI. */
  variant?: 'default' | 'logoOnly';
  /** Desktop sidebar state. Undefined preserves the existing logo-only trigger. */
  sidebarExpanded?: boolean;
}

type DropdownPosition = {
  top: number;
  left: number;
};

export function CompanySwitcher({ isOpen: controlledOpen, onOpenChange, variant = 'default', sidebarExpanded }: CompanySwitcherProps = {}) {
  const { activeCompanyId, setActiveCompanyId, globalCompany, company } = useAppStore();
  const user = useCurrentUser();
  const queryClient = useQueryClient();

  // Phase 5 (§7.2): a Group Admin's switcher lists EVERY Company in their own
  // Group (query-level where('groupId','==',...), rules-provable) regardless of
  // the currently selected Company. Other roles keep the existing list. Both
  // hooks run unconditionally (rules of hooks); the unused one is inert
  // (useGroupCompanies is disabled without a groupId; useCompanies is only
  // consumed for non-GroupAdmin actors).
  const isGroupAdmin = user?.role === 'GroupAdmin';
  const groupCompanies = useGroupCompanies(isGroupAdmin ? user?.groupId : undefined);
  const allCompanies = useCompanies();
  const { data: companies = [], isFetching } = isGroupAdmin ? groupCompanies : allCompanies;
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<DropdownPosition>({ top: 0, left: 0 });

  const setOpen = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    if (isControlled) {
      if (typeof v === 'function') {
        const next = v(controlledOpen);
        if (next !== controlledOpen) onOpenChange?.(next);
      } else if (v !== controlledOpen) {
        onOpenChange?.(v);
      }
    } else {
      setInternalOpen(v);
    }
  }, [isControlled, controlledOpen, onOpenChange]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      return undefined;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  const handleSelect = useCallback((id: string) => {
    if (id === activeCompanyId) { setOpen(false); return; }
    setActiveCompanyId(id);
    queryClient.invalidateQueries();
    setOpen(false);
    if (id === ALL_COMPANIES_ID) toast.success('Viewing all companies');
    else if (id === GROUP_VIEW_ID) toast.success('Viewing all companies (Group view)');
    else toast.success('Company switched');
  }, [activeCompanyId, setActiveCompanyId, queryClient]);

  const activeCompany = companies.find(c => c.id === activeCompanyId);
  const primaryCompany = companies.find(c => c.isDefault) ?? companies[0];
  // Platform identity (Owner/Super-Admin, no explicit Company selected): the
  // sidebar trigger must show the platform's own brand (the same source
  // Login.tsx's BrandLogo uses), never "whichever company happens to be
  // primary" — a Super Admin viewing "All Companies" is not that company.
  const isPlatformIdentity = !!(user?.isOwner || user?.isSuperAdmin) && activeCompanyId === ALL_COMPANIES_ID;
  const logoCompany = (activeCompanyId === ALL_COMPANIES_ID || activeCompanyId === GROUP_VIEW_ID)
    ? primaryCompany
    : activeCompany ?? primaryCompany;
  const fallbackBrand = globalCompany || company;
  const activeLabel = activeCompanyId === ALL_COMPANIES_ID
    ? 'All Companies'
    : activeCompanyId === GROUP_VIEW_ID
      ? 'All Companies (Group view)'
      : (activeCompany?.shortName ?? activeCompany?.name ?? 'Company');

  const q = search.trim().toLowerCase();
  const filtered: CompanyDoc[] = q
    ? companies.filter(c => c.name.toLowerCase().includes(q) || (c.shortName||'').toLowerCase().includes(q))
    : companies;

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const viewportPadding = 12;
    const gap = 8;
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const preferredLeft = variant === 'logoOnly'
      ? triggerRect.left
      : triggerRect.right - panelRect.width;
    const preferredTop = triggerRect.bottom + gap;
    const fallbackTop = triggerRect.top - panelRect.height - gap;
    const top = preferredTop + panelRect.height <= viewportHeight - viewportPadding
      ? preferredTop
      : fallbackTop;

    setPosition({
      top: Math.min(Math.max(top, viewportPadding), viewportHeight - panelRect.height - viewportPadding),
      left: Math.min(Math.max(preferredLeft, viewportPadding), viewportWidth - panelRect.width - viewportPadding),
    });
  }, [open, variant, filtered.length, companies.length]);

  if (variant === 'logoOnly') {
    // Platform identity uses the same static brand asset as the Login page's
    // BrandLogo — never a base64 company logo (b64ToSrc). The collapsed icon
    // has no light/dark split (matching how the demo branch above resolves
    // its icon); the expanded logo is rendered as a light/dark pair below.
    const iconLogo = logoCompany?.iconLogo || fallbackBrand?.iconLogo;
    const fullLogo = logoCompany?.logo || fallbackBrand?.logo;
    const collapsedLogoSrc = isPlatformIdentity
      ? DEMO_LOGO_URLS.iconLogo
      : iconLogo ? b64ToSrc(iconLogo) : null;
    const logoSrc = isPlatformIdentity
      ? null // expanded platform logo is rendered as a light/dark pair below
      : fullLogo
        ? b64ToSrc(fullLogo)
        : iconLogo
          ? b64ToSrc(iconLogo)
          : null;
    const logoName = isPlatformIdentity ? 'Neozy Platform' : logoCompany?.name || fallbackBrand?.name || 'Company';
    const initials = (logoCompany?.shortName || logoCompany?.name || fallbackBrand?.shortName || 'C')
      .substring(0, 2)
      .toUpperCase();
    const collapsed = sidebarExpanded === false;
    const expandedSidebar = sidebarExpanded === true;

    return (
      <div ref={ref} className="relative min-w-0">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-label="Switch company"
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'flex items-center rounded-lg transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
            collapsed
              ? 'h-10 w-10 justify-center p-1.5'
              : expandedSidebar
                ? 'h-11 w-full max-w-[180px] justify-between gap-2 px-2 py-1.5'
                : 'max-w-[180px] justify-center',
            open && 'ring-2 ring-[var(--color-primary)]/40',
          )}
        >
          {collapsed ? (
            collapsedLogoSrc ? (
              <img
                src={collapsedLogoSrc}
                alt={logoName}
                className="h-full w-full object-contain select-none"
                draggable={false}
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-primary)] text-sm font-bold text-white">
                {initials}
              </span>
            )
          ) : expandedSidebar ? (
            <>
              {isPlatformIdentity ? (
                <>
                  <img src={DEMO_LOGO_URLS.logoLight} alt={logoName} className="h-9 w-auto max-w-[140px] shrink object-contain select-none dark:hidden" draggable={false} />
                  <img src={DEMO_LOGO_URLS.logoDark} alt={logoName} className="hidden h-9 w-auto max-w-[140px] shrink object-contain select-none dark:block" draggable={false} />
                </>
              ) : logoSrc ? (
                <img
                  src={logoSrc}
                  alt={logoName}
                  className="h-9 w-auto max-w-[140px] shrink object-contain select-none"
                  draggable={false}
                />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)] text-sm font-bold text-white">
                  {initials}
                </span>
              )}
              <ChevronDown className={cn(
                'h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform duration-200',
                open && 'rotate-180',
              )} />
            </>
          ) : isPlatformIdentity ? (
            <>
              <img src={DEMO_LOGO_URLS.logoLight} alt={logoName} className="h-15 w-auto max-w-[180px] object-contain select-none dark:hidden" draggable={false} />
              <img src={DEMO_LOGO_URLS.logoDark} alt={logoName} className="hidden h-15 w-auto max-w-[180px] object-contain select-none dark:block" draggable={false} />
            </>
          ) : logoSrc ? (
            <img
              src={logoSrc}
              alt={logoName}
              className="h-15 w-auto max-w-[180px] object-contain select-none"
              draggable={false}
            />
          ) : (
            <span className="flex h-15 w-15 items-center justify-center rounded-xl bg-[var(--color-primary)] text-sm font-bold text-white">
              {initials}
            </span>
          )}
        </button>

        {open && createPortal(
          <div
            ref={panelRef}
            style={{ top: position.top, left: position.left }}
            className="fixed z-[120] w-64 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-dropdown)] animate-scaleIn"
            role="menu"
          >
            <div className="py-1 max-h-72 overflow-y-auto">
              {/* Phase 5 (§7.2): Group Admin gets "All Companies (Group view)" —
                  the 'group' sentinel the query layer translates to a groupId
                  constraint. Super Admin 'all' stays as-is. */}
              {isGroupAdmin ? (
                <button
                  type="button"
                  onClick={() => handleSelect(GROUP_VIEW_ID)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                    'hover:bg-[var(--color-surface-hover)]',
                    activeCompanyId === GROUP_VIEW_ID && 'bg-[var(--color-primary-light)]',
                  )}
                >
                  <span className="flex-1 truncate text-xs font-semibold text-[var(--color-text-secondary)]">
                    All Companies (Group view)
                  </span>
                  {activeCompanyId === GROUP_VIEW_ID && (
                    <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSelect(ALL_COMPANIES_ID)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                    'hover:bg-[var(--color-surface-hover)]',
                    activeCompanyId === ALL_COMPANIES_ID && 'bg-[var(--color-primary-light)]',
                  )}
                >
                  <span className="flex-1 truncate text-xs font-semibold text-[var(--color-text-secondary)]">
                    All Companies
                  </span>
                  {activeCompanyId === ALL_COMPANIES_ID && (
                    <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  )}
                </button>
              )}

              <div className="mx-3 my-1 border-t border-[var(--color-border-subtle)]" />

              {companies.map(c => (
                <CompanyOption
                  key={c.id}
                  company={c}
                  isActive={activeCompanyId === c.id}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative block min-w-0">
      {/* Trigger — sunken interactive surface in topbar */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold',
          'bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)]',
          'hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border)]',
          'border border-transparent',
          'transition-all duration-150 max-w-[150px] md:max-w-[180px]',
          // VALID: indigo focus ring is primary brand focus affordance
          open && 'ring-2 ring-indigo-500/50 border-indigo-300 dark:border-indigo-600'
        )}
      >
        {isFetching
          ? <Loader2 className="h-3 w-3 text-[var(--color-text-muted)] animate-spin shrink-0" />
          : <Building2 className="h-3 w-3 text-[var(--color-text-muted)] shrink-0" />
        }
        <span className="truncate">{activeLabel}</span>
        <ChevronDown className={cn(
          'h-3 w-3 text-[var(--color-text-muted)] shrink-0 transition-transform duration-150',
          open && 'rotate-180'
        )} />
      </button>

      {/* Dropdown panel */}
      {open && createPortal(
        <div
          ref={panelRef}
          style={{ top: position.top, left: position.left }}
          className="fixed z-[120] w-60 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-[var(--shadow-dropdown)] animate-scaleIn overflow-hidden"
          role="menu"
        >

          {/* Search bar */}
          <div className="p-2 border-b border-[var(--color-border-subtle)]">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-[var(--color-bg-sunken)] rounded-lg">
              <Search className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
              <input
                ref={inputRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search workspace…"
                className="flex-1 bg-transparent text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
              />
            </div>
          </div>

          {/* Company list */}
          <div className="py-1 max-h-52 overflow-y-auto">
            {filtered.length === 0
              ? <p className="text-xs text-[var(--color-text-muted)] text-center py-4">No companies found</p>
              : filtered.map(c => (
                  <CompanyOption
                    key={c.id}
                    company={c}
                    isActive={activeCompanyId === c.id}
                    onSelect={handleSelect}
                  />
                ))
            }

            {/* All Companies — Admin only; Group view — Group Admin only (§7.2) */}
            {user.role === 'Admin' && !isGroupAdmin && (
              <>
                <div className="mx-3 my-1 border-t border-[var(--color-border-subtle)]" />
                <button
                  onClick={() => handleSelect(ALL_COMPANIES_ID)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                    'hover:bg-[var(--color-surface-hover)]',
                    // Normalized to token (equivalent to bg-indigo-50 / bg-indigo-900/20)
                    activeCompanyId === ALL_COMPANIES_ID && 'bg-[var(--color-primary-light)]'
                  )}
                >
                  <span className="flex-1 truncate text-xs font-semibold text-[var(--color-text-secondary)]">All Companies</span>
                  {/* VALID: indigo checkmark is primary brand active indicator */}
                  {activeCompanyId === ALL_COMPANIES_ID && (
                    <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  )}
                </button>
              </>
            )}
            {isGroupAdmin && (
              <>
                <div className="mx-3 my-1 border-t border-[var(--color-border-subtle)]" />
                <button
                  onClick={() => handleSelect(GROUP_VIEW_ID)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                    'hover:bg-[var(--color-surface-hover)]',
                    // Normalized to token (equivalent to bg-indigo-50 / bg-indigo-900/20)
                    activeCompanyId === GROUP_VIEW_ID && 'bg-[var(--color-primary-light)]'
                  )}
                >
                  <span className="flex-1 truncate text-xs font-semibold text-[var(--color-text-secondary)]">All Companies (Group view)</span>
                  {/* VALID: indigo checkmark is primary brand active indicator */}
                  {activeCompanyId === GROUP_VIEW_ID && (
                    <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  )}
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function CompanyOption({ company, isActive, onSelect }: {
  company: CompanyDoc; isActive: boolean; onSelect: (id: string) => void;
}) {
  const initials = (company.shortName || company.name || 'C').substring(0, 2).toUpperCase();
  const logoSrc = company.logo ? b64ToSrc(company.logo) : null;

  return (
    <button
      onClick={() => onSelect(company.id)}
      className={cn(
        'grid w-full grid-cols-[1.25rem_minmax(0,1fr)_1.25rem] items-center gap-2 px-3 py-2 transition-colors',
        'hover:bg-[var(--color-surface-hover)]',
        // Normalized to token
        isActive && 'bg-[var(--color-primary-light)]'
      )}
    >
      <span aria-hidden="true" />

      <span className="flex min-h-8 items-center justify-center overflow-hidden">
        {logoSrc ? (
          <img
            src={logoSrc}
            alt={company.shortName || company.name}
            className="max-h-8 w-auto max-w-[160px] object-contain select-none"
            draggable={false}
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-xs font-bold text-white">
            {initials}
          </span>
        )}
      </span>

      {/* VALID: indigo checkmark is primary brand active indicator */}
      <span className="flex justify-end">
        {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />}
      </span>
    </button>
  );
}

export default CompanySwitcher;
