/**
 * useGenerationReadings — React Query hooks for generation readings
 *
 * Architecture follows the same pattern as useAmcContracts / useServiceTickets.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, getOne } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { queryKeys } from '../../../lib/queryKeys';
import { createReading, type GenerationReadingRecord } from '../../../lib/monitoringWorkflow';
import { useAppStore } from '../../../store/useAppStore';

export function useGenerationReadings() {
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useQuery({
    queryKey: keys.generationReadingsAll,
    queryFn: () => getAll<GenerationReadingRecord>(COLLECTIONS.GENERATION_READINGS),
    staleTime: 30_000,
  });
}

export function useGenerationReading(id: string) {
  return useQuery({
    queryKey: [...queryKeys.forCompany(useAppStore.getState().activeCompanyId).generationReadings, id],
    queryFn: () => getOne<GenerationReadingRecord>(COLLECTIONS.GENERATION_READINGS, id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateGenerationReading() {
  const queryClient = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: createReading,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.generationReadings });
      void queryClient.invalidateQueries({ queryKey: keys.generationReadingsAll });
    },
  });
}
