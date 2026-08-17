/**
 * CustomerOrdersTabContent — Order History section, mounted inside the
 * Center Panel's accordion (CustomerWorkspaceSections.tsx), B2B only.
 *
 * Premium UX Redesign mission: the old standalone "Orders" tab's "Financial
 * Summary" tile row (four money/count tiles sourced from
 * `customer.lifetimeValue`, `customer.totalRevenue`,
 * `customer.outstandingAmount`, `customer.activeOrders`) is REMOVED — none
 * of those fields are ever written anywhere in this codebase (confirmed by
 * search; the Customer Workspace Master Plan §8.2 explicitly flagged the
 * receivable calculation those tiles implied as unsafe and never
 * implemented it), so the row always rendered four "—" placeholders —
 * decorative, not information.
 * The genuinely useful part — this customer's real order history — is kept
 * as-is: same useCustomerBillingContext() query the B2B pipeline/KPI bar
 * already share (React Query dedups by key, no new fetch), same
 * statusBadge()/fmtCurrency()/fmtDate() helpers, same /orders/:id route for
 * the "View" action — no new Orders business logic.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { EmptyState } from '../../../../components/shared';
import { statusBadge } from '../../../../components/ui/Badge';
import { fmtCurrency, fmtDate } from '../../../../lib/firestore';
import { useCustomerBillingContext } from '../../hooks/useCustomerBillingContext';

interface Props {
  customer: any;
}

function orderTimestamp(order: any): number {
  const value = order?.date || order?.createdAt;
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export default function CustomerOrdersTabContent({ customer }: Props) {
  const navigate = useNavigate();
  const { orders, ordersLoading } = useCustomerBillingContext(customer);

  const sortedOrders = useMemo(() => [...(orders as any[])].sort((a, b) => orderTimestamp(b) - orderTimestamp(a)), [orders]);

  return (
    <div>
      {ordersLoading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl bg-[var(--color-bg-sunken)]" />)}
        </div>
      ) : sortedOrders.length === 0 ? (
        <EmptyState title="No orders yet" description="Orders placed for this customer will appear here, most recent first." compact />
      ) : (
        <div className="space-y-2">
          {sortedOrders.map((order: any) => (
            <button
              key={order.id}
              type="button"
              onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
                  <span className="truncate text-sm font-semibold text-[var(--color-text)]">{order.orderNumber || order.orderNo || order.id}</span>
                  {statusBadge(order.status || 'Pending')}
                </div>
                <span className="shrink-0 text-sm font-semibold text-[var(--color-text)]">{fmtCurrency(order.total)}</span>
              </div>
              <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                {fmtDate(order.date || order.createdAt)}
                {Array.isArray(order.items) && order.items.length > 0 && <> · {order.items.length} item{order.items.length === 1 ? '' : 's'}</>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
