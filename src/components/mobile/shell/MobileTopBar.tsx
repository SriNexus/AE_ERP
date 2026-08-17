/**
 * MobileTopBar — Premium mobile ERP top app bar
 *
 * Features:
 *   - Theme-aware design using CSS custom properties (automatically
 *     adapts to light/dark mode — no hardcoded colors)
 *   - Premium background image treatment
 *   - Company logo (left): single-tap opens ModuleNavDrawer
 *   - Search icon (right): opens desktop SearchModal (full-screen on mobile)
 *   - Notification bell (right): opens full-screen MobileNotificationSheet
 *   - Safe-area aware
 *   - Same height across all mobile pages
 *   - Reusable across all mobile screens
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, ListFilter, Plus } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '../../../utils/cn';
import { useAppStore } from '../../../store/useAppStore';
import { useNotifications } from '../../../hooks/useNotifications';
import { useTasks } from '../../../hooks/useTasks';
import { b64ToSrc } from '../../../templates/documents/shared/utils';
import { SearchModal } from '../../../features/search/components/SearchModal';
import { GlobalCreatePopup } from '../../shared/GlobalCreatePopup';
import { ModuleNavDrawer } from './ModuleNavDrawer';
import { MobileNotificationSheet } from './MobileNotificationSheet';
import { TOUCH } from '../shared/styles';
import { useContextResolver } from '../context/ContextResolver';
import { DateRangeFilter, Select } from '../../ui';
import { DISPATCH_STATUSES, LEAD_SOURCES, LEAD_STATUSES, ORDER_STATUSES, PAYMENT_STATUSES } from '../../../config/company';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import {
  MOBILE_TASK_DATE_OPTIONS,
  MOBILE_TASK_PRIORITY_OPTIONS,
  MOBILE_TASK_STATUS_OPTIONS,
} from '../tasks/MobileTaskWorkspace';
import { useProducts } from '../../../features/inventory/hooks/useInventory';
import { useWarehouses } from '../../../features/warehouses/hooks/useWarehouses';
import { usePermissions } from '../../../lib/permissions';
import { PROJECT_STAGE_OPTIONS } from '../../../features/projects/utils/projectDisplay';

const MODULE_SEARCH_ROUTES = new Set([
  '/leads', '/customers', '/projects', '/quotations', '/orders', '/invoices',
  '/surveys', '/engineering-designs', '/installations',
  '/products', '/categories', '/warehouses', '/stock', '/dispatch',
  '/partners', '/commission-rules', '/commission-approvals', '/settlements', '/performance',
  '/commissioning',
  '/handovers',
  '/qc',
  '/payments', '/reports',
  '/employees', '/attendance', '/payroll',
  '/tasks', '/users', '/roles', '/companies',
  '/vendors', '/purchase-orders', '/goods-receipts',
  '/net-metering', '/subsidy', '/tax-invoices',
  '/amc-contracts', '/service-tickets', '/monitoring',
  '/cases',
  '/loan-applications',
]);

type ModuleFilterOption = string | { label: string; value: string };
const MODULE_FILTER_OPTIONS: Record<string, { label: string; key: string; options: ModuleFilterOption[] }[]> = {
  '/surveys': [
    { label: 'Status', key: 'status', options: ['All', 'Scheduled', 'InProgress', 'Completed', 'Rejected'] },
  ],
  '/engineering-designs': [
    { label: 'Status', key: 'status', options: ['All', 'Draft', 'InReview', 'Approved', 'Revised'] },
  ],
  '/handovers': [
    { label: 'Status', key: 'status', options: [
      { label: 'All Statuses', value: 'All' },
      { label: 'Draft', value: 'Draft' },
      { label: 'Scheduled', value: 'Scheduled' },
      { label: 'Completed', value: 'Completed' },
      { label: 'Cancelled', value: 'Cancelled' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/commissioning': [
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/qc': [
    { label: 'Status', key: 'status', options: [
      { label: 'All Statuses', value: 'All' },
      { label: 'Pending', value: 'pending' },
      { label: 'In Progress', value: 'in_progress' },
      { label: 'Passed', value: 'passed' },
      { label: 'Failed', value: 'failed' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/installations': [
    { label: 'Stage', key: 'stage', options: [
      { label: 'All Stages', value: 'All' },
      { label: 'Lead Approved', value: 'lead_approved' },
      { label: 'Survey Scheduled', value: 'survey_scheduled' },
      { label: 'Survey Completed', value: 'survey_completed' },
      { label: 'Material Ordered', value: 'material_ordered' },
      { label: 'Material Delivered', value: 'material_delivered' },
      { label: 'Installation Started', value: 'installation_started' },
      { label: 'Installation In Progress', value: 'installation_in_progress' },
      { label: 'Quality Inspection', value: 'quality_inspection' },
      { label: 'Customer Handover', value: 'customer_handover' },
      { label: 'Completed', value: 'completed' },
    ] },
    { label: 'Delay', key: 'delay', options: [
      { label: 'All Statuses', value: 'All' },
      { label: 'Delayed', value: 'delayed' },
      { label: 'On Track', value: 'ontrack' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/projects': [
    { label: 'Stage', key: 'stage', options: PROJECT_STAGE_OPTIONS.map((option) => ({ label: option.label, value: option.value || 'All' })) },
  ],
  '/leads': [
    { label: 'Status', key: 'status', options: ['All', ...LEAD_STATUSES] },
    { label: 'Source', key: 'source', options: ['All', ...LEAD_SOURCES] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Dates', value: 'All' },
      { label: 'Follow-up Today', value: 'today' },
      { label: 'Overdue', value: 'overdue' },
      { label: 'No Follow-up', value: 'none' },
    ] },
  ],
  '/customers': [
    { label: 'Type', key: 'type', options: ['All', 'B2B', 'B2C'] },
    { label: 'Status', key: 'status', options: ['All', 'Active', 'Inactive'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Dates', value: 'All' },
      { label: 'This Month', value: 'this_month' },
      { label: 'Active', value: 'active' },
    ] },
  ],
  '/orders': [
    { label: 'Status', key: 'status', options: ['All', ...ORDER_STATUSES] },
    { label: 'Type', key: 'orderType', options: ['All', 'B2B', 'B2C'] },
    { label: 'Payment', key: 'paymentStatus', options: ['All', ...PAYMENT_STATUSES] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Dates', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: 'This Week', value: 'week' },
      { label: 'This Month', value: 'month' },
    ] },
  ],
  '/quotations': [
    { label: 'Status', key: 'status', options: ['All', 'Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Dates', value: 'All' },
      { label: 'This Month', value: 'this_month' },
      { label: 'Expired', value: 'expired' },
    ] },
  ],
  '/invoices': [
    { label: 'Status', key: 'status', options: ['All', 'Draft', 'Sent', 'Accepted', 'Cancelled'] },
    { label: 'Payment', key: 'payment', options: ['All', ...PAYMENT_STATUSES] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/products': [
    { label: 'Status', key: 'status', options: ['All', 'Active', 'Inactive'] },
    { label: 'Stock', key: 'stock', options: ['All', 'In Stock', 'Low Stock', 'Out Of Stock'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/categories': [
    { label: 'Status', key: 'status', options: ['All', 'Root', 'Child', 'With Products', 'Empty'] },
    { label: 'Parent', key: 'parent', options: ['All', 'Root'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/warehouses': [
    { label: 'Status', key: 'status', options: ['All', 'Active', 'Inactive', 'Under Maintenance'] },
    { label: 'Type', key: 'type', options: ['All', 'General', 'Storage', 'Dispatch', 'Transit', 'Cold Storage'] },
    { label: 'Capacity', key: 'capacity', options: ['All', 'Available', 'Utilized', 'Low Capacity', 'Full'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/settlements': [
    { label: 'Status', key: 'status', options: ['All', 'Pending', 'Processing', 'Completed', 'Failed', 'Cancelled'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/commission-approvals': [
    { label: 'Status', key: 'status', options: ['All', 'Pending', 'Approved', 'Rejected', 'Paid', 'Voided'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/commission-rules': [
    { label: 'Status', key: 'status', options: [
      { label: 'All Statuses', value: 'All' },
      { label: 'Active', value: 'active' },
      { label: 'Inactive', value: 'inactive' },
    ] },
    { label: 'Scope', key: 'scope', options: [
      { label: 'All Scopes', value: 'All' },
      { label: 'Default', value: 'all' },
      { label: 'Partner Tier', value: 'partner_tier' },
      { label: 'Category', value: 'product_category' },
      { label: 'Location', value: 'location' },
      { label: 'Partner', value: 'partner' },
    ] },
    { label: 'Type', key: 'type', options: [
      { label: 'All Types', value: 'All' },
      { label: 'Percentage', value: 'percentage' },
      { label: 'Fixed', value: 'fixed' },
      { label: 'Per kW', value: 'per_kw' },
      { label: 'Per Deal', value: 'per_deal' },
      { label: 'Slab', value: 'slab' },
    ] },
    { label: 'Tier', key: 'tier', options: [
      { label: 'All Tiers', value: 'All' },
      { label: 'Bronze', value: 'bronze' },
      { label: 'Silver', value: 'silver' },
      { label: 'Gold', value: 'gold' },
      { label: 'Platinum', value: 'platinum' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/stock': [
    { label: 'Warehouse', key: 'warehouse', options: ['All'] },
    { label: 'Category', key: 'category', options: ['All'] },
    { label: 'Status', key: 'status', options: ['All', 'In Stock', 'Reserved', 'Low Stock', 'Out Of Stock', 'IN', 'OUT', 'ADJUSTMENT'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/partners': [
    { label: 'Status', key: 'status', options: [
      { label: 'All Statuses', value: 'All' },
      { label: 'Pending Approval', value: 'pending_approval' },
      { label: 'Active', value: 'active' },
      { label: 'Suspended', value: 'suspended' },
      { label: 'Inactive', value: 'inactive' },
    ] },
    { label: 'KYC', key: 'kyc', options: [
      { label: 'All KYC', value: 'All' },
      { label: 'Not Started', value: 'not_started' },
      { label: 'Pending', value: 'pending' },
      { label: 'Submitted', value: 'submitted' },
      { label: 'Verified', value: 'verified' },
      { label: 'Rejected', value: 'rejected' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/payroll': [
    { label: 'Month', key: 'month', options: ['All', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] },
    { label: 'Status', key: 'status', options: ['All', 'Paid', 'Pending', 'Processing'] },
  ],
  '/companies': [
    { label: 'Status', key: 'status', options: ['All', 'Active', 'Inactive'] },
  ],
  '/users': [
    { label: 'Role', key: 'role', options: ['All'] },
    { label: 'Status', key: 'status', options: ['All', 'Active', 'Inactive', 'Suspended'] },
  ],
  '/attendance': [
    { label: 'Status', key: 'status', options: ['All', 'Present', 'Absent', 'Late', 'Half Day', 'Holiday', 'On Leave'] },
  ],
  '/employees': [
    { label: 'Department', key: 'dept', options: ['All', 'Sales', 'Marketing', 'Operations', 'Finance', 'HR', 'IT', 'Admin', 'Procurement', 'Logistics'] },
    { label: 'Status', key: 'status', options: ['All', 'Active', 'Inactive', 'On Leave', 'Terminated'] },
  ],
  '/performance': [
    { label: 'Period', key: 'period', options: [
      { label: 'All Time', value: 'All' },
      { label: 'This Month', value: 'this_month' },
      { label: 'Last 30 Days', value: '30d' },
      { label: 'This Quarter', value: 'quarter' },
      { label: 'This Year', value: 'year' },
    ] },
    { label: 'Tier', key: 'tier', options: [
      { label: 'All Tiers', value: 'All' },
      { label: 'Bronze', value: 'bronze' },
      { label: 'Silver', value: 'silver' },
      { label: 'Gold', value: 'gold' },
      { label: 'Platinum', value: 'platinum' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/vendors': [
    { label: 'Category', key: 'category', options: ['All'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/purchase-orders': [
    { label: 'Status', key: 'status', options: ['All', 'Draft', 'Sent', 'PartiallyReceived', 'Received', 'Cancelled'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/goods-receipts': [
    { label: 'Warehouse', key: 'warehouse', options: ['All'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/subsidy': [
    { label: 'Status', key: 'status', options: [
      { label: 'All Statuses', value: 'All' },
      { label: 'Draft', value: 'Draft' },
      { label: 'Submitted', value: 'Submitted' },
      { label: 'Under Review', value: 'UnderReview' },
      { label: 'Approved', value: 'Approved' },
      { label: 'Disbursed', value: 'Disbursed' },
      { label: 'Rejected', value: 'Rejected' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/amc-contracts': [
    { label: 'Status', key: 'status', options: [
      { label: 'All Statuses', value: 'All' },
      { label: 'Draft', value: 'Draft' },
      { label: 'Active', value: 'Active' },
      { label: 'Expired', value: 'Expired' },
      { label: 'Cancelled', value: 'Cancelled' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/service-tickets': [
    { label: 'Status', key: 'status', options: [
      { label: 'All Statuses', value: 'All' },
      { label: 'Open', value: 'Open' },
      { label: 'In Progress', value: 'InProgress' },
      { label: 'Resolved', value: 'Resolved' },
      { label: 'Closed', value: 'Closed' },
      { label: 'Cancelled', value: 'Cancelled' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/monitoring': [
    { label: 'Date', key: 'date', options: ['All', 'today', '7d', '30d', '90d'] },
    { label: 'Project', key: 'projectId', options: ['All'] },
  ],
  '/tax-invoices': [
    { label: 'Status', key: 'status', options: [
      { label: 'All Statuses', value: 'All' },
      { label: 'Draft', value: 'Draft' },
      { label: 'Issued', value: 'Issued' },
      { label: 'Cancelled', value: 'Cancelled' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/loan-applications': [
    { label: 'Status', key: 'status', options: [
      { label: 'All Statuses', value: 'All' },
      { label: 'Draft', value: 'Draft' },
      { label: 'Digital Sign Pending', value: 'Digital Sign Pending' },
      { label: 'Digital Sign Completed', value: 'Digital Sign Completed' },
      { label: 'Bank Submission Pending', value: 'Bank Submission Pending' },
      { label: 'Submitted To Bank', value: 'Submitted To Bank' },
      { label: 'Under Review', value: 'Under Review' },
      { label: 'Approved', value: 'Approved' },
      { label: 'Rejected', value: 'Rejected' },
      { label: 'Payment Received', value: 'Payment Received' },
      { label: 'Closed', value: 'Closed' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/net-metering': [
    { label: 'Status', key: 'status', options: [
      { label: 'All Statuses', value: 'All' },
      { label: 'Submitted', value: 'Submitted' },
      { label: 'Under Review', value: 'UnderReview' },
      { label: 'Approved', value: 'Approved' },
      { label: 'Meter Installed', value: 'MeterInstalled' },
      { label: 'Rejected', value: 'Rejected' },
    ] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
  '/dispatch': [
    { label: 'Status', key: 'status', options: ['All', ...DISPATCH_STATUSES, 'Pending Approval', 'Approved', 'Closed', 'Cancelled', 'Failed Delivery', 'Rescheduled'] },
    { label: 'Warehouse', key: 'warehouse', options: ['All'] },
    { label: 'Assigned', key: 'assigned', options: ['All'] },
    { label: 'Priority', key: 'priority', options: ['All', 'Low', 'Normal', 'High', 'Urgent'] },
    { label: 'Customer', key: 'customer', options: ['All'] },
    { label: 'Date', key: 'date', options: [
      { label: 'All Time', value: 'All' },
      { label: 'Today', value: 'today' },
      { label: '7 Days', value: '7d' },
      { label: '30 Days', value: '30d' },
      { label: '90 Days', value: '90d' },
    ] },
  ],
};

// ── Component ────────────────────────────────────────────────

export function MobileTopBar() {
  const { globalCompany, company, activeCompanyId } = useAppStore();
  const { unreadCount } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { currentModule } = useContextResolver();
  const { allTasks } = useTasks();
  const { data: products = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  // Gated on perms.ready — mounted globally as part of the mobile shell chrome
  // (every route), so an ungated/weakly-gated query here fired on every page
  // load, including mid-boot before the ERP identity/tenant context existed.
  // Boolean(activeCompanyId) previously "gated" dispatchRows, but the store's
  // initial/post-logout activeCompanyId is the literal string 'default' —
  // Boolean('default') is true, so that check never actually blocked the
  // pre-boot window (Admin /users+settings runtime-storm root cause).
  const perms = usePermissions();
  const { data: dispatchRows = [] } = useQuery({
    queryKey: companyKeys.dispatchAll,
    queryFn: () => getAll(COLLECTIONS.DISPATCH),
    staleTime: 60_000,
    enabled: perms.ready,
  });
  const { data: users = [] } = useQuery({
    queryKey: queryKeys.global.users,
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300_000,
    enabled: perms.ready,
  });

  // Drawer & sheet state
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Navigation style for logo click behavior
  const navigationStyle = useAppStore((s) => s.navigationStyle);

  // Brand info
  const brand = globalCompany || company;
  const shortName = brand?.shortName || brand?.name || 'App';
  const isHomeModule = location.pathname === '/' || location.pathname === '/app' || !currentModule;
  const isOnModuleRoute = currentModule && location.pathname.startsWith(currentModule);
  const moduleRoute = !isHomeModule && currentModule && MODULE_SEARCH_ROUTES.has(currentModule) && isOnModuleRoute
    ? currentModule
    : undefined;
  const activeModuleRoute = moduleRoute || (location.pathname === '/app' ? '/app' : undefined);

  // Tutorial target ids: map the current module route to the same data-tour
  // ids used on the desktop pages (e.g. /leads → "leads-search"/"leads-create")
  // so the SAME tutorial definitions resolve real targets on mobile.
  const tourModuleId = (() => {
    const p = location.pathname;
    if (p.startsWith('/leads')) return 'leads';
    if (p.startsWith('/projects')) return 'projects';
    if (p.startsWith('/stock')) return 'stock';
    if (p.startsWith('/purchase-orders')) return 'purchase-orders';
    if (p.startsWith('/vendors')) return 'vendors';
    if (p.startsWith('/dispatch')) return 'dispatch';
    if (p.startsWith('/payments')) return 'payments';
    if (p.startsWith('/reports')) return 'reports';
    if (p.startsWith('/employees')) return 'employees';
    if (p.startsWith('/attendance')) return 'attendance';
    return null;
  })();

  const taskAssigneeOptions = React.useMemo(() => {
    const names = Array.from(new Set(allTasks.map((task) => task.assignedToName).filter(Boolean))).sort();
    return ['All', ...names];
  }, [allTasks]);
  const stockWarehouseOptions = React.useMemo<ModuleFilterOption[]>(() => [
    'All',
    ...(warehouses as any[]).map((warehouse) => ({ label: warehouse.name || warehouse.code || warehouse.id, value: warehouse.id })),
  ], [warehouses]);
  const stockCategoryOptions = React.useMemo<ModuleFilterOption[]>(() => [
    'All',
    ...Array.from(new Set((products as any[]).map((product) => product.category).filter(Boolean))).sort(),
  ], [products]);
  const dispatchWarehouseOptions = React.useMemo<ModuleFilterOption[]>(() => {
    const known = new Map<string, string>();
    (warehouses as any[]).forEach((warehouse) => known.set(warehouse.id, warehouse.name || warehouse.code || warehouse.id));
    (dispatchRows as any[]).forEach((row) => {
      const id = row.warehouseId || row.warehouse;
      if (id) known.set(id, known.get(id) || row.warehouseName || row.warehouse || id);
    });
    return ['All', ...Array.from(known.entries()).map(([value, label]) => ({ label, value }))];
  }, [dispatchRows, warehouses]);
  const dispatchCustomerOptions = React.useMemo<ModuleFilterOption[]>(() => [
    'All',
    ...Array.from(new Set((dispatchRows as any[]).map((row) => row.customerName || row.customer).filter(Boolean))).sort(),
  ], [dispatchRows]);
  const dispatchAssignedOptions = React.useMemo<ModuleFilterOption[]>(() => {
    const names = new Set<string>();
    (users as any[]).forEach((user) => {
      const name = user.name || user.displayName || user.email;
      if (name) names.add(name);
    });
    (dispatchRows as any[]).forEach((row) => {
      const name = row.assignedToName || row.ownerName || row.createdByName || row.updatedByName;
      if (name) names.add(name);
    });
    return ['All', ...Array.from(names).sort()];
  }, [dispatchRows, users]);

  const taskFilters = {
    search: params.get('q') || '',
    status: params.get('status') || 'All',
    priority: params.get('priority') || 'All',
    assignee: params.get('assignee') || 'All',
    date: params.get('date') || 'all',
  };

  function updateTaskFilter(key: string, value: string, defaultValue: string) {
    const next = new URLSearchParams(params);
    if (!value || value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchOpen(false);
    navigate(`/app${next.toString() ? `?${next.toString()}` : ''}`, { replace: true });
  }

  function clearTaskFilters() {
    const next = new URLSearchParams(params);
    ['q', 'status', 'priority', 'assignee', 'date'].forEach((key) => next.delete(key));
    navigate(`${location.pathname === '/' ? '/' : '/app'}${next.toString() ? `?${next.toString()}` : ''}`, { replace: true });
  }

  function openCreate() {
    setCreateOpen(true);
  }

  function updateModuleFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'All') next.delete(key);
    else next.set(key, value);
    if (moduleRoute) {
      setSearchOpen(false);
      navigate(`${moduleRoute}${next.toString() ? `?${next.toString()}` : ''}`, { replace: true });
    } else {
      setParams(next, { replace: true });
    }
  }

  function clearModuleFilters() {
    const route = moduleRoute;
    const next = new URLSearchParams(params);
    next.delete('q');
    (MODULE_FILTER_OPTIONS[route || ''] || []).forEach((filter) => next.delete(filter.key));
    if (route) {
      navigate(`${route}${next.toString() ? `?${next.toString()}` : ''}`, { replace: true });
    } else {
      setParams(next, { replace: true });
    }
  }

  const hasActiveTaskFilters = ['q', 'status', 'priority', 'assignee', 'date'].some((key) => {
    const value = params.get(key);
    if (!value) return false;
    if (key === 'status' || key === 'priority' || key === 'assignee') return value !== 'All';
    if (key === 'date') return value !== 'all';
    return true;
  });

  const hasActiveModuleFilters = Boolean(moduleRoute && (
    params.has('q') ||
    (MODULE_FILTER_OPTIONS[moduleRoute] || []).some((filter) => {
      const value = params.get(filter.key);
      return Boolean(value && value !== 'All' && value !== 'all');
    })
  ));

  const filterContent = isHomeModule ? (
    <div className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <DateRangeFilter
          value={taskFilters.date}
          onChange={(value) => updateTaskFilter('date', value, 'all')}
          options={MOBILE_TASK_DATE_OPTIONS}
        />
        <Select
          aria-label="Task status"
          value={taskFilters.status}
          onChange={(event) => updateTaskFilter('status', event.target.value, 'All')}
          options={MOBILE_TASK_STATUS_OPTIONS.map((value) => ({ label: value === 'All' ? 'All Status' : value, value }))}
          className="max-w-[160px]"
        />
        <Select
          aria-label="Task priority"
          value={taskFilters.priority}
          onChange={(event) => updateTaskFilter('priority', event.target.value, 'All')}
          options={MOBILE_TASK_PRIORITY_OPTIONS.map((value) => ({ label: value === 'All' ? 'All Priority' : value, value }))}
          className="max-w-[160px]"
        />
        <Select
          aria-label="Task assignee"
          value={taskFilters.assignee}
          onChange={(event) => updateTaskFilter('assignee', event.target.value, 'All')}
          options={taskAssigneeOptions.map((value) => ({ label: value === 'All' ? 'All Assignees' : value, value }))}
          className="max-w-[160px]"
        />
        {(taskFilters.status !== 'All' || taskFilters.priority !== 'All' || taskFilters.assignee !== 'All' || taskFilters.date !== 'all') && (
          <button
            type="button"
            onClick={clearTaskFilters}
            className="min-h-10 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-danger-light)] hover:text-[var(--color-danger)]"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  ) : (
    <div className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        {(MODULE_FILTER_OPTIONS[moduleRoute || ''] || []).map((filter) => (
          <Select
            key={filter.key}
            aria-label={filter.label}
            value={params.get(filter.key) || 'All'}
            onChange={(event) => updateModuleFilter(filter.key, event.target.value)}
            options={(
              moduleRoute === '/stock' && filter.key === 'warehouse' ? stockWarehouseOptions :
              moduleRoute === '/stock' && filter.key === 'category' ? stockCategoryOptions :
              moduleRoute === '/dispatch' && filter.key === 'warehouse' ? dispatchWarehouseOptions :
              moduleRoute === '/dispatch' && filter.key === 'customer' ? dispatchCustomerOptions :
              moduleRoute === '/dispatch' && filter.key === 'assigned' ? dispatchAssignedOptions :
              filter.options
            ).map((option) => {
              if (typeof option !== 'string') return option;
              return { label: option === 'All' ? `All ${filter.label}` : option, value: option };
            })}
            className="max-w-[160px]"
          />
        ))}
      </div>
    </div>
  );

  return (
    <>
      <header
        className={cn(
          'mobile-topbar',
          'h-[60px] shrink-0 z-30 sticky top-0',
          'flex items-center justify-between px-3',
          'relative',
          // Use theme tokens — matches desktop TopBar pattern
          'bg-transparant',
          'mobile-topbar--home',
        )}
      >
        {/* ── Left: Company Logo (with tap detection) ──────── */}
        <div className="flex items-center min-w-0 mr-2 z-10 relative">
          <button
            type="button"
            onClick={() => setNavDrawerOpen(true)}
            aria-label={navigationStyle === 'app-launcher' ? 'Open app launcher' : 'Open navigation'}
            className={cn(
              'cursor-pointer rounded-lg transition-all duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
              'active:scale-95',
            )}
          >
            {brand?.logo ? (
              <img
                src={b64ToSrc(brand.logo)}
                alt={brand?.name || 'Logo'}
                className="h-12 w-auto max-w-[185px] object-contain select-none"
                draggable={false}
              />
            ) : (
              <div className={cn(
                'flex items-center justify-center h-10 w-10',
                'rounded-xl',
                'bg-gradient-to-br from-[var(--color-primary)] to-[color-mix(in srgb, var(--color-primary) 80%, transparent)]',
                'shadow-sm',
              )}>
                <span className="text-xs font-bold text-white">
                  {shortName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </button>
        </div>

        {/* ── Center: Empty spacer ───────────────────────── */}
        <div className="flex-1 z-10 relative" />

        {/* ── Right: Search + Notifications + Create ─────── */}
        <div className="flex items-center gap-1.5 z-10 relative">
          {/* Unified Search + Filter trigger */}
          <button
            type="button"
            aria-label="Search and filter"
            data-tour={tourModuleId ? `${tourModuleId}-search` : 'mobile-search'}
            onClick={() => setSearchOpen(true)}
            className={cn(
              TOUCH.MIN, 'rounded-lg p-2.5',
              'text-[#000000] dark:text-[#FFFFFF]',
              'hover:bg-black/5 dark:hover:bg-white/10',
              'transition-colors duration-150',
              'active:scale-95',
            )}
          >
            <ListFilter className="h-6 w-6" strokeWidth={2} />
          </button>

          {/* Notification bell */}
          <button
            type="button"
            aria-label="Notifications"
            data-tour="mobile-notifications"
            onClick={() => setNotifOpen(true)}
            className={cn(
              TOUCH.MIN, 'rounded-lg p-2.5 relative',
              'text-[#000000] dark:text-[#FFFFFF]',
              'hover:bg-black/5 dark:hover:bg-white/10',
              'transition-colors duration-150',
              'active:scale-95',
            )}
          >
            <Bell className="h-6 w-6" strokeWidth={2} />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[10px] font-bold text-white ring-2 ring-[var(--color-topbar-bg)]">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            aria-label="Create"
            data-tour={tourModuleId ? `${tourModuleId}-create` : 'mobile-create'}
            onClick={openCreate}
            className={cn(
              TOUCH.MIN, 'rounded-lg p-2.5',
              'text-[#000000] dark:text-[#FFFFFF]',
              'hover:bg-black/5 dark:hover:bg-white/10',
              'transition-colors duration-150',
              'active:scale-95',
            )}
          >
            <Plus className="h-6 w-6" strokeWidth={3} />
          </button>
        </div>
      </header>

      {/* Module Navigation Drawer (single-tap on logo) */}
      <ModuleNavDrawer
        open={navDrawerOpen}
        onClose={() => setNavDrawerOpen(false)}
        mode={navigationStyle === 'app-launcher' ? 'app-launcher' : 'navigation'}
      />

      {/* Desktop SearchModal — reused directly, renders full-screen on mobile */}
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        centeredOnMobile
        moduleRoute={activeModuleRoute}
        filterContent={filterContent}
        onClear={isHomeModule ? clearTaskFilters : clearModuleFilters}
        clearVisible={isHomeModule ? hasActiveTaskFilters : hasActiveModuleFilters}
      />

      {/* Mobile Notification Sheet (tap bell icon) */}
      <MobileNotificationSheet
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
      />

      <GlobalCreatePopup
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        variant="mobile"
      />
    </>
  );
}

export default MobileTopBar;
