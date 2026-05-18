import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * ErrorBoundary. last-ditch catcher for render-time errors anywhere below
 * the App tree. Render-time errors above this point (router init, auth
 * provider) are not catchable; everything inside renders this brand-clean
 * fallback. React 18 still requires a class component for componentDidCatch.
 *
 * The fallback is intentionally minimal: no router-dependent navigation,
 * just a hard reload. The Reload button is keyboard-reachable.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(_error: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] render error', error, info);
    }
  }

  handleReload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="min-h-screen flex items-center justify-center bg-bg px-6">
        <div className="w-full max-w-md bg-bg-2 border border-line p-10 flex flex-col gap-6">
          <h1 className="text-4xl font-display tracking-wide text-ink">
            SOMETHING WENT WRONG
          </h1>
          <p className="font-sans text-ink-dim">
            Refresh to try again.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="self-start px-4 py-2 bg-accent text-on-primary font-display tracking-wider text-sm"
          >
            RELOAD
          </button>
        </div>
      </main>
    );
  }
}
