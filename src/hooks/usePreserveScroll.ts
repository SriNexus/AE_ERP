import { useLayoutEffect, useRef } from 'react';

/**
 * usePreserveScroll — wraps a toggle callback (expand/collapse an accordion
 * section, switch a peek card's "show all" state, etc.) so the nearest
 * scrollable ancestor's `scrollTop` is captured immediately before the state
 * change and restored synchronously after the DOM commits.
 *
 * Root cause this defends against: any accordion/expand toggle that briefly
 * shrinks the rendered content (a lazy-loaded chunk's Suspense fallback, a
 * loading skeleton, content genuinely growing/shrinking) can make the
 * browser clamp `scrollTop` down when `scrollHeight` momentarily drops below
 * it — the container never recovers its old position once the content
 * regrows. `useLayoutEffect` (not `requestAnimationFrame`) restores it
 * before the browser paints, so there is no visible jump-then-correct flash.
 *
 * Scoped to the nearest `.overflow-y-auto` ancestor via `rootRef` (the
 * component's own root element) rather than a prop-drilled ref — both
 * Customer and Lead Workspace's center scroll containers already carry that
 * exact class, so this works without threading a ref through the page
 * component that owns the actual scrollable div.
 */
export function usePreserveScroll<T extends (...args: any[]) => void>(
  rootRef: React.RefObject<HTMLElement | null>,
  toggle: T
): T {
  const savedTop = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (savedTop.current === null) return;
    const scrollEl = rootRef.current?.closest<HTMLElement>('.overflow-y-auto');
    if (scrollEl) scrollEl.scrollTop = savedTop.current;
    savedTop.current = null;
  });

  return ((...args: Parameters<T>) => {
    const scrollEl = rootRef.current?.closest<HTMLElement>('.overflow-y-auto');
    savedTop.current = scrollEl ? scrollEl.scrollTop : null;
    toggle(...args);
  }) as T;
}
