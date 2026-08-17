// features/categories/types/index.ts
import type { BaseRecord } from '../../../types';

export interface Category extends BaseRecord {
  name:           string;
  description?:   string;
  parentCategory?: string;
  order:          number;
}

export const CATEGORY_FORM_DEFAULT = {
  name:           '',
  description:    '',
  parentCategory: '',
  order:          '0',
};

export type CategoryForm = typeof CATEGORY_FORM_DEFAULT;
