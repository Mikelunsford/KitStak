import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Contract test config. Loads _shared/*.ts (Deno-targeted) under Vitest by
// rewriting Deno-style URL imports to the bare 'zod' specifier at load
// time. _shared/types.ts and _shared/workflow.ts may import zod from one
// of several Deno URL forms across waves; we normalise them all to the
// bundled zod that the SPA already has on disk so the byte-parity test
// and behaviour-parity test both run without spawning Deno.
//
// Drift between the SPA copy and the _shared copy is a release blocker
// (CLAUDE.md Zod canon). The byte-equality test in parity.test.ts is
// authoritative; this config exists to keep behaviour-parity tests like
// money.parity.test.ts importable on Node.

const denoZodPattern =
  /^https:\/\/(?:deno\.land\/x\/zod(?:@v?[\d.]+)?\/mod\.ts|esm\.sh\/zod(?:@\d[\w.-]*)?)$/;

export default defineConfig({
  plugins: [
    {
      name: 'kitstak-deno-zod-rewrite',
      enforce: 'pre',
      resolveId(source) {
        if (denoZodPattern.test(source)) {
          return { id: 'zod', external: false };
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
    include: ['test/contract/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
