/**
 * ModuleGrid — Permission-filtered module grid for the App tab
 *
 * Default state of the App tab when no module is selected.
 * Renders ModuleCard tiles grouped by:
 *   Sales / Inventory / Finance / HR / Productivity
 *
 * Each tile is permission-filtered via canDo('view', module).
 * Tapping a tile calls onSelect(route) which AppWorkspace uses
 * to update ContextResolver and navigate.
 *
 * Per Foundation doc Section 5 — Module Grid:
 * - "Compact ModuleGrid grouped by Sales / Inventory / Finance / HR / Productivity"
 * - "Grid is permission-filtered — only modules the role can view appear as tiles"
 * - "Renders normally (static, no query dependency)"
 */

import React, { useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  Target, Building2, ClipboardList, ShoppingCart, FileText,
  Boxes, Package, Warehouse, Truck, Tag,
  CreditCard, BarChart3,
  Users, Calendar, DollarSign,
  CheckSquare, UserCog, Shield, Settings, FolderKanban, MapPinned, DraftingCompass,
  Handshake, HardHat, ClipboardCheck, Zap, Landmark, CalendarCheck, Wrench, Activity,} from 'lucide-react';
import type { Module } from '../../../lib/permissions';
import { canDo } from '../../../lib/permissions';
import { isDemoHiddenModule, isDemoUser } from '../../../lib/demoCapabilityPolicy';
import { useAppStore } from '../../../store/useAppStore';
import { ModuleCard } from './ModuleCard';

// ── Module Type ───────────────────────────────────────────────

type ModuleGroup = 'sales' | 'field' | 'procurement' | 'inventory' | 'finance' | 'hr' | 'productivity';

interface ModuleDef {
  id: string;
  label: string;
  route: string;
  group: ModuleGroup;
  icon: ReactNode;
  permissionModule: Module;
}

// ── Group Configuration ───────────────────────────────────────

const GROUP_LABELS: Record<ModuleGroup, { label: string; subtitle: string }> = {
  sales:        { label: 'Sales',        subtitle: 'Leads to invoices' },
  field:        { label: 'Field Operations', subtitle: 'On-site project work' },
  procurement:  { label: 'Procurement', subtitle: 'Vendors and purchasing' },
  inventory:    { label: 'Inventory',    subtitle: 'Products to dispatch' },
  finance:      { label: 'Finance',      subtitle: 'Payments & reports' },
  hr:           { label: 'HR',           subtitle: 'People & payroll' },
  productivity: { label: 'Productivity', subtitle: 'Users, roles & settings' },
};

const GROUP_ORDER: ModuleGroup[] = ['sales', 'field', 'procurement', 'inventory', 'finance', 'hr', 'productivity'];

// ── Module Definitions ────────────────────────────────────────

