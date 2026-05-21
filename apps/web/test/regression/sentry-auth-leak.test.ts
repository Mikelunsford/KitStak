// F-Wave9-SENTRY-SOURCEMAPS-01 contract test.
//
// The `@sentry/vite-plugin` (configured in `apps/web/vite.config.ts`)
// reads three build-time env vars: `SENTRY_ORG`, `SENTRY_PROJECT`, and
// `SENTRY_AUTH_TOKEN`. The plugin uses them to upload production source
// maps to Sentry so server-side deminification of stack traces works.
//
// Critically, none of these vars carry a `VITE_` prefix, which means
// Vite's `define` step does NOT substitute them into the SPA bundle at
// compile time. This test enforces that posture against future
// regressions:
//
//   1. After every production build, scan every file emitted to `dist/`
//      and assert no chunk contains the literal substring `sentry_auth`
//      (case-insensitive). Catches the case where a future hand-edit to
//      `vite.config.ts` accidentally drops the var into a string
//      template that Rollup then inlines.
//
//   2. If `SENTRY_AUTH_TOKEN` is set at test runtime, additionally
//      assert no chunk contains its literal value. Catches the case
//      where the var leaks via some other path (e.g. an inline
//      `process.env.SENTRY_AUTH_TOKEN` in a SPA-side module that the
//      dead-code eliminator failed to strip).
//
// When `dist/` is absent (fresh checkout without a build), the test
// skips with a clear message rather than failing. Mirrors the
// skip-guard pattern used by the nightly RLS probe.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const DIST_DIR = path.resolve(__dirname, '../../dist');

// Recursively list every file under a directory. Returns absolute paths.
async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

describe('F-Wave9-SENTRY-SOURCEMAPS-01 — SPA bundle must not leak SENTRY_AUTH_TOKEN', () => {
  it('no file in dist/ contains the literal substring "sentry_auth" (case-insensitive)', async () => {
    if (!existsSync(DIST_DIR) || !statSync(DIST_DIR).isDirectory()) {
      // Fresh checkout, no build yet. The test is a build-output contract;
      // there is nothing meaningful to assert against until a build has
      // produced dist/. Same skip-guard shape as the nightly RLS probe.
      console.log(
        '[sentry-auth-leak] dist/ absent; skipping. Run `pnpm -C apps/web build` first to exercise this test.',
      );
      return;
    }

    const files = await listFilesRecursive(DIST_DIR);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      if (contents.toLowerCase().includes('sentry_auth')) {
        offenders.push(path.relative(DIST_DIR, file));
      }
    }

    expect(
      offenders,
      `dist/ files containing the substring "sentry_auth" (case-insensitive): ${offenders.join(', ')}. SENTRY_AUTH_TOKEN must never be substituted into the SPA bundle. Check that the env var is read via process.env (build-time) only, not import.meta.env (SPA-time).`,
    ).toEqual([]);
  });

  it('no file in dist/ contains the literal value of SENTRY_AUTH_TOKEN if it is set at test runtime', async () => {
    const token = process.env.SENTRY_AUTH_TOKEN;
    if (!token) {
      // No token at test runtime. The first assertion above already covers
      // the substring case; the literal-value check requires a real token
      // to be meaningful.
      console.log(
        '[sentry-auth-leak] SENTRY_AUTH_TOKEN not set at test runtime; literal-value check is informational only.',
      );
      return;
    }

    if (!existsSync(DIST_DIR) || !statSync(DIST_DIR).isDirectory()) {
      console.log('[sentry-auth-leak] dist/ absent; skipping literal-value check.');
      return;
    }

    const files = await listFilesRecursive(DIST_DIR);
    const offenders: string[] = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      if (contents.includes(token)) {
        offenders.push(path.relative(DIST_DIR, file));
      }
    }

    expect(
      offenders,
      `dist/ files containing the literal SENTRY_AUTH_TOKEN value: ${offenders.join(', ')}. The token must be a build-time-only env var (no VITE_ prefix).`,
    ).toEqual([]);
  });
});
