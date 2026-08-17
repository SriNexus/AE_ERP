/**
 * CustomerLinkedRecords — Right Panel widget (Phase 4). Uses the shared
 * linkedRecordsEngine (Section 8 engine) — the single unified relationship
 * surface, not a customer-specific parallel query. Covers every relationship
 * type declared in RELATIONSHIP_MAP.customers (Loan Applications, Projects,
 * Quotations, Orders, Service Tickets, AMC Contracts, Cases, Source Lead,
 * plus Dispatch/Payments/Invoices/Project Handovers — added this phase after
 * re-verifying they were still genuinely missing; see the Phase 4 report §7).
 *
 * Fixed a genuine pre-existing bug in the engine as a direct prerequisite
 * for this component to work at all: hasPermissionForEntityType() called a
 * React hook (usePermissions()) from a plain async function outside any
 * render, which threw "Invalid hook call" the moment RELATIONSHIP_MAP had
 * entries for the queried type (true for 'customers') — see
 * LinkedRecordsEngine.ts and the Phase 4 report §7 for the fix.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Layers, ChevronRight } from 'lucide-react';
import { linkedRecordsEngine } from '../../../../../engines/LinkedRecordsEngine';

export default function CustomerLinkedRecords({ customerId, companyId }: { customerId: string; companyId: string }) {
  const navigate = useNavigate();
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['customer-linked-records', customerId],
    queryFn: () => linkedRecordsEngine.getLinkedRecords(customerId, 'customers', companyId),
    enabled: !!customerId,
    staleTime: 60000,
  });

  return (
    <div className="px-4 py-4">
      <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Linked Records</h3>
      {isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3].map((i) => <div key={i} className="h-8 rounded-lg bg-[var(--color-bg-sunken)] animate-pulse" />)}
        </div>
      ) : groups.length > 0 ? (
        <div className="space-y-1.5">
          {groups.map((group) => (
            <button
              key={group.entityType}
              type="button"
              onClick={() => navigate(group.viewAllLink)}
              className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"
            >
              <span className="text-[11px] text-[var(--color-text-secondary)] truncate">{group.label}</span>
              <span className="flex items-center gap-1 shrink-0">
                <span className="text-[11px] font-semibold text-[var(--color-primary)]">{group.count}</span>
                <ChevronRight className="h-3 w-3 text-[var(--color-text-muted)]" />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Layers className="h-5 w-5 text-[var(--color-text-disabled)]" />
          <p className="text-[11px] text-[var(--color-text-muted)]">No linked records yet</p>
        </div>
      )}
    </div>
  );
}
