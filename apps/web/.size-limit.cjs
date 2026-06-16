module.exports = [
  // SPA entry chunk. Must stay lean: no vendor code lands here.
  {
    name: 'SPA index chunk',
    path: 'dist/assets/index-*.js',
    limit: '40 KB',
    gzip: true,
  },

  // React + react-dom + react-router-dom vendor chunk (manualChunks: react).
  // Current: ~52.5 kB gzip. Headroom: ~10 kB.
  {
    name: 'React vendor chunk',
    path: 'dist/assets/react-*.js',
    limit: '63 KB',
    gzip: true,
  },

  // Supabase JS client vendor chunk (manualChunks: supabase).
  // Current: ~52.2 kB gzip. Headroom: ~10 kB.
  {
    name: 'Supabase vendor chunk',
    path: 'dist/assets/supabase-*.js',
    limit: '63 KB',
    gzip: true,
  },

  // R-W13-DX-01: lazy observability chunks (sentry, posthog).
  //
  // These two SDKs are dynamic-imported (manualChunks.sentry / .posthog in
  // vite.config.ts) from src/lib/sentry.ts and src/lib/analytics.ts. Both
  // are no-op when their env key (VITE_SENTRY_DSN / VITE_POSTHOG_KEY) is
  // absent at build: the dynamic import is unreachable post-Vite-define and
  // Rollup tree-shakes the SDK out, leaving a sub-1 kB stub chunk.
  //
  // CI builds WITHOUT the secrets (see .github/workflows/ci.yml: the build
  // step has no VITE_SENTRY_DSN / VITE_POSTHOG_KEY env), so size-limit runs
  // against the stub. The activation build (deploy-prod.yml) injects the
  // secrets and ships the full SDK, but that workflow does not run
  // size-limit, so a stub-scoped budget never blocks activation.
  //
  // The regression these budgets catch: a refactor that makes either SDK
  // eagerly imported (non-lazy). That would either balloon the stub chunk
  // past the budget here, or fold the SDK into the index chunk and trip the
  // 40 kB SPA index budget above. Either way the regression fails CI.
  //
  // Current: sentry stub ~0.07 kB gzip, posthog stub ~0.04 kB gzip. The
  // 2 kB cap leaves generous headroom for stub-shape churn while staying
  // far below the full-SDK sizes (sentry ~25 kB, posthog ~30 kB gzip) so an
  // accidental eager bundle is caught.
  {
    name: 'Sentry lazy chunk (no-op stub when DSN absent)',
    path: 'dist/assets/sentry-*.js',
    limit: '2 KB',
    gzip: true,
  },
  {
    name: 'PostHog lazy chunk (no-op stub when key absent)',
    path: 'dist/assets/posthog-*.js',
    limit: '2 KB',
    gzip: true,
  },

  // TanStack Query vendor chunk (manualChunks: query).
  // Current: ~12.5 kB gzip. Headroom: ~5 kB.
  {
    name: 'TanStack Query vendor chunk',
    path: 'dist/assets/query-*.js',
    limit: '18 KB',
    gzip: true,
  },

  // Sonner toast vendor chunk (manualChunks: sonner).
  // Current: ~9.3 kB gzip. Headroom: ~4 kB.
  {
    name: 'Sonner toast vendor chunk',
    path: 'dist/assets/sonner-*.js',
    limit: '14 KB',
    gzip: true,
  },

  // PhasesSection chunk (contains dnd-kit; lazy-split from ProjectDetailPage).
  // Current: ~16.1 kB gzip. Headroom: ~6 kB.
  {
    name: 'PhasesSection (dnd-kit) chunk',
    path: 'dist/assets/PhasesSection-*.js',
    limit: '22 KB',
    gzip: true,
  },

  // KitCost dashboard chunk (contains recharts; operator-approved, lazy route).
  // Must never land in the main SPA index chunk. Budget enforces the isolation.
  // Current: ~107 kB gzip. Headroom: ~20 kB.
  {
    name: 'KitCost dashboard (recharts) chunk',
    path: 'dist/assets/KitCostDashboardPage-*.js',
    limit: '130 KB',
    gzip: true,
  },
];
