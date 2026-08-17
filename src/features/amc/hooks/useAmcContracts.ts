/**
 * useAmcContracts.ts — React Query hooks for AMC Contracts
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import {
  createAmcContract,
  transitionAmcStatus,
  type AmcContractCreateInput,
  type AmcContractRecord,
  type AmcStatus,
} from '../../../lib/amcWorkflow';

export function useAmcContracts() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({
    queryKey: keys.amcContracts,
    queryFn: () => getAll<AmcContractRecord>(COLLECTIONS.AMC_CONTRACTS),
    staleTime: 30_000,
  });
}

export function useCreateAmcContract() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (input: AmcContractCreateInput) => createAmcContract(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.amcContracts });
      toast.success('AMC contract created');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useTransitionAmcContract() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({
      contractId,
      nextStatus,
      note,
    }: {
      contractId: string;
      nextStatus: AmcStatus;
      note?: string;
    }) => transitionAmcStatus(contractId, nextStatus, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.amcContracts });
      toast.success('AMC contract status updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
