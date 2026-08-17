import React from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Boxes,
  Brain,
  Building2,
  Calendar,
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  DollarSign,
  FileText,
  Handshake,
  Home,
  LayoutDashboard,
  Package,
  ReceiptText,
  Settings,
  Shield,
  MapPinned,
  DraftingCompass,
  HardHat,
  Landmark,
  ShoppingCart,
  Target,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Warehouse,
  Wrench,
  Zap,
} from 'lucide-react';
import type { Module } from '../../lib/permissions';

export type NavItem = {
  label: string;
  path?: string;
  icon: React.ReactNode;
  children?: NavItem[];
  module?: Module;
  ownerOnly?: boolean;
};

export const ERP_NAV_ITEMS: NavItem[] = [
  { label: 'Home', path: '/', icon: <Home className="h-4 w-4" />, module: 'dashboard' },
  { label: 'Dashboards', path: '/dashboards', icon: <LayoutDashboard className="h-4 w-4" />, module: 'dashboard' },
  { label: 'Tasks', path: '/tasks', icon: <ClipboardList className="h-4 w-4" />, module: 'dashboard' },
  { label: 'Projects', icon: <LayoutDashboard className="h-4 w-4" />, children: [
    { label: 'Projects', path: '/projects', icon: <LayoutDashboard className="h-4 w-4" />, module: 'projects' },
  ] },
  { label: 'Sales', icon: <TrendingUp className="h-4 w-4" />, children: [
    { label: 'Leads', path: '/leads', icon: <Target className="h-4 w-4" />, module: 'leads' },
    { label: 'Customers', path: '/customers', icon: <Building2 className="h-4 w-4" />, module: 'customers' },
    { label: 'Loan Applications', path: '/loan-applications', icon: <FileText className="h-4 w-4" />, module: 'loan_applications' },
    { label: 'Quotations', path: '/quotations', icon: <ClipboardList className="h-4 w-4" />, module: 'quotations' },
    { label: 'Orders', path: '/orders', icon: <ShoppingCart className="h-4 w-4" />, module: 'orders' },
    { label: 'Invoices', path: '/invoices', icon: <FileText className="h-4 w-4" />, module: 'invoices' },
  ] },
  { label: 'Field Operations', icon: <Target className="h-4 w-4" />, children: [
    { label: 'Surveys', path: '/surveys', icon: <MapPinned className="h-4 w-4" />, module: 'surveys' },
    { label: 'Engineering Designs', path: '/engineering-designs', icon: <DraftingCompass className="h-4 w-4" />, module: 'engineering' },
    { label: 'Installations', path: '/installations', icon: <HardHat className="h-4 w-4" />, module: 'installations' },
    { label: 'Quality Checks', path: '/qc', icon: <ClipboardCheck className="h-4 w-4" />, module: 'qc' },
    { label: 'Commissioning', path: '/commissioning', icon: <Zap className="h-4 w-4" />, module: 'commissioning' },
    { label: 'Project Handover', path: '/handovers', icon: <Handshake className="h-4 w-4" />, module: 'projects' },
  ] },
  { label: 'Procurement', icon: <ShoppingCart className="h-4 w-4" />, children: [
    { label: 'Vendors', path: '/vendors', icon: <Building2 className="h-4 w-4" />, module: 'vendors' },
    { label: 'Purchase Orders', path: '/purchase-orders', icon: <ShoppingCart className="h-4 w-4" />, module: 'purchase_orders' },
    { label: 'Goods Receipts', path: '/goods-receipts', icon: <Package className="h-4 w-4" />, module: 'purchase_orders' },
  ] },
  { label: 'Compliance', icon: <Shield className="h-4 w-4" />, children: [
    { label: 'Net Metering', path: '/net-metering', icon: <Zap className="h-4 w-4" />, module: 'net_metering' },
    { label: 'Subsidy', path: '/subsidy', icon: <Landmark className="h-4 w-4" />, module: 'subsidy' },
    { label: 'Tax Invoices', path: '/tax-invoices', icon: <ReceiptText className="h-4 w-4" />, module: 'tax_invoices' },
  ] },
  { label: 'Inventory', icon: <Package className="h-4 w-4" />, children: [
    { label: 'Products', path: '/products', icon: <Boxes className="h-4 w-4" />, module: 'products' },
    { label: 'Warehouses', path: '/warehouses', icon: <Warehouse className="h-4 w-4" />, module: 'warehouses' },
    { label: 'Stock', path: '/stock', icon: <Package className="h-4 w-4" />, module: 'stock' },
    { label: 'Dispatch', path: '/dispatch', icon: <Truck className="h-4 w-4" />, module: 'dispatch' },
  ] },
  { label: 'Post-Sale', icon: <FileText className="h-4 w-4" />, children: [
    { label: 'AMC Contracts', path: '/amc-contracts', icon: <CalendarCheck className="h-4 w-4" />, module: 'projects' },
    { label: 'Service Tickets', path: '/service-tickets', icon: <Wrench className="h-4 w-4" />, module: 'service_tickets' },
    { label: 'Monitoring', path: '/monitoring', icon: <Activity className="h-4 w-4" />, module: 'projects' },
  ] },
  { label: 'Channel Partners', icon: <Users className="h-4 w-4" />, children: [
    { label: 'Partners', path: '/partners', icon: <Users className="h-4 w-4" />, module: 'partners' },
    // VL-9/VL-10: standalone Registration (Vendor Lock / Scheme Registration)
    // list — Manager/TL team view + Management/Director read-only + Admin.
    // Partner-portal users see the dedicated "My Registration" portal instead.
    { label: 'Registrations', path: '/registration', icon: <ClipboardCheck className="h-4 w-4" />, module: 'scheme_registration' },
    { label: 'Comm. Rules', path: '/partners/commission-rules', icon: <FileText className="h-4 w-4" />, module: 'partners' },
    { label: 'Comm. Approvals', path: '/partners/commission-approvals', icon: <DollarSign className="h-4 w-4" />, module: 'partners' },
    { label: 'Settlements', path: '/partners/settlements', icon: <CreditCard className="h-4 w-4" />, module: 'partners' },
    { label: 'Performance', path: '/partners/performance', icon: <BarChart3 className="h-4 w-4" />, module: 'partners' },
  ] },
  { label: 'HR', icon: <Users className="h-4 w-4" />, children: [
    { label: 'Employees', path: '/employees', icon: <UserCog className="h-4 w-4" />, module: 'employees' },
    { label: 'Attendance', path: '/attendance', icon: <Calendar className="h-4 w-4" />, module: 'attendance' },
    { label: 'Payroll', path: '/payroll', icon: <DollarSign className="h-4 w-4" />, module: 'payroll' },
  ] },
  { label: 'Finance', icon: <BookOpen className="h-4 w-4" />, children: [
    { label: 'Payments', path: '/payments', icon: <CreditCard className="h-4 w-4" />, module: 'payments' },
    { label: 'Reports', path: '/reports', icon: <BarChart3 className="h-4 w-4" />, module: 'reports' },
  ] },
  { label: 'AI Intelligence', path: '/ai-intelligence', icon: <Brain className="h-4 w-4" />, module: 'dashboard', ownerOnly: true },
  { label: 'Audit Logs', path: '/audit-logs', icon: <Shield className="h-4 w-4" />, module: 'dashboard', ownerOnly: true },
  { label: 'Settings', icon: <Settings className="h-4 w-4" />, children: [
    { label: 'Bank Master', path: '/banks', icon: <Landmark className="h-4 w-4" />, module: 'banks' },
    { label: 'Users', path: '/users', icon: <Users className="h-4 w-4" />, module: 'users' },
    { label: 'Roles', path: '/roles', icon: <Shield className="h-4 w-4" />, module: 'roles' },
    { label: 'Companies', path: '/companies', icon: <Building2 className="h-4 w-4" />, module: 'companies' },
    { label: 'App Settings', path: '/settings', icon: <Settings className="h-4 w-4" />, module: 'settings' },
  ] },
];
