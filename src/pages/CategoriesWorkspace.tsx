/**
 * Categories Page — Desktop Gold Standard (Phase 1)
 * Full Leads parity implementation.
 *
 * Features:
 * - 6 PremiumKpi cards (Total Categories, Active, Product Count, Empty, Recently Added, Root)
 * - Leads-style search + inline filters (Date, Status, Parent, Company, Created By)
 * - UniversalCheckbox for selection
 * - Sortable columns with sticky header
 * - Bulk actions (Export CSV, Merge, Delete)
 * - CategoryDetailsModal for detail view
 * - URL sync for all filter state
 * - Type A scroll architecture (no browser scroll)
 * - Embedded mode support (when rendered inside Products page)
 */
import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Tag,
  Plus,
  RefreshCw,
  Download,
  Trash2,
  GitMerge,
  Target,
  Package,
  Layers,
  Archive,
  X,
  Eye,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { Badge } from '../components/ui/Badge';
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Modal,
  Pagination,
  PremiumKpi,
  Select,
  SkeletonRows,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  UniversalCheckbox,
  WorkspaceHero,
} from '../components/ui';
import { CategoryDetailsModal, CategoryMergeModal } from '../features/categories/components/CategoryWorkspaceParts';
import { useCategories } from '../features/categories/hooks/useCategories';
import {
  DATE_RANGE_OPTIONS,
  categoryKeys,
  categoryProductCount,
  exportCategoriesCSV,
  formatDate,
  matchesCategoryRef,
  normalize,
  recencyDotClass,
  withinDateRange,
} from '../features/categories/utils/categoryWorkspaceUtils';
import { useProducts } from '../features/inventory/hooks/useInventory';
import { COLLECTIONS } from '../lib/firebase';
import { createDocWithId, deleteDocById, hardDelete, updateDocById, genId, getAll } from '../lib/firestore';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { useSuperAdminAccess } from '../components/auth/SuperAdminRoute';
import type { Category } from '../features/categories/types';
import { CATEGORY_FORM_DEFAULT, type CategoryForm as CategoryFormValues } from '../features/categories/types';
import type { Product } from '../types';

