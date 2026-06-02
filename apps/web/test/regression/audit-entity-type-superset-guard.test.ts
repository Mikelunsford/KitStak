// Regression for F-Wave10-REVIEW-REMEDIATION (WS-C / C3).
//
// scripts/audit-entity-type-superset-check.mjs is the CI guardrail that fails
// when the highest-numbered migration redefining audit_log_entity_type_check
// enumerates a NARROWER list than some earlier redefinition. That subset shape
// is exactly the 0078-0081 regression (R-W10-AUDIT-01): the KitForce migrations
// copied the 0073 entity_type list and silently dropped the four Co-Pack types,
// so every Co-Pack MAKE audit write 500'd on prod until 0083 restored them.
//
// The existing db-0083-audit-entity-type-superset.test.ts asserts the invariant
// against the real tree only. This suite additionally proves the standalone
// script (a) passes on the real tree and (b) fails with a clear remediation
// message when a later migration narrows the list. The red case is produced by
// writing a synthetic higher-numbered migration that recreates the constraint
// with one allowed entity_type removed, then deleting it in a finally block so
// a crashed test never leaves a stray migration on disk.

import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// apps/web/test/regression/ -> repo root.
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const SCRIPT_PATH = resolve(
  REPO_ROOT,
  'scripts',
  'audit-entity-type-superset-check.mjs',
);
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'supabase', 'migrations');

// A synthetic migration number safely above any real migration. Four-digit
// zero-padded so the script's `^(\d{4})_` matcher accepts it and so it sorts
// last (making it the "latest" redefinition the guard evaluates).
const SYNTH_FILE = '9990_audit_superset_guard_synthetic_narrow.sql';
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

// Read the current authoritative entity_type list straight from the real latest
// redefinition so the synthetic "narrowed" migration is genuinely a strict
// subset regardless of which migration is currently authoritative.
function latestRealTypes(): { file: string; types: string[] } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let latest: { num: number; file: string; types: string[] } | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const addIdx = sql.search(/add constraint audit_log_entity_type_check/i);
    if (addIdx === -1) continue;
    const tail = sql.slice(addIdx);
    const closeIdx = tail.indexOf('));');
    const block = closeIdx === -1 ? tail : tail.slice(0, closeIdx);
    const cleaned = block.replace(/--[^\n]*/g, '');
    const types: string[] = [];
    for (const m of cleaned.matchAll(/'([a-z][a-z0-9_]*)'/g)) {
      types.push(m[1]);
    }
    const numMatch = file.match(/^(\d{4})_/);
    if (!numMatch) continue;
    const num = Number(numMatch[1]);
    if (!latest || num > latest.num) latest = { num, file, types };
  }
  if (!latest) throw new Error('no audit_log_entity_type_check redefinition found');
  return { file: latest.file, types: latest.types };
}

describe('audit-entity-type-superset-check guard', () => {
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

  it('fails when a later migration narrows the entity_type list', () => {
    const { types } = latestRealTypes();
    expect(types.length).toBeGreaterThan(1);

    // Drop exactly one allowed entity_type to create a strict-subset latest.
    const dropped = types[0];
    const kept = types.slice(1);
    const inList = kept.map((t) => `'${t}'`).join(', ');

    const synthetic = [
      '-- Synthetic test-only migration. Written and deleted by',
      '-- audit-entity-type-superset-guard.test.ts. Never applied to any database.',
      'alter table public.audit_log',
      '  drop constraint if exists audit_log_entity_type_check;',
      'alter table public.audit_log',
      `  add constraint audit_log_entity_type_check check (entity_type in (${inList}));`,
      '',
    ].join('\n');
    writeFileSync(SYNTH_PATH, synthetic, 'utf8');

    const { status, stdout } = runScript();
    expect(status).toBe(1);
    expect(stdout).toContain('violations found');
    expect(stdout).toContain(SYNTH_FILE);
    expect(stdout).toContain(`'${dropped}'`);
    expect(stdout).toContain('STRICT SUPERSET');
  });
});
