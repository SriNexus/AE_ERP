// features/categories/hooks/useCategories.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, createDocWithId, updateDocById, deleteDocById, genId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useCurrentUser } from '../../../store/useAppStore';
import type { CategoryForm } from '../types';
import toast from 'react-hot-toast';

const QK = ['product_categories'] as const;

export function useCategories() {
  return useQuery({
    queryKey: QK,
    queryFn:  () => getAll(COLLECTIONS.PRODUCT_CATEGORIES),
    staleTime: 60_000,
  });
}

export function useSaveCategory(editId: string | null, onSuccess: () => void) {
  const qc   = useQueryClient();
  const user = useCurrentUser();

  return useMutation({
    mutationFn: async (data: CategoryForm) => {
      if (editId) {
        await updateDocById(COLLECTIONS.PRODUCT_CATEGORIES, editId, data);
      } else {
        const id = genId.generic('CAT');
        await createDocWithId(COLLECTIONS.PRODUCT_CATEGORIES, id, { ...data, id, createdBy: user.id });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      toast.success(editId ? 'Category updated' : 'Category added');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDocById(COLLECTIONS.PRODUCT_CATEGORIES, id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: QK }); toast.success('Category deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}
