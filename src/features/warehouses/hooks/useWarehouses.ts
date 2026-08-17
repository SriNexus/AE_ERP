import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, createDocWithId, updateDocById, deleteDocById, genId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useCurrentUser } from '../../../store/useAppStore';
import type { WarehouseForm } from '../types';
import toast from 'react-hot-toast';

const QK = ['warehouses'] as const;

export function useWarehouses() {
  return useQuery({
    queryKey: QK,
    queryFn:  () => getAll(COLLECTIONS.WAREHOUSES),
    staleTime: 30_000,
  });
}

export function useSaveWarehouse(editId: string | null, onSuccess: () => void) {
  const qc   = useQueryClient();
  const user = useCurrentUser();

  return useMutation({
    mutationFn: async (data: WarehouseForm) => {
      if (editId) {
        await updateDocById(COLLECTIONS.WAREHOUSES, editId, data);
      } else {
        const id = genId.generic('WH');
        await createDocWithId(COLLECTIONS.WAREHOUSES, id, { ...data, id, createdBy: user.id });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      toast.success(editId ? 'Warehouse updated' : 'Warehouse added');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDocById(COLLECTIONS.WAREHOUSES, id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: QK }); toast.success('Warehouse deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}
