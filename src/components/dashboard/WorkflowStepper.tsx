/**
 * WorkflowStepper — Visual business workflow pipeline.
 * Phase P1: Full semantic token compliance on themed surfaces/text.
 * VALID palette: step.color/step.dotColor/step.ringHex entries (per-stage identity pigments).
 * step.ringHex is the literal hex of the same fixed pigment as step.dotColor — required because
 * CSS conic-gradient() cannot consume a Tailwind class, only a real color value.
 *
 * Redesign pass 4 (ground-up rebuild): the previous "row of connected circles" language is gone.
 * Desktop is now an executive KPI strip (active volume / bottleneck / completion) sitting above a
 * single continuous segmented flow bar and a stage-chip grid. Mobile is a completion-ring hero card
 * above a swipeable, snap-scrolling stage carousel with a live position indicator — a native-app
 * pattern, not a compressed desktop layout. All numbers shown (completion %, bottleneck, share of
 * pipeline) are derived purely from the existing `counts` prop at render time — no new data source,
 * no change to `workflowSteps`/`desktopWorkflowSteps`, their keys, paths, or the counts they read.
 *
 * Rendering-chain audit (carried over from pass 3): Home.tsx imports only the `WorkflowStepper`
 * named export and renders it once, unconditionally, with no viewport branching in that file. The
 * mobile layout previously had no call site — dead code. FIX: the two layouts are internal-only
 * (`DesktopWorkflowStepper` / `MobileWorkflowStepper`); the exported `WorkflowStepper` is a
 * responsive switch that mounts exactly one of them based on viewport width (matchMedia, not CSS
 * hide/show — never both mounted). Home.tsx required zero changes. `MobileLeadFunnel` remains
 * exported as an alias in case anything else imports it directly.
 */

import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserPlus, Phone, FileText, ShoppingCart, ReceiptText,
  CreditCard, Truck, Wrench, CheckCircle2, ChevronRight,
  GitBranch, Flame, Layers, Sparkles,
} from 'lucide-react';

interface WorkflowStep {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  count: number;
  color: string;
  dotColor: string;
  ringHex: string;
  path: string;
}

interface WorkflowStepperProps {
  counts: {
    newLeads?: number;
    followUp?: number;
    quotations?: number;
    orders?: number;
    invoices?: number;
    pendingPayments?: number;
    dispatched?: number;
    installed?: number;
    completed?: number;
  } | null;
  loading?: boolean;
}

type WorkflowCounts = WorkflowStepperProps['counts'];

// VALID: short helper copy per stage — presentation only, no effect on business logic.
const STEP_DESCRIPTIONS: Record<string, string> = {
  newLeads: 'New inquiries, not yet contacted',
  followUp: 'Leads being actively pursued',
  quotations: 'Quotes sent, awaiting response',
  orders: 'Confirmed and moving to fulfilment',
  invoices: 'Billed, awaiting settlement',
  pendingPayments: 'Payments due or in process',
  dispatched: 'Materials on the way to site',
  installed: 'On-site installation underway',
  completed: 'Delivered and closed out',
};

function sharePercent(count: number, total: number): number {
  if (!total || total <= 0 || count <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((count / total) * 100)));
}

function ringStyle(percent: number, hex: string): React.CSSProperties {
  if (percent <= 0) {
    return { background: 'var(--color-border)' };
  }
  return { background: `conic-gradient(${hex} ${percent}%, var(--color-border) ${percent}% 100%)` };
}

