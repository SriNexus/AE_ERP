import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, Download, Edit2, GitMerge, Layers3, Mail, MessageCircle, Package, Phone, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import { useCategories } from '../../../features/categories/hooks/useCategories';
import { CATEGORY_FORM_DEFAULT, type Category, type CategoryForm } from '../../../features/categories/types';
import { exportProductsCSV, useProducts } from '../../../features/inventory/hooks/useInventory';
import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, deleteDocById, fmtDate, genId, hardDelete, updateDocById } from '../../../lib/firestore';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { useSuperAdminAccess } from '../../auth/SuperAdminRoute';
import type { Product } from '../../../types';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';

type Mode = 'records' | 'create';
type MobileCategory = Category & Record<string, any>;
type CategoryFilters = {
  search: string;
  status: string;
  parent: string;
  date: string;
};

function normalize(value?: string) {
  return String(value || '').trim().toLowerCase();
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isInDateRange(value: any, range: string) {
  if (range === 'all' || range === ALL) return true;
  const date = toDate(value);
  if (!date) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return date >= start;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 0;
  return days ? date >= new Date(Date.now() - days * 86400000) : true;
}

function categoryKeys(category: Partial<Category>) {
  return [category.id, category.name, category.parentCategory].map(normalize).filter(Boolean);
}

function matchesCategoryRef(value: string | undefined, category: Partial<Category>) {
  return new Set(categoryKeys(category)).has(normalize(value));
}

function categoryProductCount(category: Category, products: Product[]) {
  const aliases = new Set(categoryKeys(category));
  return products.filter((product: any) => aliases.has(normalize(product.categoryId)) || aliases.has(normalize(product.category))).length;
}

function linkedProducts(category: Category, products: Product[]) {
  return products.filter((product: any) => matchesCategoryRef(product.categoryId || product.category, category));
}

function childCategories(category: Category, categories: Category[]) {
  return categories.filter((candidate) => candidate.id !== category.id && matchesCategoryRef(candidate.parentCategory, category));
}

function collectDescendantIds(source: Category, categories: Category[]): Set<string> {
  const seen = new Set<string>();
  const queue = [source];
  while (queue.length) {
    const current = queue.shift()!;
    const aliases = categoryKeys(current);
    categories.forEach((candidate) => {
      if (seen.has(candidate.id) || candidate.id === source.id) return;
      if (aliases.some((alias) => normalize(candidate.parentCategory) === alias)) {
        seen.add(candidate.id);
        queue.push(candidate);
      }
    });
  }
  return seen;
}

function filterCategories(categories: MobileCategory[], products: Product[], filters: CategoryFilters) {
  const term = filters.search.trim().toLowerCase();
  return categories
    .filter((category) => {
      const count = categoryProductCount(category, products);
      const root = !category.parentCategory;
      const statusMatch =
        filters.status === ALL ||
        (filters.status === 'Root' && root) ||
        (filters.status === 'Child' && !root) ||
        (filters.status === 'With Products' && count > 0) ||
        (filters.status === 'Empty' && count === 0);
      const parentMatch =
        filters.parent === ALL ||
        (filters.parent === 'Root' ? root : matchesCategoryRef(category.parentCategory, { id: filters.parent, name: filters.parent }));
      if (!statusMatch || !parentMatch) return false;
      if (!isInDateRange(category.createdAt || category.updatedAt, filters.date)) return false;
      if (!term) return true;
      return [category.id, category.name, category.description, category.parentCategory, category.code, category.categoryCode]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => (toDate(b.updatedAt || b.createdAt)?.getTime() || 0) - (toDate(a.updatedAt || a.createdAt)?.getTime() || 0));
}

function exportCategoriesCSV(rows: MobileCategory[], products: Product[]) {
  const headers = ['ID', 'Name', 'Code', 'Parent', 'Description', 'Products', 'Order', 'Created'];
  const lines = rows.map((row) => [
    row.id,
    row.name,
    row.code || row.categoryCode || '',
    row.parentCategory || '',
    String(row.description || '').replace(/\n/g, ' '),
    categoryProductCount(row, products),
    row.order ?? 0,
    row.createdAt ? fmtDate(row.createdAt) : '',
  ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + [headers.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
  a.download = 'product-categories.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function whatsappHref(phone?: string) {
  const clean = String(phone || '').replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : undefined;
}

export function MobileCategoryWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const company = useAppStore((state) => state.company);
  const user = useAppStore((state) => state.user);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const { data: categories = [], isLoading, error, refetch } = useCategories();
  const { data: products = [] } = useProducts();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<MobileCategory | null>(null);
  const [viewCategory, setViewCategory] = useState<MobileCategory | null>(null);
  const [form, setForm] = useState<CategoryForm>({ ...CATEGORY_FORM_DEFAULT });
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MobileCategory | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<MobileCategory | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSourceIds, setMergeSourceIds] = useState<string[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const createParam = params.get('create') || '';

  // Phase 13 (Blueprint §13): permanent (hard) delete/merge is Super-Admin-only,
  // on top of (not instead of) the ordinary module 'delete' permission —
  // matches the desktop CategoriesWorkspace.tsx gate and the same
  // isSuperAdmin() check firestore.rules now enforces server-side.
  const isSuperAdmin = useSuperAdminAccess();
  const canCreate = perms.canCreate('categories');
  const canEdit = perms.canEdit('categories');
  const canDelete = perms.canDelete('categories') && isSuperAdmin;
  const canExport = perms.canExport('categories') || canEdit || canCreate;
  const companyPhone = company?.phone || '';
  const companyEmail = company?.email || '';

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setEditingCategory(null);
    setForm({ ...CATEGORY_FORM_DEFAULT });
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  useEffect(() => {
    const openId = params.get('open');
    if (!openId || viewCategory || !categories.length) return;
    const found = (categories as MobileCategory[]).find((category) => category.id === openId);
    if (found) setViewCategory(found);
  }, [categories, params, viewCategory]);

  const filters = useMemo<CategoryFilters>(() => ({
    search: params.get('q') || params.get('search') || '',
    status: params.get('status') || ALL,
    parent: params.get('parent') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const filteredCategories = useMemo(() => filterCategories(categories as MobileCategory[], products as Product[], filters), [categories, filters, products]);
  const paginatedCategories = useMemo(() => filteredCategories.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredCategories, page]);
  const selectedRows = useMemo(() => (categories as MobileCategory[]).filter((category) => selected.has(category.id)), [categories, selected]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredCategories.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredCategories.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const valid = new Set((categories as MobileCategory[]).map((category) => category.id));
      const next = new Set(Array.from(current).filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [categories]);

  const saveCategory = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        description: form.description?.trim() || '',
        parentCategory: form.parentCategory?.trim() || '',
        order: Number(form.order) || 0,
      };
      if (!payload.name) throw new Error('Name required');
      if (editingCategory) {
        const current = (categories as Category[]).find((category) => category.id === editingCategory.id);
        if (!current) throw new Error('Category not found');
        if (payload.name !== current.name) {
          const descendants = collectDescendantIds(current, categories as Category[]);
          const sourceAliases = new Set(categoryKeys(current));
          await Promise.all([
            ...(products as Product[])
              .filter((product: any) => sourceAliases.has(normalize(product.categoryId)) || sourceAliases.has(normalize(product.category)))
              .map((product) => updateDocById(COLLECTIONS.PRODUCTS, product.id, { category: payload.name, categoryId: current.id })),
            ...(categories as Category[])
              .filter((child) => descendants.has(child.id))
              .map((child) => updateDocById(COLLECTIONS.PRODUCT_CATEGORIES, child.id, {
                parentCategory: child.parentCategory && normalize(child.parentCategory) === normalize(current.name) ? payload.name : child.parentCategory,
              })),
          ]);
        }
        await updateDocById(COLLECTIONS.PRODUCT_CATEGORIES, current.id, payload);
        return current.id;
      }
      const id = genId.generic('CAT');
      await createDocWithId(COLLECTIONS.PRODUCT_CATEGORIES, id, { ...payload, id, createdBy: user?.id || 'system' });
      return id;
    },
    onSuccess: (savedId) => {
      void qc.invalidateQueries({ queryKey: ['product_categories'] });
      void qc.invalidateQueries({ queryKey: keys.categories });
      void qc.invalidateQueries({ queryKey: keys.productsRoot });
      void qc.invalidateQueries({ queryKey: keys.productsAll });
      toast.success(editingCategory ? 'Category updated' : 'Category added');
      closeForm();
      if (savedId) openById(savedId);
    },
    onError: (e: any) => toast.error(e.message || 'Category save failed'),
  });

  const archiveMutation = useMutation({
    mutationFn: async (categoryId: string) => deleteDocById(COLLECTIONS.PRODUCT_CATEGORIES, categoryId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['product_categories'] });
      void qc.invalidateQueries({ queryKey: keys.categories });
      toast.success('Category archived');
      setArchiveTarget(null);
      setSelected(new Set());
      closeCategory();
    },
    onError: (e: any) => toast.error(e.message || 'Archive failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (categoryIds: string[]) => {
      if (!isSuperAdmin) throw new Error('Permanent delete is restricted to the Super Admin account.');
      for (const categoryId of categoryIds) {
        const current = (categories as Category[]).find((category) => category.id === categoryId);
        if (!current) throw new Error('Category not found');
        const linked = linkedProducts(current, products as Product[]);
        const children = childCategories(current, categories as Category[]);
        if (linked.length || children.length) {
          throw new Error('Merge or reassign linked products and child categories before deleting this category.');
        }
        await hardDelete(COLLECTIONS.PRODUCT_CATEGORIES, categoryId);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['product_categories'] });
      void qc.invalidateQueries({ queryKey: keys.categories });
      toast.success('Category deleted');
      setDeleteTarget(null);
      setSelected(new Set());
      closeCategory();
    },
    onError: (e: any) => toast.error(e.message || 'Delete failed'),
  });

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (!isSuperAdmin) throw new Error('Merging categories permanently deletes the source categories, which is restricted to the Super Admin account.');
      const target = (categories as Category[]).find((category) => category.id === mergeTargetId);
      if (!target) throw new Error('Target category not found');
      const sources = (categories as Category[]).filter((category) => mergeSourceIds.includes(category.id) && category.id !== target.id);
      if (!sources.length) throw new Error('Select at least one source category');
      const sourceAliases = new Set(sources.flatMap((source) => categoryKeys(source)));
      await Promise.all([
        ...(products as Product[])
          .filter((product: any) => sourceAliases.has(normalize(product.categoryId)) || sourceAliases.has(normalize(product.category)))
          .map((product) => updateDocById(COLLECTIONS.PRODUCTS, product.id, { category: target.name, categoryId: target.id })),
        ...(categories as Category[])
          .filter((category) => category.id !== target.id && sources.some((source) => matchesCategoryRef(category.parentCategory, source)))
          .map((category) => updateDocById(COLLECTIONS.PRODUCT_CATEGORIES, category.id, { parentCategory: target.name })),
        ...sources.map((source) => hardDelete(COLLECTIONS.PRODUCT_CATEGORIES, source.id)),
      ]);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['product_categories'] });
      void qc.invalidateQueries({ queryKey: keys.categories });
      void qc.invalidateQueries({ queryKey: keys.productsRoot });
      void qc.invalidateQueries({ queryKey: keys.productsAll });
      toast.success('Categories merged');
      setMergeOpen(false);
      setMergeSourceIds([]);
      setMergeTargetId('');
      setSelected(new Set());
      closeCategory();
    },
    onError: (e: any) => toast.error(e.message || 'Merge failed'),
  });

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function openById(categoryId: string) {
    const next = new URLSearchParams(params);
    next.set('open', categoryId);
    setParams(next, { replace: true });
  }

  function openCategory(category: MobileCategory) {
    setViewCategory(category);
    openById(category.id);
  }

  function closeCategory() {
    setViewCategory(null);
    if (params.get('open')) {
      const next = new URLSearchParams(params);
      next.delete('open');
      setParams(next, { replace: true });
    }
  }

  function closeForm() {
    setFormOpen(false);
    setEditingCategory(null);
    setForm({ ...CATEGORY_FORM_DEFAULT });
    setDirty(false);
    if (mode === 'create') navigate('/app', { replace: true });
    if (createParam === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function requestCloseForm() {
    if (dirty) return setConfirmClose(true);
    closeForm();
  }

  function openCreate() {
    setEditingCategory(null);
    setForm({ ...CATEGORY_FORM_DEFAULT });
    setDirty(false);
    setFormOpen(true);
  }

  function openEdit(category: MobileCategory) {
    closeCategory();
    setEditingCategory(category);
    setForm({
      name: category.name || '',
      description: category.description || '',
      parentCategory: category.parentCategory || '',
      order: String(category.order || 0),
    });
    setDirty(false);
    setFormOpen(true);
  }

  function updateForm(patch: Partial<CategoryForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return toast.error('Name required');
    if (editingCategory && form.parentCategory) {
      const descendants = collectDescendantIds(editingCategory, categories as Category[]);
      const parentMatchesCurrent = normalize(form.parentCategory) === normalize(editingCategory.name) || normalize(form.parentCategory) === normalize(editingCategory.id);
      const parentMatchesDescendant = (categories as Category[]).some((category) => descendants.has(category.id) && matchesCategoryRef(form.parentCategory, category));
      if (parentMatchesCurrent || parentMatchesDescendant) return toast.error('Parent category cannot create a circular relationship');
    }
    saveCategory.mutate();
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function startMerge(sourceIds: string[]) {
    if (!sourceIds.length) return toast.error('Select at least one category');
    closeCategory();
    setMergeSourceIds(sourceIds);
    setMergeTargetId('');
    setMergeOpen(true);
  }

  const parentOptions = useMemo(() => {
    const roots = (categories as MobileCategory[]).filter((category) => !category.parentCategory);
    return [{ label: 'Root Category', value: '' }, ...roots.map((category) => ({ label: category.name, value: category.name }))];
  }, [categories]);

  if (mode === 'create') {
    return (
      <CategoryDialogs
        formOpen={formOpen}
        form={form}
        parentOptions={parentOptions}
        dirty={dirty}
        saving={saveCategory.isPending}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onSubmit={submitForm}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3 px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Categories</h1>
        </div>

        {selected.size > 0 ? (
          <Card className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/35 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm font-bold text-[var(--color-primary-text)]">{selected.size} selected</p>
              {canExport ? <Button size="xs" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportCategoriesCSV(selectedRows, products as Product[])}>Export</Button> : null}
              {canDelete ? <Button size="xs" variant="outline" icon={<GitMerge className="h-3.5 w-3.5" />} onClick={() => startMerge(Array.from(selected))}>Merge</Button> : null}
              {canDelete ? <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleteTarget(selectedRows[0])}>Delete</Button> : null}
              <button type="button" className="text-xs font-medium text-[var(--color-text-muted)]" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </Card>
        ) : null}

        {error ? (
          <Card className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Categories could not be loaded. <button type="button" className="font-bold underline" onClick={() => refetch()}>Retry</button>
          </Card>
        ) : null}

        <div className="space-y-2">
          {isLoading ? Array.from({ length: 5 }).map((_, index) => <CategorySkeletonCard key={index} />) : null}
          {!isLoading && !paginatedCategories.length ? (
            <Card className="rounded-xl p-6 text-center">
              <Layers3 className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
              <p className="mt-3 text-sm font-bold text-[var(--color-text)]">{params.get('q') || params.get('status') || params.get('parent') || params.get('date') ? 'No categories found' : 'No categories yet'}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{params.get('q') || params.get('status') || params.get('parent') || params.get('date') ? 'Clear search or filters to view all categories.' : 'Add your first category to organize products.'}</p>
              {!params.get('q') && !params.get('status') && !params.get('parent') && !params.get('date') && canCreate ? (
                <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate} className="mt-3">Add First Category</Button>
              ) : null}
            </Card>
          ) : null}
          {paginatedCategories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              selected={selected.has(category.id)}
              productCount={categoryProductCount(category, products as Product[])}
              companyPhone={companyPhone}
              companyEmail={companyEmail}
              onSelect={() => toggleSelect(category.id)}
              onView={() => openCategory(category)}
            />
          ))}
        </div>

        <Pagination page={page} total={filteredCategories.length} perPage={PER_PAGE} onChange={changePage} />
      </div>

      <CategoryDialogs
        formOpen={formOpen}
        form={form}
        parentOptions={parentOptions}
        dirty={dirty}
        saving={saveCategory.isPending}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onSubmit={submitForm}
      />

      <CategoryViewModal
        category={viewCategory}
        categories={categories as MobileCategory[]}
        products={products as Product[]}
        canEdit={canEdit}
        canDelete={canDelete}
        companyPhone={companyPhone}
        companyEmail={companyEmail}
        onClose={closeCategory}
        onEdit={openEdit}
        onArchive={(category) => setArchiveTarget(category)}
        onDelete={(category) => setDeleteTarget(category)}
        onMerge={(category) => startMerge([category.id])}
        onExportProducts={(rows) => exportProductsCSV(rows)}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
        loading={archiveMutation.isPending}
        title="Archive Category"
        message="Archive this category? Linked products will remain intact."
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(selected.size ? Array.from(selected) : deleteTarget ? [deleteTarget.id] : [])}
        loading={deleteMutation.isPending}
        title="Delete Category"
        message={selected.size > 1 ? `Delete ${selected.size} selected categories? Categories with products or children will be blocked.` : 'Delete this category? This is only allowed when no products or child categories remain.'}
      />

      <Modal open={mergeOpen} onClose={() => setMergeOpen(false)} title="Merge Categories" size="full">
        <div className="space-y-4">
          <Section title="Source Categories">
            {mergeSourceIds.map((id) => {
              const category = (categories as MobileCategory[]).find((entry) => entry.id === id);
              return <Detail key={id} label={category?.name || id} value={`${category ? categoryProductCount(category, products as Product[]) : 0} products`} />;
            })}
          </Section>
          <Section title="Target Category">
            <Select
              label="Merge Into"
              value={mergeTargetId}
              onChange={(event) => setMergeTargetId(event.target.value)}
              options={[{ label: 'Select target...', value: '' }, ...(categories as MobileCategory[]).filter((category) => !mergeSourceIds.includes(category.id)).map((category) => ({ label: category.name, value: category.id }))]}
            />
          </Section>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setMergeOpen(false)}>Cancel</Button>
            <Button className="flex-1" loading={mergeMutation.isPending} onClick={() => mergeMutation.mutate()}>Merge</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CategoryCard({ category, selected, productCount, companyPhone, companyEmail, onSelect, onView }: {
  category: MobileCategory;
  selected: boolean;
  productCount: number;
  companyPhone: string;
  companyEmail: string;
  onSelect: () => void;
  onView: () => void;
}) {
  const root = !category.parentCategory;
  return (
    <Card className={cn('rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]', selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40')}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" checked={selected} onChange={onSelect} className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]" aria-label={`Select ${category.name}`} />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{category.name || 'Untitled Category'}</p>
          <p className="mt-0.5 truncate font-mono text-xs font-medium text-[var(--color-text-muted)]">{category.code || category.categoryCode || category.id}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{root ? 'Root Category' : `Parent ${category.parentCategory}`}</p>
            <p className="truncate">{productCount} products</p>
            <p className="truncate">{category.createdByName || category.createdBy || 'System'}</p>
            <p className="truncate">{category.updatedAt ? fmtDate(category.updatedAt) : category.createdAt ? fmtDate(category.createdAt) : 'Not updated'}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge variant={root ? 'info' : 'purple'}>{root ? 'Root' : 'Child'}</Badge>
            {statusBadge(productCount > 0 ? 'Active' : 'Inactive')}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsappHref(companyPhone)} target="_blank" rel="noreferrer" aria-label="WhatsApp category" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !companyPhone && 'pointer-events-none opacity-40')}><MessageCircle className="h-4 w-4" /></a>
          <a href={companyEmail ? `mailto:${companyEmail}?subject=${encodeURIComponent(category.name || 'Category')}` : undefined} aria-label="Email category" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !companyEmail && 'pointer-events-none opacity-40')}><Mail className="h-4 w-4" /></a>
          <a href={companyPhone ? `tel:${companyPhone}` : undefined} aria-label="Call category" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !companyPhone && 'pointer-events-none opacity-40')}><Phone className="h-4 w-4" /></a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function CategorySkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-8 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