const PER_PAGE = 10;

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function isThisMonth(value: any): boolean {
  const date = toDateValue(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

// ─────────────────────────────────────────────────────────────────────────────
export function CategoriesWorkspace({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { company, activeCompanyId } = useAppStore();
  const user = useAppStore((state) => state.user);
  // Phase 13 (Blueprint §13): permanent (hard) delete is a distinct,
  // Super-Admin-only action — "Archive" (soft delete, deleteMut below)
  // stays available to any user with category-delete permission; "Delete"
  // and "Merge" (both call hardDelete()) must not be reachable by anyone
  // else, matching the same isSuperAdmin() check firestore.rules now
  // enforces server-side for this collection.
  const isSuperAdmin = useSuperAdminAccess();
  const openParam = embedded ? '' : searchParams.get('open') || '';

  // ── Filters ──────────────────────────────────────────────────
  const [search, setSearch] = useState(embedded ? '' : searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);

  const [statusF, setStatusF] = useState(embedded ? '' : searchParams.get('status') || '');
  const [parentF, setParentF] = useState(embedded ? '' : searchParams.get('parent') || '');
  const [companyF, setCompanyF] = useState(embedded ? 'all' : searchParams.get('company') || 'all');
  const [createdByF, setCreatedByF] = useState(embedded ? '' : searchParams.get('createdBy') || '');
  const [dateRange, setDateRange] = useState(embedded ? 'all' : searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(embedded ? '' : searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(embedded ? '' : searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(embedded ? '' : searchParams.get('kpi') || '');

  // ── Table ────────────────────────────────────────────────────
  const [page, setPage] = useState(embedded ? 1 : Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(embedded ? PER_PAGE : Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('name');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const userClosedRef = useRef(false);

  // ── Mutations state ──────────────────────────────────────────
  const [viewItem, setViewItem] = useState<Category | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<CategoryFormValues>({ ...CATEGORY_FORM_DEFAULT });
  const [delId, setDelId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSourceIds, setMergeSourceIds] = useState<string[]>([]);

  // ── Queries ──────────────────────────────────────────────────
  const { data: categories = [], isLoading, refetch } = useCategories();
  const { data: products = [] } = useProducts();
  const { data: allUsers = [] } = useQuery({
    queryKey: ['company-users-categories', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 120_000,
  });

  // ── Mutations ────────────────────────────────────────────────
  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setForm({ ...CATEGORY_FORM_DEFAULT });
  }

  const saveMut = useMutation({
    mutationFn: async (data: CategoryFormValues) => {
      const payload = {
        name: data.name.trim(),
        description: data.description?.trim() || '',
        parentCategory: data.parentCategory?.trim() || '',
        order: Number(data.order) || 0,
      };
      if (editId) {
        await updateDocById(COLLECTIONS.PRODUCT_CATEGORIES, editId, payload);
        return editId;
      } else {
        const id = genId.generic('CAT');
        await createDocWithId(COLLECTIONS.PRODUCT_CATEGORIES, id, { ...payload, id, createdBy: user?.id || 'system' });
        return id;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product_categories'] });
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).productsRoot });
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).productsAll });
      toast.success(editId ? 'Category updated' : 'Category added');
      closeForm();
    },
    onError: (error: any) => toast.error(error?.message || 'Category save failed'),
  });

  const archiveMut = useMutation({
    mutationFn: async (categoryId: string) => {
      await deleteDocById(COLLECTIONS.PRODUCT_CATEGORIES, categoryId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product_categories'] });
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).productsRoot });
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).productsAll });
      toast.success('Category archived');
      setArchiveId(null);
      closeView();
    },
    onError: (error: any) => toast.error(error?.message || 'Archive failed'),
  });

  const deleteMut = useMutation({
    mutationFn: async (categoryId: string) => {
      if (!isSuperAdmin) throw new Error('Permanent delete is restricted to the Super Admin account.');
      await hardDelete(COLLECTIONS.PRODUCT_CATEGORIES, categoryId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product_categories'] });
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).productsRoot });
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).productsAll });
      toast.success('Category deleted');
      setDelId(null);
      closeView();
    },
    onError: (error: any) => toast.error(error?.message || 'Delete failed'),
  });

  const mergeMut = useMutation({
    mutationFn: async ({ sourceIds, targetId }: { sourceIds: string[]; targetId: string }) => {
      if (!isSuperAdmin) throw new Error('Merging categories permanently deletes the source categories, which is restricted to the Super Admin account.');
      const target = (categories as Category[]).find((c) => c.id === targetId);
      if (!target) throw new Error('Target category not found');
      const sources = (categories as Category[]).filter((c) => sourceIds.includes(c.id) && c.id !== targetId);
      if (!sources.length) throw new Error('Select at least one source category');
      const sourceAliases = new Set(sources.flatMap((s) => categoryKeys(s)));
      const targetPayload = { category: target.name, categoryId: target.id };
      await Promise.all([
        ...(products as Product[])
          .filter((p: any) => sourceAliases.has(normalize(p.categoryId)) || sourceAliases.has(normalize(p.category)))
          .map((p) => updateDocById(COLLECTIONS.PRODUCTS, p.id, targetPayload)),
        ...sources.map((s) => hardDelete(COLLECTIONS.PRODUCT_CATEGORIES, s.id)),
      ]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product_categories'] });
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).productsRoot });
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).productsAll });
      toast.success('Categories merged');
      setShowMerge(false);
      setMergeSourceIds([]);
      setSelected(new Set());
      closeView();
    },
    onError: (error: any) => toast.error(error?.message || 'Merge failed'),
  });

  // ── Computed data ────────────────────────────────────────────
  const productCountMap = useMemo(() => {
    const map = new Map<string, number>();
    (categories as Category[]).forEach((c) => map.set(c.id, categoryProductCount(c, products as Product[])));
    return map;
  }, [categories, products]);

  const parentOptions = useMemo(() => {
    const roots = (categories as Category[])
      .filter((c) => !c.parentCategory)
      .map((c) => ({ label: `${c.name} (Root)`, value: c.name }));
    return [{ label: 'All Parent', value: '' }, { label: 'Root', value: '__root__' }, ...roots];
  }, [categories]);

  const companyOptions = useMemo(() => {
    const ids = Array.from(new Set((categories as any[]).map((c) => String(c.companyId || '')).filter(Boolean)));
    return [
      { label: 'All Companies', value: 'all' },
      ...ids.map((id) => ({ label: id === activeCompanyId ? company?.name || id : id, value: id })),
    ];
  }, [activeCompanyId, categories, company?.name]);

  const userOptions = useMemo(() => {
    return [
      { label: 'All Users', value: '' },
      ...Array.from(new Map((allUsers as any[]).map((u: any) => [u.id, u])).values())
        .filter((u: any) => u.name || u.email)
        .map((u: any) => ({ label: u.name || u.email, value: u.id })),
    ];
  }, [allUsers]);

  // ── Stats (6 KPIs) ──────────────────────────────────────────
  const stats = useMemo(() => {
    const activeCount = (categories as Category[]).filter((c) => (productCountMap.get(c.id) || 0) > 0).length;
    const emptyCount = (categories as Category[]).filter((c) => (productCountMap.get(c.id) || 0) === 0).length;
    const recentCount = (categories as Category[]).filter((c) => isThisMonth(c.createdAt)).length;
    const rootCount = (categories as Category[]).filter((c) => !c.parentCategory).length;
    const totalProducts = (products as Product[]).length;
    return {
      total: categories.length,
      active: activeCount,
      productCount: totalProducts,
      empty: emptyCount,
      recent: recentCount,
      root: rootCount,
    };
  }, [categories, productCountMap, products]);

  // ── Sync helper (no-op when embedded) ───────────────────────
  function syncQueueParams(nextState: {
    q?: string;
    status?: string;
    parent?: string;
    company?: string;
    createdBy?: string;
    date?: string;
    from?: string;
    to?: string;
    kpi?: string;
    page?: number;
    perPage?: number;
  }) {
    if (embedded) return;
    const next = new URLSearchParams(searchParams);
    const q = nextState.q ?? search;
    const status = nextState.status ?? statusF;
    const parent = nextState.parent ?? parentF;
    const company = nextState.company ?? companyF;
    const createdBy = nextState.createdBy ?? createdByF;
    const date = nextState.date ?? dateRange;
    const from = nextState.from ?? customFrom;
    const to = nextState.to ?? customTo;
    const kpi = nextState.kpi ?? activeKpi;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (status) next.set('status', status); else next.delete('status');
    if (parent) next.set('parent', parent); else next.delete('parent');
    if (company && company !== 'all') next.set('company', company); else next.delete('company');
    if (createdBy) next.set('createdBy', createdBy); else next.delete('createdBy');
    if (date && date !== 'all') next.set('date', date); else next.delete('date');
    if (from) next.set('from', from); else next.delete('from');
    if (to) next.set('to', to); else next.delete('to');
    if (kpi) next.set('kpi', kpi); else next.delete('kpi');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== PER_PAGE) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    setSearchParams(next, { replace: true });
  }

  // ── Filtering & sorting ──────────────────────────────────────
  const filtered = useMemo(() => {      const q = (deferredSearch || '').toLowerCase();
      let result = (categories as Category[]).filter((c) => {
      const count = productCountMap.get(c.id) || 0;
      const root = !c.parentCategory;
      const child = !!c.parentCategory;
      const isRecent = isThisMonth(c.createdAt);

      // KPI filter
      const kpiMatch =
        !activeKpi ||
        activeKpi === 'total' ||
        (activeKpi === 'active' && count > 0) ||
        (activeKpi === 'empty' && count === 0) ||
        (activeKpi === 'recent' && isRecent) ||
        (activeKpi === 'root' && root);

      // Status filter
      const statusMatch =
        !statusF ||
        (statusF === 'root' && root) ||
        (statusF === 'child' && child) ||
        (statusF === 'with_products' && count > 0) ||
        (statusF === 'empty' && count === 0);

      // Parent filter
      const parentMatch =
        !parentF ||
        (parentF === '__root__' ? root : matchesCategoryRef(c.parentCategory, { id: parentF, name: parentF } as Category));

      // Company filter
      const companyMatch = companyF === 'all' || normalize(String(c.companyId || '')) === normalize(companyF);

      return (
        (!q || [c.name, c.description, c.parentCategory].some((f) => String(f || '').toLowerCase().includes(q))) &&
        kpiMatch &&
        statusMatch &&
        parentMatch &&
        companyMatch &&
        (!createdByF || c.createdBy === createdByF) &&
        (dateRange === 'all' || withinDateRange(c.createdAt, dateRange))
      );
    });

    result.sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = (a.name || '').localeCompare(b.name || '');
          break;
        case 'parentCategory':
          cmp = (a.parentCategory || '').localeCompare(b.parentCategory || '');
          break;
        case 'productsCount':
          cmp = (productCountMap.get(a.id) || 0) - (productCountMap.get(b.id) || 0);
          break;
        case 'createdAt':
          cmp = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
          break;
      }
      return sortDesc ? -cmp : cmp;
    });

    return result;
  }, [activeKpi, categories, companyF, createdByF, dateRange, deferredSearch, parentF, productCountMap, sortKey, sortDesc, statusF]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / perPage));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page, perPage]);

  const paginated = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page, perPage]);

  // ── URL-driven open ──────────────────────────────────────────
  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    const openId = openParam;
    if (!openId || isLoading) return;
    const target = (categories as Category[]).find((c) => c.id === openId);
    if (!target) return;
    setViewItem(target);
    window.setTimeout(() =>
      document.querySelector(`[data-record-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'center' }),
    0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam, isLoading, categories]);

  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && !statusF && !parentF && companyF === 'all' && !createdByF && dateRange === 'all';
  }, [activeKpi, search, statusF, parentF, companyF, createdByF, dateRange]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusF) count++;
    if (parentF) count++;
    if (companyF !== 'all') count++;
    if (createdByF) count++;
    if (dateRange !== 'all') count++;
    if (activeKpi) count++;
    return count;
  }, [search, statusF, parentF, companyF, createdByF, dateRange, activeKpi]);

  const toggleSelect = useCallback((id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    }),
  []);

  const toggleAll = () =>
    setSelected((s) =>
      s.size === paginated.length ? new Set() : new Set(paginated.map((c: any) => c.id)),
    );
  const allSel = selected.size === paginated.length && paginated.length > 0;

  function closeView() {
    userClosedRef.current = true;
    setViewItem(null);
    if (!openParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }

  function openView(c: Category) {
    userClosedRef.current = false;
    setViewItem(c);
    if (!c?.id || embedded) return;
    const next = new URLSearchParams(searchParams);
    next.set('open', c.id);
    setSearchParams(next, { replace: true });
  }

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, c: Category) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openView(c);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, c: Category) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openView(c);
  }

  function sort(k: string) {
    if (sortKey === k) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(k);
      setSortDesc(true);
    }
  }

  function clearAll() {
    setSearch('');
    setStatusF('');
    setParentF('');
    setCompanyF('all');
    setCreatedByF('');
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
    setActiveKpi('');
    setPage(1);
    syncQueueParams({
      q: '', status: '', parent: '', company: 'all', createdBy: '',
      date: 'all', from: '', to: '', kpi: '', page: 1,
    });
  }

  function openEdit(category: any) {
    closeView();
    setForm({
      name: category.name || '',
      description: category.description || '',
      parentCategory: category.parentCategory || '',
      order: String(category.order || 0),
    });
    setEditId(category.id);
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saveMut.isPending) return;
    if (!form.name) return toast.error('Name required');
    saveMut.mutate(form);
  }

  function exportSelected() {
    const rows = (categories as Category[])
      .filter((c) => selected.has(c.id))
      .map((c) => ({ ...c, productsCount: productCountMap.get(c.id) || 0 }));
    if (!rows.length) return toast.error('No categories selected');
    exportCategoriesCSV(rows);
    setSelected(new Set());
  }

  function openMergeAction(sourceIds: string[]) {
    if (!sourceIds.length) return toast.error('Select at least one category');
    closeView();
    setMergeSourceIds(sourceIds);
    setShowMerge(true);
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // ── Date options ────────────────────────────────────────────
  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: 'week' },
    { label: 'Last 30 days', value: 'month' },
    { label: 'Custom', value: 'custom' },
  ];

  function handleDateChange(newDateRange: string) {
    setDateRange(newDateRange);
    setPage(1);
    if (newDateRange !== 'custom') {
      setCustomFrom('');
      setCustomTo('');
    }
    syncQueueParams({ date: newDateRange, from: '', to: '', page: 1 });
  }

  // ── KPI Tiles ────────────────────────────────────────────────
  const KPI_TILES = [
    { label: 'TOTAL', value: stats.total, key: '', icon: <Layers className="h-4 w-4" />, description: `${stats.total} total categories` },
    { label: 'ACTIVE', value: stats.active, key: 'active', icon: <Tag className="h-4 w-4" />, description: 'Categories with products' },
    { label: 'PRODUCTS', value: stats.productCount, key: 'products', icon: <Package className="h-4 w-4" />, description: 'Total products across categories' },
    { label: 'EMPTY', value: stats.empty, key: 'empty', icon: <Archive className="h-4 w-4" />, description: 'Categories with no products' },
    { label: 'NEW THIS MONTH', value: stats.recent, key: 'recent', icon: <Package className="h-4 w-4" />, description: 'Created in last 30 days' },
    { label: 'ROOT', value: stats.root, key: 'root', icon: <Layers className="h-4 w-4" />, description: 'Top-level categories' },
  ];

  // ── Render ───────────────────────────────────────────────────
  const content = (
    <>
      {/* ── Workspace Hero (only when not embedded) ───────── */}
      {!embedded && (
        <WorkspaceHero
          title="Categories"
          icon={<Tag className="h-6 w-6" />}
          breadcrumbs={['Home', 'Inventory', 'Categories']}
          statusText="Last sync · Realtime Connected"
          statusDotColor="var(--color-success)"
          className="gap-3"            actions={
            <>
              <Button variant="outline" size="sm" onClick={() => navigate('/products')}>
                Products
              </Button>
              <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
                Refresh
              </Button>
              <Button
                size="sm"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => { setForm({ ...CATEGORY_FORM_DEFAULT }); setEditId(null); setShowForm(true); }}
              >
                Add Category
              </Button>
            </>
          }
        />
      )}

      {/* ── Premium Clickable KPI Cards ────────────────────── */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map((k) => (
          <PremiumKpi
            key={k.key}
            label={k.label}
            value={k.value}
            icon={k.icon}
            description={k.description}
            onClick={
              k.key === 'products'
                ? undefined
                : () => {
                    const nextKpi = activeKpi === k.key ? '' : k.key;
                    setActiveKpi(nextKpi);
                    setPage(1);
                    syncQueueParams({ kpi: nextKpi, page: 1 });
                  }
            }
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
          />
        ))}
      </div>

      {/* ── Premium Elevated Table Card ────────────────────── */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] border-[var(--color-border)]">
        {/* ── Card Header with Search + Filters ────────────── */}
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              aria-label="Search categories"
              placeholder="Search name, description..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            <Select
              aria-label="Date"
              value={dateRange}
              options={DATE_OPTIONS}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-[110px] h-8 py-1"
            />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, to: customTo, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, from: customFrom, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
              </div>
            )}
            <Select
              aria-label="Status"
              value={statusF}
              onChange={(e) => {
                const v = e.target.value;
                setStatusF(v);
                if (v && activeKpi && v !== activeKpi) {
                  setActiveKpi('');
                  setPage(1);
                  syncQueueParams({ status: v, kpi: '', page: 1 });
                } else {
                  setPage(1);
                  syncQueueParams({ status: v, page: 1 });
                }
              }}
              options={[
                { label: 'All Status', value: '' },
                { label: 'Root', value: 'root' },
                { label: 'Child', value: 'child' },
                { label: 'With Products', value: 'with_products' },
                { label: 'Empty', value: 'empty' },
              ]}
              className="w-[110px] h-8 py-1"
            />
            <Select
              aria-label="Parent"
              value={parentF}
              onChange={(e) => { setParentF(e.target.value); setPage(1); syncQueueParams({ parent: e.target.value, page: 1 }); }}
              options={parentOptions}
              className="w-[120px] h-8 py-1"
            />
            <Select
              aria-label="Created By"
              value={createdByF}
              onChange={(e) => { setCreatedByF(e.target.value); setPage(1); syncQueueParams({ createdBy: e.target.value, page: 1 }); }}
              options={userOptions}
              className="w-[120px] h-8 py-1"
            />
            {/* Active filter pills + Clear All */}
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">
                    {KPI_TILES.find((t) => t.key === activeKpi)?.label || activeKpi}
                    <button
                      type="button"
                      onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }}
                      className="ml-0.5 hover:opacity-70"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                )}
                {search && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                    S: {search.slice(0, 12)}{search.length > 12 ? '…' : ''}
                  </span>
                )}
                {statusF && !activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{statusF}</span>
                )}
                {parentF && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{parentF}</span>
                )}
                <button
                  type="button"
                  onClick={clearAll}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <X className="h-2.5 w-2.5" />
                  Clear
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            </div>
          </div>
        </CardHeader>

        {/* ── Bulk action bar ──────────────────────────────── */}
        {selected.size > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">
              {selected.size} categor{selected.size > 1 ? 'ies' : 'y'} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button
                size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30"
              >
                Export CSV
              </Button>
              {isSuperAdmin && (
                <Button
                  size="sm" variant="outline"
                  icon={<GitMerge className="h-3.5 w-3.5" />}
                  onClick={() => openMergeAction(Array.from(selected))}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30"
                >
                  Merge
                </Button>
              )}
              {isSuperAdmin && (
                <Button
                  size="sm" variant="outline"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setDelId('__bulk__')}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30"
                >
                  Delete
                </Button>
              )}
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1"
              >
                ✕ Clear
              </button>
            </div>
          </div>
        )}

        {/* ── Table + Pagination (unified) ─────────────────── */}
        <div className="px-6 flex-1 flex flex-col min-h-0">
          <div className="min-h-0 flex-1 overflow-auto scroll-pt-10">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox
                    checked={allSel}
                    indeterminate={selected.size > 0 && !allSel}
                    onChange={toggleAll}
                    ariaLabel="Select visible categories"
                  />
                </Th>
                <Th
                  sortable
                  sorted={sortKey === 'name'}
                  desc={sortDesc}
                  onSort={() => sort('name')}
                  style={{ width: '28%', minWidth: 200 }}
                >
                  CATEGORY
                </Th>
                <Th
                  sortable
                  sorted={sortKey === 'parentCategory'}
                  desc={sortDesc}
                  onSort={() => sort('parentCategory')}
                  style={{ width: '18%', minWidth: 130 }}
                >
                  PARENT
                </Th>
                <Th style={{ width: '22%', minWidth: 150 }}>DESCRIPTION</Th>
                <Th
                  sortable
                  sorted={sortKey === 'productsCount'}
                  desc={sortDesc}
                  onSort={() => sort('productsCount')}
                  style={{ width: 100, minWidth: 100 }}
                >
                  PRODUCTS
                </Th>
                <Th
                  sortable
                  sorted={sortKey === 'createdAt'}
                  desc={sortDesc}
                  onSort={() => sort('createdAt')}
                  style={{ width: 100, minWidth: 100 }}
                >
                  CREATED
                </Th>
                <Th align="right" style={{ width: 120, minWidth: 120 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? (
                  <SkeletonRows cols={7} />
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-14 text-center">
                      <EmptyState
                        icon={<Tag className="h-9 w-9" />}
                        title={
                          search || statusF || parentF
                            ? 'No categories match filters'
                            : 'No categories yet'
                        }
                        description={
                          search || statusF || parentF
                            ? undefined
                            : 'Create your first category to get started.'
                        }
                        action={
                          !search && !statusF && !parentF && !embedded
                            ? (
                              <Button
                                size="sm"
                                icon={<Plus className="h-4 w-4" />}
                                onClick={() => {
                                  setForm({ ...CATEGORY_FORM_DEFAULT });
                                  setEditId(null);
                                  setShowForm(true);
                                }}
                                className="mt-2"
                              >
                                Add Your First Category
                              </Button>
                            )
                            : undefined
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((c: any) => {
                    const count = productCountMap.get(c.id) || 0;
                    return (
                      <Tr
                        key={c.id}
                        selected={selected.has(c.id)}
                        data-record-id={c.id}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => handleRowClick(e, c)}
                        onKeyDown={(e) => handleRowKeyDown(e, c)}
                        className="transition-colors duration-150"
                      >
                        {/* Checkbox */}
                        <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox
                            checked={selected.has(c.id)}
                            onChange={() => toggleSelect(c.id)}
                            ariaLabel={`Select ${c.name}`}
                          />
                        </Td>

                        {/* Name + Avatar */}
                        <Td className="py-3 min-w-[200px]">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                              {(c.name || '?')[0].toUpperCase()}
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{c.name || '—'}</span>
                              {!c.parentCategory && (
                                <span className="text-[10px] text-[var(--color-text-muted)]">Root</span>
                              )}
                            </div>
                          </div>
                        </Td>

                        {/* Parent Category */}
                        <Td className="py-3">
                          {c.parentCategory ? (
                            <span className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
                              {c.parentCategory}
                            </span>
                          ) : (
                            <span className="text-[11px] text-[var(--color-text-disabled)]">—</span>
                          )}
                        </Td>

                        {/* Description */}
                        <Td className="py-3 max-w-[250px]">
                          <span className="block truncate text-xs text-[var(--color-text-muted)]" title={c.description || ''}>
                            {c.description || <span className="text-[var(--color-text-disabled)]">—</span>}
                          </span>
                        </Td>

                        {/* Products Count */}
                        <Td className="py-3">
                          <Badge variant={count > 0 ? 'success' : 'gray'}>{count}</Badge>
                        </Td>

                        {/* Created */}
                        <Td className="py-3">
                          <div className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                            <span className={`h-1.5 w-1.5 rounded-full ${recencyDotClass(c.createdAt)}`} />
                            {formatDate(c.createdAt)}
                          </div>
                        </Td>

                        {/* Actions */}
                        <Td className="py-3" align="right">
                          <Button
                            size="xs"
                            variant="outline"
                            icon={<Eye className="h-3 w-3" />}
                            onClick={(e) => { e.stopPropagation(); openView(c); }}
                            data-action
                          >
                            View
                          </Button>
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </Tbody>
            </Table>
          </div>

          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination
              page={page}
              total={filtered.length}
              perPage={perPage}
              onChange={(nextPage) => { setPage(nextPage); syncQueueParams({ page: nextPage }); }}
              onPerPageChange={(n) => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }}
            />
          </div>
        </div>
      </Card>

      {/* ── Category Form Modal ──────────────────────────────── */}
      <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit Category' : 'Add Category'} size="sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Name *</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Solar Panels"
              className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Category description..."
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] min-h-[60px]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Parent Category</label>
            <input
              value={form.parentCategory}
              onChange={(e) => setForm({ ...form, parentCategory: e.target.value })}
              placeholder="Leave empty for root"
              className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Order</label>
            <input
              type="number" min="0"
              value={form.order}
              onChange={(e) => setForm({ ...form, order: e.target.value })}
              placeholder="0"
              className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={closeForm}>Cancel</Button>
            <Button type="submit" loading={saveMut.isPending}>
              {editId ? 'Update' : 'Add Category'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Category Details Modal ──────────────────────────── */}
      <CategoryDetailsModal
        key={viewItem?.id || 'category-modal-closed'}
        open={!!viewItem}
        category={viewItem}
        categories={categories as Category[]}
        products={products as Product[]}
        companyLabel={company?.name || activeCompanyId || 'Current Company'}
        onClose={closeView}
        onEdit={(category) => openEdit(category)}
        onArchive={(category) => { setArchiveId(category.id); closeView(); }}
        onDelete={(category) => { setDelId(category.id); closeView(); }}
        onMerge={(categoryIds) => openMergeAction(categoryIds)}
        canDelete={isSuperAdmin}
      />

      {/* ── Merge Modal ─────────────────────────────────────── */}
      <CategoryMergeModal
        open={showMerge}
        sourceIds={mergeSourceIds}
        categories={categories as Category[]}
        onClose={() => { setShowMerge(false); setMergeSourceIds([]); }}
        onConfirm={(targetId) => mergeMut.mutate({ sourceIds: mergeSourceIds, targetId })}
        loading={mergeMut.isPending}
      />

      {/* ── Archive Confirmation ────────────────────────────── */}
      <ConfirmDialog
        open={!!archiveId}
        onClose={() => setArchiveId(null)}
        onConfirm={() => archiveId && archiveMut.mutate(archiveId)}
        loading={archiveMut.isPending}
        title="Archive Category"
        message="Archive this category? It will be removed from the active list but linked products will remain intact."
      />

      {/* ── Delete Confirmation ─────────────────────────────── */}
      <ConfirmDialog
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={async () => {
          if (!delId) return;
          try {
            if (delId === '__bulk__') {
              if (!isSuperAdmin) throw new Error('Permanent delete is restricted to the Super Admin account.');
              const ids = Array.from(selected);
              await Promise.all(ids.map((id) => hardDelete(COLLECTIONS.PRODUCT_CATEGORIES, id)));
              qc.invalidateQueries({ queryKey: ['product_categories'] });
              toast.success(`Deleted ${ids.length} categories`);
              setSelected(new Set());
            } else {
              await deleteMut.mutateAsync(delId);
            }
            setDelId(null);
          } catch (error: any) {
            toast.error(error?.message || 'Delete failed');
          }
        }}
        loading={deleteMut.isPending}
        title={delId === '__bulk__' ? 'Delete Categories' : 'Delete Category'}
        message={
          delId === '__bulk__'
            ? `Delete ${selected.size} categories? Products will not be deleted.`
            : 'Delete this category? Only allowed when no child categories or linked products remain.'
        }
      />
    </>
  );

  // ── When embedded, only the card content (no outer wrapper)
  if (embedded) {
    return content;
  }

  // ── Standalone page wrapper (Type A scroll architecture)
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {content}
    </div>
  );
}

export default function Categories() {
  return <CategoriesWorkspace />;
}
