// Regression suite for F-Wave9-AUDIT-CHAIN-SAME-TXN-01.
//
// SMOKE-05's verify_audit_chain found the per-org hash chain broken on 3 of 5
// sampled prod orgs. Root cause: audit_log (0001) has no monotonic ordering
// column, so every writer's chain-head lookup `order by triggered_at desc,
// id desc limit 1` and the verifier's `order by triggered_at asc, id asc`
// cannot order rows written in the SAME transaction. now()/triggered_at is
// constant within a txn and the id tiebreaker is a random uuid, so same-txn
// rows chain against the wrong prior row.
//
// Migration 0085 adds a monotonic `seq` bigint column (dedicated sequence),
// backfills existing rows in their CURRENT chain order (triggered_at, id) so
// history is not reordered, centralizes the chain-head lookup into
// kitstak_audit_chain_head (order by seq desc), and repoints all 23 writers
// plus verify_audit_chain (order by seq asc) at the seq ordering. No historical
// audit row is re-hashed or mutated.
//
// The apps/web test harness has no DB connection, so this suite asserts the
// migration text shape - same approach as db-0061-mfg-created-audit.test.ts and
// db-0067-org-membership-audit.test.ts. Live behavioural verification is a
// `supabase db reset` + the same-transaction repro script documented in the PR
// (it was proven against Postgres 15 while authoring this migration: the old
// ordering produced 30/30 broken links, the seq ordering produced 0).

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const MIGRATION_PATH = join(
  MIGRATIONS_DIR,
  '0085_audit_chain_same_txn_ordering.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');

// Lower-cased view for case-insensitive structural assertions on SQL keywords.
const lower = sql.toLowerCase();

// Every reusable WRITER function whose inline chain-head lookup must now read
// through kitstak_audit_chain_head. The one-time backfill DO-blocks in 0061
// and 0067 are intentionally excluded (historical DML, not reusable functions).
const WRITER_FUNCTIONS = [
  'audit_append_state_change',
  'kitstak_audit_state',
  'kitstak_audit_created',
  'trg_audit_organizations_status',
  'tg_lead_audit_state_change',
  'tg_opportunity_audit_stage_change',
  'trg_audit_purchase_orders_status',
  'trg_audit_vendor_bills_status',
  'trg_audit_expenses_status',
  'trg_audit_receiving_orders_status',
  'trg_audit_production_runs_status',
  'trg_audit_shipments_status',
  'trg_audit_manufacturing_runs_status',
  'trg_audit_manufacturing_runs_created',
  'trg_org_memberships_created_audit',
  'trg_org_memberships_updated_audit',
  'trg_audit_organizations_subscription_status',
  'trg_audit_sales_orders_status',
  'trg_audit_kitting_jobs_status',
  'trg_audit_fulfillments_status',
  'trg_audit_workforce_members_status',
  'trg_audit_shifts_status',
  'trg_audit_work_assignments_status',
];

