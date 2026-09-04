// features/categories/hooks/useCategories.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, getOne, createDocWithId, updateDocById, deleteDocById, genId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { assertMasterDataIdAvailable } from '../../inventory/hooks/useInventory';
import { checkCategoryDeleteGuard } from '../../../lib/inventory/masterDataGuards';
import { categoryKeys, collectDescendantIds, normalize } from '../utils/categoryWorkspaceUtils';
import type { Product } from '../../../types';
import type { Category, CategoryForm } from '../types';
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
    queryFn:  () => getAll<Category>(COLLECTIONS.PRODUCT_CATEGORIES),
    staleTime: 60_000,
  });
}

/**
 * INVENTORY-09 (§6) — save a category, cascading a NAME rename onto the
 * denormalized `product.category` display field of every product CURRENTLY
 * linked to it. `categoryId` never changes (it's the doc id). Historical
 * quotation/order line-item snapshots are separate documents this never
 * touches — only live `products` docs. Reuses the exact same "linked"
 * predicate `CategoriesWorkspace`'s own product-count / merge features use
 * (`categoryKeys`/`normalize`) — one definition, not a second one.
 */
export async function saveCategoryWithRenameCascade(
  editId: string | null,
  data: CategoryForm & { parentCategoryId?: string },
  actorId: string,
): Promise<string> {
  const name = data.name.trim();
  if (!name) throw new Error('Category name is required');
  const payload = {
    name,
    description: data.description?.trim() || '',
    parentCategory: data.parentCategory?.trim() || '',
    parentCategoryId: data.parentCategoryId?.trim() || '',
    order: Number(data.order) || 0,
  };

  if (editId) {
    const existing = await getOne<Category>(COLLECTIONS.PRODUCT_CATEGORIES, editId);
    if (!existing) throw new Error('Category not found');
    await updateDocById(COLLECTIONS.PRODUCT_CATEGORIES, editId, payload);

    if (payload.name !== existing.name) {
      const [products, categories] = await Promise.all([
        getAll<Product & { id: string; categoryId?: string }>(COLLECTIONS.PRODUCTS),
        getAll<Category & { id: string }>(COLLECTIONS.PRODUCT_CATEGORIES),
      ]);
      const aliases = new Set(categoryKeys(existing));
      const linked = products.filter((p) => p.isDeleted !== true
        && (aliases.has(normalize(p.categoryId)) || aliases.has(normalize(p.category))));
      const descendants = collectDescendantIds(existing, categories);
      // Same pattern CategoriesWorkspace's own merge feature already uses —
      // independent per-document writes, not a single batched commit (no
      // 500-op batch limit to chunk around at this scale; each write is
      // idempotent — a retry lands on the same final name).
      await Promise.all([
        // Linked products' denormalized display name (+ backfill categoryId
        // for a legacy name-only match — never touched otherwise).
        ...linked.map((p) => updateDocById(COLLECTIONS.PRODUCTS, p.id, { category: payload.name, categoryId: existing.id })),
        // Direct child categories' own denormalized parentCategory display name.
        ...categories
          .filter((c) => descendants.has(c.id) && c.parentCategory && normalize(c.parentCategory) === normalize(existing.name))
          .map((c) => updateDocById(COLLECTIONS.PRODUCT_CATEGORIES, c.id, { parentCategory: payload.name })),
      ]);
    }
    return editId;
  }

  const id = genId.generic('CAT');
  await assertMasterDataIdAvailable(COLLECTIONS.PRODUCT_CATEGORIES, id, 'Category');
  await createDocWithId(COLLECTIONS.PRODUCT_CATEGORIES, id, { ...payload, id, createdBy: actorId });
  return id;
}

export function useSaveCategory(editId: string | null, onSuccess: () => void) {
  const qc   = useQueryClient();
  const user = useCurrentUser();
  const { activeCompanyId } = useAppStore();
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (data: CategoryForm & { parentCategoryId?: string }) => saveCategoryWithRenameCascade(editId, data, user.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.categories });
      qc.invalidateQueries({ queryKey: keys.productsRoot });
      qc.invalidateQueries({ queryKey: keys.productsAll });
      toast.success(editId ? 'Category updated' : 'Category added');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/** INVENTORY-09 (§12) — block the soft-delete when a non-deleted product is still linked. */
export async function deleteCategoryWithGuard(id: string): Promise<void> {
  const existing = await getOne<Category>(COLLECTIONS.PRODUCT_CATEGORIES, id);
  if (!existing) throw new Error('Category not found');
  const guard = await checkCategoryDeleteGuard(existing);
  if (guard.blocked) throw new Error(guard.reason || 'This category cannot be deleted right now.');
  await deleteDocById(COLLECTIONS.PRODUCT_CATEGORIES, id);
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  const { activeCompanyId } = useAppStore();
  const keys = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: (id: string) => deleteCategoryWithGuard(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: keys.categories }); toast.success('Category deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}
