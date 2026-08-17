/**
 * useCrossModuleNavigation — Cross-module navigation hooks (Phase 0F)
 *
 * Provides navigators for the following entity transitions:
 * - Lead → Customer
 * - Customer → Project
 * - Project → Case
 * - Case → Tasks
 * - Task → Linked Records
 * - Vendor → Purchase Orders
 * - Purchase Orders → Goods Receipt
 *
 * Requirements:
 * - Preserves browser history (pushState, not replaceState)
 * - URL synchronization (uses search params to pass entity context)
 * - Workspace-aware navigation (respects current workspace state)
 * - No desktop regression (backward compatible with existing code)
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// ── Types ──────────────────────────────────────────────────

export interface NavigationOptions {
  /** Whether to replace current history entry instead of pushing */
  replace?: boolean;
  /** Additional URL search params to include */
  params?: Record<string, string>;
  /** Tab to open in the target workspace */
  tab?: string;
}

// ── Hook ───────────────────────────────────────────────────

export function useCrossModuleNavigation() {
  const navigate = useNavigate();

  /**
   * Navigate from a Lead to its converted Customer workspace.
   */
  const navigateLeadToCustomer = useCallback(
    (leadId: string, customerId: string, options?: NavigationOptions) => {
      const params = new URLSearchParams();
      params.set('from', `lead:${leadId}`);
      if (options?.params) {
        Object.entries(options.params).forEach(([k, v]) => params.set(k, v));
      }
      const url = `/customers/${encodeURIComponent(customerId)}`;
      const fullUrl = params.toString() ? `${url}?${params.toString()}` : url;
      navigate(fullUrl, { replace: options?.replace ?? false });
    },
    [navigate],
  );

  /**
   * Navigate from a Customer to one of its Projects.
   */
  const navigateCustomerToProject = useCallback(
    (customerId: string, projectId: string, options?: NavigationOptions) => {
      const params = new URLSearchParams();
      params.set('from', `customer:${customerId}`);
      if (options?.params) {
        Object.entries(options.params).forEach(([k, v]) => params.set(k, v));
      }
      const url = `/projects/${encodeURIComponent(projectId)}`;
      const fullUrl = params.toString() ? `${url}?${params.toString()}` : url;
      navigate(fullUrl, { replace: options?.replace ?? false });
    },
    [navigate],
  );

  /**
   * Navigate from a Project to its Case workspace.
   */
  const navigateProjectToCase = useCallback(
    (projectId: string, caseId: string, options?: NavigationOptions) => {
      const params = new URLSearchParams();
      params.set('from', `project:${projectId}`);
      if (options?.params) {
        Object.entries(options.params).forEach(([k, v]) => params.set(k, v));
      }
      const url = `/cases/${encodeURIComponent(caseId)}`;
      const fullUrl = params.toString() ? `${url}?${params.toString()}` : url;
      navigate(fullUrl, { replace: options?.replace ?? false });
    },
    [navigate],
  );

  /**
   * Navigate from a Case to its Task list (with case ID filter).
   */
  const navigateCaseToTasks = useCallback(
    (caseId: string, options?: NavigationOptions) => {
      const params = new URLSearchParams();
      params.set('caseId', caseId);
      if (options?.tab) params.set('tab', options.tab);
      if (options?.params) {
        Object.entries(options.params).forEach(([k, v]) => params.set(k, v));
      }
      const url = `/tasks?${params.toString()}`;
      navigate(url, { replace: options?.replace ?? false });
    },
    [navigate],
  );

  /**
   * Navigate from a Task to its Linked Records (the entity the task belongs to).
   */
  const navigateTaskToLinkedRecord = useCallback(
    (taskId: string, linkedEntityType: string, linkedEntityId: string, options?: NavigationOptions) => {
      const params = new URLSearchParams();
      params.set('from', `task:${taskId}`);
      if (options?.tab) params.set('tab', options.tab);
      if (options?.params) {
        Object.entries(options.params).forEach(([k, v]) => params.set(k, v));
      }

      // Map entity type to route
      const routeMap: Record<string, string> = {
        lead: '/leads',
        leads: '/leads',
        customer: '/customers',
        customers: '/customers',
        project: '/projects',
        projects: '/projects',
        order: '/orders',
        orders: '/orders',
        quotation: '/quotations',
        quotations: '/quotations',
        invoice: '/invoices',
        invoices: '/invoices',
        dispatch: '/dispatch',
        'service-ticket': '/service-tickets',
        service_ticket: '/service-tickets',
      };

      const baseRoute = routeMap[linkedEntityType] || `/${linkedEntityType}`;
      const url = `${baseRoute}?open=${encodeURIComponent(linkedEntityId)}&${params.toString()}`;
      navigate(url, { replace: options?.replace ?? false });
    },
    [navigate],
  );

  /**
   * Navigate from a Vendor to its Purchase Orders.
   */
  const navigateVendorToPurchaseOrders = useCallback(
    (vendorId: string, options?: NavigationOptions) => {
      const params = new URLSearchParams();
      params.set('vendorId', vendorId);
      if (options?.params) {
        Object.entries(options.params).forEach(([k, v]) => params.set(k, v));
      }
      const url = `/purchase-orders?${params.toString()}`;
      navigate(url, { replace: options?.replace ?? false });
    },
    [navigate],
  );

  /**
   * Navigate from a Purchase Order to its Goods Receipt.
   */
  const navigatePurchaseOrderToGoodsReceipt = useCallback(
    (poId: string, options?: NavigationOptions) => {
      const params = new URLSearchParams();
      params.set('poId', poId);
      if (options?.params) {
        Object.entries(options.params).forEach(([k, v]) => params.set(k, v));
      }
      const url = `/goods-receipts?${params.toString()}`;
      navigate(url, { replace: options?.replace ?? false });
    },
    [navigate],
  );

  return {
    navigateLeadToCustomer,
    navigateCustomerToProject,
    navigateProjectToCase,
    navigateCaseToTasks,
    navigateTaskToLinkedRecord,
    navigateVendorToPurchaseOrders,
    navigatePurchaseOrderToGoodsReceipt,
  };
}

export default useCrossModuleNavigation;
