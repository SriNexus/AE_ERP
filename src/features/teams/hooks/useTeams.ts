import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, createDocWithId, updateDocById, genId } from '../../../lib/firestore';
import { logCreate, logUpdate } from '../../../lib/auditLogger';
import { COLLECTIONS } from '../../../lib/firebase';
import { useCurrentUser } from '../../../store/useAppStore';
import type { Team } from '../types';
import toast from 'react-hot-toast';

const QK = ['teams'] as const;

export function useTeams() {
  return useQuery({
    queryKey: QK,
    queryFn: () => getAll<Team>(COLLECTIONS.TEAMS),
    staleTime: 30_000,
  });
}

export function useSaveTeam(editId: string | null, onSuccess: () => void) {
  const qc = useQueryClient();
  const user = useCurrentUser();

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
      qc.invalidateQueries({ queryKey: QK });
      toast.success(editId ? 'Team updated' : 'Team added');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}
