import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import {
  createNetMeteringApplication,
  transitionNetMeteringStatus,
  type NetMeteringApplication,
  type NetMeteringCreateInput,
  type NetMeteringStatus,
} from '../../../lib/netMeteringWorkflow';

export function useNetMetering() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useQuery({
    queryKey: keys.netMeteringAll,
    queryFn: () => getAll<NetMeteringApplication>(COLLECTIONS.NET_METERING_APPLICATIONS),
    staleTime: 15_000,
  });
}

export function useCreateNetMetering() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (input: NetMeteringCreateInput) => createNetMeteringApplication(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.netMeteringAll });
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success('Net metering application created');
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create application'),
  });
}

export function useTransitionNetMetering() {
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
      status: NetMeteringStatus;
      options?: {
        note?: string;
        approvedDate?: string;
        rejectionReason?: string;
        meterInstalledDate?: string;
      };
    }) => transitionNetMeteringStatus(id, status, options),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: keys.netMeteringAll });
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success(`Status updated to ${data.status}`);
    },
    onError: (err: any) => toast.error(err?.message || 'Status update failed'),
  });
}
