/**
 * useProjectHandover.ts — React Query hooks for Project Handover
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import {
  createHandover,
  transitionHandoverStatus,
  type HandoverCreateInput,
  type HandoverRecord,
  type HandoverStatus,
} from '../../../lib/projectHandoverWorkflow';

export function useProjectHandovers() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({
    queryKey: keys.projectHandovers,
    queryFn: () => getAll<HandoverRecord>(COLLECTIONS.PROJECT_HANDOVERS),
    staleTime: 30_000,
  });
}

export function useCreateHandover() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (input: HandoverCreateInput) => createHandover(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.projectHandovers });
      toast.success('Handover record created');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useTransitionHandover() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({
      handoverId,
      nextStatus,
      note,
      scheduledDate,
      assignedEngineer,
      assignedEngineerName,
    }: {
      handoverId: string;
      nextStatus: HandoverStatus;
      note?: string;
      scheduledDate?: string;
      assignedEngineer?: string;
      assignedEngineerName?: string;
    }) => transitionHandoverStatus(handoverId, nextStatus, {
      note,
      scheduledDate,
      assignedEngineer,
      assignedEngineerName,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.projectHandovers });
      toast.success('Handover status updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
