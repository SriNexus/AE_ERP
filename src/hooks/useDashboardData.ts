import { useQuery } from '@tanstack/react-query';
import { getDashboardOverview, type DashboardOverview } from '../lib/dashboardAggregation';

export const EMPTY_DASHBOARD_OVERVIEW: DashboardOverview = {
  stats: {
    todayLeads: 0,
    todayOrders: 0,
    pendingDispatch: 0,
    pendingPayments: 0,
    totalRevenueMTD: 0,
    activeCustomers: 0,
    newCustomersToday: 0,
    todayCollection: 0,
  },
  summary: {
    totalLeads: 0,
    customers: 0,
    totalOrders: 0,
    pendingOrders: 0,
    revenue: 0,
    collected: 0,
    employees: 0,
  },
  workflowCounts: {
    newLeads: 0,
    followUp: 0,
    quotations: 0,
    orders: 0,
    invoices: 0,
    pendingPayments: 0,
    dispatched: 0,
    installed: 0,
    completed: 0,
  },
  pipelineData: [],
  revenueTrend: [],
  recentLeads: [],
  recentOrders: [],
};

export function useDashboardOverview(companyId?: string) {
  return useQuery({
    queryKey: ['dashboard-overview', companyId || 'none'],
    enabled: Boolean(companyId),
    // PERF: a KPI dashboard does not need 45s freshness — this query fans out
    // to ~30 aggregate/count round-trips, so the old 45s staleTime re-ran all
    // of them on every navigation back to the dashboard within a working
    // session. 3 min is well within acceptable staleness for headline counts
    // and is still tighter than the app-wide 5 min default (queryClient.ts).
    // A hard refresh, reconnect, or any mutation that invalidates
    // ['dashboard-overview'] still forces a refetch.
    staleTime: 3 * 60_000,
    gcTime: 10 * 60_000,
    placeholderData: EMPTY_DASHBOARD_OVERVIEW,
    queryFn: async (): Promise<DashboardOverview> => {
      if (!companyId) return EMPTY_DASHBOARD_OVERVIEW;
      return getDashboardOverview(companyId);
    },
  });
}
