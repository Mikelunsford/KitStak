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
