// features/categories/hooks/useCategories.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, createDocWithId, updateDocById, deleteDocById, genId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import type { CategoryForm } from '../types';
import toast from 'react-hot-toast';

// Phase 10 (F-CACHE-01 sweep): the module-level `const QK = ['product_categories']`
// this file previously used was company-unscoped — routed through the
// existing queryKeys.forCompany() factory instead (see useHR.ts for the
// full rationale). QK can no longer be a module-level constant since
// activeCompanyId is only available inside a hook.

export function useCategories() {
  const { activeCompanyId } = useAppStore();
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({
    queryKey: keys.categories,
    queryFn:  () => getAll(COLLECTIONS.PRODUCT_CATEGORIES),
    staleTime: 60_000,
  });
}

export function useSaveCategory(editId: string | null, onSuccess: () => void) {
  const qc   = useQueryClient();
  const user = useCurrentUser();
  const { activeCompanyId } = useAppStore();
  const keys = queryKeys.forCompany(activeCompanyId);

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
      qc.invalidateQueries({ queryKey: keys.categories });
      toast.success(editId ? 'Category updated' : 'Category added');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  const { activeCompanyId } = useAppStore();
  const keys = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: (id: string) => deleteDocById(COLLECTIONS.PRODUCT_CATEGORIES, id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: keys.categories }); toast.success('Category deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}
