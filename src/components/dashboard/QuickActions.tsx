/**
 * QuickActions — Quick action shortcuts to major ERP modules.
 *
 * Redesign pass: launch-pad presentation — consistent card sizing, refined
 * hover/focus, icon-badge header matching the rest of the dashboard.
 * ALL_ACTIONS data (label/path/module/permission), ROLE_MODULES, role
 * normalization and quickActionsForRole are untouched — this is styling only.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Target, Building2, ShoppingCart, Package,
  Truck, FileText, CreditCard, Users, Handshake, DollarSign,
  FolderKanban, ClipboardCheck, Zap, MapPinned, DraftingCompass, Landmark,
} from 'lucide-react';
import { canDo, type Module, type Permission } from '../../lib/permissions';
import { useCurrentUser } from '../../store/useAppStore';
import { UserRole } from '../../types';

export interface QuickAction {
  label: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  path: string;
  role?: string[];
  module: Module;
  permission: Permission;
}

const ALL_ACTIONS: QuickAction[] = [
  { label: 'Add Lead',      icon: <Target className="h-5 w-5" />,       color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/leads',     module: 'leads', permission: 'create' },
  { label: 'New Customer',  icon: <Building2 className="h-5 w-5" />,     color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/customers', module: 'customers', permission: 'create' },
  { label: 'Create Quotation', icon: <FileText className="h-5 w-5" />,   color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/quotations', module: 'quotations', permission: 'create' },
  { label: 'Create Order',  icon: <ShoppingCart className="h-5 w-5" />,  color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/orders',    module: 'orders', permission: 'create' },
  { label: 'New Invoice',   icon: <FileText className="h-5 w-5" />,      color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/invoices',  module: 'invoices', permission: 'create' },
  { label: 'Add Payment',   icon: <CreditCard className="h-5 w-5" />,    color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/payments',  module: 'payments', permission: 'create' },
  { label: 'New Dispatch',  icon: <Truck className="h-5 w-5" />,         color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/dispatch',  module: 'dispatch', permission: 'create' },
  { label: 'Add Product',   icon: <Package className="h-5 w-5" />,       color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/products',  module: 'products', permission: 'create' },
  { label: 'Stock Entry',   icon: <Package className="h-5 w-5" />,       color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/stock',     module: 'stock', permission: 'create' },
  { label: 'Add Partner',  icon: <Handshake className="h-5 w-5" />,    color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/partners', module: 'partners', permission: 'create' },
  { label: 'Commission Rule', icon: <DollarSign className="h-5 w-5" />, color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/commission-rules', module: 'partners', permission: 'create' },
  { label: 'Add Employee',  icon: <Users className="h-5 w-5" />,         color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/employees', module: 'employees', permission: 'create' },
  { label: 'Create Project', icon: <FolderKanban className="h-5 w-5" />,    color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/projects', module: 'projects', permission: 'create' },
  { label: 'Schedule Survey', icon: <MapPinned className="h-5 w-5" />,            color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/surveys', module: 'surveys', permission: 'create' },
  { label: 'Create Design',  icon: <DraftingCompass className="h-5 w-5" />,              color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/engineering-designs', module: 'engineering', permission: 'create' },
  { label: 'New QC Check', icon: <ClipboardCheck className="h-5 w-5" />,       color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/qc', module: 'qc', permission: 'create' },
  { label: 'Commissioning', icon: <Zap className="h-5 w-5" />,                         color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/commissioning', module: 'commissioning', permission: 'create' },
  { label: 'New Handover',  icon: <Handshake className="h-5 w-5" />,        color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/handover', module: 'projects', permission: 'create' },
  { label: 'AMC Contract',  icon: <FileText className="h-5 w-5" />,                color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/amc-contracts', module: 'projects', permission: 'create' },
  { label: 'Service Ticket', icon: <FileText className="h-5 w-5" />,                color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/service-tickets', module: 'service_tickets', permission: 'create' },
  { label: 'Net Metering',  icon: <FileText className="h-5 w-5" />,                 color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/net-metering', module: 'net_metering', permission: 'create' },
  { label: 'Subsidy',       icon: <Landmark className="h-5 w-5" />,                color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/subsidy', module: 'subsidy', permission: 'create' },
  { label: 'Tax Invoice',   icon: <FileText className="h-5 w-5" />,                color: 'text-[var(--color-primary)]', bg: 'bg-[var(--color-bg-sunken)] ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]', path: '/tax-invoices', module: 'tax_invoices', permission: 'create' },
];

const ROLE_MODULES: Record<UserRole, Module[]> = {
  [UserRole.Admin]:      ALL_ACTIONS.map(action => action.module),
  [UserRole.Director]:   ALL_ACTIONS.map(action => action.module),
  [UserRole.Sales]:      ['leads', 'customers', 'orders', 'quotations', 'invoices'],
  [UserRole.Accounts]:   ['customers', 'orders', 'invoices', 'payments'],
  [UserRole.Warehouse]:  ['products', 'stock', 'dispatch'],
  [UserRole.HR]:         ['employees'],
  [UserRole.Operations]: ['orders', 'products', 'stock', 'dispatch', 'commissioning', 'qc', 'projects'],
  [UserRole.Partner]:    ['leads', 'customers', 'partners', 'dashboard'],
};

function normalizeRole(role?: string): UserRole {
  if (role === UserRole.Admin || role === 'Management') return UserRole.Admin;
  if (role === UserRole.Director) return UserRole.Director;
  if (role === UserRole.Accounts || role === 'Account Head' || role === 'Accounts Executive') return UserRole.Accounts;
  if (role === UserRole.Warehouse || role === 'Warehouse Executive') return UserRole.Warehouse;
  if (role === UserRole.Operations || role === 'Operations Head') return UserRole.Operations;
  if (role === UserRole.HR) return UserRole.HR;
  return UserRole.Sales;
}

export function quickActionsForRole(role: UserRole): QuickAction[] {
  const allowedModules = ROLE_MODULES[role] ?? [];
  return ALL_ACTIONS.filter(action =>
    allowedModules.includes(action.module) && canDo(action.module, action.permission)
  );
}

interface QuickActionsProps {
  onActionComplete?: () => void;
  createOnSelect?: boolean;
}

export const QuickActions = React.memo(function QuickActions({ onActionComplete, createOnSelect = false }: QuickActionsProps) {
  const navigate = useNavigate();
  const user = useCurrentUser();

  const visibleActions = quickActionsForRole(normalizeRole(user?.role));

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="rounded-xl bg-[var(--color-primary-light)] p-2 text-[var(--color-primary-text)]">
          <Zap className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[var(--color-text)]">Quick Actions</h3>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Jump straight into your most common tasks</p>
        </div>
      </div>

      <div className="grid grid-cols-3 min-[480px]:grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2.5">
        {visibleActions.map(action => (
          <button
            key={action.label}
            onClick={() => {
              onActionComplete?.();
              navigate(createOnSelect ? `${action.path}?create=1` : action.path);
            }}
            className={[
              'flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl p-3 ring-1 transition-all duration-200',
              'hover:shadow-sm hover:-translate-y-0.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
              action.bg,
            ].join(' ')}
          >
            <div className={`${action.color} transition-transform duration-200 group-hover:scale-110`}>
              {action.icon}
            </div>
            <span className={`text-[11px] font-bold text-center leading-tight ${action.color}`}>
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
});
