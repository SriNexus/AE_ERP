/**
 * AppProviders — centralized provider composition
 * QueryClient, ThemeProvider, BrowserRouter, ErrorBoundary, Toaster.
 */

import { type ReactNode, Suspense } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { ErrorBoundary } from './ErrorBoundary';
import { DemoExternalActionGuard } from '../../components/auth/DemoExternalActionGuard';
import { TutorialEngine } from '../../features/tutorials';
import { queryClient } from '../../lib/queryClient';

// Re-exported for any existing import site; the instance itself now lives in
// src/lib/queryClient.ts (a leaf module, safe for non-component code like
// useAppStore.ts's logout() to import without a circular dependency).
export { queryClient };

// ── Toast config ─────────────────────────────────────────────
const TOAST_OPTIONS = {
  duration: 3500,
  style: { background: '#1e293b', color: '#f1f5f9', fontSize: '13px', borderRadius: '12px', padding: '10px 16px' },
  success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
  error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
} as const;

// ── Loading fallback ─────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-[var(--color-bg)]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      </div>
    </div>
  );
}

// ── AppProviders ─────────────────────────────────────────────
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrowserRouter>
            <DemoExternalActionGuard />
            {/* Interactive tutorial overlay — mounted inside the Router so it
                survives route changes; renders only while a tutorial is active. */}
            <TutorialEngine />
            <Suspense fallback={<PageLoader />}>
              {children}
            </Suspense>
          </BrowserRouter>
          <Toaster position="top-right" toastOptions={TOAST_OPTIONS} />
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
