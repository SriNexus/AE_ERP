import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  limit as limitQuery,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore';
import { CheckCircle2, Clock, FileText, RefreshCw, ShoppingCart, Truck } from 'lucide-react';
import { COLLECTIONS, db, firebaseEnv } from '../../lib/firebase';
import { getAll } from '../../lib/firestore';

type ActivityItem = DocumentData & { id: string };

type Props = {
  entityId?: string;
  companyId: string;
  limit?: number;
  mode?: 'entity' | 'global';
  title?: string;
};

function toDate(value: unknown): Date {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate();
  if (value && typeof value === 'object' && 'seconds' in value) return new Date(Number(value.seconds) * 1000);
  const parsed = value ? new Date(String(value)) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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

function ActivitySkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex gap-3">
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[var(--color-bg-sunken)]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--color-bg-sunken)]" />
            <div className="h-2 w-1/3 animate-pulse rounded bg-[var(--color-bg-sunken)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ActivityTimeline({ entityId, companyId, limit = 20, mode = 'entity', title = 'Activity Feed' }: Props) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId || (mode === 'entity' && !entityId)) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const sourceUpdates = new Map<string, Map<string, ActivityItem>>();
    const applySnapshot = (source: string, docs: ActivityItem[]) => {
      sourceUpdates.set(source, new Map(docs.map((item) => [item.id, item])));
      const merged = new Map<string, ActivityItem>();
      sourceUpdates.forEach((sourceMap) => {
        sourceMap.forEach((item, id) => {
          if (item.isDeleted !== true) merged.set(id, item);
        });
      });
      setItems(
        Array.from(merged.values())
          .sort((a, b) => toDate(b.createdAt || b.date).getTime() - toDate(a.createdAt || a.date).getTime())
          .slice(0, limit)
      );
      setLoading(false);
    };

    if (!firebaseEnv.isConfigured) {
      let active = true;
      void getAll<ActivityItem>(COLLECTIONS.AUDIT_LOGS)
        .then((rows) => {
          if (!active) return;
          const filtered = rows.filter((item) => {
            if (item.isDeleted === true) return false;
            if (mode === 'global') return item.companyId === companyId;
            return item.entityId === entityId || item.primary?.id === entityId;
          });
          applySnapshot('demo', filtered);
        })
        .catch(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }

    const base = collection(db, COLLECTIONS.AUDIT_LOGS);
    const unsubscribers: Array<() => void> = [];
    const subscribe = (source: string, constraints: QueryConstraint[]) => {
      const unsub = onSnapshot(
        query(base, ...constraints),
        (snap) => applySnapshot(source, snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))),
        () => setLoading(false)
      );
      unsubscribers.push(unsub);
    };

    if (mode === 'global') {
      subscribe('company', [where('companyId', '==', companyId), limitQuery(Math.max(limit, 50))]);
    } else {
      subscribe('entityId', [where('entityId', '==', entityId), limitQuery(limit)]);
      subscribe('primaryId', [where('primary.id', '==', entityId), limitQuery(limit)]);
    }

    return () => unsubscribers.forEach((unsub) => unsub());
  }, [companyId, entityId, limit, mode]);

  const grouped = useMemo(() => items.reduce<Record<string, ActivityItem[]>>((acc, item) => {
    const label = dayLabel(toDate(item.createdAt || item.date));
    acc[label] = acc[label] || [];
    acc[label].push(item);
    return acc;
  }, {}), [items]);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
        <h3 className="text-sm font-bold text-[var(--color-text)]">{title}</h3>
      </div>
      <div className="max-h-[520px] overflow-y-auto p-4">
        {loading ? <ActivitySkeleton /> : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Clock className="h-8 w-8 text-[var(--color-text-disabled)]" />
            <p className="text-sm text-[var(--color-text-muted)]">No activity yet.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([label, group]) => (
              <section key={label}>
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
                <div className="space-y-3">
                  {group.map((item) => {
                    const actionLabel = item.actionLabel || item.metadata?.actionLabel || item.action || 'Activity';
                    const date = toDate(item.createdAt || item.date);
                    return (
                      <div key={item.id} className="flex gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-sunken)] text-[var(--color-primary)] ring-1 ring-[var(--color-border)]">
                          {iconFor(String(actionLabel))}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-[var(--color-text)]">
                            <span className="font-semibold">{item.userName || item.actorName || 'System'}</span>
                            <span className="text-[var(--color-text-muted)]"> {actionLabel}</span>
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                            {item.entityName || item.metadata?.entityName || item.entityId || ''} · {relativeTime(date)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
