import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './components/shell/ErrorBoundary';
import { initAnalytics } from './lib/analytics';
import { lazyWithReload as lazy } from './lib/lazyWithReload';
import { initSentry } from './lib/sentry';
import './styles.css';

// Lazy-load sonner so the ~10 kB gzip toast library lands in its own
// chunk instead of bloating the SPA index chunk past the 40 kB budget.
// The Toaster mounts in the React tree but renders nothing until the
// first toast() call, so the suspense boundary never flashes.
const Toaster = lazy(() =>
  import('sonner').then((m) => ({ default: m.Toaster })),
);

// F-Wave5-CO-01 / F-Wave3-OBS-01 (SPA portion): fire Sentry init BEFORE
// React renders so any render-time error during the very first paint is
// still captured. The dynamic import inside initSentry is fire-and-forget;
// the network round trip never blocks the render path. No-op when
// VITE_SENTRY_DSN is absent at build (dev and DSN-less previews).
if (import.meta.env.VITE_SENTRY_DSN) {
  void initSentry();
}

// Per 00-canon/01-architecture.md "State management": staleTime 30_000,
// refetchOnWindowFocus false, retry 1. Configured once here so every
// useQuery call inherits the policy.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
            <App />
            <Suspense fallback={null}>
              <Toaster position="top-right" richColors closeButton />
            </Suspense>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

// F-Wave5-CO-02: lazy-loaded PostHog analytics. Fire-and-forget so the
// init network round trip never blocks the React render path. No-op
// when VITE_POSTHOG_KEY is absent (dev / staging without analytics).
if (import.meta.env.VITE_POSTHOG_KEY) {
  void initAnalytics();
}
