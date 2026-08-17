/**
 * queryClient — the single React Query client instance for the whole app.
 *
 * Lives in its own leaf module (no React, no store imports) so that
 * non-component code — e.g. useAppStore.ts's `logout()` — can import and
 * clear it directly, without a circular dependency on
 * app/providers/index.tsx (which itself pulls in components that read from
 * useAppStore). Previously this was a `const` defined inline inside
 * app/providers/index.tsx (still re-exported from there for compatibility);
 * moved here specifically so `logout()` and the demo-reset flow can
 * invalidate every cached query on session change instead of leaving up to
 * `gcTime` (30 minutes) of stale query results rendering after a Demo
 * reset or a real logout/login cycle in the same tab.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:             1000 * 60 * 5,
      gcTime:                1000 * 60 * 30,
      retry:                 2,
      refetchOnWindowFocus:  false,
      refetchOnReconnect:    true,
    },
  },
});
