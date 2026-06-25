// Regression suite for R-W10-AUDIT-01 (2026-05-31 smoke test P0).
//
// Root cause: audit_log.entity_type CHECK is recreated (guarded drop-then-add)
// by every migration that introduces a new auditable entity. Migrations 0074
// and 0076 added the Co-Pack kitting + fulfillment entity_types. The KitForce
// migrations 0078-0081 each ALSO recreate the constraint, but copied the list
// as of 0073 and silently dropped those four types. 0081 ran last, so its
// narrower list won on prod and every Co-Pack MAKE audit write 500'd.
//
// The prior per-migration tests (e.g. db-0067) each hardcoded their own
// "expected types" array, so a migration could subset an earlier list and
// still pass review. This suite encodes the real invariant structurally:
//
//   The single highest-numbered migration that redefines
//   audit_log_entity_type_check MUST enumerate a superset of every entity_type
//   enumerated by any earlier constraint redefinition.
//
// This test would have FAILED on 0081 (not a superset of 0076) and passes on
// 0083, which restores the full list. It needs no DB connection — it reads the
// migration text, matching the apps/web harness convention.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

const CONSTRAINT = 'audit_log_entity_type_check';

interface ConstraintMigration {
  file: string;
  num: number;
  types: Set<string>;
}

// Extract the entity_type literals enumerated inside the
// `add constraint audit_log_entity_type_check check (entity_type in ( ... ))`
// block of a single migration file. Returns null if the file does not
// redefine the constraint.
function extractConstraintTypes(sql: string): Set<string> | null {
  const addIdx = sql.search(
    new RegExp(`add constraint ${CONSTRAINT}`, 'i'),
  );
  if (addIdx === -1) return null;

  // Grab from the `add constraint` keyword to the end of the check(...) list:
  // the first `));` that closes `check (entity_type in ( ... ))`.
  const tail = sql.slice(addIdx);
  const closeIdx = tail.indexOf('));');
  const block = closeIdx === -1 ? tail : tail.slice(0, closeIdx);

  // Strip SQL line comments so commented entity names (none today, but cheap
  // insurance) never count as enumerated types.
  const cleaned = block.replace(/--[^\n]*/g, '');

  const types = new Set<string>();
  for (const m of cleaned.matchAll(/'([a-z][a-z0-9_]*)'/g)) {
    types.add(m[1]);
  }
  return types;
}

function loadConstraintMigrations(): ConstraintMigration[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const out: ConstraintMigration[] = [];
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

describe('audit_log entity_type constraint — superset invariant (R-W10-AUDIT-01)', () => {
  const migrations = loadConstraintMigrations();

  it('finds every migration that redefines the constraint', () => {
    // Sanity: the known redefiners through 0110 must all be discovered.
    const nums = migrations.map((m) => m.num);
    for (const n of [36, 73, 74, 76, 78, 79, 80, 81, 83, 89, 91, 96, 98, 99, 102, 106, 109, 110, 139, 140]) {
      expect(nums).toContain(n);
    }
  });

  it('latest redefinition is a superset of every prior redefinition', () => {
    expect(migrations.length).toBeGreaterThan(1);
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));

    const violations: string[] = [];
    for (const m of migrations) {
      if (m.num === latest.num) continue;
      for (const t of m.types) {
        if (!latest.types.has(t)) {
          violations.push(`'${t}' enumerated in ${m.file} is missing from latest ${latest.file}`);
        }
      }
    }
    // A non-empty list here means a later migration narrowed the constraint
    // and would 500 audit writes for the dropped entity_type(s) — exactly the
    // R-W10-AUDIT-01 production regression.
    expect(violations).toEqual([]);
  });

  it('the latest redefinition restores the four Co-Pack types dropped by 0078-0081', () => {
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    for (const t of [
      'kitting_job',
      'kitting_job_consumed_line_item',
      'kitting_job_produced_line_item',
      'fulfillment',
    ]) {
      expect(latest.types.has(t)).toBe(true);
    }
  });

  it('0140 is the current authoritative redefinition', () => {
    // This pin moves forward each time a migration redefines the constraint.
    // 0139 (audit created-symmetry extend) added recurring_schedule and
    // quote_tier; 0140 (support tickets) adds support_ticket on top of the
    // full 0139 list, so 0140 is latest.
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    expect(latest.num).toBe(140);
    expect(latest.file).toBe('0140_support_tickets.sql');
  });

  it('the latest redefinition includes the support ticket type (0140)', () => {
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    expect(latest.types.has('support_ticket')).toBe(true);
  });

  it('the latest redefinition includes the spine types added after 0070 (0139)', () => {
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    for (const t of ['recurring_schedule', 'quote_tier']) {
      expect(latest.types.has(t)).toBe(true);
    }
  });

  it('the latest redefinition includes the 3PL commercial layer types (0089)', () => {
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    for (const t of ['three_pl_account', 'account_service_definition']) {
      expect(latest.types.has(t)).toBe(true);
    }
  });

  it('the latest redefinition includes the Job Builder types (0091)', () => {
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    for (const t of ['job_template', 'job_template_line']) {
      expect(latest.types.has(t)).toBe(true);
    }
  });

  it('the latest redefinition includes the Supply Plan types (0096)', () => {
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    for (const t of ['supply_plan', 'supply_plan_line']) {
      expect(latest.types.has(t)).toBe(true);
    }
  });

  it('the latest redefinition includes the Job Run types (0098/0099)', () => {
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    for (const t of [
      'job_run',
      'job_run_daily_log',
      'job_run_daily_log_consumed_line_item',
      'job_run_daily_log_produced_line_item',
    ]) {
      expect(latest.types.has(t)).toBe(true);
    }
  });

  it('the latest redefinition includes the Billing Review type (0102)', () => {
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    expect(latest.types.has('billing_review')).toBe(true);
  });

  it('the latest redefinition includes the WMS Locations type (0106)', () => {
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    expect(latest.types.has('warehouse_location')).toBe(true);
  });

  it('the latest redefinition includes the WMS Putaway type (0109)', () => {
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    expect(latest.types.has('putaway_task')).toBe(true);
  });

  it('the latest redefinition includes the WMS Lot type (0110)', () => {
    const latest = migrations.reduce((a, b) => (b.num > a.num ? b : a));
    expect(latest.types.has('lot')).toBe(true);
  });
});
