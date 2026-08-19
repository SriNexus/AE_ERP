import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, getOne, createDocWithId, updateDocById, deleteDocById, genId } from '../../../lib/firestore';
import { logCreate, logUpdate, logDelete } from '../../../lib/auditLogger';
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
        // F-16 (Phase 0): audit warehouse edits (previously unlogged).
        const existing = await getOne<any>(COLLECTIONS.WAREHOUSES, editId).catch(() => null);
        await updateDocById(COLLECTIONS.WAREHOUSES, editId, data);
        await logUpdate('warehouse', editId, existing ? { ...existing } : {}, { ...data }, 'warehouses');
      } else {
        const id = genId.generic('WH');
        await createDocWithId(COLLECTIONS.WAREHOUSES, id, { ...data, id, createdBy: user.id });
        // F-16 (Phase 0): audit warehouse creation.
        await logCreate('warehouse', id, { ...data, id }, 'warehouses');
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
    mutationFn: async (id: string) => {
      await deleteDocById(COLLECTIONS.WAREHOUSES, id);
      // F-16 (Phase 0): audit warehouse deletion (soft delete).
      await logDelete('warehouse', id, undefined, 'warehouses');
    },
    onSuccess:  () => { qc.invalidateQueries({ queryKey: QK }); toast.success('Warehouse deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}
