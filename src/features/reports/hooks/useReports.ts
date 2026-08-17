/**
 * P10-01 — Reporting Engine: React Query Hooks
 *
 * Fetches all project and order data, computes pipeline analytics client-side.
 * Follows the same pattern as other feature hooks (useNetMetering, etc.).
 */

import { useQuery } from '@tanstack/react-query';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import type { ProjectRecord } from '../../projects/types';
import {
  buildStageDistribution,
  buildRevenuePipeline,
  buildCycleTimes,
  findStuckProjects,
  buildProjectKpis,
  generateProjectPipelineReport,
} from '../../../lib/reportsAggregation';
import type { ProjectPipelineReport } from '../types';

/**
 * Fetch all projects for reporting (no pagination — reports need full dataset).
 */
export function useProjectsForReport() {
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useQuery({
    queryKey: [...keys.projectsRoot, 'report'],
    queryFn: () => getAll<ProjectRecord>(COLLECTIONS.PROJECTS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });
}

/**
 * Fetch all orders for revenue pipeline.
 */
export function useOrdersForReport() {
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useQuery({
    queryKey: [...keys.ordersRoot, 'report'],
    queryFn: () => getAll(COLLECTIONS.ORDERS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });
}

/**
 * Compute the full project pipeline report from cached data.
 */
export function useProjectPipelineReport(): {
  report: ProjectPipelineReport | null;
  isLoading: boolean;
  error: Error | null;
} {
  const projectsQuery = useProjectsForReport();
  const ordersQuery = useOrdersForReport();

  const isLoading = projectsQuery.isLoading || ordersQuery.isLoading;
  const error = projectsQuery.error || ordersQuery.error;

  if (isLoading || !projectsQuery.data) {
    return { report: null, isLoading, error: error as Error | null };
  }

  const projects = projectsQuery.data;
  const orders = ordersQuery.data || [];

  const report = generateProjectPipelineReport(projects, orders);

  return { report, isLoading: false, error: null };
}

/**
 * Individual computed sub-queries (for selective loading).
 */
export function useStageDistribution() {
  const { report, isLoading } = useProjectPipelineReport();
  return { data: report?.stageDistribution || [], isLoading };
}

export function useRevenuePipeline() {
  const { report, isLoading } = useProjectPipelineReport();
  return { data: report?.revenuePipeline || [], isLoading };
}

export function useCycleTimes() {
  const { report, isLoading } = useProjectPipelineReport();
  return { data: report?.cycleTimes || [], isLoading };
}

export function useStuckProjects() {
  const { report, isLoading } = useProjectPipelineReport();
  return { data: report?.stuckProjects || [], isLoading };
}

export function useProjectKpis() {
  const { report, isLoading } = useProjectPipelineReport();
  return { data: report?.kpis, isLoading };
}
