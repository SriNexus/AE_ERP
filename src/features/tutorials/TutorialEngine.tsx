/**
 * TutorialEngine — the interactive guided-walkthrough overlay.
 *
 * Mounted once, globally, inside the Router (see src/app/providers). When a
 * tutorial is started it takes over the screen: dims the app, spotlights the
 * REAL target element (via its stable `data-tour` identifier), explains it,
 * navigates across routes as needed, and lets the learner move through the
 * tutorial with Next / Back / Skip / Exit / Finish controls.
 *
 * Robustness rules implemented here (see master requirements §13/§14):
 *  - Route steps navigate first, then wait for the page to render.
 *  - Targets are resolved with polling + MutationObserver + re-query when a
 *    previously-found element disappears (e.g. a modal opens/closes).
 *  - Missing targets never crash: the step shows a graceful recovery UI
 *    (Skip Step / Next) and logs a console warning for developers.
 *  - No global listeners leak: every listener/observer/rAF is cleaned up.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  X, ChevronLeft, ChevronRight, CheckCircle2, RotateCcw,
  MousePointerClick, Keyboard, ListChecks, SkipForward, Compass,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useCurrentUser } from '../../store/useAppStore';
import { useTutorialStore } from './TutorialStore';
import { useTutorialProgress } from './progress';
import { getTutorialById } from './tutorials';
import type { TutorialDefinition, TutorialPlacement, TutorialStep } from './types';

// ── Small helpers ─────────────────────────────────────────────

interface Rect { top: number; left: number; width: number; height: number; }

/** `/leads/workspace/:id` prefix-matches any record id; exact otherwise. */
function pathnameMatches(route: string, pathname: string): boolean {
  if (route.endsWith('/:id')) {
    const base = route.slice(0, -4);
    return pathname === base || pathname.startsWith(`${base}/`);
  }
  return pathname === route;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ── Entry — mounts nothing when no tutorial is active ─────────

export function TutorialEngine() {
  const active = useTutorialStore((s) => s.active);
  const tutorial = useMemo(() => (active ? getTutorialById(active.tutorialId) : undefined), [active]);

  if (!active || !tutorial) return null;
  return <Walkthrough key={tutorial.id} tutorial={tutorial} stepIndex={active.stepIndex} />;
}

// ── Target resolution hook ────────────────────────────────────

type TargetStatus = 'none' | 'pending' | 'found' | 'missing';

function useTarget(selector: string | undefined, active: boolean) {
  const [status, setStatus] = useState<TargetStatus>(() => (active && selector ? 'pending' : 'none'));
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);

  // Polling + MutationObserver that keeps running for the whole step: a
  // found element can disappear again (modal closed, list refetched), and
  // the watcher must recover to 'pending' and re-search instead of freezing
  // the spotlight on a stale rectangle. Uses a time deadline rather than an
  // attempt counter so heavy page churn (loading spinners, react-query
  // refetch) can never exhaust the budget prematurely.
  useEffect(() => {
    if (!active || !selector) {
      setStatus('none');
      setElement(null);
      setRect(null);
      return;
    }
    let cancelled = false;
    let searchDeadline = Date.now() + 12000;
    const interval = setInterval(check, 250);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });

    function query() {
      const found = document.querySelector<HTMLElement>(`[data-tour="${selector}"]`);
      return found && found.isConnected ? found : null;
    }

    function check() {
      if (cancelled) return;
      const found = query();
      if (found) {
        if (found !== elementRef.current) {
          elementRef.current = found;
          setElement(found);
          setStatus('found');
        }
        return;
      }
      if (elementRef.current) {
        // The element was there but disappeared (route change / modal
        // closed). Drop it, restart the search, and give the re-search a
        // fresh budget — the same identifier may re-appear.
        elementRef.current = null;
        setElement(null);
        setRect(null);
        setStatus('pending');
        searchDeadline = Date.now() + 12000;
        return;
      }
      if (Date.now() > searchDeadline) {
        setStatus('missing');
        console.warn(`[tutorial] target not found on this screen: [data-tour="${selector}"]`);
      }
    }

    check();
    return () => {
      cancelled = true;
      clearInterval(interval);
      observer.disconnect();
    };
  }, [selector, active]);

  // Measure the resolved element every animation frame (cheap, and only
  // while a tutorial is active). Re-measures on scroll/resize/layout change
  // without extra listeners. setState only fires when the rect actually moved.
  useEffect(() => {
    if (status !== 'found' || !element) {
      setRect(null);
      return;
    }
    let raf = 0;
    let last = '';
    const measure = () => {
      if (!element.isConnected) {
        raf = requestAnimationFrame(measure);
        return;
      }
      const r = element.getBoundingClientRect();
      const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (key !== last) {
        last = key;
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [status, element]);

  return { status, element, rect };
}

// ── Popover positioning ───────────────────────────────────────

interface PanelPos {
  style: React.CSSProperties;
  placement: TutorialPlacement;
}

function computePanelPos(rect: Rect | null, preferred: TutorialPlacement, panelW: number, panelH: number): PanelPos | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 14;
  const pad = 10;

  // Mobile: bottom sheet — panel hugs the bottom of the viewport.
  if (vw < 640) {
    return { style: { left: 12, right: 12, bottom: 12 }, placement: 'bottom' };
  }
  if (!rect) {
    // Info step without a target: center the panel.
    return {
      style: { top: '14%', left: '50%', transform: 'translateX(-50%)', width: 380, maxWidth: 'calc(100vw - 2rem)' },
      placement: 'bottom',
    };
  }

  const spaceTop = rect.top;
  const spaceBottom = vh - (rect.top + rect.height);
  const spaceLeft = rect.left;
  const spaceRight = vw - (rect.left + rect.width);

  let placement = preferred === 'auto'
    ? (spaceBottom >= spaceTop ? 'bottom' : 'top')
    : preferred;

  if (placement === 'bottom' && spaceBottom < panelH + margin) placement = spaceTop >= panelH + margin ? 'top' : 'right';
  else if (placement === 'top' && spaceTop < panelH + margin) placement = spaceBottom >= panelH + margin ? 'bottom' : 'right';
  if (placement === 'right' && spaceRight < panelW + margin) placement = 'left';
  if (placement === 'left' && spaceLeft < panelW + margin) placement = 'bottom';

  let top = 0;
  let left = 0;
  if (placement === 'bottom') {
    top = rect.top + rect.height + margin;
    left = clamp(rect.left + rect.width / 2 - panelW / 2, pad, vw - panelW - pad);
  } else if (placement === 'top') {
    top = Math.max(pad, rect.top - margin - panelH);
    left = clamp(rect.left + rect.width / 2 - panelW / 2, pad, vw - panelW - pad);
  } else if (placement === 'right') {
    top = clamp(rect.top + rect.height / 2 - panelH / 2, pad, vh - panelH - pad);
    left = rect.left + rect.width + margin;
  } else {
    top = clamp(rect.top + rect.height / 2 - panelH / 2, pad, vh - panelH - pad);
    left = Math.max(pad, rect.left - margin - panelW);
  }
  return { style: { top, left, width: panelW }, placement };
}

// ── The walkthrough ───────────────────────────────────────────

function Walkthrough({ tutorial, stepIndex }: { tutorial: TutorialDefinition; stepIndex: number }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { next, back, exit, start } = useTutorialStore();
  const returnTo = useTutorialStore((s) => s.active?.returnTo);
  const user = useCurrentUser();
  const recordStep = useTutorialProgress((s) => s.recordStep);
  const complete = useTutorialProgress((s) => s.complete);
  const resetProgress = useTutorialProgress((s) => s.reset);

  const total = tutorial.steps.length;
  const step = tutorial.steps[Math.min(stepIndex, total - 1)];
  const isLast = stepIndex >= total - 1;
  const isInteractive = step.type === 'click' || step.type === 'input' || step.type === 'select';

  // ── Route handling: navigate first, wait for the page, then resolve ──
  const [routeReady, setRouteReady] = useState(false);
  useEffect(() => {
    if (!step.route) {
      setRouteReady(true);
      return;
    }
    if (pathnameMatches(step.route, location.pathname)) {
      setRouteReady(true);
      return;
    }
    setRouteReady(false);
    navigate(step.route);
  }, [step.route, location.pathname, navigate]);

  // ── Target resolution ──
  const { status: targetStatus, element, rect } = useTarget(step.target, routeReady && !isLast);

  // Scroll the target into view once it appears (not on every frame).
  const scrolledRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (targetStatus === 'found' && element && scrolledRef.current !== element) {
      scrolledRef.current = element;
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }
  }, [targetStatus, element]);

  // ── Interaction detection for click / input / select steps ──
  const [interacted, setInteracted] = useState(false);
  useEffect(() => {
    setInteracted(false);
  }, [stepIndex]);

  useEffect(() => {
    if (!element || isLast || !isInteractive) return;
    if (step.type === 'click') {
      const onDocClick = (e: MouseEvent) => {
        if (element.contains(e.target as Node)) setInteracted(true);
      };
      document.addEventListener('click', onDocClick, true);
      return () => document.removeEventListener('click', onDocClick, true);
    }
    if (step.type === 'input') {
      const onInput = () => setInteracted(true);
      element.addEventListener('input', onInput);
      return () => element.removeEventListener('input', onInput);
    }
    if (step.type === 'select') {
      const onChange = () => setInteracted(true);
      element.addEventListener('change', onChange);
      return () => element.removeEventListener('change', onChange);
    }
  }, [element, isLast, isInteractive, step.type]);

  // Click steps auto-advance once the user actually clicks the control.
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (interacted && step.type === 'click' && !isLast) {
      autoAdvanceTimer.current = setTimeout(() => next(), 550);
    }
    return () => {
      if (autoAdvanceTimer.current) { clearTimeout(autoAdvanceTimer.current); autoAdvanceTimer.current = null; }
    };
  }, [interacted, step.type, isLast, next]);

  // ── Progress tracking ──
  useEffect(() => {
    if (!isLast) recordStep(user?.id ?? '', tutorial.id, stepIndex, total);
  }, [stepIndex, isLast, recordStep, user?.id, tutorial.id, total]);

  const markedComplete = useRef(false);
  useEffect(() => {
    if (!isLast) {
      markedComplete.current = false;
      return;
    }
    if (!markedComplete.current) {
      markedComplete.current = true;
      complete(user?.id ?? '', tutorial.id, total);
    }
  }, [isLast, complete, user?.id, tutorial.id, total]);

  // ── Controls ──
  const finish = useCallback(() => {
    complete(user?.id ?? '', tutorial.id, total);
    exit();
  }, [complete, user?.id, tutorial.id, total, exit]);

  const replay = useCallback(() => {
    resetProgress(user?.id ?? '', tutorial.id);
    start(tutorial.id, 0, returnTo);
  }, [resetProgress, user?.id, tutorial.id, start, returnTo]);

  const handleNext = useCallback(() => {
    if (isLast) { finish(); return; }
    next();
  }, [isLast, finish, next]);

  const handleBack = useCallback(() => {
    back();
  }, [back]);

  const [confirmingExit, setConfirmingExit] = useState(false);
  useEffect(() => { setConfirmingExit(false); }, [stepIndex]);

  const requestExit = useCallback(() => {
    if (stepIndex === 0 || isLast) {
      exit();
      return;
    }
    setConfirmingExit(true);
  }, [stepIndex, isLast, exit]);

  // ── Keyboard navigation (Escape / ← / →), ignoring typing contexts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing) return;
      if (e.key === 'Escape') { e.preventDefault(); requestExit(); }
      else if (e.key === 'ArrowRight' && !isLast) { e.preventDefault(); handleNext(); }
      else if (e.key === 'ArrowLeft' && stepIndex > 0) { e.preventDefault(); handleBack(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestExit, isLast, handleNext, handleBack, stepIndex]);

  // ── Popover measurement + placement ──
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PanelPos | null>(null);
  useLayoutEffect(() => {
    if (isLast) {
      setPos(null);
      return;
    }
    if (routeReady === false) {
      setPos(null);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const pw = panel.offsetWidth || 340;
    const ph = panel.offsetHeight || 200;
    setPos(computePanelPos(rect, step.placement ?? 'auto', pw, ph));
  }, [isLast, routeReady, rect, step.placement]);

  // Focus the panel for keyboard users (not for input steps — the learner
  // needs to type into the REAL control).
  useEffect(() => {
    if (!isLast && routeReady && step.type !== 'input' && step.type !== 'select') {
      panelRef.current?.focus();
    }
  }, [isLast, routeReady, step.type, stepIndex]);

  // Simple focus trap while the instruction panel is up: Tab cycles within
  // the panel's own controls. Escape always exits, so this is never a trap.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusables = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const progressPct = isLast ? 100 : Math.round(((stepIndex + 1) / total) * 100);

  return createPortal(
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-label={`${tutorial.title} — step ${stepIndex + 1} of ${total}`}>
      {/* ── Navigation-in-progress state ── */}
      {!routeReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-overlay)]">
          <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 shadow-[var(--shadow-dropdown)]">
            <Compass className="h-5 w-5 animate-pulse text-[var(--color-primary)]" />
            <p className="text-sm font-medium text-[var(--color-text)]">Taking you to the right screen…</p>
          </div>
        </div>
      )}

      {routeReady && !isLast && rect && (
        <>
          {/* ── Dim regions (block interaction outside the target, using the
              app's own overlay token so dark/light/theme-presets stay natural) ── */}
          <div className="absolute inset-0" aria-hidden="true">
            <div className="absolute bg-[var(--color-overlay)]" style={{ left: 0, top: 0, width: '100vw', height: Math.max(0, rect.top) }} />
            <div className="absolute bg-[var(--color-overlay)]" style={{ left: 0, top: rect.top + rect.height, width: '100vw', height: Math.max(0, window.innerHeight - rect.top - rect.height) }} />
            <div className="absolute bg-[var(--color-overlay)]" style={{ left: 0, top: rect.top, width: Math.max(0, rect.left), height: rect.height }} />
            <div className="absolute bg-[var(--color-overlay)]" style={{ left: rect.left + rect.width, top: rect.top, width: Math.max(0, window.innerWidth - rect.left - rect.width), height: rect.height }} />
          </div>
          {/* ── Spotlight ring around the real element ── */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-[1] animate-[tour-pulse_1.6s_ease-in-out_infinite]"
            style={{
              top: rect.top - 3,
              left: rect.left - 3,
              width: rect.width + 6,
              height: rect.height + 6,
              borderRadius: 'calc(var(--theme-radius, 10px) + 3px)',
              boxShadow: '0 0 0 2px var(--color-primary), 0 0 0 4px rgba(255,255,255,0.4), 0 0 28px 4px var(--color-focus-ring)',
            }}
          />
        </>
      )}

      {/* ── Missing-target recovery ── */}
      {routeReady && !isLast && step.target && targetStatus === 'missing' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-overlay)] p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-dropdown)]">
            <p className="text-sm font-bold text-[var(--color-text)]">{step.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              This step is currently unavailable on this screen — the control it points to is not visible for your role or for the current data.
            </p>
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">{step.description}</p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <ButtonGhost onClick={handleNext}><SkipForward className="h-3.5 w-3.5" /> Skip Step</ButtonGhost>
              <ButtonPrimary onClick={handleNext}>Next</ButtonPrimary>
            </div>
          </div>
        </div>
      )}

      {/* ── Instruction panel ── */}
      {routeReady && !isLast && !(step.target && targetStatus === 'missing') && (
        <div
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={onPanelKeyDown}
          style={{ ...(pos?.style ?? { opacity: 0 }), borderRadius: 'var(--theme-radius)' }}
          className={cn(
            'fixed z-[2] outline-none',
            pos ? 'opacity-100' : 'opacity-0',
            'shadow-[var(--shadow-dropdown)] border border-[var(--color-border)] bg-[var(--color-surface)]',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="rounded-md bg-[var(--color-primary-light)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-primary-text)]">
                Step {stepIndex + 1} of {total}
              </span>
              {isInteractive && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
                  {interacted ? <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" /> : <MousePointerClick className="h-3 w-3" />}
                  {interacted ? 'Done' : 'Try it'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={requestExit}
              aria-label="Exit tutorial"
              className="rounded-lg p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Exit confirmation (in-panel, styled by the design system) */}
          {confirmingExit ? (
            <div className="px-5 py-4">
              <p className="text-sm font-bold text-[var(--color-text)]">Exit this tutorial?</p>
              <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">Your progress is saved automatically — you can resume from the Tutorials list later.</p>
              <div className="mt-4 flex justify-end gap-2">
                <ButtonGhost onClick={() => setConfirmingExit(false)}>Keep Learning</ButtonGhost>
                <ButtonPrimary onClick={exit}>Exit</ButtonPrimary>
              </div>
            </div>
          ) : (
            <>
              <div className="px-5 py-4">
                <p className="text-sm font-bold text-[var(--color-text)]">{step.title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">{step.description}</p>
                {step.type === 'input' && step.inputPlaceholder && (
                  <p className="mt-2 rounded-lg bg-[var(--color-bg-sunken)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)]">
                    Try: {step.inputPlaceholder}
                  </p>
                )}
                {isInteractive && !interacted && step.hint && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-text-muted)]">
                    <Keyboard className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {step.hint}
                  </p>
                )}
              </div>

              {/* Progress bar */}
              <div className="px-5 pb-3">
                <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-bg-sunken)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
                <div className="flex items-center gap-1.5">
                  <ButtonGhost onClick={handleBack} disabled={stepIndex === 0} aria-label="Previous step">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </ButtonGhost>
                  {isInteractive && (
                    <button
                      type="button"
                      onClick={handleNext}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
                    >
                      Skip
                    </button>
                  )}
                </div>
                <ButtonPrimary onClick={handleNext}>
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </ButtonPrimary>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Completion screen ── */}
      {isLast && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-overlay)] p-4">
          <div
            style={{ borderRadius: 'var(--theme-radius)' }}
            className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-7 text-center shadow-[var(--shadow-dropdown)]"
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-success-light)]">
              <CheckCircle2 className="h-8 w-8 text-[var(--color-success)]" />
            </div>
            <h2 className="mt-4 text-lg font-bold text-[var(--color-text)]">Tutorial Completed</h2>
            <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">{step.description}</p>

            <div className="mt-5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4 text-left">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                <ListChecks className="h-3.5 w-3.5" /> You can now
              </p>
              <ul className="mt-2 space-y-1.5">
                {tutorial.learnings.map((l) => (
                  <li key={l} className="flex items-start gap-2 text-[13px] text-[var(--color-text-secondary)]">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-success)]" />
                    {l}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 flex items-center justify-center gap-2">
              <ButtonGhost onClick={replay}><RotateCcw className="h-3.5 w-3.5" /> Replay</ButtonGhost>
              <ButtonPrimary onClick={() => { if (returnTo) navigate(returnTo); exit(); }}>Back to Tutorials</ButtonPrimary>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ── Local button helpers (kept inline to match the design system) ──

function ButtonPrimary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ borderRadius: 'var(--theme-radius)', boxShadow: 'var(--theme-shadow-md)' }}
      className="inline-flex items-center gap-1.5 bg-[var(--color-primary)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-text-inverse)] transition-all hover:bg-[var(--color-primary-hover)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1"
    >
      {children}
    </button>
  );
}

function ButtonGhost({ children, onClick, disabled, 'aria-label': ariaLabel }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; 'aria-label'?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{ borderRadius: 'var(--theme-radius)' }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1"
    >
      {children}
    </button>
  );
}

export type { TutorialStep };
