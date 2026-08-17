/**
 * relationshipHealth — Customer Relationship Health calculation (Phase 4).
 *
 * NOT a "Customer Value Score" and NOT a copy of Lead Score — Lead Score
 * measures conversion likelihood for a prospect; a Customer is already
 * converted, so the relevant question is "is this relationship being
 * maintained, or going stale?" The result is always DERIVED at render time
 * from real, already-loaded fields — never stored on the customer document.
 *
 * Signals used (every one verified against real schema/usage before use —
 * see the Phase 4 report §4 for the exact source of each):
 *   - daysSinceLastActivity: most recent customer.activityLog[] entry's
 *     date, falling back to customer.updatedAt, then customer.createdAt.
 *   - customer age (customer.createdAt) — a brand-new customer (<14 days)
 *     is never penalized for having no activity yet; there's been no time.
 *   - open / overdue follow-up: customer.next_date — the same field
 *     `isOverdue(c.next_date)` already reads elsewhere in CustomersWorkspace.tsx
 *     for the customer list's own "Overdue" KPI/badge. A single field
 *     naturally covers both "is a follow-up open" (next_date is set) and
 *     "is it overdue" (next_date is in the past) — no new query, no new field.
 *   - B2B order recency: most recent order in `orders` (from the already-
 *     loaded useCustomerBillingContext) — a customer who has never ordered
 *     is NOT penalized (there's nothing overdue about a relationship that
 *     hasn't started billing yet); only an existing-but-stale order history
 *     counts against health. Does not apply to B2C (no order concept there
 *     — see calculateRelationshipHealth's isB2B branch).
 *
 * Calculation rule (documented exactly, not left implicit):
 *   riskPoints = 0
 *   if NOT a new customer (age >= 14 days):
 *     + 2 if daysSinceLastActivity > 60
 *     + 1 if 30 < daysSinceLastActivity <= 60
 *     + 1 if daysSinceLastActivity is unknown (no activity/updatedAt/createdAt at all)
 *   + 2 if there is an overdue follow-up
 *   (B2B only) + 1 if the most recent order (if any exist) is > 90 days old
 *   level = riskPoints === 0 ? 'healthy' : riskPoints <= 2 ? 'attention' : 'risk'
 */
import { mostRecentByDate } from '../components/workspace/CustomerWorkspaceKpis';

export type RelationshipHealthLevel = 'healthy' | 'attention' | 'risk';

export interface RelationshipHealthSignals {
  isNewCustomer: boolean;
  daysSinceLastActivity: number | null;
  hasOpenFollowup: boolean;
  hasOverdueFollowup: boolean;
  nextFollowupDate: string | null;
  /** null when not applicable (B2C, or B2B with zero orders ever) */
  daysSinceLastOrder: number | null;
}

export interface RelationshipHealthResult {
  level: RelationshipHealthLevel;
  riskPoints: number;
  signals: RelationshipHealthSignals;
}

function daysSince(value: unknown, now: number): number | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((now - d.getTime()) / 86400000));
}

export interface RelationshipHealthBillingInput {
  isB2B: boolean;
  orders: any[];
}

export function calculateRelationshipHealth(customer: any, billing: RelationshipHealthBillingInput, now: number = Date.now()): RelationshipHealthResult {
  const customerAgeDays = daysSince(customer?.createdAt, now);
  const isNewCustomer = customerAgeDays !== null && customerAgeDays < 14;

  const lastActivity = mostRecentByDate(customer?.activityLog || [], 'date');
  const lastActivityDate = lastActivity?.date || customer?.updatedAt || customer?.createdAt || null;
  const daysSinceLastActivity = daysSince(lastActivityDate, now);

  const nextFollowupDate: string | null = customer?.next_date || null;
  // daysSince() clamps at 0 (it's meant for "how long ago"), so a
  // future next_date can't be distinguished from today via that helper —
  // compare the raw timestamp instead to tell open from overdue.
  const nextFollowupIsPast = nextFollowupDate ? new Date(nextFollowupDate).getTime() < now : false;
  const hasOpenFollowup = !!nextFollowupDate && !nextFollowupIsPast;
  const hasOverdueFollowup = !!nextFollowupDate && nextFollowupIsPast;

  let daysSinceLastOrder: number | null = null;
  let riskPoints = 0;

  if (!isNewCustomer) {
    if (daysSinceLastActivity === null) riskPoints += 1;
    else if (daysSinceLastActivity > 60) riskPoints += 2;
    else if (daysSinceLastActivity > 30) riskPoints += 1;
  }

  if (hasOverdueFollowup) riskPoints += 2;

  if (billing.isB2B) {
    const lastOrder = mostRecentByDate(billing.orders || [], 'date');
    if (lastOrder) {
      daysSinceLastOrder = daysSince(lastOrder.date, now);
      if (daysSinceLastOrder !== null && daysSinceLastOrder > 90) riskPoints += 1;
    }
  }

  const level: RelationshipHealthLevel = riskPoints === 0 ? 'healthy' : riskPoints <= 2 ? 'attention' : 'risk';

  return {
    level,
    riskPoints,
    signals: {
      isNewCustomer,
      daysSinceLastActivity,
      hasOpenFollowup,
      hasOverdueFollowup,
      nextFollowupDate,
      daysSinceLastOrder,
    },
  };
}