describe('migration 0085 — audit chain same-transaction ordering (F-Wave9-AUDIT-CHAIN-SAME-TXN-01)', () => {
  describe('schema: monotonic seq column', () => {
    it('adds audit_log.seq as a bigint, idempotently', () => {
      expect(lower).toMatch(
        /alter table public\.audit_log\s+add column if not exists seq bigint/,
      );
    });

    it('creates a dedicated sequence owned by the seq column, idempotently', () => {
      expect(lower).toMatch(
        /create sequence if not exists public\.audit_log_seq_seq\s+owned by public\.audit_log\.seq/,
      );
    });

    it('sets the sequence as the column default and makes seq NOT NULL', () => {
      expect(lower).toMatch(
        /alter table public\.audit_log\s+alter column seq set default nextval\('public\.audit_log_seq_seq'\)/,
      );
      expect(lower).toMatch(
        /alter table public\.audit_log\s+alter column seq set not null/,
      );
    });

    it('adds a (org_id, seq desc) index for the chain-head lookup, idempotently', () => {
      expect(lower).toMatch(
        /create index if not exists audit_log_org_seq_idx\s+on public\.audit_log \(org_id, seq desc\)/,
      );
    });
  });

  describe('backfill: preserves existing chain order, never re-hashes', () => {
    it('ranks existing rows by (triggered_at asc, id asc) - the prior verifier order', () => {
      // The backfill must reproduce each org's CURRENT chain order so history
      // is not reordered. (triggered_at, id) is exactly the ordering the old
      // verify_audit_chain walked.
      expect(lower).toMatch(
        /row_number\(\) over \(order by triggered_at asc, id asc\)/,
      );
    });

    it('writes the window rank directly (not nextval) so ctid order cannot reorder history', () => {
      // nextval() in an UPDATE...FROM is assigned in physical/join order, which
      // would scramble seq vs the intended rank. The backfill must assign the
      // computed rank value (o.rn), not call nextval during the update.
      expect(sql).toMatch(/set seq = o\.rn/i);
      const backfill = sql.match(
        /update public\.audit_log a[\s\S]*?where a\.id = o\.id[\s\S]*?;/i,
      );
      expect(backfill).not.toBeNull();
      expect(backfill![0]).not.toMatch(/nextval/i);
    });

    it('backfill is idempotent (only touches rows whose seq is still null)', () => {
      const backfill = sql.match(
        /update public\.audit_log a[\s\S]*?where a\.id = o\.id[\s\S]*?;/i,
      );
      expect(backfill).not.toBeNull();
      expect(backfill![0]).toMatch(/where seq is null/i);
      expect(backfill![0]).toMatch(/a\.seq is null/i);
    });

    it('advances the sequence past max(seq) so future inserts continue cleanly', () => {
      expect(lower).toMatch(/setval\(\s*'public\.audit_log_seq_seq'/);
      expect(lower).toMatch(/max\(seq\)/);
    });

    it('does NOT rewrite from_state / to_state / payload_hash / prev_hash of existing rows', () => {
      // Append-only + no historical re-hash. The only UPDATE against audit_log
      // in this migration sets the seq column. No UPDATE may touch the sealed
      // chain columns.
      const updates = sql.match(/update public\.audit_log[\s\S]*?;/gi) || [];
      expect(updates.length).toBeGreaterThan(0);
      for (const u of updates) {
        expect(u).not.toMatch(/set[\s\S]*\b(payload_hash|prev_hash|from_state|to_state)\b\s*=/i);
      }
    });

    it('contains no recompute / re-hash of historical rows (no encode(digest(...)) inside an UPDATE)', () => {
      const updates = sql.match(/update public\.audit_log[\s\S]*?;/gi) || [];
      for (const u of updates) {
        expect(u).not.toMatch(/digest\s*\(/i);
      }
    });
  });

  describe('kitstak_audit_chain_head: the single seq-ordered lookup', () => {
    it('declares the helper as a SECURITY DEFINER function ordering by seq desc', () => {
      const fn = sql.match(
        /create or replace function public\.kitstak_audit_chain_head\(p_org_id uuid\)[\s\S]*?\$\$;/i,
      );
      expect(fn).not.toBeNull();
      expect(fn![0]).toMatch(/security definer/i);
      expect(fn![0]).toMatch(/order by seq desc\s+limit 1/i);
      // Must read payload_hash scoped to the org.
      expect(fn![0]).toMatch(/select\s+payload_hash/i);
      expect(fn![0]).toMatch(/where org_id = p_org_id/i);
    });

    it('revokes the helper from public/anon and grants only to service_role', () => {
      expect(lower).toMatch(
        /revoke execute on function public\.kitstak_audit_chain_head\(uuid\) from public, anon/,
      );
      expect(lower).toMatch(
        /grant execute on function public\.kitstak_audit_chain_head\(uuid\) to service_role/,
      );
    });
  });

  describe('writers: all repointed to kitstak_audit_chain_head', () => {
    it('rewrites every reusable writer to call the shared helper', () => {
      for (const fn of WRITER_FUNCTIONS) {
        const block = sql.match(
          new RegExp(
            `create or replace function public\\.${fn}\\s*\\([\\s\\S]*?\\$\\$;`,
            'i',
          ),
        );
        expect(block, `${fn} must be redefined in 0085`).not.toBeNull();
        expect(
          block![0],
          `${fn} must read the chain head via kitstak_audit_chain_head`,
        ).toMatch(/v_prev_hash := public\.kitstak_audit_chain_head\(/i);
      }
    });

    it('leaves NO writer using the old (triggered_at desc, id desc) chain-head lookup in active SQL', () => {
      // Strip line comments, then assert the stale ordering is gone from
      // executable statements. (The header documents the old ordering in prose;
      // those lines are comments and are excluded here.)
      const active = sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      expect(active).not.toMatch(/order by triggered_at desc, id desc/i);
    });

    it('preserves the per-org advisory lock in the reusable writers', () => {
      // The advisory lock is orthogonal to the ordering fix and must remain.
      for (const fn of WRITER_FUNCTIONS) {
        const block = sql.match(
          new RegExp(
            `create or replace function public\\.${fn}\\s*\\([\\s\\S]*?\\$\\$;`,
            'i',
          ),
        );
        expect(block).not.toBeNull();
        expect(block![0]).toMatch(/pg_advisory_xact_lock/i);
      }
    });

    it('keeps the canonical payload hashing unchanged (kitstak_audit_canonical + sha256)', () => {
      // The canonical function and the sha256 digest call must be untouched so
      // previously sealed payload_hashes stay valid.
      expect(sql).not.toMatch(/create or replace function public\.kitstak_audit_canonical/i);
      expect(lower).toMatch(/kitstak_audit_canonical/);
    });
  });

  describe('verifier: walks by seq', () => {
    it('rewrites verify_audit_chain to walk order by seq asc (not triggered_at)', () => {
      const fn = sql.match(
        /create or replace function public\.verify_audit_chain\(p_org_id uuid\)[\s\S]*?\$\$;/i,
      );
      expect(fn).not.toBeNull();
      expect(fn![0]).toMatch(/order by seq asc/i);
      expect(fn![0]).not.toMatch(/order by triggered_at asc/i);
    });

    it('preserves the verify_audit_chain return contract used by audit-chain-verify', () => {
      // The nightly edge function reads broken_id / broken_triggered_at /
      // expected_hash / stored_hash. The signature must not change.
      const fn = sql.match(
        /create or replace function public\.verify_audit_chain\(p_org_id uuid\)\s*returns table \(([\s\S]*?)\)/i,
      );
      expect(fn).not.toBeNull();
      const cols = fn![1];
      expect(cols).toMatch(/broken_id\s+uuid/i);
      expect(cols).toMatch(/broken_triggered_at\s+timestamptz/i);
      expect(cols).toMatch(/expected_hash\s+text/i);
      expect(cols).toMatch(/stored_hash\s+text/i);
    });

    it('recomputes the payload hash the same way (canonical + extensions.digest sha256)', () => {
      const fn = sql.match(
        /create or replace function public\.verify_audit_chain\(p_org_id uuid\)[\s\S]*?\$\$;/i,
      );
      expect(fn).not.toBeNull();
      expect(fn![0]).toMatch(
        /extensions\.digest\(\s*public\.kitstak_audit_canonical\(v_payload\),\s*'sha256'\s*\)/i,
      );
    });

    it('reconstructs the optional non-empty metadata key so org_membership rows verify', () => {
      // 0067/0068 hash a non-empty 'metadata' object (user_id + role_id); the
      // audit_log.metadata column is NOT NULL default '{}', so verify must add
      // the key back only when metadata is non-empty. Without this every
      // org_membership row (and so every org, since provisioning creates an
      // owner membership) falsely reports broken. F-Wave9-AUDIT-CHAIN-SAME-TXN-01.
      const fn = sql.match(
        /create or replace function public\.verify_audit_chain\(p_org_id uuid\)[\s\S]*?\$\$;/i,
      );
      expect(fn).not.toBeNull();
      expect(fn![0]).toMatch(/r\.metadata <> '\{\}'::jsonb/i);
      expect(fn![0]).toMatch(/jsonb_build_object\('metadata', r\.metadata\)/i);
    });
  });

  describe('append-only RLS posture preserved', () => {
    it('does NOT add any INSERT/UPDATE/DELETE policy for authenticated on audit_log', () => {
      // audit_log must remain select-only for authenticated (service-role
      // writes only). This migration must not relax that.
      expect(lower).not.toMatch(
        /create policy[\s\S]*?on public\.audit_log[\s\S]*?for (insert|update|delete)/,
      );
    });

    it('does not disable RLS or drop the existing select policy on audit_log', () => {
      expect(lower).not.toMatch(/alter table public\.audit_log disable row level security/);
      expect(lower).not.toMatch(/drop policy[\s\S]*?audit_log_select/);
    });
  });

  describe('constitutional + forward-only invariants', () => {
    it('is the next free migration number (0085; 0084 was the prior max)', () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
      const nums = files
        .map((f) => /^(\d{4})_/.exec(f)?.[1])
        .filter((n): n is string => Boolean(n))
        .map(Number);
      const max = Math.max(...nums);
      expect(max).toBe(85);
      // Exactly one 0085 migration file exists.
      expect(files.filter((f) => f.startsWith('0085_')).length).toBe(1);
    });

    it('header declares Wave, Closes, dated DOWN MIGRATION, and the F-id', () => {
      expect(sql).toMatch(/Wave:\s*9/);
      expect(sql).toMatch(/F-Wave9-AUDIT-CHAIN-SAME-TXN-01/);
      expect(sql).toMatch(/DOWN MIGRATION \(operator-only/i);
      expect(sql).toMatch(/Date:\s*2026-06-01/);
    });

    it('header carries the constitutional alignment block (Audit + RLS + Migration rules)', () => {
      expect(sql).toMatch(/Constitutional alignment/i);
      expect(sql).toMatch(/Audit rules/);
      expect(sql).toMatch(/RLS rules/);
      expect(sql).toMatch(/Migration rules/);
    });

    it('uses idempotent DDL throughout (IF NOT EXISTS / CREATE OR REPLACE)', () => {
      expect(lower).toMatch(/add column if not exists/);
      expect(lower).toMatch(/create sequence if not exists/);
      expect(lower).toMatch(/create index if not exists/);
      // Every function is CREATE OR REPLACE (no bare CREATE FUNCTION).
      expect(sql).not.toMatch(/\bcreate function\b/i);
    });

    it('carries no em dashes or double hyphens in prose (brand voice on disk)', () => {
      expect(sql).not.toMatch(/—/); // em dash
      // No `--` outside of SQL line-comment leaders. Every `--` in this file
      // must be a comment marker at a line start (after optional whitespace).
      const offending = sql
        .split('\n')
        .filter((line) => {
          const idx = line.indexOf('--');
          if (idx === -1) return false;
          // Allowed: the comment leader is the first non-space token.
          return line.slice(0, idx).trim().length > 0;
        });
      expect(offending).toEqual([]);
    });
  });
});
