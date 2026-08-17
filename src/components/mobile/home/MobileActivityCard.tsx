import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  limit as limitQuery,
  onSnapshot,
  query,
  where,
  type DocumentData,
} from 'firebase/firestore';
import { CheckCircle2, Clock, FileText, RefreshCw, ShoppingCart, Truck } from 'lucide-react';
import { Button } from '../../ui';
import { COLLECTIONS, db } from '../../../lib/firebase';
import { MobileHomeCard, MobileHomeEmptyState, MobileHomeSkeletonRows } from './MobileHomeCard';

type ActivityItem = DocumentData & { id: string };

function toDate(value: unknown): Date {
  if (value && typeof value === 'object') {
    const maybeTimestamp = value as { toDate?: unknown; seconds?: unknown };
    if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate() as Date;
    if (maybeTimestamp.seconds !== undefined) return new Date(Number(maybeTimestamp.seconds) * 1000);
  }
  const parsed = value ? new Date(String(value)) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function relativeTime(date: Date) {
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function iconFor(action: string) {
  const value = action.toLowerCase();
  if (value.includes('dispatch')) return <Truck className="h-4 w-4" />;
  if (value.includes('order')) return <ShoppingCart className="h-4 w-4" />;
  if (value.includes('invoice') || value.includes('pi')) return <FileText className="h-4 w-4" />;
  if (value.includes('approve') || value.includes('convert')) return <CheckCircle2 className="h-4 w-4" />;
  return <RefreshCw className="h-4 w-4" />;
}

export function MobileActivityCard({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(
      query(collection(db, COLLECTIONS.AUDIT_LOGS), where('companyId', '==', companyId), limitQuery(50)),
      (snap) => {
        setItems(
          snap.docs
            .map((docSnap): ActivityItem => ({ id: docSnap.id, ...docSnap.data() }))
            .filter((item) => item.isDeleted !== true)
            .sort((a, b) => toDate(b.createdAt || b.date).getTime() - toDate(a.createdAt || a.date).getTime())
            .slice(0, 5)
        );
        setLoading(false);
      },
      () => setLoading(false)
    );

    return unsub;
  }, [companyId]);

  return (
    <MobileHomeCard
      title="Recent Activity"
      bodyClassName="p-0"
      actions={(
        <Button size="xs" variant="ghost" className="min-h-8 px-2" onClick={() => navigate('/recent')}>
          View All
        </Button>
      )}
    >
      {loading ? (
        <div className="px-3"><MobileHomeSkeletonRows count={5} /></div>
      ) : items.length === 0 ? (
        <MobileHomeEmptyState
          icon={<Clock className="h-5 w-5" />}
          title="No activity yet"
          description="Updates from leads, orders, invoices, and dispatch will appear here."
        />
      ) : (
        <div className="divide-y divide-[var(--color-border-subtle)] px-3">
          {items.map((item) => {
            const actionLabel = item.actionLabel || item.metadata?.actionLabel || item.action || 'Activity';
            const date = toDate(item.createdAt || item.date);
            return (
              <div key={item.id} className="flex min-h-[68px] items-center gap-3 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-sunken)] text-[var(--color-primary)] ring-1 ring-[var(--color-border)]">
                  {iconFor(String(actionLabel))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[var(--color-text)]">
                    <span className="font-semibold">{item.userName || item.actorName || 'System'}</span>
                    <span className="text-[var(--color-text-muted)]"> {actionLabel}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                    {item.entityName || item.metadata?.entityName || item.entityId || 'ERP activity'} · {relativeTime(date)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </MobileHomeCard>
  );
}
