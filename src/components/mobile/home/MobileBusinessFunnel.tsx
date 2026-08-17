import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  CreditCard,
  FileText,
  Flame,
  Handshake,
  ReceiptText,
  PackageCheck,
  ShoppingCart,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { MobileHomeCard } from './MobileHomeCard';

type WorkflowCounts = {
  newLeads: number;
  quotations: number;
  orders: number;
  invoices: number;
  pendingPayments: number;
  dispatched: number;
  installed: number;
  completed: number;
};

type Stage = {
  key: keyof WorkflowCounts;
  label: string;
  route: string;
  icon: LucideIcon;
  description: string;
  /** VALID: fixed per-stage identity accent — built only from existing design tokens
   *  (var(--color-*) / color-mix()), never a raw hex. Each stage keeps the same semantic
   *  hue the original gradient used (e.g. Lead = primary, Payment = warning), so the
   *  redesign stays recognizable rather than being arbitrarily recoloured. */
  accent: string;
};

const STAGES: Stage[] = [
  {
    key: 'newLeads',
    label: 'Lead',
    route: '/leads',
    icon: Handshake,
    description: 'New inquiries, not yet contacted',
    accent: 'var(--color-primary)',
  },
  {
    key: 'quotations',
    label: 'Quotation',
    route: '/quotations',
    icon: FileText,
    description: 'Quotes sent, awaiting response',
    accent: 'var(--color-info)',
  },
  {
    key: 'orders',
    label: 'Order',
    route: '/orders',
    icon: ShoppingCart,
    description: 'Confirmed and moving to fulfilment',
    accent: 'var(--color-success)',
  },
  {
    key: 'invoices',
    label: 'Invoice',
    route: '/invoices',
    icon: ReceiptText,
    description: 'Billed, awaiting settlement',
    accent: 'color-mix(in srgb, var(--color-info) 56%, var(--color-primary) 44%)',
  },
  {
    key: 'pendingPayments',
    label: 'Payment',
    route: '/payments',
    icon: CreditCard,
    description: 'Payments due or in process',
    accent: 'var(--color-warning)',
  },
  {
    key: 'dispatched',
    label: 'Dispatch',
    route: '/dispatch',
    icon: Truck,
    description: 'Materials on the way to site',
    accent: 'var(--color-danger)',
  },
  {
    key: 'installed',
    label: 'Installation',
    route: '/dispatch',
    icon: PackageCheck,
    description: 'On-site installation underway',
    accent: 'color-mix(in srgb, var(--color-primary) 82%, var(--color-info) 18%)',
  },
  {
    key: 'completed',
    label: 'Completed',
    route: '/orders',
    icon: CheckCircle2,
    description: 'Delivered and closed out',
    accent: 'var(--color-text-secondary)',
  },
];

/** Share of the total pipeline this stage represents right now — always a sane 0–100%.
 *  Replaces the old stage-over-previous-stage "conversion" math, which could exceed 100%
 *  whenever a later stage held more items than the one before it (see chat notes). */
function sharePercent(count: number, total: number): number {
  if (!total || total <= 0 || count <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((count / total) * 100)));
}

function FunnelSkeleton() {
  return (
    <div className="flex flex-col">
      {STAGES.map((stage, i) => (
        <div key={stage.key} className="flex gap-3">
          <div className="flex w-9 shrink-0 flex-col items-center">
            {i > 0 && <span className="h-2.5 w-px bg-[var(--color-border)]" />}
            <div className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-[var(--color-bg-sunken)]" />
            {i < STAGES.length - 1 && <span className="min-h-[26px] w-px flex-1 bg-[var(--color-border)]" />}
          </div>
          <div className="mb-3 h-[64px] flex-1 animate-pulse rounded-2xl bg-[var(--color-bg-sunken)]" />
        </div>
      ))}
    </div>
  );
}

