import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Regression test config. Loads edge-function `index.ts` modules (Deno-targeted)
// under Vitest by aliasing the Deno import-map specifiers to local
// Node-friendly modules.
//
// Why this exists: the Kitstak edge handlers run under Deno and import their
// deps through `supabase/functions/deno.json` (`zod`,
// `@supabase/supabase-js`). Pre-F-Wave7-ESM-SH-DRIFT-01 these were
// `https://esm.sh/...` URL imports; the conversion to bare specifiers means
// the Node test harness resolves `zod` from node_modules naturally, but we
// still need to redirect `@supabase/supabase-js` to a local in-memory stub
// so tests can seed query state. To exercise the handlers' HTTP-level
// behaviour under Vitest without standing up a Supabase project or running
// Deno, we:
//   1. Let `zod` resolve from node_modules (same version pinned in
//      apps/web/package.json and supabase/functions/deno.json).
//   2. Rewrite `@supabase/supabase-js` (and the legacy esm.sh URL form, for
//      defence in depth) to a local stub that returns an in-memory query
//      builder. Each test seeds the stub state.
//   3. Install a `globalThis.Deno` shim that captures `Deno.serve(handler)`
//      so tests can invoke the handler with a forged `Request`.
//
// Drift between this approach and the production runtime is intentional and
// surface-deep: PostgREST semantics are reproduced only to the extent the
// handlers exercise them. The bugs under test live in handler-local code
// (return-statement of `next_cursor`, presence/absence of `.limit()`, and the
// behaviour of `deliverChannel` in `notifications-worker`), all of which are
// faithfully reproducible with the mock surface.

// Legacy CDN forms retained for defence in depth; the production source no
// longer uses these after F-Wave7-ESM-SH-DRIFT-01.
const denoZodPattern =
  /^https:\/\/(?:deno\.land\/x\/zod(?:@v?[\d.]+)?\/mod\.ts|esm\.sh\/zod(?:@\d[\w.-]*)?)$/;

const denoSupabasePattern =
  /^https:\/\/esm\.sh\/@supabase\/supabase-js(?:@[\w.-]+)?$/;

const supabaseStubPath = path.resolve(
  __dirname,
  './test/regression/_helpers/supabase-stub.ts',
);

// billing-api edge bundle imports `stripe` (mapped to npm:stripe@^17 by
// supabase/functions/deno.json). The Stripe package is Deno-runtime only in
// this repo; under Vitest we rewrite the bare specifier to a local in-memory
// fake so tests can assert calls without a real Stripe HTTP round trip.
const stripeStubPath = path.resolve(
  __dirname,
  './test/regression/_helpers/stripe-stub.ts',
);

export default defineConfig({
  plugins: [
    {
      name: 'kitstak-deno-url-rewrite',
      enforce: 'pre',
      resolveId(source) {
        if (denoZodPattern.test(source)) {
          return { id: 'zod', external: false };
        }
        if (source === '@supabase/supabase-js' || denoSupabasePattern.test(source)) {
          return { id: supabaseStubPath, external: false };
        }
        if (source === 'stripe') {
          return { id: stripeStubPath, external: false };
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['test/regression/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
