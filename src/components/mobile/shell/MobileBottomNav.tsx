/**
 * MobileBottomNav — Premium platform-grade bottom navigation
 *
 * Five fixed tabs: Home | List | Create | Dash | Settings
 *
 * Design: Apple/Linear-inspired premium glassmorphism
 *   - Thick frosted glass with deep backdrop blur
 *   - Floating pill container hugging the bottom edge
 *   - Clean active indicator with accent color
 *   - Smooth 250ms ease-out transitions
 *   - Proper safe-area integration
 *   - Touch-friendly 48px minimum hit targets
 *
 * Active tab is DERIVED from the current route (never stored).
 * The App tab's label + icon dynamically updates based on currentModule.
 * Auth pages (/login) hide the entire component via MobileShell.
 */

import React from 'react';
import {
  BarChart3,
  Boxes,
  Building2,
  Calendar,
  ClipboardList,
  CreditCard,
  DollarSign,
  FileText,
  HardHat,
  Home,
  ClipboardCheck,
  Zap,
  LayoutDashboard,
  ListTodo,
  Package,
  Plus,
  Settings,
  Shield,
  ShoppingCart,
  Tag,
  Target,
  Truck,
  UserCog,
  Users,
  Warehouse,
  FolderKanban,
  MapPinned,
  DraftingCompass,
  Handshake,
  Landmark,
  ReceiptText,
  CalendarCheck,
  Wrench,
  Activity,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../../../utils/cn';
import { useMobileNavigation } from '../hooks/useMobileNavigation';
import { useContextResolver } from '../context/ContextResolver';
import type { MobileTab } from '../types';

// ── Module label/icon registry ──────────────────────────────────

const LIST_META: Record<string, { label: string; icon: React.ReactNode }> = {
  '/leads':               { label: 'Leads',       icon: <Target className="h-5 w-5" /> },
  '/customers':           { label: 'Customers',   icon: <Building2 className="h-5 w-5" /> },
  '/projects':            { label: 'Projects',    icon: <FolderKanban className="h-5 w-5" /> },
  '/surveys':             { label: 'Surveys',     icon: <MapPinned className="h-5 w-5" /> },
  '/engineering-designs': { label: 'Engineering', icon: <DraftingCompass className="h-5 w-5" /> },
  '/installations':     { label: 'Installations', icon: <HardHat className="h-5 w-5" /> },
  '/commissioning':     { label: 'Commissioning', icon: <Zap className="h-5 w-5" /> },
  '/handovers':         { label: 'Handovers',   icon: <Handshake className="h-5 w-5" /> },
  '/qc':                { label: 'QC',           icon: <ClipboardCheck className="h-5 w-5" /> },
  '/net-metering':        { label: 'Net Metering', icon: <Zap className="h-5 w-5" /> },
  '/subsidy':             { label: 'Subsidy',     icon: <Landmark className="h-5 w-5" /> },
  '/tax-invoices':        { label: 'Tax Invoices', icon: <ReceiptText className="h-5 w-5" /> },
  '/amc-contracts':       { label: 'AMC',         icon: <CalendarCheck className="h-5 w-5" /> },
  '/service-tickets':     { label: 'Service',     icon: <Wrench className="h-5 w-5" /> },
  '/monitoring':          { label: 'Monitoring',  icon: <Activity className="h-5 w-5" /> },
  '/cases':               { label: 'Cases',       icon: <FolderKanban className="h-5 w-5" /> },
  '/loan-applications':       { label: 'Loan Applications', icon: <FileText className="h-5 w-5" /> },
  '/vendors':             { label: 'Vendors',     icon: <Building2 className="h-5 w-5" /> },
  '/purchase-orders':     { label: 'POs',         icon: <ShoppingCart className="h-5 w-5" /> },
  '/goods-receipts':      { label: 'Receipts',    icon: <Package className="h-5 w-5" /> },
  '/quotations':          { label: 'Quotations',  icon: <ClipboardList className="h-5 w-5" /> },
  '/orders':              { label: 'Orders',      icon: <ShoppingCart className="h-5 w-5" /> },
  '/invoices':            { label: 'Invoices',    icon: <FileText className="h-5 w-5" /> },
  '/products':            { label: 'Products',    icon: <Boxes className="h-5 w-5" /> },
  '/categories':          { label: 'Categories',  icon: <Tag className="h-5 w-5" /> },
  '/warehouses':          { label: 'Warehouses',  icon: <Warehouse className="h-5 w-5" /> },
  '/stock':               { label: 'Stock',       icon: <Package className="h-5 w-5" /> },
  '/dispatch':            { label: 'Dispatch',    icon: <Truck className="h-5 w-5" /> },
  '/partners':            { label: 'Partners',    icon: <Handshake className="h-5 w-5" /> },
  '/commission-rules':    { label: 'Comm. Rules', icon: <DollarSign className="h-5 w-5" /> },
  '/commission-approvals':{ label: 'Approvals',   icon: <Shield className="h-5 w-5" /> },
  '/settlements':         { label: 'Settlements', icon: <DollarSign className="h-5 w-5" /> },
  '/performance':         { label: 'Performance', icon: <BarChart3 className="h-5 w-5" /> },
  '/payments':            { label: 'Payments',    icon: <CreditCard className="h-5 w-5" /> },
  '/reports':             { label: 'Reports',     icon: <LayoutDashboard className="h-5 w-5" /> },
  '/employees':           { label: 'Employees',   icon: <UserCog className="h-5 w-5" /> },
  '/attendance':          { label: 'Attendance',  icon: <Calendar className="h-5 w-5" /> },
  '/payroll':             { label: 'Payroll',     icon: <CreditCard className="h-5 w-5" /> },
  '/tasks':               { label: 'Tasks',       icon: <ListTodo className="h-5 w-5" /> },
  '/users':               { label: 'Users',       icon: <Users className="h-5 w-5" /> },
  '/roles':               { label: 'Roles',       icon: <Shield className="h-5 w-5" /> },
  '/companies':           { label: 'Companies',   icon: <Building2 className="h-5 w-5" /> },
  '/settings':            { label: 'Settings',    icon: <LayoutDashboard className="h-5 w-5" /> },
};

const DEFAULT_LIST_META = { label: 'Tasks', icon: <ListTodo className="h-5 w-5" /> };

const BASE_TABS: { id: MobileTab; label: string; icon: React.ReactNode }[] = [
  { id: 'home',     label: 'Home',     icon: <Home className="h-5 w-5" /> },
  { id: 'tasks',    label: DEFAULT_LIST_META.label, icon: DEFAULT_LIST_META.icon },
  { id: 'create',   label: 'Create',   icon: <Plus className="h-5 w-5" /> },
  { id: 'recent',   label: 'Dash',     icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-5 w-5" /> },
];

// ── Component ──────────────────────────────────────────────────

export const MobileBottomNav = React.memo(function MobileBottomNav() {
  const { activeTab, navigateToTab } = useMobileNavigation();
  const { currentModule } = useContextResolver();
  const location = useLocation();
  const navigate = useNavigate();

  // Derive App tab label + icon from current module context
  const listMeta = location.pathname === '/' || location.pathname === '/app'
    ? DEFAULT_LIST_META
    : LIST_META[currentModule || ''] || DEFAULT_LIST_META;

  const tabs = BASE_TABS.map((tab) =>
    tab.id === 'tasks' ? { ...tab, ...listMeta } : tab,
  );

  /**
   * Handle tab click — single source of truth for Create tab.
   *
   * On Homepage (/) or Task module (/tasks):
   *   Navigate to /create which renders the Task creation form.
   *
   * On any other module:
   *   Existing behavior: navigate to {currentModule}?create=1 via navigateToTab.
   */
  const handleTabClick = (tabId: MobileTab) => {
    if (tabId === 'create') {
      const path = location.pathname;
      if (path === '/' || path === '/app' || path.startsWith('/tasks')) {
        navigate('/create', { replace: true });
        return;
      }
    }
    navigateToTab(tabId);
  };

  return (
    <>
      <nav
        className={cn(
          'mobile-bottom-nav',
          // Fixed to bottom, full width, above content
          'fixed inset-x-0 bottom-0 z-30',
          // Safe area padding below the pill
          'pb-[max(env(safe-area-inset-bottom,0px),0px)]',
        )}
        role="tablist"
        aria-label="Mobile navigation"
      >
        {/* ── Premium glassmorphism pill container ──────────── */}
        <div
          className={cn(
            // Outer shape: floating pill hugging the bottom
            'mx-2 mb-1.5 rounded-[22px] overflow-hidden',
            // Glass: thick frosted backdrop with deep blur
            'bg-[var(--color-surface)]/80 dark:bg-[var(--color-surface)]/75',
            'backdrop-blur-2xl backdrop-saturate-200',
            // Premium shadow stack: subtle ambient + directional
            'shadow-[0_1px_8px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]',
            'dark:shadow-[0_1px_8px_rgba(0,0,0,0.15),0_8px_24px_rgba(0,0,0,0.2)]',
            // Subtle border for definition
            'border border-[var(--color-border)]/50',
            'dark:border-[var(--color-border)]/30',
          )}
        >
          {/* ── Five tab buttons ──────────────────────────── */}
          <div className="relative flex items-end justify-around h-[60px] px-1 pt-2 pb-1.5">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;

              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={tab.label}
                  onClick={() => handleTabClick(tab.id)}
                  className={cn(
                    // Layout: flex column with icon + label
                    'group relative flex flex-col items-center justify-end',
                    'h-full min-w-0 flex-1',
                    'px-1 py-0.5',
                    // Touch target minimum
                    'min-h-[44px]',
                    // Transitions
                    'transition-colors duration-[250ms] ease-out',
                    // Cursor
                    'select-none',
                  )}
                >
                  {/* Active indicator — slim pill floating above */}
                  {isActive && (
                    <span
                      className={cn(
                        'absolute -top-px left-1/2 -translate-x-1/2',
                        'w-[18px] h-[3px] rounded-full',
                        'bg-[var(--color-primary)]',
                        'transition-all duration-[250ms] ease-out',
                      )}
                      aria-hidden="true"
                    />
                  )}

                  {/* Icon */}
                  <div
                    className={cn(
                      'flex items-center justify-center',
                      'transition-colors duration-[250ms] ease-out',
                      isActive
                        ? 'text-[var(--color-primary)]'
                        : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]',
                    )}
                  >
                    {tab.icon}
                  </div>

                  {/* Label */}
                  <span
                    className={cn(
                      'text-[9px] leading-tight text-center',
                      'transition-colors duration-[250ms] ease-out',
                      'max-w-[64px] truncate',
                      'mt-0.5',
                      isActive
                        ? [
                            'text-[var(--color-primary)]',
                            'font-bold',
                            'tracking-[0.01em]',
                          ]
                        : [
                            'text-[var(--color-text-muted)]',
                            'font-medium',
                          ],
                    )}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

    </>
  );
});

export default MobileBottomNav;