function CategoryDialogs({ formOpen, form, parentOptions, dirty, saving, confirmClose, onCloseForm, onDiscard, onKeepEditing, onFormChange, onSubmit }: {
  formOpen: boolean;
  form: CategoryForm;
  parentOptions: { label: string; value: string }[];
  dirty: boolean;
  saving: boolean;
  confirmClose: boolean;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onFormChange: (patch: Partial<CategoryForm>) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title="Category" size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <Section title="Category Information">
            <Input label="Category Name" required value={form.name} onChange={(event) => onFormChange({ name: event.target.value })} />
            <Select label="Parent Category" value={form.parentCategory} onChange={(event) => onFormChange({ parentCategory: event.target.value })} options={parentOptions} />
            <Input label="Category Code" value={(form as any).code || ''} onChange={(event) => onFormChange({ code: event.target.value } as any)} />
            <Input label="Display Order" type="number" value={form.order} onChange={(event) => onFormChange({ order: event.target.value })} />
          </Section>
          <Section title="Description">
            <Textarea label="Description" value={form.description} onChange={(event) => onFormChange({ description: event.target.value })} rows={4} />
          </Section>
          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>Save</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={confirmClose} onClose={onKeepEditing} onConfirm={onDiscard} title="Discard Changes" message="Close this form and discard unsaved changes?" />
    </>
  );
}

