import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './components/shell/ErrorBoundary';
import { initAnalytics } from './lib/analytics';
import './styles.css';

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
