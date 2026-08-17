/**
 * ErrorBoundary — Production-grade React error boundary
 * Catches render errors, shows graceful fallback UI.
 */

import React, { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children:  ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError:    boolean;
  error?:      Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production: send to error monitoring (Sentry, etc.)
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-[var(--color-bg)] text-center">
          <div className="max-w-md">
            <div className="h-16 w-16 bg-[var(--color-danger-light)] rounded-2xl flex items-center justify-center mx-auto mb-6">
              <svg className="h-8 w-8 text-[var(--color-danger)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-[var(--color-text)] mb-2">
              Something went wrong
            </h1>
            <p className="text-[var(--color-text-muted)] text-sm mb-6">
              {this.state.error?.message || 'An unexpected error occurred. Please try refreshing the page.'}
            </p>
            <button
              onClick={this.handleReset}
              className="px-5 py-2.5 bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-text-inverse)] text-sm font-semibold rounded-lg transition-colors"
            >
              Return to Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
