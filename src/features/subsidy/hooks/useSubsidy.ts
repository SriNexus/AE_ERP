import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import {
  createSubsidyApplication,
  transitionSubsidyStatus,
  recordDisbursement,
  type SubsidyApplication,
  type SubsidyCreateInput,
  type SubsidyStatus,
  type DisburseInput,
} from '../../../lib/subsidyWorkflow';

export function useSubsidy() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useQuery({
    queryKey: keys.subsidyAll,
    queryFn: () => getAll<SubsidyApplication>(COLLECTIONS.SUBSIDY_APPLICATIONS),
    staleTime: 15_000,
  });
}

export function useCreateSubsidy() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (input: SubsidyCreateInput) => createSubsidyApplication(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.subsidyAll });
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success('Subsidy application created');
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create application'),
  });
}

export function useTransitionSubsidy() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({
      id,
      status,
      options,
    }: {
      id: string;
      status: SubsidyStatus;
      options?: {
        note?: string;
        approvedDate?: string;
        rejectionReason?: string;
        totalSanctionedAmount?: number;
      };
    }) => transitionSubsidyStatus(id, status, options),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: keys.subsidyAll });
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success(`Status updated to ${data.status}`);
    },
    onError: (err: any) => toast.error(err?.message || 'Status update failed'),
  });
}

export function useRecordDisbursement() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: DisburseInput;
    }) => recordDisbursement(id, input),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: keys.subsidyAll });
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success(`Disbursement recorded. Total: ${data.totalDisbursedAmount}`);
    },
    onError: (err: any) => toast.error(err?.message || 'Disbursement failed'),
  });
}
