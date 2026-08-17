import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import type { DesignInput, DesignUpdateInput, EngineeringDesignRecord } from '../types';
import { approveDesign, createDesign, requestDesignRevision, submitForReview, updateDesign } from '../services/engineeringWorkflow';

export function useEngineeringDesigns() {
  const companyId = useAppStore((state) => state.activeCompanyId);
  return useQuery({ queryKey: queryKeys.forCompany(companyId).engineeringAll, queryFn: () => getAll<EngineeringDesignRecord>(COLLECTIONS.ENGINEERING_DESIGNS), staleTime: 30_000 });
}

export function useEngineeringActions() {
  const companyId = useAppStore((state) => state.activeCompanyId);
  const client = useQueryClient();
  const invalidate = () => Promise.all([client.invalidateQueries({ queryKey: queryKeys.forCompany(companyId).engineeringRoot }), client.invalidateQueries({ queryKey: queryKeys.forCompany(companyId).projectsRoot })]);
  return {
    create: useMutation({ mutationFn: (input: DesignInput) => createDesign(input), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: DesignUpdateInput }) => updateDesign(id, input), onSuccess: invalidate }),
    submit: useMutation({ mutationFn: (id: string) => submitForReview(id), onSuccess: invalidate }),
    approve: useMutation({ mutationFn: ({ id, note }: { id: string; note?: string }) => approveDesign(id, note), onSuccess: invalidate }),
    revise: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => requestDesignRevision(id, reason), onSuccess: invalidate }),
  };
}
