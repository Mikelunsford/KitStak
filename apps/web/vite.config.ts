import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          supabase: ['@supabase/supabase-js'],
          // F-Wave5-CO-02: posthog-js is dynamic-imported from
          // src/lib/analytics.ts. Named manually so the lazy chunk
          // is recognisable in dist and survives tree-shaking when
          // VITE_POSTHOG_KEY is absent at build time.
          posthog: ['posthog-js'],
          // F-Wave5-CO-01 / F-Wave3-OBS-01 (SPA portion): @sentry/react
          // is dynamic-imported from src/lib/sentry.ts. Named so the
          // lazy chunk is recognisable in dist; tree-shaken entirely
          // when VITE_SENTRY_DSN is absent at build time.
          sentry: ['@sentry/react'],
        },
      },
    },
  },
});
