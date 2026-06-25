import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import path from 'path';

import { version as pkgVersion } from './package.json';

// F-Wave9-SENTRY-SOURCEMAPS-01: production source-map upload.
//
//   1. `build.sourcemap: 'hidden'` emits `.map` files to `dist/` but
//      strips the `//# sourceMappingURL=` comment from the JS bundle, so
//      the SPA never tells a browser where the maps live (private maps,
//      per operator decision).
//
//   2. `sentryVitePlugin` runs at the end of the build. When
//      `SENTRY_AUTH_TOKEN` is set in the environment, it uploads the
//      maps to Sentry (so Sentry deminifies stack traces server-side)
//      and then deletes every `.map` file from `dist/`. When the token
//      is absent the plugin no-ops, matching the existing
//      `VITE_SENTRY_DSN`-absent posture. CI without the token (preview
//      builds, contributor checkouts) builds clean and ships nothing
//      to Sentry.
//
//   3. The plugin reads `SENTRY_*` (no `VITE_` prefix) so the values
//      never reach the SPA bundle via Vite's `define`. The
//      `sentry-auth-leak` contract test scans `dist/` after every build
//      to enforce this; see test/regression/sentry-auth-leak.test.ts.
//
//   4. `release.name` derives from `VERCEL_GIT_COMMIT_SHA` (Vercel
//      injects this at build time). Falls back to a stable constant for
//      local builds so the plugin still has a release name to attach
//      uploads to.

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const release = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local-dev';

// Build-time constants for the support-ticketing context capture (migration
// 0140). SendFeedbackModal silently records which app version and commit a
// tester was on when they filed, so an operator triaging the staff inbox knows
// exactly what build a bug came from. The version reads from this package's
// `version` field; the commit reads from the CI build SHA (GitHub Actions or
// Vercel), falling back to 'dev' for local builds where no SHA is injected.
// Declared as ambient globals in src/vite-env.d.ts.
const appVersion = process.env.npm_package_version ?? pkgVersion;
const buildCommit =
  process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  plugins: [
    react(),
    sentryVitePlugin({
      org: sentryOrg,
      project: sentryProject,
      authToken: sentryAuthToken,
      release: { name: release },
      sourcemaps: {
        // Maps are emitted to dist/ as a side effect of sourcemap:
        // 'hidden'. The plugin uploads them to Sentry, then deletes
        // every .map file from dist/ so they never ship publicly.
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
      // No-op posture when the auth token is absent. Matches the
      // VITE_SENTRY_DSN-absent posture on the SPA side.
      disable: !sentryAuthToken,
      // Keep build logs quiet on success; surface only on failure.
      silent: true,
      // The plugin should never break the build. If upload fails (auth
      // expired, Sentry down, network blip) the build still succeeds
      // and ships the bundle. Source maps remain in dist/ for the
      // contract test to assert on; CI is expected to flag the upload
      // failure separately via Sentry's release-tracking dashboard.
      errorHandler: () => {
        // Intentional no-op: capture is observational, build must not
        // break. The plugin logs internally even with silent: true when
        // errorHandler swallows. Acceptable.
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // 'hidden' emits .map files to dist/ but does NOT add the
    // //# sourceMappingURL= comment to the JS bundle. The plugin
    // consumes the maps then deletes them; nothing exposing the maps
    // ships to end users.
    sourcemap: 'hidden',
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
          // Stripe wiring (item 9): sonner is dynamic-imported in
          // main.tsx and used by BillingPage. Named so the lazy chunk
          // does not land with an `index-*.js` filename that would
          // collide with the size-limit glob for the SPA index chunk.
          sonner: ['sonner'],
        },
      },
    },
  },
});