export function MobileBusinessFunnel({
  counts,
  loading,
}: {
  counts: WorkflowCounts;
  loading?: boolean;
}) {
  const navigate = useNavigate();

  const total = useMemo(
    () => STAGES.reduce((sum, stage) => sum + (counts[stage.key] || 0), 0),
    [counts]
  );

  // VALID: "bottleneck" = the stage carrying the most active items right now (ties → earliest
  // stage). Purely derived from `counts` at render time — no new data source, no stored state.
  const bottleneck = useMemo(() => {
    let max = 0;
    let found: Stage | null = null;
    for (const stage of STAGES) {
      const c = counts[stage.key] || 0;
      if (c > max) {
        max = c;
        found = stage;
      }
    }
    return found;
  }, [counts]);

  return (
    <MobileHomeCard
      title="Business Funnel"
      bodyClassName="px-3 py-4"
      actions={
        <span className="rounded-full bg-[var(--color-bg-sunken)] px-2.5 py-1 text-xs font-bold text-[var(--color-text-muted)]">
          {total}
        </span>
      }
    >
      {loading ? (
        <FunnelSkeleton />
      ) : (
        <div className="flex flex-col">
          {bottleneck && (
            <div
              className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2.5"
              style={{ background: `color-mix(in srgb, ${bottleneck.accent} 8%, var(--color-bg-sunken))` }}
            >
              <Flame className="h-3.5 w-3.5 shrink-0" style={{ color: bottleneck.accent }} />
              <p className="min-w-0 flex-1 truncate text-xs font-bold" style={{ color: bottleneck.accent }}>
                Bottleneck: {bottleneck.label} · {counts[bottleneck.key] || 0} item{(counts[bottleneck.key] || 0) === 1 ? '' : 's'} waiting
              </p>
            </div>
          )}

          {STAGES.map((stage, i) => {
            const Icon = stage.icon;
            const count = counts[stage.key] || 0;
            const isActive = count > 0;
            const isBottleneck = bottleneck?.key === stage.key;
            const isLast = i === STAGES.length - 1;
            const prevActive = i > 0 && (counts[STAGES[i - 1].key] || 0) > 0;
            const percent = sharePercent(count, total);
            const beadSize = isBottleneck ? 34 : isActive ? 26 : 22;

            return (
              <div key={stage.key} className="relative flex gap-3">
                {/* ─── Connecting rail ─── */}
                <div className="flex w-9 shrink-0 flex-col items-center">
                  {i > 0 && (
                    <span
                      className="h-2.5 w-px transition-colors duration-500"
                      style={{ background: prevActive ? STAGES[i - 1].accent : 'var(--color-border)', opacity: prevActive ? 0.55 : 1 }}
                    />
                  )}

                  <span
                    className="relative flex shrink-0 items-center justify-center rounded-full transition-all duration-300"
                    style={{
                      width: beadSize,
                      height: beadSize,
                      background: isActive ? stage.accent : 'var(--color-surface)',
                      border: isActive ? 'none' : '2px solid var(--color-border)',
                      boxShadow: isBottleneck ? `0 0 0 6px color-mix(in srgb, ${stage.accent} 18%, transparent)` : 'none',
                    }}
                  >
                    {isBottleneck && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full animate-pulse motion-reduce:animate-none"
                        style={{ background: stage.accent, opacity: 0.3 }}
                      />
                    )}
                    <Icon
                      className={`relative ${isBottleneck ? 'h-4 w-4' : isActive ? 'h-3.5 w-3.5' : 'h-3 w-3'}`}
                      style={{ color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-disabled)' }}
                    />
                  </span>

                  {!isLast && (
                    <span
                      className="min-h-[26px] w-px flex-1 transition-colors duration-500"
                      style={{ background: isActive ? stage.accent : 'var(--color-border)', opacity: isActive ? 0.55 : 1 }}
                    />
                  )}
                </div>

                {/* ─── Stage card ─── */}
                <button
                  type="button"
                  onClick={() => navigate(stage.route)}
                  title={`${stage.label}: ${count} ${count === 1 ? 'item' : 'items'} — tap to view`}
                  className={[
                    'mb-3 min-h-[64px] flex-1 rounded-2xl p-3.5 text-left transition-all duration-200 ease-out active:scale-[0.98]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
                    isBottleneck
                      ? 'border shadow-md'
                      : isActive
                        ? 'border border-[var(--color-border)] bg-[var(--color-surface)] active:bg-[var(--color-surface-hover)]'
                        : 'border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/60',
                  ].join(' ')}
                  style={
                    isBottleneck
                      ? {
                          borderColor: `color-mix(in srgb, ${stage.accent} 45%, transparent)`,
                          background: `color-mix(in srgb, ${stage.accent} 7%, var(--color-surface))`,
                        }
                      : undefined
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[14px] font-bold leading-tight text-[var(--color-text)]">{stage.label}</p>
                        {isBottleneck && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
                            style={{ background: `color-mix(in srgb, ${stage.accent} 16%, transparent)`, color: stage.accent }}
                          >
                            Focus
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-text-muted)]">
                        {isActive ? stage.description : 'No items in this stage yet'}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="text-xl font-extrabold tabular-nums leading-none text-[var(--color-text)]">{count}</span>
                      <span
                        className="text-[10px] font-semibold tabular-nums"
                        style={{ color: isActive ? stage.accent : 'var(--color-text-disabled)' }}
                      >
                        {percent}%
                      </span>
                    </div>
                  </div>

                  <span className="mt-2.5 block h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                    <span
                      className="block h-full rounded-full transition-all duration-700"
                      style={{ width: `${Math.max(percent, isActive ? 8 : 0)}%`, background: stage.accent }}
                    />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </MobileHomeCard>
  );
}