function workflowSteps(counts: WorkflowCounts): WorkflowStep[] {
  return [
    { key: 'newLeads',        label: 'Leads',        description: STEP_DESCRIPTIONS.newLeads,        icon: <UserPlus className="h-4 w-4" />,      count: counts?.newLeads ?? 0,        color: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/50 ring-1 ring-violet-200 dark:ring-violet-800/60',     dotColor: 'bg-violet-500',  ringHex: '#8b5cf6', path: '/leads'      },
    { key: 'followUp',        label: 'Follow-up',    description: STEP_DESCRIPTIONS.followUp,        icon: <Phone className="h-4 w-4" />,          count: counts?.followUp ?? 0,        color: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50 ring-1 ring-sky-200 dark:ring-sky-800/60',                           dotColor: 'bg-sky-500',     ringHex: '#0ea5e9', path: '/leads'      },
    { key: 'quotations',      label: 'Quotation',    description: STEP_DESCRIPTIONS.quotations,      icon: <FileText className="h-4 w-4" />,       count: counts?.quotations ?? 0,      color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 ring-1 ring-blue-200 dark:ring-blue-800/60',                     dotColor: 'bg-blue-500',    ringHex: '#3b82f6', path: '/quotations' },
    { key: 'orders',          label: 'Order',        description: STEP_DESCRIPTIONS.orders,          icon: <ShoppingCart className="h-4 w-4" />,   count: counts?.orders ?? 0,          color: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 ring-1 ring-indigo-200 dark:ring-indigo-800/60',       dotColor: 'bg-indigo-500',  ringHex: '#6366f1', path: '/orders'     },
    { key: 'pendingPayments', label: 'Payment',      description: STEP_DESCRIPTIONS.pendingPayments, icon: <CreditCard className="h-4 w-4" />,     count: counts?.pendingPayments ?? 0, color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 ring-1 ring-emerald-200 dark:ring-emerald-800/60', dotColor: 'bg-emerald-500', ringHex: '#10b981', path: '/invoices'   },
    { key: 'dispatched',      label: 'Dispatch',     description: STEP_DESCRIPTIONS.dispatched,      icon: <Truck className="h-4 w-4" />,          count: counts?.dispatched ?? 0,      color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 ring-1 ring-amber-200 dark:ring-amber-800/60',             dotColor: 'bg-amber-500',   ringHex: '#f59e0b', path: '/dispatch'   },
    { key: 'installed',       label: 'Installation', description: STEP_DESCRIPTIONS.installed,       icon: <Wrench className="h-4 w-4" />,         count: counts?.installed ?? 0,       color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/50 ring-1 ring-orange-200 dark:ring-orange-800/60',       dotColor: 'bg-orange-500',  ringHex: '#f97316', path: '/dispatch'   },
    { key: 'completed',       label: 'Completed',    description: STEP_DESCRIPTIONS.completed,       icon: <CheckCircle2 className="h-4 w-4" />,   count: counts?.completed ?? 0,       color: 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 ring-1 ring-teal-200 dark:ring-teal-800/60',                   dotColor: 'bg-teal-500',    ringHex: '#14b8a6', path: '/orders'     },
  ];
}

function desktopWorkflowSteps(counts: WorkflowCounts): WorkflowStep[] {
  return [
    { key: 'newLeads',        label: 'Lead',         description: STEP_DESCRIPTIONS.newLeads,        icon: <UserPlus className="h-4 w-4" />,      count: counts?.newLeads ?? 0,        color: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/50 ring-1 ring-violet-200 dark:ring-violet-800/60',     dotColor: 'bg-violet-500',  ringHex: '#8b5cf6', path: '/leads'      },
    { key: 'quotations',      label: 'Quotation',    description: STEP_DESCRIPTIONS.quotations,      icon: <FileText className="h-4 w-4" />,      count: counts?.quotations ?? 0,      color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 ring-1 ring-blue-200 dark:ring-blue-800/60',                     dotColor: 'bg-blue-500',    ringHex: '#3b82f6', path: '/quotations' },
    { key: 'orders',          label: 'Order',        description: STEP_DESCRIPTIONS.orders,          icon: <ShoppingCart className="h-4 w-4" />,  count: counts?.orders ?? 0,          color: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 ring-1 ring-indigo-200 dark:ring-indigo-800/60',       dotColor: 'bg-indigo-500',  ringHex: '#6366f1', path: '/orders'     },
    { key: 'invoices',        label: 'Invoice',      description: STEP_DESCRIPTIONS.invoices,        icon: <ReceiptText className="h-4 w-4" />,   count: counts?.invoices ?? 0,        color: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50 ring-1 ring-sky-200 dark:ring-sky-800/60',                           dotColor: 'bg-sky-500',     ringHex: '#0ea5e9', path: '/invoices'   },
    { key: 'pendingPayments', label: 'Payment',      description: STEP_DESCRIPTIONS.pendingPayments, icon: <CreditCard className="h-4 w-4" />,    count: counts?.pendingPayments ?? 0, color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 ring-1 ring-emerald-200 dark:ring-emerald-800/60', dotColor: 'bg-emerald-500', ringHex: '#10b981', path: '/invoices'   },
    { key: 'dispatched',      label: 'Dispatch',     description: STEP_DESCRIPTIONS.dispatched,      icon: <Truck className="h-4 w-4" />,         count: counts?.dispatched ?? 0,      color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 ring-1 ring-amber-200 dark:ring-amber-800/60',             dotColor: 'bg-amber-500',   ringHex: '#f59e0b', path: '/dispatch'   },
    { key: 'installed',       label: 'Installation', description: STEP_DESCRIPTIONS.installed,       icon: <Wrench className="h-4 w-4" />,        count: counts?.installed ?? 0,       color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/50 ring-1 ring-orange-200 dark:ring-orange-800/60',       dotColor: 'bg-orange-500',  ringHex: '#f97316', path: '/dispatch'   },
    { key: 'completed',       label: 'Completed',    description: STEP_DESCRIPTIONS.completed,       icon: <CheckCircle2 className="h-4 w-4" />,  count: counts?.completed ?? 0,       color: 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 ring-1 ring-teal-200 dark:ring-teal-800/60',                   dotColor: 'bg-teal-500',    ringHex: '#14b8a6', path: '/orders'     },
  ];
}

/** VALID: "bottleneck" = the stage carrying the most active items right now (ties → earliest stage). Pure derived display value — reads counts already on the step objects, no new business logic. */
function useBottleneck(steps: WorkflowStep[]): WorkflowStep | null {
  return useMemo(() => {
    let max = 0;
    let found: WorkflowStep | null = null;
    for (const s of steps) {
      if (s.count > max) {
        max = s.count;
        found = s;
      }
    }
    return found;
  }, [steps]);
}

/** VALID: "completion" = share of active pipeline items currently sitting in the Completed stage. Derived-only display metric. */
function useCompletion(steps: WorkflowStep[], total: number): { percent: number; step: WorkflowStep | undefined } {
  return useMemo(() => {
    const step = steps.find((s) => s.key === 'completed');
    return { percent: sharePercent(step?.count ?? 0, total), step };
  }, [steps, total]);
}

/**
 * Tracks whether the viewport is below the given breakpoint (default: Tailwind's `md`, 768px —
 * matches the `md:`/`lg:` breakpoints already used elsewhere in this codebase, e.g. Home.tsx's
 * hero section). Drives which of the two WorkflowStepper layouts actually mounts — a real
 * conditional mount, not a CSS hide/show, so only one implementation is ever in the DOM at a time.
 */
function useIsMobile(breakpointPx = 768): boolean {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpointPx;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [breakpointPx]);

  return isMobile;
}

/* ═══════════════════════════════════════════ Shared header ═══════════════════════════════════════════ */

function WorkflowHeader({
  loading, activeTotal, subtitle, dense,
}: { loading?: boolean; activeTotal: number; subtitle: string; dense?: boolean }) {
  return (
    <div className={`relative flex items-center justify-between gap-3 ${dense ? 'mb-5' : 'mb-6 lg:mb-7'}`}>
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-[var(--color-primary-light)] to-[var(--color-primary-light)] p-2.5 text-[var(--color-primary-text)] shadow-sm ring-1 ring-[var(--color-border)]">
          <GitBranch className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold tracking-tight text-[var(--color-text)] lg:text-base">Business Workflow</h3>
          <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
            {loading ? 'Loading pipeline…' : subtitle}
          </p>
        </div>
      </div>
      {/* VALID: indigo badge is fixed primary brand pigment; emerald dot is fixed "live" pigment */}
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:ring-indigo-800/60">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        Live
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════ Desktop ═══════════════════════════════════════════ */
/* Executive KPI strip → continuous segmented flow bar → stage-chip grid. No circles-in-a-row,      */
/* no arrow connectors — the flow bar itself *is* the connection, and is the visual centerpiece.    */

function DesktopSkeleton() {
  return (
    <>
      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] p-4 sm:flex-row sm:divide-x sm:divide-[var(--color-border)] lg:mb-7">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex-1 sm:px-4 sm:first:pl-0">
            <div className="animate-pulse h-2.5 w-20 rounded bg-[var(--color-bg-sunken)]" />
            <div className="animate-pulse mt-2 h-5 w-24 rounded bg-[var(--color-bg-sunken)]" />
          </div>
        ))}
      </div>
      <div className="animate-pulse mb-6 h-3 w-full rounded-full bg-[var(--color-bg-sunken)]" />
      <div className="grid grid-cols-4 gap-3 lg:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="animate-pulse h-24 rounded-2xl bg-[var(--color-bg-sunken)]" />
        ))}
      </div>
    </>
  );
}

const DesktopWorkflowStepper = React.memo(function DesktopWorkflowStepper({
  counts, loading,
}: WorkflowStepperProps) {
  const navigate = useNavigate();

  // VALID: step.color, step.dotColor and step.ringHex are fixed per-stage workflow identity pigments.
  const steps: WorkflowStep[] = useMemo(() => desktopWorkflowSteps(counts), [counts]);
  const activeTotal = useMemo(() => steps.reduce((sum, s) => sum + s.count, 0), [steps]);
  const bottleneck = useBottleneck(steps);
  const completion = useCompletion(steps, activeTotal);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_32px_-18px_rgba(0,0,0,0.2)] sm:p-6 lg:p-7">
      <div aria-hidden="true" className="pointer-events-none absolute -top-28 right-0 h-64 w-64 rounded-full opacity-[0.05] blur-3xl" style={{ background: 'var(--color-primary)' }} />

      <WorkflowHeader
        loading={loading}
        activeTotal={activeTotal}
        subtitle={`${activeTotal} active item${activeTotal === 1 ? '' : 's'} across the pipeline`}
      />

      {loading ? (
        <DesktopSkeleton />
      ) : (
        <>
          {/* ─── Executive KPI strip ─── */}
          <div className="relative mb-6 flex flex-col gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)]/40 p-4 sm:flex-row sm:items-center sm:gap-0 sm:divide-x sm:divide-[var(--color-border)] lg:mb-7">
            <div className="flex items-center gap-3 sm:flex-1 sm:pr-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">
                <Layers className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Active Pipeline</p>
                <p className="mt-0.5 text-lg font-extrabold tabular-nums leading-none text-[var(--color-text)]">{activeTotal}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:flex-1 sm:px-5">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: bottleneck ? `${bottleneck.ringHex}1F` : 'var(--color-bg-sunken)', color: bottleneck ? bottleneck.ringHex : 'var(--color-text-muted)' }}
              >
                <Flame className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Bottleneck</p>
                <p className="mt-0.5 truncate text-sm font-extrabold leading-none text-[var(--color-text)]">
                  {bottleneck ? bottleneck.label : 'None yet'}
                </p>
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  {bottleneck ? `${bottleneck.count} item${bottleneck.count === 1 ? '' : 's'} waiting here` : 'No active items'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:flex-1 sm:pl-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${completion.step?.ringHex ?? '#14b8a6'}1F`, color: completion.step?.ringHex ?? '#14b8a6' }}>
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Completion</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-lg font-extrabold tabular-nums leading-none text-[var(--color-text)]">{completion.percent}%</p>
                  <span className="h-1.5 flex-1 max-w-[64px] overflow-hidden rounded-full bg-[var(--color-border)]">
                    <span className="block h-full rounded-full transition-all duration-700" style={{ width: `${completion.percent}%`, background: completion.step?.ringHex ?? '#14b8a6' }} />
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ─── Continuous segmented flow bar — the connective centerpiece ─── */}
          <div className="relative mb-7">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--color-border)]/60">
              {steps.map((step, i) => {
                const isActive = step.count > 0;
                const percent = sharePercent(step.count, activeTotal);
                const weight = Math.max(percent, 6);
                return (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => navigate(step.path)}
                    title={`${step.label}: ${step.count} ${step.count === 1 ? 'item' : 'items'} — click to view`}
                    style={{ flexGrow: weight, flexBasis: 0 }}
                    className={[
                      'group relative h-full min-w-[3px] transition-[filter] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
                      i === 0 ? 'rounded-l-full' : '',
                      i === steps.length - 1 ? 'rounded-r-full' : '',
                      i > 0 ? 'border-l border-[var(--color-surface)]' : '',
                    ].join(' ')}
                  >
                    <span
                      className="block h-full w-full transition-all duration-500 group-hover:brightness-110"
                      style={{ background: isActive ? step.ringHex : 'transparent' }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-disabled)]">
              <span>Lead intake</span>
              <span>Completed</span>
            </div>
          </div>

          {/* ─── Stage-chip grid ─── */}
          <div className="relative grid grid-cols-4 gap-2.5 sm:gap-3 lg:grid-cols-8">
            {steps.map((step) => {
              const isActive = step.count > 0;
              const isBottleneck = bottleneck?.key === step.key;
              const percent = sharePercent(step.count, activeTotal);
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => navigate(step.path)}
                  title={`${step.label}: ${step.count} ${step.count === 1 ? 'item' : 'items'} — click to view`}
                  className={[
                    'group relative flex flex-col rounded-2xl p-3 text-left transition-all duration-300 ease-out',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
                    isBottleneck
                      ? 'border shadow-md'
                      : 'border border-[var(--color-border)] bg-[var(--color-surface)] hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:shadow-sm',
                  ].join(' ')}
                  style={isBottleneck ? { borderColor: `${step.ringHex}55`, background: `${step.ringHex}0D` } : undefined}
                >
                  {isBottleneck && (
                    <span
                      className="absolute -top-2 right-2 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider shadow-sm ring-1 ring-[var(--color-border)]"
                      style={{ background: `${step.ringHex}1F`, color: step.ringHex }}
                    >
                      Bottleneck
                    </span>
                  )}

                  <div className="flex items-center justify-between">
                    <span className={['flex h-8 w-8 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110', step.color].join(' ')}>
                      {step.icon}
                    </span>
                    <span className="text-[10px] font-bold tabular-nums" style={{ color: isActive ? step.ringHex : 'var(--color-text-disabled)' }}>
                      {percent}%
                    </span>
                  </div>

                  <p className="mt-2.5 truncate text-[11.5px] font-bold leading-tight text-[var(--color-text)]">{step.label}</p>

                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span className="text-xl font-extrabold tabular-nums leading-none text-[var(--color-text)]">{step.count}</span>
                    <span className="text-[9.5px] text-[var(--color-text-muted)]">{isActive ? 'items' : 'no items'}</span>
                  </div>

                  <span className="mt-2 block h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                    <span className="block h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(percent, isActive ? 8 : 0)}%`, background: step.ringHex }} />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
});

/* ═══════════════════════════════════════════ Mobile ═══════════════════════════════════════════ */
/* Completion-ring hero card + swipeable, snap-scrolling stage carousel with a live position dial — */
/* a native-app interaction pattern, not the desktop grid squeezed into a narrow viewport.          */

function MobileSkeleton() {
  return (
    <>
      <div className="mb-4 flex items-center gap-4 rounded-2xl border border-[var(--color-border)] p-4">
        <div className="animate-pulse h-16 w-16 shrink-0 rounded-full bg-[var(--color-bg-sunken)]" />
        <div className="min-w-0 flex-1">
          <div className="animate-pulse h-2.5 w-32 rounded bg-[var(--color-bg-sunken)]" />
          <div className="animate-pulse mt-2 h-2.5 w-40 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse h-36 w-36 shrink-0 rounded-2xl bg-[var(--color-bg-sunken)]" />
        ))}
      </div>
    </>
  );
}

const MobileWorkflowStepper = React.memo(function MobileWorkflowStepper({
  counts, loading,
}: WorkflowStepperProps) {
  const navigate = useNavigate();
  const steps = useMemo(() => workflowSteps(counts), [counts]);
  const activeTotal = useMemo(() => steps.reduce((sum, s) => sum + s.count, 0), [steps]);
  const bottleneck = useBottleneck(steps);
  const completion = useCompletion(steps, activeTotal);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const CARD_STRIDE = 148; // card width (136) + gap (12) — used only to approximate scroll position for the dot indicator

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / CARD_STRIDE);
    setActiveIndex(Math.max(0, Math.min(steps.length - 1, idx)));
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_14px_28px_-18px_rgba(0,0,0,0.2)] sm:p-5">
      <div aria-hidden="true" className="pointer-events-none absolute -top-20 right-0 h-44 w-44 rounded-full opacity-[0.07] blur-3xl" style={{ background: 'var(--color-primary)' }} />

      <WorkflowHeader
        dense
        loading={loading}
        activeTotal={activeTotal}
        subtitle={`${activeTotal} active item${activeTotal === 1 ? '' : 's'} · lead funnel progression`}
      />

      {loading ? (
        <MobileSkeleton />
      ) : (
        <>
          {/* ─── Hero: completion ring + bottleneck callout ─── */}
          <div className="relative mb-5 flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)]/40 p-4">
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
              <span className="absolute inset-0 rounded-full transition-all duration-700" style={ringStyle(completion.percent, completion.step?.ringHex ?? '#14b8a6')} />
              <span className="relative flex h-[calc(100%-7px)] w-[calc(100%-7px)] items-center justify-center rounded-full bg-[var(--color-surface)]">
                <span className="text-sm font-extrabold tabular-nums text-[var(--color-text)]">{completion.percent}%</span>
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Pipeline Completion</p>
              <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
                {activeTotal} item{activeTotal === 1 ? '' : 's'} across {steps.filter((s) => s.count > 0).length} active stage{steps.filter((s) => s.count > 0).length === 1 ? '' : 's'}
              </p>
              {bottleneck ? (
                <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs font-bold" style={{ color: bottleneck.ringHex }}>
                  <Flame className="h-3.5 w-3.5 shrink-0" />
                  Bottleneck: {bottleneck.label} · {bottleneck.count}
                </p>
              ) : (
                <p className="mt-1.5 text-xs font-medium text-[var(--color-text-disabled)]">No active items yet</p>
              )}
            </div>
          </div>

          {/* ─── Swipeable stage carousel ─── */}
          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            className="relative -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {steps.map((step) => {
              const isActive = step.count > 0;
              const isBottleneck = bottleneck?.key === step.key;
              const percent = sharePercent(step.count, activeTotal);
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => navigate(step.path)}
                  className={[
                    'flex w-[136px] shrink-0 snap-start flex-col rounded-2xl p-3.5 text-left transition-all duration-200 ease-out active:scale-[0.97]',
                    'min-h-[132px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
                    isBottleneck
                      ? 'border shadow-md'
                      : isActive
                        ? 'border border-[var(--color-border)] bg-[var(--color-surface)]'
                        : 'border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/60',
                  ].join(' ')}
                  style={isBottleneck ? { borderColor: `${step.ringHex}55`, background: `${step.ringHex}0D` } : undefined}
                >
                  <div className="flex items-center justify-between">
                    <span className={['flex h-9 w-9 items-center justify-center rounded-xl', step.color].join(' ')}>
                      {step.icon}
                    </span>
                    {isBottleneck && (
                      <span className="rounded-full px-1.5 py-0.5 text-[7.5px] font-bold uppercase tracking-wider" style={{ background: `${step.ringHex}1F`, color: step.ringHex }}>
                        Hot
                      </span>
                    )}
                  </div>

                  <p className="mt-2.5 truncate text-[13px] font-bold leading-tight text-[var(--color-text)]">{step.label}</p>
                  <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-[var(--color-text-muted)]">
                    {isActive ? step.description : 'No items yet'}
                  </p>

                  <div className="mt-auto flex items-end justify-between pt-2.5">
                    <span className="text-lg font-extrabold tabular-nums leading-none text-[var(--color-text)]">{step.count}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-disabled)]" />
                  </div>
                  <span className="mt-2 block h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                    <span className="block h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(percent, isActive ? 8 : 0)}%`, background: step.ringHex }} />
                  </span>
                </button>
              );
            })}
          </div>

          {/* ─── Position dial ─── */}
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {steps.map((step, i) => (
              <span
                key={step.key}
                aria-hidden="true"
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: i === activeIndex ? '16px' : '6px',
                  background: i === activeIndex ? (step.ringHex) : 'var(--color-border)',
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
});

// Backward-compatible alias — kept in case any other file imports MobileLeadFunnel directly.
export const MobileLeadFunnel = MobileWorkflowStepper;

/**
 * WorkflowStepper — the single entry point Home.tsx (and anything else) imports.
 * Mounts exactly one of DesktopWorkflowStepper / MobileWorkflowStepper based on viewport width.
 * Home.tsx's import and JSX call (`<WorkflowStepper counts={...} loading={...} />`) are unchanged.
 */
export const WorkflowStepper = React.memo(function WorkflowStepper(props: WorkflowStepperProps) {
  const isMobile = useIsMobile(768);
  return isMobile ? <MobileWorkflowStepper {...props} /> : <DesktopWorkflowStepper {...props} />;
});