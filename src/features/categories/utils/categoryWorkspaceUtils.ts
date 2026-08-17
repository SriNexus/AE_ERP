import toast from 'react-hot-toast';

import type { Product } from '../../../types';
import type { Category } from '../types';

export const DATE_RANGE_OPTIONS = [
  { label: 'All Time', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This Week', value: 'this_week' },
  { label: 'This Month', value: 'this_month' },
  { label: 'This Year', value: 'this_year' },
];

export function normalize(value?: string) {
  return String(value || '').trim().toLowerCase();
}

export function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString('en-GB') : '—';
}

export function formatTime(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
}

export function daysAgoText(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'Not available';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(date); then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function recencyDotClass(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'bg-[var(--color-text-disabled)]';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const created = new Date(date); created.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86400000));
  if (days === 0) return 'bg-emerald-500';
  if (days <= 7) return 'bg-blue-500';
  if (days <= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

export function withinDateRange(value: any, range: string): boolean {
  const date = toDateValue(value);
  if (!date || !range || range === 'all') return true;
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.max(0, Math.floor((startOfToday.getTime() - new Date(date).setHours(0, 0, 0, 0)) / 86400000));
  if (range === 'today') return diffDays === 0;
  if (range === 'yesterday') return diffDays === 1;
  if (range === 'this_week') return diffDays <= 7;
  if (range === 'this_month') return diffDays <= 30;
  if (range === 'this_year') return date.getFullYear() === now.getFullYear();
  return true;
}

export function categoryKeys(category: Partial<Category>) {
  return [category.id, category.name, category.parentCategory].map(normalize).filter(Boolean);
}

export function matchesCategoryRef(value: string | undefined, category: Partial<Category>) {
  const keys = new Set(categoryKeys(category));
  return keys.has(normalize(value));
}

export function categoryProductCount(category: Category, products: Product[]) {
  const aliases = new Set(categoryKeys(category));
  return products.filter((product: any) => aliases.has(normalize(product.categoryId)) || aliases.has(normalize(product.category))).length;
}

export function collectDescendantIds(source: Category, categories: Category[]): Set<string> {
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

export function exportCategoriesCSV(rows: any[]) {
  const csvRows = [
    ['ID', 'Name', 'Parent', 'Description', 'Products', 'Order', 'Created'],
    ...rows.map((row) => [
      row.id,
      row.name,
      row.parentCategory || '',
      String(row.description || '').replace(/\n/g, ' '),
      row.productsCount ?? 0,
      row.order ?? 0,
      formatDate(row.createdAt),
    ]),
  ];
  const blob = new Blob([csvRows.map((row) => row.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'product-categories.csv';
  a.click();
  toast.success('Exported');
}
