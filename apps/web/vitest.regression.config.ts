import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Regression test config. Loads edge-function `index.ts` modules (Deno-targeted)
// under Vitest by aliasing the Deno-style URL specifiers to local Node-friendly
// modules.
//
// Why this exists: the Kitstak edge handlers run under Deno and import from
// esm.sh by URL (`https://esm.sh/zod@3.23.8`, `https://esm.sh/@supabase/supabase-js@2.45.0`).
// To exercise their HTTP-level behaviour under Vitest without standing up a
// Supabase project or running Deno, we:
//   1. Rewrite `https://esm.sh/zod@...` to the bundled `zod` on disk (same
//      trick the contract config uses).
//   2. Rewrite `https://esm.sh/@supabase/supabase-js@...` to a local stub that
//      returns an in-memory query builder. Each test seeds the stub state.
//   3. Install a `globalThis.Deno` shim that captures `Deno.serve(handler)`
//      so tests can invoke the handler with a forged `Request`.
//
// Drift between this approach and the production runtime is intentional and
// surface-deep: PostgREST semantics are reproduced only to the extent the
// handlers exercise them. The bugs under test live in handler-local code
// (return-statement of `next_cursor`, presence/absence of `.limit()`, and the
// behaviour of `deliverChannel` in `notifications-worker`), all of which are
// faithfully reproducible with the mock surface.

const denoZodPattern =
  /^https:\/\/(?:deno\.land\/x\/zod(?:@v?[\d.]+)?\/mod\.ts|esm\.sh\/zod(?:@\d[\w.-]*)?)$/;

const denoSupabasePattern =
  /^https:\/\/esm\.sh\/@supabase\/supabase-js(?:@[\w.-]+)?$/;

const supabaseStubPath = path.resolve(
  __dirname,
  './test/regression/_helpers/supabase-stub.ts',
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
        if (denoSupabasePattern.test(source)) {
          return { id: supabaseStubPath, external: false };
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
