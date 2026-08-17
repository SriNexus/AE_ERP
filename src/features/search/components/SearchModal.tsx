import { useEffect, useRef, memo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, X, ArrowLeft, Clock, ArrowRight, Loader2,
  Target, Users, ShoppingCart, ClipboardList, FileText, Package, ListTodo, Layers3, Warehouse, Boxes, Truck,
  FolderKanban, Briefcase, Handshake, ClipboardCheck, UserCircle, DollarSign,
  Wrench, CheckCircle, Zap, Gauge, PiggyBank, Shield, Headphones, Activity,
  Map, PenTool, Receipt, Bell,
} from 'lucide-react';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { type SearchResult, type SearchCategory } from '../types';
import { cn } from '../../../utils/cn';
import React from 'react';

const CATEGORY_ICONS: Record<string, React.FC<{ className?: string }>> = {
  tasks:      ListTodo,
  leads:      Target,
  customers:  Users,
  orders:     ShoppingCart,
  quotations: ClipboardList,
  invoices:   FileText,
  products:   Package,
  categories: Layers3,
  warehouses: Warehouse,
  stock:      Boxes,
  dispatch:   Truck,
  cases:      FolderKanban,
  projects:   Briefcase,
  vendors:    Handshake,
  purchase_orders: ClipboardCheck,
  goods_receipts:  Package,
  partners:        Handshake,
  employees:       UserCircle,
  payments:        DollarSign,
  installations:   Wrench,
  qc_checks:       CheckCircle,
  commissioning:   Zap,
  net_metering:    Gauge,
  subsidy:         PiggyBank,
  handovers:       Shield,
  amc_contracts:   Shield,
  service_tickets: Headphones,
  monitoring:      Activity,
  surveys:         Map,
  engineering_designs: PenTool,
  tax_invoices:       Receipt,
  notifications:      Bell,
};

const ROUTE_CATEGORY: Record<string, string> = {
  '/app': 'tasks',
  '/tasks': 'tasks',
  '/leads': 'leads',
  '/customers': 'customers',
  '/orders': 'orders',
  '/quotations': 'quotations',
  '/invoices': 'invoices',
  '/products': 'products',
  '/categories': 'categories',
  '/warehouses': 'warehouses',
  '/stock': 'stock',
  '/dispatch': 'dispatch',
  '/projects': 'projects',
  '/vendors': 'vendors',
  '/purchase-orders': 'purchase_orders',
  '/goods-receipts': 'goods_receipts',
  '/cases': 'cases',
  // Phase 9C
  '/partners': 'partners',
  '/employees': 'employees',
  '/payments': 'payments',
  '/installations': 'installations',
  '/qc': 'qc_checks',
  '/commissioning': 'commissioning',
  '/net-metering': 'net_metering',
  '/subsidy': 'subsidy',
  '/handovers': 'handovers',
  '/amc-contracts': 'amc_contracts',
  '/service-tickets': 'service_tickets',
  '/monitoring': 'monitoring',
  '/surveys': 'surveys',
  '/engineering-designs': 'engineering_designs',
  '/tax-invoices': 'tax_invoices',
  '/notifications': 'notifications',
};

interface SearchModalProps {
  open:    boolean;
  onClose: () => void;
  centeredOnMobile?: boolean;
  moduleRoute?: string;
  filterContent?: ReactNode;
  onClear?: () => void;
  clearVisible?: boolean;
}

