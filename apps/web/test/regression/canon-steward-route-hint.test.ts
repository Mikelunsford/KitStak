// Regression for F-Wave9-CANON-STEWARD-ROUTE-HINT-01.
//
// scripts/canon-steward-check.mjs is the CI guardrail that fails when a SPA
// route exists with no Sidebar entry pointing at it ("orphan route") unless
// the route is explicitly allowlisted. Two agents recently tripped the
// check by shipping a deep-link-only route without remembering to add an
// allowlist entry, each requiring a chore re-push.
//
// The fix: when the check detects orphan-route violations, emit a
// remediation block that points at the allowlist file and the exact line
// format. The hint must fire exactly once per failed run (not per
// offending route) and must not appear on green runs.
//
// This test verifies both halves of the contract by spawning the script
// against the real tree (green run) and against a synthetic tree with one
// extra orphan route (red run). The synthetic route is patched into
// apps/web/src/routes.ts only for the duration of the test and reverted
// in a finally block; if the test crashes the original file content is
// always restored.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// apps/web/test/regression/ -> repo root.
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const SCRIPT_PATH = resolve(REPO_ROOT, 'scripts', 'canon-steward-check.mjs');
const ROUTES_PATH = resolve(REPO_ROOT, 'apps', 'web', 'src', 'routes.ts');

const SYNTHETIC_ROUTE = '/canon-steward-route-hint-test-orphan';
// Inject a fully-formed route entry before /signin so the file still parses
// as TypeScript if anything happens to read it during the test window. The
// guardrail itself is a regex sweep that only cares about the `path:` key.
const INJECT_MARKER = "    path: '/signin',";
const INJECT_BLOCK = [
  `    path: '${SYNTHETIC_ROUTE}',`,
  '    element: SignInPage,',
  "    guard: 'public',",
  "    layout: 'unauthenticated',",
  '  },',
  '  {',
  "    path: '/signin',",
].join('\n');

function runScript(): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT_PATH], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('canon-steward-check orphan-route hint', () => {
  let originalRoutes: string;

  beforeEach(() => {
    originalRoutes = readFileSync(ROUTES_PATH, 'utf8');
  });

  afterEach(() => {
    // Always restore, even on assertion failure.
    writeFileSync(ROUTES_PATH, originalRoutes, 'utf8');
  });

  it('does not emit the hint on a clean tree', () => {
    const { status, stdout } = runScript();
    expect(status).toBe(0);
    expect(stdout).toBe('');
    expect(stdout).not.toContain('[canon-steward] Orphan route');
  });

  it('emits the hint exactly once when an orphan route is present', () => {
    const patched = originalRoutes.replace(INJECT_MARKER, INJECT_BLOCK);
    expect(patched).not.toBe(originalRoutes);
    writeFileSync(ROUTES_PATH, patched, 'utf8');

    const { status, stdout } = runScript();
    expect(status).toBe(1);
    expect(stdout).toContain(
      `Route ${SYNTHETIC_ROUTE} is registered but not reachable from Sidebar.tsx`,
    );
    expect(stdout).toContain('[canon-steward] Orphan route(s) detected.');
    expect(stdout).toContain('Option A: Add a Sidebar entry');
    expect(stdout).toContain(
      'Option B: If the route is intentionally orphan',
    );
    expect(stdout).toContain(
      'orphan-route|apps/web/src/routes.ts|<route-path>',
    );

    // Fires exactly once per run, even if multiple orphan routes existed.
    const occurrences = stdout.match(
      /\[canon-steward\] Orphan route\(s\) detected\./g,
    );
    expect(occurrences).not.toBeNull();
    expect(occurrences?.length).toBe(1);
  });

  it('emits the hint only once when multiple orphan routes are present', () => {
    const SECOND_SYNTHETIC = '/canon-steward-route-hint-test-orphan-two';
    const secondBlock = [
      `    path: '${SECOND_SYNTHETIC}',`,
      '    element: SignInPage,',
      "    guard: 'public',",
      "    layout: 'unauthenticated',",
      '  },',
      '  {',
      "    path: '/signin',",
    ].join('\n');
    // Inject the first synthetic, then chain the second onto the same
    // anchor. Both produce orphan-route violations.
    const firstPatch = originalRoutes.replace(INJECT_MARKER, INJECT_BLOCK);
    const patched = firstPatch.replace(INJECT_MARKER, secondBlock);
    writeFileSync(ROUTES_PATH, patched, 'utf8');

    const { status, stdout } = runScript();
    expect(status).toBe(1);
    expect(stdout).toContain(SYNTHETIC_ROUTE);
    expect(stdout).toContain(SECOND_SYNTHETIC);

    const occurrences = stdout.match(
      /\[canon-steward\] Orphan route\(s\) detected\./g,
    );
    expect(occurrences?.length).toBe(1);
  });
});
