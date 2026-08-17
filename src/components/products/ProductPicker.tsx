import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Camera } from 'lucide-react';
import { COLLECTIONS, db } from '../../lib/firebase';
import { fmtCurrency, resolveWriteCompanyId } from '../../lib/firestore';
import { useAppStore } from '../../store/useAppStore';
import type { Product } from '../../types';
import { SearchInput } from '../ui/Input';

export type ProductPickerValue = {
  productId: string;
  product: string;
  category: string;
  price: number;
  tax: number;
  unit: string;
  specs: Record<string, unknown>;
  photos: string[];
};

type Props = {
  value?: string;
  onSelect: (value: ProductPickerValue) => void;
  category?: string;
};

export function ProductPicker({ value, onSelect, category }: Props) {
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const company = useAppStore((state) => state.company);
  const user = useAppStore((state) => state.user);
  const companyId = resolveWriteCompanyId();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(search), 250);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setLoading(true);
    getDocs(query(
      collection(db, COLLECTIONS.PRODUCTS),
      where('companyId', '==', companyId),
      where('isDeleted', '==', false),
    ))
      .then((snap) => {
        if (cancelled) return;
        setProducts(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Product)));
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyId]);

  const filtered = useMemo(() => {
    const q = debounced.toLowerCase();
    return products
      .filter((product) => product.status !== 'Inactive')
      .filter((product) => !category || product.category === category)
      .filter((product) => !q || [product.name, product.category, product.sku].some((field) => String(field || '').toLowerCase().includes(q)))
      .slice(0, 8);
  }, [category, debounced, products]);

  return (
    <div className="space-y-2">
      <SearchInput value={search} onChange={setSearch} placeholder="Search products..." />
      <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {loading ? (
          <p className="px-3 py-4 text-sm text-[var(--color-text-muted)]">Loading products...</p>
        ) : filtered.length ? filtered.map((product) => {
          const photos = product.photos || [];
          const selected = value === product.id;
          return (
            <button
              key={product.id}
              type="button"
              onClick={() => onSelect({
                productId: product.id,
                product: product.name,
                category: product.category,
                price: Number(product.price) || 0,
                tax: Number(product.tax) || 0,
                unit: product.unit || 'PCS',
                specs: product.specs || {},
                photos,
              })}
              className={`flex w-full items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--color-surface-hover)] ${selected ? 'bg-[var(--color-bg-sunken)]' : ''}`}
            >
              {photos[0] ? (
                <img src={photos[0]} alt={product.name} className="h-10 w-10 rounded-md border border-[var(--color-border)] object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]">
                  <Camera className="h-4 w-4" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[var(--color-text)]">{product.name}</span>
                <span className="block truncate text-xs text-[var(--color-text-muted)]">{product.category || '-'} • {fmtCurrency(product.price || 0)}</span>
              </span>
            </button>
          );
        }) : (
          <p className="px-3 py-4 text-sm text-[var(--color-text-muted)]">No products found.</p>
        )}
      </div>
    </div>
  );
}
