import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-09 (§6) — category id integrity: rename cascade onto linked
 * products' denormalized display name + child categories' parentCategory,
 * categoryId stability, delete guard, and — critically — historical
 * quotation/order line-item snapshots are NEVER touched by a rename.
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ counter: 0, updateDocByIdCalls: [] as Array<{ col: string; id: string; patch: any }> }));

vi.mock('../../../../lib/firebase', () => ({
  COLLECTIONS: {
    PRODUCTS: 'products', PRODUCT_CATEGORIES: 'product_categories', ORDERS: 'orders', QUOTATIONS: 'quotations',
  },
}));
vi.mock('../../../../lib/firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => {
    mocks.updateDocByIdCalls.push({ col: c, id, patch });
    col(c)[id] = { ...(col(c)[id] || { id }), ...patch };
  }),
  deleteDocById: vi.fn(async (c: string, id: string) => { col(c)[id] = { ...(col(c)[id] || { id }), isDeleted: true }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  genId: { generic: (p = 'ID') => `${p}-${++mocks.counter}` },
}));

import { saveCategoryWithRenameCascade, deleteCategoryWithGuard } from '../useCategories';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.counter = 0;
  mocks.updateDocByIdCalls = [];
});

const FORM = (over: Partial<{ name: string; description: string; parentCategory: string; parentCategoryId: string; order: string }> = {}) => ({
  name: '', description: '', parentCategory: '', parentCategoryId: '', order: '0', ...over,
});

describe('INVENTORY-09 — category create/edit', () => {
  it('creates a category', async () => {
    const id = await saveCategoryWithRenameCascade(null, FORM({ name: 'Electronics' }), 'U-1');
    expect(col('product_categories')[id]).toMatchObject({ name: 'Electronics', createdBy: 'U-1' });
  });

  it('a blank name is rejected', async () => {
    await expect(saveCategoryWithRenameCascade(null, FORM({ name: '  ' }), 'U-1')).rejects.toThrow(/required/i);
  });

  it('editing without a name change does not touch any product', async () => {
    const id = await saveCategoryWithRenameCascade(null, FORM({ name: 'Electronics' }), 'U-1');
    col('products')['P-1'] = { id: 'P-1', categoryId: id, category: 'Electronics', isDeleted: false };
    await saveCategoryWithRenameCascade(id, FORM({ name: 'Electronics', order: '5' }), 'U-1');
    expect(col('products')['P-1'].category).toBe('Electronics');
  });
});

describe('INVENTORY-09 — rename cascade (§6)', () => {
  it('renaming a category updates the display name on products linked by categoryId; categoryId itself never changes', async () => {
    const id = await saveCategoryWithRenameCascade(null, FORM({ name: 'Electronics' }), 'U-1');
    col('products')['P-1'] = { id: 'P-1', categoryId: id, category: 'Electronics', isDeleted: false };

    await saveCategoryWithRenameCascade(id, FORM({ name: 'Consumer Electronics' }), 'U-1');

    expect(col('products')['P-1']).toMatchObject({ categoryId: id, category: 'Consumer Electronics' });
    expect(col('product_categories')[id].name).toBe('Consumer Electronics');
  });

  it('a legacy product linked only by the OLD name string is also updated (and backfilled with categoryId)', async () => {
    const id = await saveCategoryWithRenameCascade(null, FORM({ name: 'Electronics' }), 'U-1');
    col('products')['P-2'] = { id: 'P-2', category: 'Electronics', isDeleted: false }; // no categoryId yet

    await saveCategoryWithRenameCascade(id, FORM({ name: 'Consumer Electronics' }), 'U-1');

    expect(col('products')['P-2']).toMatchObject({ category: 'Consumer Electronics', categoryId: id });
  });

  it('an unrelated product (different category) is never touched', async () => {
    const id = await saveCategoryWithRenameCascade(null, FORM({ name: 'Electronics' }), 'U-1');
    col('products')['P-3'] = { id: 'P-3', category: 'Hardware', isDeleted: false };

    await saveCategoryWithRenameCascade(id, FORM({ name: 'Consumer Electronics' }), 'U-1');

    expect(col('products')['P-3'].category).toBe('Hardware');
  });

  it('renaming a parent cascades its denormalized name onto direct child categories', async () => {
    const parentId = await saveCategoryWithRenameCascade(null, FORM({ name: 'Electronics' }), 'U-1');
    const childId = await saveCategoryWithRenameCascade(null, FORM({ name: 'Phones', parentCategory: 'Electronics', parentCategoryId: parentId }), 'U-1');

    await saveCategoryWithRenameCascade(parentId, FORM({ name: 'Consumer Electronics' }), 'U-1');

    expect(col('product_categories')[childId]).toMatchObject({ parentCategory: 'Consumer Electronics', parentCategoryId: parentId });
  });

  it('a rename NEVER touches historical quotation/order documents (only live products/categories are written)', async () => {
    const id = await saveCategoryWithRenameCascade(null, FORM({ name: 'Electronics' }), 'U-1');
    col('products')['P-4'] = { id: 'P-4', categoryId: id, category: 'Electronics', isDeleted: false };
    // A historical order/quotation line-item snapshot — a SEPARATE document
    // that stores its OWN copy of the category string at the time it was created.
    col('orders')['O-1'] = { id: 'O-1', items: [{ productId: 'P-4', category: 'Electronics' }] };
    col('quotations')['Q-1'] = { id: 'Q-1', items: [{ productId: 'P-4', category: 'Electronics' }] };

    await saveCategoryWithRenameCascade(id, FORM({ name: 'Consumer Electronics' }), 'U-1');

    // the live product display name DID update...
    expect(col('products')['P-4'].category).toBe('Consumer Electronics');
    // ...but the historical snapshots are byte-for-byte untouched.
    expect(col('orders')['O-1'].items[0].category).toBe('Electronics');
    expect(col('quotations')['Q-1'].items[0].category).toBe('Electronics');
    expect(mocks.updateDocByIdCalls.some((c) => c.col === 'orders' || c.col === 'quotations')).toBe(false);
  });
});

describe('INVENTORY-09 — category delete guard (§12, wired)', () => {
  it('a linked category cannot be deleted', async () => {
    const id = await saveCategoryWithRenameCascade(null, FORM({ name: 'Electronics' }), 'U-1');
    col('products')['P-5'] = { id: 'P-5', categoryId: id, category: 'Electronics', isDeleted: false };
    await expect(deleteCategoryWithGuard(id)).rejects.toThrow(/linked/i);
    expect(col('product_categories')[id].isDeleted).not.toBe(true);
  });

  it('an unlinked category can be soft-deleted', async () => {
    const id = await saveCategoryWithRenameCascade(null, FORM({ name: 'Unused' }), 'U-1');
    await deleteCategoryWithGuard(id);
    expect(col('product_categories')[id].isDeleted).toBe(true);
  });
});
