// Regression for F-Wave10-REVIEW-REMEDIATION (WS-F / F3).
//
// scripts/migration-header-format-check.mjs is the CI guardrail that fails when
// a FUTURE numbered migration (number >= ENFORCE_FROM) is missing any of the
// canonical header fields: the `-- ====` separator, Migration, Wave, Phase,
// Closes, Date, and Constitutional alignment (see CLAUDE.md "Migration rules").
//
// Already-applied migrations are frozen by the forward-only rule, so the guard
// grandfathers everything below ENFORCE_FROM. This suite proves the standalone
// script (a) passes on the real tree and (b) fails with a clear remediation
// message when a future migration omits required header fields. The red case is
// produced by writing a synthetic high-numbered migration with a bare header,
// then deleting it in a finally / afterEach so a crashed test never leaves a
// stray migration on disk.

import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// apps/web/test/regression/ -> repo root.
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const SCRIPT_PATH = resolve(
  REPO_ROOT,
  'scripts',
  'migration-header-format-check.mjs',
);
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'supabase', 'migrations');

// A synthetic migration number safely above any real migration and above the
// script's ENFORCE_FROM boundary, so the guard evaluates it.
const SYNTH_FILE = '9991_migration_header_guard_synthetic.sql';
const SYNTH_PATH = join(MIGRATIONS_DIR, SYNTH_FILE);

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

const CANONICAL_HEADER = [
  '-- ============================================================================',
  `-- Migration: ${SYNTH_FILE}`,
  '-- Wave: 99',
  '-- Phase: synthetic test fixture',
  '-- Closes: NONE (test-only)',
  '-- Date: 2026-06-01',
  '--',
  '-- Constitutional alignment:',
  '--   * Test-only synthetic migration. Never applied to any database.',
  '-- ============================================================================',
  '',
  'select 1;',
  '',
].join('\n');

describe('migration-header-format-check guard', () => {
  afterEach(() => {
    // Always remove the synthetic migration, even on assertion failure.
    if (existsSync(SYNTH_PATH)) rmSync(SYNTH_PATH);
  });

  it('passes on the real migration tree (no synthetic file present)', () => {
    expect(existsSync(SYNTH_PATH)).toBe(false);
    const { status, stdout } = runScript();
    expect(status).toBe(0);
    expect(stdout).not.toContain('violations found');
  });

  it('passes when a future migration carries the canonical header', () => {
    writeFileSync(SYNTH_PATH, CANONICAL_HEADER, 'utf8');
    const { status, stdout } = runScript();
    expect(status).toBe(0);
    expect(stdout).not.toContain('violations found');
  });

  it('fails when a future migration omits required header fields', () => {
    // Bare header: a single comment line, no separator, no labelled fields.
    const bare = ['-- just a migration', 'select 1;', ''].join('\n');
    writeFileSync(SYNTH_PATH, bare, 'utf8');

    const { status, stdout } = runScript();
    expect(status).toBe(1);
    expect(stdout).toContain('violations found');
    expect(stdout).toContain(SYNTH_FILE);
    expect(stdout).toContain('separator');
    expect(stdout).toContain('Migration');
    expect(stdout).toContain('Constitutional alignment');
  });

  it('fails when a future migration drops a single required field', () => {
    // Canonical header minus the Closes line only.
    const missingCloses = CANONICAL_HEADER.split('\n')
      .filter((l) => !/^--\s*Closes:/i.test(l.trim()))
      .join('\n');
    writeFileSync(SYNTH_PATH, missingCloses, 'utf8');

    const { status, stdout } = runScript();
    expect(status).toBe(1);
    expect(stdout).toContain('violations found');
    expect(stdout).toContain('Closes');
  });
});
