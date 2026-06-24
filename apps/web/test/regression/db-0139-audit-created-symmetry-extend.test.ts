// Regression suite for migration 0139 — extend created-audit symmetry to the
// entities added after 0070 (F-Wave9-AUDIT-CREATED-SYMMETRY-01 remainder).
//
// 0061 covered manufacturing_runs; 0070 (2026-05-27) covered 18 core entities
// via the shared kitstak_audit_created helper + per-table AFTER INSERT triggers.
// Everything shipped after 0070 (3PL / Co-Pack / KitForce / WMS pillars plus
// quote_tiers and recurring_schedules) never got a created trigger. 0139 adds
// them, reusing the 0070 helper unchanged.
//
// Static-content assertions (no DB harness is wired into apps/web/test); the
// same shape db-0061 / db-0070-style suites use. Behaviour is proven separately
// on staging in an aborting transaction.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATION_PATH = join(
  ROOT,
  'supabase',
  'migrations',
  '0139_audit_created_symmetry_extend.sql',
);
const sql = readFileSync(MIGRATION_PATH, 'utf8');

// [table, entity_type, hasStatus]. hasStatus drives whether to_state is
// new.status (true) or null (false, helper records the 'created' sentinel).
const ENTITIES: ReadonlyArray<[string, string, boolean]> = [
  ['three_pl_accounts', 'three_pl_account', true],
  ['job_templates', 'job_template', true],
  ['supply_plans', 'supply_plan', true],
  ['job_runs', 'job_run', true],
  ['billing_reviews', 'billing_review', true],
  ['sales_orders', 'sales_order', true],
  ['kitting_jobs', 'kitting_job', true],
  ['fulfillments', 'fulfillment', true],
  ['shifts', 'shift', true],
  ['work_assignments', 'work_assignment', true],
  ['time_entries', 'time_entry', false],
  ['workforce_members', 'workforce_member', true],
  ['workforce_teams', 'workforce_team', false],
  ['putaway_tasks', 'putaway_task', true],
  ['lots', 'lot', true],
  ['warehouse_locations', 'warehouse_location', false],
  ['warehouses', 'warehouse', false],
  ['recurring_schedules', 'recurring_schedule', true],
  ['quote_tiers', 'quote_tier', false],
];

describe('migration 0139 — created-audit symmetry extension', () => {
  for (const [table, entity, hasStatus] of ENTITIES) {
    describe(`${table} (${entity})`, () => {
      const fnRe = new RegExp(
        `create or replace function public\\.trg_audit_${table}_created\\(\\)`,
        'i',
      );
      const fnBodyRe = new RegExp(
        `create or replace function public\\.trg_audit_${table}_created\\(\\)[\\s\\S]*?\\$\\$;`,
      );

      it('declares a SECURITY DEFINER trigger function', () => {
        expect(sql).toMatch(fnRe);
        const body = sql.match(fnBodyRe);
        expect(body).not.toBeNull();
        expect(body![0]).toMatch(/returns trigger/i);
        expect(body![0]).toMatch(/security definer/i);
      });

      it('wires the trigger AFTER INSERT (not AFTER UPDATE)', () => {
        expect(sql).toMatch(
          new RegExp(
            `drop trigger if exists audit_${table}_created on public\\.${table};`,
            'i',
          ),
        );
        const trigRe = new RegExp(
          `create trigger audit_${table}_created\\s+after insert on public\\.${table}[\\s\\S]*?execute function public\\.trg_audit_${table}_created\\(\\);`,
          'i',
        );
        const trig = sql.match(trigRe);
        expect(trig).not.toBeNull();
        expect(trig![0]).not.toMatch(/after update/i);
      });

      it('writes the action constant created via the shared helper with the right entity_type', () => {
        const body = sql.match(fnBodyRe);
        expect(body).not.toBeNull();
        expect(body![0]).toMatch(/public\.kitstak_audit_created\(/);
        expect(body![0]).toMatch(new RegExp(`'${entity}'`));
      });

      it(`passes ${hasStatus ? 'new.status' : 'null'} as to_state`, () => {
        const body = sql.match(fnBodyRe);
        expect(body).not.toBeNull();
        if (hasStatus) {
          expect(body![0]).toMatch(/new\.status, v_actor/);
        } else {
          expect(body![0]).toMatch(/new\.id, null, v_actor/);
        }
      });

      it('resolves the actor as coalesce(auth.uid(), new.created_by)', () => {
        const body = sql.match(fnBodyRe);
        expect(body).not.toBeNull();
        expect(body![0]).toMatch(/coalesce\(auth\.uid\(\),\s*new\.created_by\)/i);
      });

      it('revokes execute from public, anon', () => {
        expect(sql).toMatch(
          new RegExp(
            `revoke execute on function public\\.trg_audit_${table}_created\\(\\)\\s*from public, anon`,
            'i',
          ),
        );
      });
    });
  }

  it('extends the audit_log entity_type CHECK with the two missing spine types', () => {
    // quote_tier and recurring_schedule are the only two of the 19 entity types
    // not already in audit_log_entity_type_check; without this the created
    // trigger fails the CHECK and aborts the parent insert. Drop + re-add.
    expect(sql).toMatch(
      /alter table public\.audit_log drop constraint if exists audit_log_entity_type_check;/i,
    );
    const addConstraint = sql.match(
      /add constraint audit_log_entity_type_check\s+check \(entity_type in \([\s\S]*?\)\);/i,
    );
    expect(addConstraint).not.toBeNull();
    expect(addConstraint![0]).toMatch(/'recurring_schedule'/);
    expect(addConstraint![0]).toMatch(/'quote_tier'/);
    // Strict superset: the pre-existing types must still be present.
    expect(addConstraint![0]).toMatch(/'invoice'/);
    expect(addConstraint![0]).toMatch(/'job_run'/);
  });

  it('reuses the 0070 helper and does NOT redefine it', () => {
    expect(sql).toMatch(/public\.kitstak_audit_created\(/);
    // 0070 owns the helper; redefining it here would be a forward-only edit of
    // shared audit machinery and risk drifting the hash-chain algorithm.
    expect(sql).not.toMatch(/create or replace function public\.kitstak_audit_created/i);
  });

  it('derives org_id from the parent quote for quote_tiers (Pattern B)', () => {
    const body = sql.match(
      /create or replace function public\.trg_audit_quote_tiers_created\(\)[\s\S]*?\$\$;/,
    );
    expect(body).not.toBeNull();
    expect(body![0]).toMatch(/select org_id into v_org_id from public\.quotes where id = new\.quote_id/i);
    expect(body![0]).toMatch(/if v_org_id is null then\s+return new;/i);
  });

  it('is forward-only with no backfill DO-block (matches 0070)', () => {
    expect(sql).not.toMatch(/do \$\$/i);
  });

  it('header documents the closure and the operator-only DOWN MIGRATION', () => {
    expect(sql).toMatch(/F-Wave9-AUDIT-CREATED-SYMMETRY-01/);
    expect(sql).toMatch(/DOWN MIGRATION \(operator-only/i);
    expect(sql).toMatch(/Date: 2026-06-24/);
  });

  it('covers exactly the 19 expected entities', () => {
    const triggers = sql.match(/create trigger audit_[a-z_]+_created/gi) ?? [];
    expect(triggers.length).toBe(ENTITIES.length);
  });
});
