import { useQuery } from '@tanstack/react-query';
import { getDashboardStats, type DashboardStats } from '../lib/dashboardAggregation';

export function useDashboardStats(companyId?: string) {
  return useQuery({
    queryKey: ['dashboard-stats', companyId || 'none'],
    enabled: Boolean(companyId),
    staleTime: 30_000,
    queryFn: (): Promise<DashboardStats> => getDashboardStats(companyId || ''),
  });
}
