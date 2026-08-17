import React from 'react';
import { logError } from '../../lib/monitoring';

type ErrorBoundaryProps = {
  children: React.ReactNode;
  monitoringContext?: Record<string, unknown>;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logError(error, { ...this.props.monitoringContext, componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-text)]">
          <p className="mb-4 text-sm font-semibold">Something went wrong.</p>
          <button
            type="button"
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-foreground)]"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
