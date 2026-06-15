// Regression suite for Wave 13 Phase A (R-W13-WMS-01). Migration 0114 hardens
// the putaway complete RPC so a null destination no longer marks the task done
// with zero movements (the 0109 silent no-op bug). It also adds
// set_putaway_destination so the bin can be set before completing.
//
// Static content checks (mirror db-0109 style). The runtime behaviour (two
// movements on complete, STATE_CONFLICT on a null-destination complete, and
// set-then-complete) is asserted at the edge layer in
// wms-api-putaway-destination.test.ts and was validated on staging in an
// aborting transaction during the build.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'supabase',
    'migrations',
    '0114_putaway_complete_requires_destination.sql',
  ),
  'utf8',
);

// The header DOWN MIGRATION block embeds the PRIOR (0109) function body as a
// commented-out restore script. Strip every `--` comment line so the function
// regexes below match only the LIVE (executed) DDL, never the commented restore.
const live = sql
  .split(/\r?\n/)
  .filter((l) => !/^\s*--/.test(l))
  .join('\n');

describe('migration 0114 putaway complete requires destination (WMS R-W13-WMS-01)', () => {
  it('carries the canonical header (Wave 13, Phase A, Closes R-W13-WMS-01, dated, DOWN block)', () => {
    expect(sql).toMatch(/-- Wave: 13/);
    expect(sql).toMatch(/-- Phase: A\./);
    expect(sql).toMatch(/-- Closes: R-W13-WMS-01/);
    expect(sql).toMatch(/-- Date: 2026-06-15/);
    expect(sql).toMatch(/DOWN MIGRATION \(operator-only/i);
  });

  it('complete_putaway_task keeps the same 3-arg signature and is CREATE OR REPLACE', () => {
    expect(sql).toMatch(
      /create or replace function public\.complete_putaway_task\(\s*p_putaway_task_id uuid,\s*p_actor uuid,\s*p_caller_org_id uuid\s*\)/i,
    );
  });

  it('complete RAISES STATE_CONFLICT on a null destination BEFORE marking the task done', () => {
    const fn = live.match(/create or replace function public\.complete_putaway_task[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    // the new guard: null destination -> STATE_CONFLICT, the spec wording.
    expect(fn!).toMatch(
      /if v_actual_location_id is null then[\s\S]*?STATE_CONFLICT: putaway requires a destination bin[\s\S]*?errcode = 'P0001'/i,
    );
    // the guard sits BEFORE the `set status = 'done'` update so the task is not
    // marked done on the error path.
    const guardIdx = fn!.indexOf("putaway requires a destination bin");
    const doneIdx = fn!.indexOf("set status = 'done'");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(doneIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(doneIdx);
    // the OLD conditional emission gate is GONE (no more silent no-op).
    expect(fn!).not.toMatch(/if v_actual_location_id is not null then/i);
  });

  it('complete still preserves the cross-tenant NOT_FOUND, idempotent done, and not-in_progress guards', () => {
    const fn = live.match(/create or replace function public\.complete_putaway_task[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
    expect(fn!).toMatch(/NOT_FOUND/);
    expect(fn!).not.toMatch(/FORBIDDEN/);
    expect(fn!).toMatch(/if v_status = 'done' then\s*return p_putaway_task_id; -- idempotent/i);
    expect(fn!).toMatch(/v_status <> 'in_progress'/i);
    // keeps the for-update row lock.
    expect(fn!).toMatch(/from public\.putaway_tasks where id = p_putaway_task_id for update;/i);
  });

  it('complete still emits the warehouse-flat transfer_out + transfer_in pair (existing 0030 types, cost 0)', () => {
    const fn = live.match(/create or replace function public\.complete_putaway_task[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/insert into public\.stock_movements/i);
    expect(fn!).toMatch(/'transfer_out', v_quantity, 0/);
    expect(fn!).toMatch(/'transfer_in', v_quantity, 0/);
    expect(fn!).toMatch(/'putaway_task', p_putaway_task_id/);
    expect(fn!).toMatch(/v_source_location_id/);
    expect(fn!).toMatch(/v_actual_location_id/);
    // no new movement type invented.
    expect(fn!).not.toMatch(/'putaway'\s*,\s*v_quantity/i);
  });

  it('adds set_putaway_destination as a 4-arg cross-tenant action RPC', () => {
    const fn = live.match(/create or replace function public\.set_putaway_destination[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(
      /set_putaway_destination\(\s*p_putaway_task_id uuid,\s*p_actual_location_id uuid,\s*p_actor uuid,\s*p_caller_org_id uuid\s*\)/i,
    );
    expect(fn!).toMatch(/security definer/i);
    expect(fn!).toMatch(/set search_path = public/i);
    // row lock + cross-tenant NOT_FOUND.
    expect(fn!).toMatch(/from public\.putaway_tasks where id = p_putaway_task_id for update;/i);
    expect(fn!).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id[\s\S]*?NOT_FOUND/i);
    expect(fn!).not.toMatch(/FORBIDDEN/);
    // only a still-open task (suggested / in_progress) can take a destination.
    expect(fn!).toMatch(/v_status not in \('suggested', 'in_progress'\)[\s\S]*?STATE_CONFLICT/i);
    // sets actual_location_id + updated_by.
    expect(fn!).toMatch(/set actual_location_id = p_actual_location_id, updated_by = p_actor/i);
  });

  it('both RPCs are granted to service_role and REVOKED from authenticated (0111 posture)', () => {
    // complete: re-revoked from authenticated after the CREATE OR REPLACE.
    expect(sql).toMatch(
      /revoke execute on function public\.complete_putaway_task\(uuid, uuid, uuid\)\s*from public, anon/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.complete_putaway_task\(uuid, uuid, uuid\)\s*to service_role/i,
    );
    expect(sql).toMatch(
      /revoke execute on function public\.complete_putaway_task\(uuid, uuid, uuid\)\s*from authenticated/i,
    );
    // set_putaway_destination: same posture.
    expect(sql).toMatch(
      /revoke execute on function public\.set_putaway_destination\(uuid, uuid, uuid, uuid\)\s*from public, anon/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.set_putaway_destination\(uuid, uuid, uuid, uuid\)\s*to service_role/i,
    );
    expect(sql).toMatch(
      /revoke execute on function public\.set_putaway_destination\(uuid, uuid, uuid, uuid\)\s*from authenticated/i,
    );
  });

  it('does NOT touch the stock_movements movement_type CHECK or the putaway_tasks table DDL', () => {
    expect(sql).not.toMatch(/check \(movement_type in/i);
    expect(sql).not.toMatch(/alter table public\.stock_movements/i);
    expect(sql).not.toMatch(/create table[\s\S]*?putaway_tasks/i);
  });
});