const MODULES: ModuleDef[] = [
  // Sales
  { id: 'leads',      label: 'Leads',       route: '/leads',      group: 'sales',       icon: <Target />,          permissionModule: 'leads' },
  { id: 'customers',  label: 'Customers',   route: '/customers',  group: 'sales',       icon: <Building2 />,       permissionModule: 'customers' },
  { id: 'projects',   label: 'Projects',    route: '/projects',   group: 'sales',       icon: <FolderKanban />,    permissionModule: 'projects' },
  { id: 'quotations', label: 'Quotations',  route: '/quotations', group: 'sales',       icon: <ClipboardList />,   permissionModule: 'quotations' },
  { id: 'orders',     label: 'Orders',      route: '/orders',     group: 'sales',       icon: <ShoppingCart />,    permissionModule: 'orders' },
  { id: 'invoices',   label: 'Invoices',    route: '/invoices',   group: 'sales',       icon: <FileText />,        permissionModule: 'invoices' },
  { id: 'surveys',    label: 'Surveys',     route: '/surveys',    group: 'field',       icon: <MapPinned />,       permissionModule: 'surveys' },
  { id: 'engineering', label: 'Engineering', route: '/engineering-designs', group: 'field', icon: <DraftingCompass />, permissionModule: 'engineering' },
  { id: 'installations', label: 'Installations', route: '/installations', group: 'field', icon: <HardHat />, permissionModule: 'installations' },
  { id: 'qc', label: 'QC', route: '/qc', group: 'field', icon: <ClipboardCheck />, permissionModule: 'qc' },
  { id: 'handovers', label: 'Handovers', route: '/handovers', group: 'field', icon: <Handshake />, permissionModule: 'projects' },
  { id: 'commissioning', label: 'Commissioning', route: '/commissioning', group: 'field', icon: <Zap />, permissionModule: 'commissioning' },
  { id: 'amc-contracts', label: 'AMC Contracts', route: '/amc-contracts', group: 'field', icon: <CalendarCheck />, permissionModule: 'projects' },
  { id: 'service-tickets', label: 'Service Tickets', route: '/service-tickets', group: 'field', icon: <Wrench />, permissionModule: 'service_tickets' },
  { id: 'monitoring', label: 'Monitoring', route: '/monitoring', group: 'field', icon: <Activity />, permissionModule: 'projects' },
  { id: 'vendors', label: 'Vendors', route: '/vendors', group: 'procurement', icon: <Building2 />, permissionModule: 'vendors' },
  { id: 'purchase-orders', label: 'Purchase Orders', route: '/purchase-orders', group: 'procurement', icon: <ShoppingCart />, permissionModule: 'purchase_orders' },
  { id: 'goods-receipts', label: 'Goods Receipts', route: '/goods-receipts', group: 'procurement', icon: <Package />, permissionModule: 'purchase_orders' },

  // Compliance
  { id: 'net-metering', label: 'Net Metering', route: '/net-metering', group: 'field', icon: <Zap />, permissionModule: 'net_metering' },
  { id: 'subsidy', label: 'Subsidy', route: '/subsidy', group: 'field', icon: <Landmark />, permissionModule: 'subsidy' },
  { id: 'tax-invoices', label: 'Tax Invoices', route: '/tax-invoices', group: 'finance', icon: <FileText />, permissionModule: 'tax_invoices' },

  // Inventory
  { id: 'products',   label: 'Products',    route: '/products',   group: 'inventory',   icon: <Boxes />,           permissionModule: 'products' },
  { id: 'stock',      label: 'Stock',       route: '/stock',      group: 'inventory',   icon: <Package />,         permissionModule: 'stock' },
  { id: 'warehouses', label: 'Warehouses',  route: '/warehouses', group: 'inventory',   icon: <Warehouse />,       permissionModule: 'warehouses' },
  { id: 'dispatch',   label: 'Dispatch',    route: '/dispatch',   group: 'inventory',   icon: <Truck />,           permissionModule: 'dispatch' },
  { id: 'categories', label: 'Categories',  route: '/categories', group: 'inventory',   icon: <Tag />,             permissionModule: 'categories' },
  { id: 'partners',   label: 'Partners',     route: '/partners',   group: 'sales',       icon: <Handshake />,       permissionModule: 'partners' },
  { id: 'commission-rules', label: 'Comm. Rules', route: '/commission-rules', group: 'sales', icon: <FileText />, permissionModule: 'partners' },
  { id: 'commission-approvals', label: 'Approvals', route: '/commission-approvals', group: 'sales', icon: <Shield />, permissionModule: 'partners' },
  { id: 'settlements', label: 'Settlements', route: '/settlements', group: 'sales', icon: <DollarSign />, permissionModule: 'partners' },
  { id: 'performance', label: 'Performance', route: '/performance', group: 'sales', icon: <BarChart3 />, permissionModule: 'partners' },

  // Finance
  { id: 'payments',   label: 'Payments',    route: '/payments',   group: 'finance',     icon: <CreditCard />,      permissionModule: 'payments' },
  { id: 'reports',    label: 'Reports',     route: '/reports',    group: 'finance',     icon: <BarChart3 />,       permissionModule: 'reports' },

  // HR
  { id: 'employees',  label: 'Employees',   route: '/employees',  group: 'hr',          icon: <Users />,           permissionModule: 'employees' },
  { id: 'attendance', label: 'Attendance',  route: '/attendance', group: 'hr',          icon: <Calendar />,        permissionModule: 'attendance' },
  { id: 'payroll',    label: 'Payroll',     route: '/payroll',    group: 'hr',          icon: <DollarSign />,      permissionModule: 'payroll' },

  // Productivity
  { id: 'tasks',      label: 'Tasks',       route: '/tasks',      group: 'productivity', icon: <CheckSquare />,    permissionModule: 'dashboard' },
  { id: 'users',      label: 'Users',       route: '/users',      group: 'productivity', icon: <UserCog />,        permissionModule: 'users' },
  { id: 'roles',      label: 'Roles',       route: '/roles',      group: 'productivity', icon: <Shield />,         permissionModule: 'roles' },
  { id: 'companies',  label: 'Companies',   route: '/companies',  group: 'productivity', icon: <Building2 />,      permissionModule: 'companies' },
  { id: 'settings',   label: 'Settings',    route: '/settings',   group: 'productivity', icon: <Settings />,       permissionModule: 'settings' },
];

// ── Props ─────────────────────────────────────────────────────

interface ModuleGridProps {
  onSelectModule: (route: string) => void;
}

// ── Component ─────────────────────────────────────────────────

export const ModuleGrid = React.memo(function ModuleGrid({ onSelectModule }: ModuleGridProps) {
  // Filter modules by view permission + demo hidden modules, then group them
  const groupedModules = useMemo(() => {
    const user = useAppStore.getState().user;
    const isDemo = isDemoUser(user);
    const groups = new Map<ModuleGroup, ModuleDef[]>();

    for (const mod of MODULES) {
      if (!canDo('view', mod.permissionModule)) continue;
      if (isDemo && isDemoHiddenModule(mod.permissionModule)) continue;

      const existing = groups.get(mod.group) ?? [];
      existing.push(mod);
      groups.set(mod.group, existing);
    }

    return groups;
  }, []);

  // Empty state: all modules filtered out by permissions
  if (groupedModules.size === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="h-14 w-14 rounded-2xl bg-[var(--color-bg-sunken)] flex items-center justify-center mb-4">
          <span className="text-2xl text-[var(--color-text-muted)]">—</span>
        </div>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">No modules available</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          You don&apos;t have permission to access any modules. Contact your admin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      {GROUP_ORDER.map((groupKey) => {
        const modules = groupedModules.get(groupKey);
        if (!modules || modules.length === 0) return null;

        const groupInfo = GROUP_LABELS[groupKey];

        return (
          <section key={groupKey}>
            {/* Group header */}
            <div className="px-1 mb-2.5">
              <h3 className="text-sm font-bold text-[var(--color-text)]">{groupInfo.label}</h3>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{groupInfo.subtitle}</p>
            </div>

            {/* Module tiles — 3-column grid for compact layout */}
            <div className="grid grid-cols-3 gap-2">
              {modules.map((mod) => (
                <ModuleCard
                  key={mod.id}
                  label={mod.label}
                  icon={mod.icon}
                  route={mod.route}
                  onSelect={onSelectModule}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
});

export default ModuleGrid;
