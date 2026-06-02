#!/usr/bin/env node
/*
 * audit-entity-type-superset-check.mjs
 * Closes: F-Wave10-REVIEW-REMEDIATION (WS-C / C3)
 * Guards:  R-W10-AUDIT-01 (the 0078-0081 subset regression).
 *
 * audit_log.entity_type is constrained by a CHECK named
 * audit_log_entity_type_check. Every migration that introduces a new auditable
 * entity recreates the constraint (guarded drop-then-add). Migrations 0078-0081
 * each copied the entity_type list as of 0073 and silently dropped the four
 * Co-Pack types added by 0074/0076. 0081 ran last, so its NARROWER list won on
 * prod and every Co-Pack MAKE audit write 500'd. 0083 restored the full list.
 *
 * Invariant enforced here:
 *
 *   The single highest-numbered migration that redefines
 *   audit_log_entity_type_check MUST enumerate a STRICT SUPERSET of every
 *   entity_type enumerated by any earlier constraint redefinition.
 *
 * A later migration that narrows the list (drops a previously-allowed
 * entity_type) is a release blocker: it silently breaks audit writes for the
 * dropped entity, which the per-migration "expected types" tests cannot catch
 * because each only checks its own list.
 *
 * Perfect SQL parsing is out of scope. The script reads migration text and
 * extracts the quoted entity_type literals inside each constraint redefinition,
 * the same heuristic the apps/web regression suite uses. Comment-stripped so a
 * commented-out entity name never counts as enumerated.
 *
 * Zero top-level dependencies. Targets Node 20+ via a .mjs ESM file.
 *
 * Exits 0 on a clean tree, 1 with a per-violation report when the latest
 * redefinition is not a superset of an earlier one.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
// Default to the real tree. AUDIT_MIGRATIONS_DIR lets a caller (notably the
// guard regression test) point the check at an isolated copy so it never has
// to write a synthetic migration into the real supabase/migrations dir, which
// other tests readdirSync in parallel (F-Wave10-MEMBERS-LIST-TEST-ISOLATION-01).
const MIGRATIONS_DIR = process.env.AUDIT_MIGRATIONS_DIR
  ? resolve(process.env.AUDIT_MIGRATIONS_DIR)
  : join(ROOT, 'supabase', 'migrations');

const CONSTRAINT = 'audit_log_entity_type_check';

// Extract the entity_type literals enumerated inside the
// `add constraint audit_log_entity_type_check check (entity_type in ( ... ))`
// block of a single migration file. Returns null if the file does not redefine
// the constraint.
function extractConstraintTypes(sql) {
  const addIdx = sql.search(new RegExp(`add constraint ${CONSTRAINT}`, 'i'));
  if (addIdx === -1) return null;

  // Grab from the `add constraint` keyword to the first `));` that closes
  // `check (entity_type in ( ... ))`.
  const tail = sql.slice(addIdx);
  const closeIdx = tail.indexOf('));');
  const block = closeIdx === -1 ? tail : tail.slice(0, closeIdx);

  // Strip SQL line comments so a commented entity name never counts.
  const cleaned = block.replace(/--[^\n]*/g, '');

  const types = new Set();
  for (const m of cleaned.matchAll(/'([a-z][a-z0-9_]*)'/g)) {
    types.add(m[1]);
  }
  return types;
}

function loadConstraintMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const out = [];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const types = extractConstraintTypes(sql);
    if (!types) continue;
    const numMatch = file.match(/^(\d{4})_/);
    if (!numMatch) continue;
    out.push({ file, num: Number(numMatch[1]), types });
  }
  return out;
}

function main() {
  const migrations = loadConstraintMigrations();
  if (migrations.length === 0) {
    process.stdout.write(
      'audit-entity-type-superset-check: no audit_log_entity_type_check redefinition found\n',
    );
    return;
  }

  const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));

  const violations = [];
  for (const m of migrations) {
    if (m.num === latest.num) continue;
    for (const t of m.types) {
      if (!latest.types.has(t)) {
        violations.push(
          `'${t}' enumerated in ${m.file} is missing from latest ${latest.file}`,
        );
      }
    }
  }

  if (violations.length === 0) {
    return;
  }

  process.stdout.write('audit-entity-type-superset-check: violations found\n');
  process.stdout.write(`Total: ${violations.length}\n\n`);
  process.stdout.write(
    `[entity-type-subset-regression] latest redefinition ${latest.file} drops entity_type(s) that an earlier migration allowed:\n`,
  );
  for (const v of violations) {
    process.stdout.write(`  ${v}\n`);
  }
  process.stdout.write('\n');
  process.stdout.write(
    `Fix: the highest-numbered migration that recreates ${CONSTRAINT} must list a\n`,
  );
  process.stdout.write(
    'STRICT SUPERSET of every entity_type any earlier constraint redefinition listed.\n',
  );
  process.stdout.write(
    'Add the dropped entity_type(s) back to the latest redefinition (forward-only:\n',
  );
  process.stdout.write(
    'a NEW migration that recreates the constraint with the full list), never edit\n',
  );
  process.stdout.write('an already-applied migration on disk.\n');
  process.exitCode = 1;
}

main();
