import React, { useEffect, useState } from 'react';
import { Archive, Edit2, GitMerge, Package, Trash2, X } from 'lucide-react';

import { RowViewAction } from '../../../components/shared';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import type { Product } from '../../../types';
import type { Category } from '../types';
import { categoryProductCount, formatDate, formatTime, matchesCategoryRef } from '../utils/categoryWorkspaceUtils';
export function CategoryActionStrip({ onView }: { onView: () => void }) {
  return <RowViewAction onView={onView} />;
}

export function CategoryDetailsModal({
  open,
  category,
  categories,
  products,
  companyLabel,
  onClose,
  onEdit,
  onArchive,
  onDelete,
  onMerge,
  canDelete = true,
}: {
  open: boolean;
  category: Category | null;
  categories: Category[];
  products: Product[];
  companyLabel: string;
  onClose: () => void;
  onEdit: (category: Category) => void;
  onArchive: (category: Category) => void;
  onDelete: (category: Category) => void;
  onMerge: (categoryIds: string[]) => void;
  /** Permanent delete/merge are Super-Admin-only (Blueprint Phase 13 §13) — hide those actions for everyone else. */
  canDelete?: boolean;
}) {
  const [tab, setTab] = useState<'overview' | 'products' | 'history'>('overview');

  useEffect(() => {
    if (open) setTab('overview');
  }, [open, category?.id]);

  if (!open || !category) return null;

  const relatedProducts = products.filter((product: any) => matchesCategoryRef(product.categoryId || product.category, category));
  const childCategories = categories.filter((candidate) => candidate.id !== category.id && matchesCategoryRef(candidate.parentCategory, category));
  const rootCategory = !category.parentCategory;
  const logs = [
    { type: 'Created', desc: 'Category record created', date: category.createdAt, userName: category.createdBy || 'System' },
    ...(category.updatedAt ? [{ type: 'Updated', desc: 'Category was updated', date: category.updatedAt, userName: category.updatedBy || category.createdBy || 'System' }] : []),
    ...(relatedProducts.length ? [{ type: 'Products', desc: `${relatedProducts.length} linked product${relatedProducts.length === 1 ? '' : 's'}`, date: category.updatedAt || category.createdAt, userName: 'System' }] : []),
    ...(childCategories.length ? [{ type: 'Hierarchy', desc: `${childCategories.length} child categorie${childCategories.length === 1 ? 'y' : 's'}`, date: category.updatedAt || category.createdAt, userName: 'System' }] : []),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-xs text-[var(--color-text-muted)]">Category management workspace</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => { onClose(); onEdit(category); }}>Edit</Button>
            {canDelete && <Button variant="outline" size="sm" icon={<GitMerge className="h-3.5 w-3.5" />} onClick={() => onMerge([category.id])}>Merge</Button>}
            <Button variant="outline" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => onArchive(category)}>Archive</Button>
            {canDelete && <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onDelete(category)}>Delete</Button>}
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    >
      <div className="flex h-[78vh] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
        <header className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-sunken)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
              {(category.name || category.id || '?')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{category.name}</h2>
                <Badge variant="gray">{rootCategory ? 'Root' : 'Child'}</Badge>
                <Badge variant={categoryProductCount(category, products) > 0 ? 'success' : 'gray'}>
                  {categoryProductCount(category, products)} product{categoryProductCount(category, products) === 1 ? '' : 's'}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                <span>Parent: {category.parentCategory || 'Root'}</span>
                <span>Company: {companyLabel}</span>
                <span>Created: {formatDate(category.createdAt)}</span>
                <span>Updated: {formatDate(category.updatedAt || category.createdAt)}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-start justify-end gap-2" data-action>
            <Button variant="outline" size="sm" icon={<Package className="h-3.5 w-3.5" />} onClick={() => setTab('products')}>View Products</Button>
            {canDelete && <Button variant="outline" size="sm" icon={<GitMerge className="h-3.5 w-3.5" />} onClick={() => onMerge([category.id])}>Merge</Button>}
            <button onClick={onClose} aria-label="Close category details" className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <nav className="shrink-0 grid grid-cols-3 gap-1 border-b border-[var(--color-border-subtle)] py-4">
          {(['overview', 'products', 'history'] as const).map((current) => (
            <button
              key={current}
              type="button"
              onClick={() => setTab(current)}
              className={[
                'rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors',
                tab === current
                  ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
              ].join(' ')}
            >
              {current === 'overview' ? 'Overview' : current === 'products' ? 'Products' : 'History'}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto transition-opacity duration-150">
          {tab === 'overview' && (
            <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-5">
                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Overview</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Info label="Category Name" value={category.name} />
                    <Info label="Parent Category" value={category.parentCategory || 'Root'} />
                    <Info label="Company" value={companyLabel} />
                    <Info label="Products Count" value={categoryProductCount(category, products)} />
                    <Info label="Created" value={formatDate(category.createdAt)} />
                    <Info label="Created Time" value={formatTime(category.createdAt)} />
                  </div>
                </section>

                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Hierarchy</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Info label="Level" value={rootCategory ? 'Root Category' : 'Child Category'} />
                    <Info label="Child Categories" value={childCategories.length} />
                    <Info label="Linked Products" value={relatedProducts.length} />
                    <Info label="Circular Safe" value="Validated in form" />
                  </div>
                </section>

                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Description</h3>
                  {category.description ? (
                    <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[var(--color-bg-sunken)] p-4 leading-relaxed text-[var(--color-text)]">{category.description}</p>
                  ) : (
                    <p className="mt-3 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-3 py-4 text-sm text-[var(--color-text-muted)]">No description added.</p>
                  )}
                </section>

                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes</h3>
                  <p className="mt-3 rounded-xl bg-[var(--color-bg-sunken)] p-4 text-[var(--color-text)]">
                    {category.description || 'No dedicated notes field exists yet. Description is used as the operational note.'}
                  </p>
                </section>
              </div>

              <aside className="space-y-4">
                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Quick Actions</h3>
                  <div className="mt-3 space-y-2">
                    <Button className="w-full justify-start" variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => { onClose(); onEdit(category); }}>Edit</Button>
                    {canDelete && <Button className="w-full justify-start" variant="outline" size="sm" icon={<GitMerge className="h-3.5 w-3.5" />} onClick={() => onMerge([category.id])}>Merge</Button>}
                    <Button className="w-full justify-start" variant="outline" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => onArchive(category)}>Archive</Button>
                    {canDelete && <Button className="w-full justify-start" variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onDelete(category)}>Delete</Button>}
                  </div>
                </section>

                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Summary</h3>
                  <div className="mt-3 space-y-2">
                    <Info label="Products" value={relatedProducts.length} />
                    <Info label="Children" value={childCategories.length} />
                    <Info label="Last Updated" value={formatDate(category.updatedAt || category.createdAt)} />
                  </div>
                </section>
              </aside>
            </div>
          )}

          {tab === 'products' && (
            <div className="pt-5">
              <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Linked Products</h3>
                <div className="mt-3 overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
                  <div className="grid grid-cols-4 gap-2 bg-[var(--color-bg-sunken)] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                    <span>Product</span>
                    <span>SKU</span>
                    <span>Price</span>
                    <span>Status</span>
                  </div>
                  {relatedProducts.length ? relatedProducts.map((product) => (
                    <div key={product.id} className="grid grid-cols-4 border-t border-[var(--color-border-subtle)] px-3 py-3 text-sm text-[var(--color-text)]">
                      <span className="truncate font-medium">{product.name}</span>
                      <span className="truncate text-[var(--color-text-muted)]">{product.sku || '—'}</span>
                      <span className="text-[var(--color-text-muted)]">{Number(product.price) || 0}</span>
                      <span><Badge variant={product.status === 'Inactive' ? 'gray' : 'success'}>{product.status || 'Active'}</Badge></span>
                    </div>
                  )) : (
                    <div className="px-3 py-4 text-sm text-[var(--color-text-muted)]">No linked products yet.</div>
                  )}
                </div>
              </section>
            </div>
          )}

          {tab === 'history' && (
            <div className="pt-5">
              <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
                <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Activity</h3>
                <div className="mt-3 space-y-3">
                  {logs.length ? logs.map((log, idx) => (
                    <div key={`${log.type}-${idx}`} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-[var(--color-text)]">{log.type}</p>
                          <time className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">{formatDate(log.date)} {formatTime(log.date)}</time>
                        </div>
                        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{log.desc}</p>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{log.userName || 'System'}</p>
                      </div>
                    </div>
                  )) : <span className="text-[var(--color-text-muted)]">No activity recorded yet.</span>}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function CategoryMergeModal({
  open,
  sourceIds,
  categories,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean;
  sourceIds: string[];
  categories: Category[];
  onClose: () => void;
  onConfirm: (targetId: string) => void;
  loading: boolean;
}) {
  const [targetId, setTargetId] = useState('');

  useEffect(() => {
    if (open) setTargetId('');
  }, [open, sourceIds.join('|')]);

  const sourceLabels = categories.filter((category) => sourceIds.includes(category.id)).map((category) => category.name).filter(Boolean);
  const targetOptions = categories.filter((category) => !sourceIds.includes(category.id)).map((category) => ({ label: category.name, value: category.id }));

  return (
    <Modal open={open} onClose={onClose} title="Merge Categories" size="md">
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Merge {sourceLabels.length ? sourceLabels.join(', ') : 'selected categories'} into a target category. Products and child categories will be moved first.
        </p>
        <Select
          label="Target Category"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          options={[{ label: 'Select target category', value: '' }, ...targetOptions]}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={loading} disabled={!targetId} onClick={() => onConfirm(targetId)}>Merge</Button>
        </div>
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-[var(--color-text)]">{value}</div>
    </div>
  );
}