function CategoryViewModal({ category, categories, products, canEdit, canDelete, companyPhone, companyEmail, onClose, onEdit, onArchive, onDelete, onMerge, onExportProducts }: {
  category: MobileCategory | null;
  categories: MobileCategory[];
  products: Product[];
  canEdit: boolean;
  canDelete: boolean;
  companyPhone: string;
  companyEmail: string;
  onClose: () => void;
  onEdit: (category: MobileCategory) => void;
  onArchive: (category: MobileCategory) => void;
  onDelete: (category: MobileCategory) => void;
  onMerge: (category: MobileCategory) => void;
  onExportProducts: (rows: Product[]) => void;
}) {
  if (!category) return null;
  const relatedProducts = linkedProducts(category, products);
  const children = childCategories(category, categories);
  const parent = categories.find((entry) => matchesCategoryRef(category.parentCategory, entry));
  const activity = [
    { type: 'Created', desc: 'Category record created', date: category.createdAt, userName: category.createdByName || category.createdBy || 'System' },
    ...(category.updatedAt ? [{ type: 'Updated', desc: 'Category was updated', date: category.updatedAt, userName: category.updatedByName || category.updatedBy || 'System' }] : []),
    ...(relatedProducts.length ? [{ type: 'Products', desc: `${relatedProducts.length} linked products`, date: category.updatedAt || category.createdAt, userName: 'System' }] : []),
    ...(children.length ? [{ type: 'Hierarchy', desc: `${children.length} child categories`, date: category.updatedAt || category.createdAt, userName: 'System' }] : []),
  ];
  return (
    <Modal open={!!category} onClose={onClose} title={category.name} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={!category.parentCategory ? 'info' : 'purple'}>{!category.parentCategory ? 'Root' : 'Child'}</Badge>
            {statusBadge(relatedProducts.length > 0 ? 'Active' : 'Inactive')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Products" value={String(relatedProducts.length)} />
            <Detail label="Children" value={String(children.length)} />
          </div>
        </section>

        <Section title="Category Information">
          <Detail label="Category Name" value={category.name || 'Not available'} />
          <Detail label="Category Code" value={category.code || category.categoryCode || category.id} />
          <Detail label="Display Order" value={String(category.order || 0)} />
          <Detail label="Status" value={relatedProducts.length > 0 ? 'Active' : 'Inactive'} />
        </Section>

        <Section title="Parent Category">
          <Detail label="Parent" value={parent?.name || category.parentCategory || 'Root Category'} />
        </Section>

        <Section title="Description">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{category.description || 'No description recorded.'}</p>
        </Section>

        <Section title="Related Products">
          {relatedProducts.length ? (
            <div className="space-y-2">
              {relatedProducts.slice(0, 8).map((product: any) => (
                <div key={product.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{product.name || product.id}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{product.sku || 'SKU not set'} · {product.status || 'Active'}</p>
                </div>
              ))}
              <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => onExportProducts(relatedProducts)}>Export Products</Button>
            </div>
          ) : <p className="text-sm text-[var(--color-text-muted)]">No products linked.</p>}
        </Section>

        <Section title="Timeline">
          <MobileTimelinePreview title={`${category.name || 'Category'} Timeline`} entries={activity} />
        </Section>

        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{category.notes || category.description || 'No notes recorded.'}</p>
        </Section>

        <Section title="Attachments">
          <p className="text-sm text-[var(--color-text-muted)]">{category.attachmentName || category.fileName || 'No attachments available.'}</p>
        </Section>

        <Section title="Audit Information">
          <Detail label="Created By" value={category.createdByName || category.createdBy || 'System'} />
          <Detail label="Created" value={category.createdAt ? fmtDate(category.createdAt) : 'Not available'} />
          <Detail label="Updated" value={category.updatedAt ? fmtDate(category.updatedAt) : 'Not available'} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {companyPhone ? <a className={linkButtonClass} href={`tel:${companyPhone}`}><Phone className="h-4 w-4" />Call</a> : null}
          {companyPhone ? <a className={linkButtonClass} href={whatsappHref(companyPhone)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a> : null}
          {companyEmail ? <a className={linkButtonClass} href={`mailto:${companyEmail}?subject=${encodeURIComponent(category.name || 'Category')}`}><Mail className="h-4 w-4" />Email</a> : null}
          {canEdit ? <Button variant="outline" icon={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(category)}>Edit</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => { onClose(); navigator.clipboard?.writeText(JSON.stringify(category, null, 2)); toast.success('Category copied'); }}>Copy</Button> : null}
          {canDelete ? <Button variant="outline" icon={<GitMerge className="h-4 w-4" />} onClick={() => onMerge(category)}>Merge</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Archive className="h-4 w-4" />} onClick={() => onArchive(category)}>Archive</Button> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(category)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

const linkButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"><h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3><div className="mt-3 space-y-3">{children}</div></section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</p></div>;
}

export default MobileCategoryWorkspace;