export function SearchModal({ open, onClose, centeredOnMobile = false, moduleRoute, filterContent, onClear, clearVisible = false }: SearchModalProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    query, setQuery, isLoading, groups, selectedIndex, setSelectedIndex,
    handleSelect, handleKeyDown, recentSearches, handleClearRecent, isEmpty,
  } = useGlobalSearch();
  const moduleCategory = moduleRoute ? ROUTE_CATEGORY[moduleRoute] : undefined;
  const visibleGroups = moduleCategory ? groups.filter((group) => group.category === moduleCategory) : groups;
  const visibleResults = visibleGroups.flatMap((group) => group.results);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return undefined;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open, setQuery]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Intercept popstate on mobile to close search on back button
  useEffect(() => {
    if (!open) return;
    const handler = () => { onClose(); };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [open, onClose]);

  // Push a state entry on mobile open so back button can close search
  useEffect(() => {
    if (!open) return;
    window.history.pushState(null, '', window.location.href);
  }, [open]);

  if (!open) return null;

  const submitModuleSearch = () => {
    const term = query.trim();
    if (!moduleRoute || !term) return;
    navigate(`${moduleRoute}?q=${encodeURIComponent(term)}`);
    onClose();
  };

  const handleClear = () => {
    setQuery('');
    onClear?.();
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (moduleRoute && query.trim()) {
        submitModuleSearch();
      } else {
        const r = selectedIndex >= 0 ? visibleResults[selectedIndex] : visibleResults[0];
        if (r) onResultClick(r);
      }
      return;
    }
    handleKeyDown(e, onResultClick);
  };

  const onResultClick = (r: SearchResult) => {
    handleSelect(r, (link) => { navigate(link); onClose(); });
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-[var(--color-overlay)] backdrop-blur-sm z-[100]" onClick={onClose} />

      {/* Desktop: centered popup (md+) / Mobile: full-screen sheet (<md) */}
      <div className={cn(
        'fixed z-[101]',
        // Desktop: centered popup
        'md:left-1/2 md:top-[12%] md:-translate-x-1/2 md:w-full md:max-w-xl md:animate-scaleIn',
        // Mobile: full-screen
        centeredOnMobile
          ? 'left-1/2 top-[72px] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 animate-scaleIn'
          : 'inset-0 top-0 flex flex-col bg-[var(--color-surface)] animate-fadeIn',
        'md:bg-transparent md:block md:animate-scaleIn',
      )}>
        <div className={cn(
          'bg-[var(--color-surface)]',
          // Desktop: rounded card
          'md:rounded-2xl md:border md:border-[var(--color-border)] md:shadow-[var(--shadow-dropdown)] md:overflow-hidden',
          // Mobile: full-screen with no rounded corners
          centeredOnMobile
            ? 'flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-dropdown)]'
            : 'flex flex-col h-full',
          'md:block md:h-auto',
        )}>
          {/* Mobile header with back button (visible only on mobile) */}
          <div className="md:hidden flex items-center gap-2 px-3 py-3 border-b border-[var(--color-border-subtle)] shrink-0">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close search"
              className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)] transition-colors -ml-1"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-bg-sunken)]">
              {isLoading ? (
                <Loader2 className="h-4 w-4 text-[var(--color-primary)] animate-spin shrink-0" />
              ) : (
                <Search className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
              )}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search leads, customers, orders…"
                className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
              />
              {moduleRoute && query && (
                <button
                  type="button"
                  onClick={submitModuleSearch}
                  className="p-0.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                  aria-label="Search module"
                >
                  <Search className="h-4 w-4" />
                </button>
              )}
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="p-0.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Desktop search header (hidden on mobile) */}
          <div className="hidden md:flex items-center gap-3 px-4 py-3.5 border-b border-[var(--color-border-subtle)]">
            {isLoading ? (
              <Loader2 className="h-4 w-4 text-[var(--color-primary)] animate-spin shrink-0" />
            ) : (
              <Search className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search leads, customers, orders, products…"
              className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
            />
            {moduleRoute && query && (
              <button
                type="button"
                onClick={submitModuleSearch}
                className="p-0.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                aria-label="Search module"
              >
                <Search className="h-3.5 w-3.5" />
              </button>
            )}
            {query && (
              <button
                onClick={() => setQuery('')}
                className="p-0.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] font-mono">
              Esc
            </kbd>
          </div>

          {/* Results — scrollable on mobile */}
          <div className={cn(
            'overflow-y-auto',
            'md:max-h-[420px] md:py-2',
            'flex-1',
          )}>
            {filterContent && (
              <div className="border-b border-[var(--color-border-subtle)]">
                {filterContent}
                {onClear && (
                  <div className="flex justify-end px-4 pb-3">
                    <button
                      type="button"
                      onClick={handleClear}
                      disabled={!clearVisible && !query}
                      className="min-h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}

            {((moduleCategory && query.trim().length >= 2 && !isLoading && visibleResults.length === 0) || (!moduleCategory && isEmpty)) && (
              <div className="flex flex-col items-center py-12 gap-2 text-[var(--color-text-muted)]">
                <Search className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium">No results found</p>
                <p className="text-xs">Try a different keyword</p>
              </div>
            )}

            {!query && recentSearches.length > 0 && (
              <div className="px-4 pb-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Recent</span>
                  <button onClick={handleClearRecent} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">Clear</button>
                </div>
                {recentSearches.map((r) => (
                  <button key={r} onClick={() => setQuery(r)}
                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors text-left">
                    <Clock className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
                    {r}
                  </button>
                ))}
              </div>
            )}

            {visibleGroups.map((group) => {
              const Icon = CATEGORY_ICONS[group.category];
              return (
                <div key={group.category} className="mb-1">
                  <div className="flex items-center gap-2 px-4 py-1.5">
                    <Icon className="h-3 w-3 text-[var(--color-text-muted)]" />
                    <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                      {group.label}
                    </span>
                  </div>
                  {group.results.map((result) => {
                    const idx = visibleResults.indexOf(result);
                    return (
                      <ResultRow
                        key={result.id}
                        result={result}
                        isSelected={idx === selectedIndex}
                        onHover={() => setSelectedIndex(idx)}
                        onClick={() => onResultClick(result)}
                      />
                    );
                  })}
                </div>
              );
            })}

            {!query && recentSearches.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-[var(--color-text-muted)]">Start typing to search across your ERP</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-60">Leads · Customers · Orders · Products</p>
              </div>
            )}
          </div>

          {/* Footer — hidden on mobile (mobile has its own close button) */}
          <div className="hidden md:flex border-t border-[var(--color-border-subtle)] px-4 py-2 items-center gap-4 text-xs text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border border-[var(--color-border)] font-mono">↑↓</kbd> Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border border-[var(--color-border)] font-mono">↵</kbd> Open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border border-[var(--color-border)] font-mono">Esc</kbd> Close
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

const ResultRow = memo(function ResultRow({
  result, isSelected, onHover, onClick,
}: {
  result: SearchResult; isSelected: boolean; onHover: () => void; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
        isSelected ? 'bg-[var(--color-primary-light)]' : 'hover:bg-[var(--color-surface-hover)]'
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text)] truncate">{result.title}</p>
        {result.subtitle && (
          <p className="text-xs text-[var(--color-text-muted)] truncate">{result.subtitle}</p>
        )}
      </div>
      <ArrowRight
        className={cn(
          'h-3.5 w-3.5 shrink-0 transition-opacity',
          isSelected ? 'opacity-100 text-[var(--color-primary)]' : 'opacity-0 text-[var(--color-text-disabled)]'
        )}
      />
    </button>
  );
});

export default SearchModal;
