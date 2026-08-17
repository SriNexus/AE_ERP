/**
 * useMobileDetect — Responsive detection hook
 *
 * Tracks viewport width and returns whether the mobile shell
 * should be rendered (< 1024px) vs the desktop shell (>= 1024px).
 *
 * Re-evaluates on window resize with a debounce to prevent
 * layout thrashing during orientation changes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { MOBILE_BREAKPOINT } from '../types';

const DEBOUNCE_MS = 100;

function getIsMobile(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function useMobileDetect(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(getIsMobile);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleResize = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIsMobile(getIsMobile());
    }, DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [handleResize]);

  return isMobile;
}
