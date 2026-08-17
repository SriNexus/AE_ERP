/**
 * useCustomerBillingContext — the one place that queries a customer's
 * Quotations (both types) plus Orders (B2B) or Loan Applications/Projects (B2C),
 * customer-scoped and company-scoped via the shared `getAll()` helper
 * (verified in Phase 0: company scoping and soft-delete filtering are
 * automatic, no full-collection fetch).
 *
 * B2B vs B2C lifecycle correction: Orders remain B2B-only (a B2C case never
 * places a commercial Order — it proceeds Quotation → Loan Application →
 * Project instead), but Quotations are fetched for both, since a B2C case
 * also starts with a Quotation.
 *
 * Extracted in Phase 2 from CustomerWorkspaceKpis.tsx (Phase 1) so the KPI
 * bar and the new Center Panel share exactly one set of queries — same query
 * keys, so React Query's own cache dedups them into one network fetch even
 * though two components consume the result, rather than each component
 * fetching independently.
 */
import { useQuery } from '@tanstack/react-query';
import { where } from 'firebase/firestore';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';

export function useCustomerBillingContext(customer: any) {
  const isB2B = (customer?.type || 'B2B') === 'B2B';
  const customerId = customer?.id;

  const { data: orders = [], isLoading: ordersLoading, isError: ordersError } = useQuery({
    queryKey: ['customer-kpi-orders', customerId],
    queryFn: () => getAll<any>(COLLECTIONS.ORDERS, [where('customerId', '==', customerId)]),
    enabled: isB2B && !!customerId,
  });
  // B2C vs B2B lifecycle correction: a B2C case starts with a Quotation too
  // (Quotation → Loan Application → Project) — only Orders are genuinely B2B-only
  // (B2C never places a commercial Order; it proceeds to Loan Application/Project
  // instead). Quotations must therefore be fetched for both customer types.
  const { data: quotations = [], isLoading: quotationsLoading } = useQuery({
    queryKey: ['customer-kpi-quotations', customerId],
    queryFn: () => getAll<any>(COLLECTIONS.QUOTATIONS, [where('customerId', '==', customerId)]),
    enabled: !!customerId,
  });
  const { data: registrations = [], isLoading: registrationsLoading } = useQuery({
    queryKey: ['customer-kpi-registrations', customerId],
    queryFn: () => getAll<any>(COLLECTIONS.LOAN_APPLICATIONS, [where('customerId', '==', customerId)]),
    enabled: !isB2B && !!customerId,
  });
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['customer-kpi-projects', customerId],
    queryFn: () => getAll<any>(COLLECTIONS.PROJECTS, [where('customerId', '==', customerId)]),
    enabled: !isB2B && !!customerId,
  });
  // Central Panel Refinement mission: B2B's Invoice/Dispatch sections reuse
  // this same hub hook rather than issuing their own one-off queries —
  // Invoices/Dispatch are genuinely B2B-only, same as Orders (a B2C case
  // never gets a commercial invoice or a warehouse dispatch; it proceeds
  // through Loan Application/Project instead).
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ['customer-kpi-invoices', customerId],
    queryFn: () => getAll<any>(COLLECTIONS.INVOICES, [where('customerId', '==', customerId)]),
    enabled: isB2B && !!customerId,
  });
  const { data: dispatches = [], isLoading: dispatchesLoading } = useQuery({
    queryKey: ['customer-kpi-dispatches', customerId],
    queryFn: () => getAll<any>(COLLECTIONS.DISPATCH, [where('customerId', '==', customerId)]),
    enabled: isB2B && !!customerId,
  });
  // Compact Workspace & Central Panel B2B Workflow mission: the fifth stage
  // of the B2B Quotation → Order → Invoice → Payment → Dispatch pipeline.
  // PaymentRecord already carries customerId directly (lib/paymentWorkflow.ts) —
  // same customer-scoped getAll() pattern as every other query above.
  const { data: payments = [], isLoading: paymentsLoading } = useQuery({
    queryKey: ['customer-kpi-payments', customerId],
    queryFn: () => getAll<any>(COLLECTIONS.PAYMENTS, [where('customerId', '==', customerId)]),
    enabled: isB2B && !!customerId,
  });

  return {
    isB2B,
    orders, ordersLoading, ordersError,
    quotations, quotationsLoading,
    registrations, registrationsLoading,
    projects, projectsLoading,
    invoices, invoicesLoading,
    dispatches, dispatchesLoading,
    payments, paymentsLoading,
  };
}
