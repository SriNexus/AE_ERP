import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, createDocWithId, updateDocById, genId } from '../../../lib/firestore';
import { logCreate, logUpdate } from '../../../lib/auditLogger';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import type { Team } from '../types';
import toast from 'react-hot-toast';

// Phase 10 (F-CACHE-01 sweep): routed through the queryKeys.forCompany()
// factory (teams entry added there) instead of the module-level, company-
// unscoped `const QK = ['teams']` this file previously used.

export function useTeams() {
  const { activeCompanyId } = useAppStore();
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({
    queryKey: keys.teams,
    queryFn: () => getAll<Team>(COLLECTIONS.TEAMS),
    staleTime: 30_000,
  });
}

export function useSaveTeam(editId: string | null, onSuccess: () => void) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const { activeCompanyId } = useAppStore();
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async (data: Partial<Team>) => {
      if (editId) {
        await updateDocById(COLLECTIONS.TEAMS, editId, data as any);
        await logUpdate('team', editId, {}, { ...data }, 'teams');
      } else {
        const id = genId.generic('TEAM');
        await createDocWithId(COLLECTIONS.TEAMS, id, { ...data, id, createdBy: user.id });
        await logCreate('team', id, { ...data, id }, 'teams');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.teams });
      toast.success(editId ? 'Team updated' : 'Team added');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}
