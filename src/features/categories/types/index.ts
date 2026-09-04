// features/categories/types/index.ts
import type { BaseRecord } from '../../../types';

export interface Category extends BaseRecord {
  name:           string;
  description?:   string;
  parentCategory?: string;
  /** INVENTORY-09 (P2-3) — stable FK to the parent `product_categories` doc.
   *  `parentCategory` stays the denormalized display name (same dual-field
   *  pattern as `product.categoryId` / `product.category`). */
  parentCategoryId?: string;
  order:          number;
}

export const CATEGORY_FORM_DEFAULT = {
  name:           '',
  description:    '',
  parentCategory: '',
  parentCategoryId: '',
  order:          '0',
};

export type CategoryForm = typeof CATEGORY_FORM_DEFAULT;
