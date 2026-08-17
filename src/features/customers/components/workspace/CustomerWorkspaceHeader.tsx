/**
 * CustomerWorkspaceHeader — compact operational identity area for the Customer
 * Workspace. Visual language matches LeadWorkspace.tsx's own header exactly
 * (same avatar treatment h-12 w-12/text-lg, same text-xl name, same px-6 py-4
 * padding, same chip styling, same info-row pattern) — Compact Workspace &
 * Header mission tightened this from an earlier, larger one-off sizing
 * (h-16 w-16/text-2xl, px-6 py-6) back to Lead's own reference exactly, and
 * removed the raw phone/email text from the identity strip entirely (the
 * Call/WhatsApp/Email quick-action buttons stay — they're the "essential
 * actions" the brief explicitly keeps, distinct from displaying the raw
 * contact text).
 *
 * Deliberately a compact identity strip, not a Customer Details dump — fields
 * shown are exactly what's needed to know "whose customer am I working on?",
 * not every available field.
 *
 * Premium UX Redesign mission: the header used to stack THREE badge-shaped
 * signals next to the name (Type, Status, "Active Batch") — three visually
 * identical pills reading as if they were all the same kind of "status,"
 * which is genuine ambiguity ("B2B | ACTIVE | ACTIVE BATCH"). There is now
 * exactly one status signal (the Active/Inactive pill); Type stays because
 * it's identity, not status. "Active Batch" (real signal: an order recorded
 * in the last 30 days) moved to the B2B pipeline's Order stage
 * (CustomerB2BWorkflowPipeline.tsx), where it's contextually meaningful
 * instead of competing for header real estate — same hasActiveBatch()
 * calculation, reused from here, not reimplemented. City (already resolved by
 * resolveCustomerHeaderFields, previously computed but never rendered) now
 * appears on the identity's second line alongside the assigned owner, per
 * the redesign brief's explicit "second line should prioritize location"
 * requirement.
 */
import {
  ArrowLeft, Phone, Mail, MessageCircle, Building2, User, MapPin,
} from 'lucide-react';
import type { QuickActionDef } from '../../../../components/shared/WorkspaceQuickActions';

export interface CustomerHeaderFields {
  type: string;
  isB2B: boolean;
  displayName: string;
  companyName: string | undefined;
  phone: string;
  email: string;
  city: string | undefined;
  assignedToName: string | undefined;
  status: string;
  sourceLeadId: string | undefined;
}

/** Pure field-resolution logic — no React — so the fallback-chain rules
 * (which field wins for name/phone/email, company shown only for B2B) are
 * unit-testable without rendering. See __tests__/customerWorkspaceHeader.test.ts. */
export function resolveCustomerHeaderFields(customer: any): CustomerHeaderFields {
  const type = customer?.type || 'B2B';
  const isB2B = type === 'B2B';
  return {
    type,
    isB2B,
    displayName: customer?.name || customer?.fullName || customer?.contactPerson || 'Unnamed',
    companyName: isB2B ? (customer?.company || customer?.companyName || undefined) : undefined,
    phone: customer?.phone || customer?.mobile || customer?.businessPhone || '',
    email: customer?.email || customer?.businessEmail || '',
    city: customer?.city || undefined,
    assignedToName: customer?.assignedToName || undefined,
    status: customer?.status || 'Active',
    sourceLeadId: customer?.sourceLeadId || customer?.leadId || undefined,
  };
}

const ACTIVE_BATCH_WINDOW_DAYS = 30;

function orderDate(order: any): number {
  const value = order?.date || order?.createdAt;
  if (!value) return NaN;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? NaN : parsed.getTime();
}

/** Pure — "Active Batch" means this customer has at least one order recorded
 * within the last 30 days. Reuses the exact same `orders` array
 * useCustomerBillingContext already fetches (B2B-only, customer-scoped) —
 * no separate query, no new business concept, no invented data model. */
export function hasActiveBatch(orders: any[], now: number = Date.now()): boolean {
  return (orders || []).some((order) => {
    const ts = orderDate(order);
    return !Number.isNaN(ts) && now - ts <= ACTIVE_BATCH_WINDOW_DAYS * 86400000 && now - ts >= 0;
  });
}

const STATUS_TONE: Record<string, string> = {
  Active: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800',
  Inactive: 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] border-[var(--color-border)]',
};

function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.Inactive;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>{status}</span>;
}

function TypeChip({ type }: { type: string }) {
  const isB2B = type === 'B2B';
  return (
    <span className={[
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
      isB2B
        ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800'
        : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
    ].join(' ')}>
      {isB2B ? <Building2 className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
      {type}
    </span>
  );
}

interface Props {
  customer: any;
  actions: QuickActionDef[];
  onBack: () => void;
}

export default function CustomerWorkspaceHeader({ customer, actions, onBack }: Props) {
  const { type, displayName, phone, email, city, assignedToName, status } = resolveCustomerHeaderFields(customer);

  return (
    <div className="flex shrink-0 items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-6 py-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-hover)] text-lg font-bold text-white shadow-sm ring-2 ring-[var(--color-primary-muted)]">
        {displayName[0]?.toUpperCase() || '?'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="truncate text-xl font-bold text-[var(--color-text)]">{displayName}</h1>
          <TypeChip type={type} />
          <StatusPill status={status} />
        </div>
        {(city || assignedToName) && (
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {city && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><MapPin className="h-3 w-3" />{city}</span>}
            {assignedToName && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><User className="h-3 w-3" />{assignedToName}</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
        {phone && (
          <a href={`tel:${phone}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors shadow-sm">
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
        )}
        {phone && (
          <a href={`https://wa.me/${String(phone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 dark:hover:bg-emerald-900/20 dark:hover:border-emerald-700 dark:hover:text-emerald-400 transition-colors shadow-sm">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 dark:hover:bg-blue-900/20 dark:hover:border-blue-700 dark:hover:text-blue-400 transition-colors shadow-sm">
            <Mail className="h-3.5 w-3.5" /> Email
          </a>
        )}
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={a.handler}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors shadow-sm"
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 sm:px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors shadow-sm"
          title="Back to Customers"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Customers</span>
        </button>
      </div>
    </div>
  );
}
