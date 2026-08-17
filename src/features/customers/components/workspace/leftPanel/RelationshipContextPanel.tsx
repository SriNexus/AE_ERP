/**
 * RelationshipContextPanel — Left Panel context for Linked Records /
 * Orders / Invoices tabs (Phase 3).
 *
 * Takes the billing context (orders/quotations/loan applications/projects) as
 * props from the orchestrator, which fetches it once via
 * `useCustomerBillingContext` (Phase 2) — no new query here. React Query
 * already dedups that hook's queries against the KPI bar and Center Panel's
 * own calls to the same hook (same query keys).
 *
 * This does NOT duplicate the full Linked Records tab (linkedRecordsEngine) —
 * it shows compact counts only, for the four record types this workspace
 * already has verified, customer-scoped data for. Invoices/Installations
 * (referenced in the pre-Phase-2 Overview's "Related Records" block) are not
 * included here since no verified data source for them was loaded this
 * phase — see the Phase 3 report's Overview Content Migration section for
 * why that block was left in place rather than removed.
 */
import { useNavigate } from 'react-router-dom';
import { Layers } from 'lucide-react';

interface Props {
  customerId: string;
  isB2B: boolean;
  orders: any[];
  quotations: any[];
  registrations: any[];
  projects: any[];
}

function CountRow({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-2 text-left hover:border-[var(--color-primary)] transition-colors"
    >
      <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-xs font-semibold text-[var(--color-primary)]">{count}</span>
    </button>
  );
}

export function LinkedRecordsContextPanel({ customerId, isB2B, orders, quotations, registrations, projects }: Props) {
  const navigate = useNavigate();
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Layers className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Relationship Summary</h4>
        </div>
        <div className="space-y-1.5">
          {isB2B ? (
            <>
              <CountRow label="Orders" count={orders.length} onClick={() => navigate(`/orders?customerId=${encodeURIComponent(customerId)}`)} />
              <CountRow label="Quotations" count={quotations.length} onClick={() => navigate(`/quotations?customerId=${encodeURIComponent(customerId)}`)} />
            </>
          ) : (
            <>
              <CountRow label="Loan Applications" count={registrations.length} onClick={() => navigate(`/loan-applications?customerId=${encodeURIComponent(customerId)}`)} />
              <CountRow label="Projects" count={projects.length} onClick={() => navigate(`/projects?customerId=${encodeURIComponent(customerId)}`)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CommercialContextPanel({ customerId, isB2B, orders, quotations }: Props) {
  const navigate = useNavigate();
  const totalOrderValue = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);

  if (!isB2B) {
    return (
      <p className="text-[11px] text-[var(--color-text-muted)] px-1">
        This is a B2C customer — commercial (Orders/Quotations) context does not apply. See Loan Applications/Projects context instead.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Layers className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Commercial Context</h4>
        </div>
        <div className="space-y-1.5">
          <CountRow label="Orders" count={orders.length} onClick={() => navigate(`/orders?customerId=${encodeURIComponent(customerId)}`)} />
          <CountRow label="Quotations" count={quotations.length} onClick={() => navigate(`/quotations?customerId=${encodeURIComponent(customerId)}`)} />
          <div className="flex items-center justify-between px-2.5 py-1">
            <span className="text-[11px] text-[var(--color-text-muted)]">Total order value</span>
            <span className="text-xs font-semibold text-[var(--color-text)]">₹{totalOrderValue.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
