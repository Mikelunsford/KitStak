// Regression suite for Wave 12 / WMS Body B Phase B1. Migration 0106
// warehouse_locations. A config table (active boolean, not a registered FSM)
// for the bins, shelves, racks, docks, and staging areas inside a warehouse.
// The B2 stock-movement bin dimension references this table.
//
// Static content checks. Locations CRUD plus the deactivate route were
// validated live on staging in an aborting transaction during the B1 build.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0106_warehouse_locations.sql'),
  'utf8',
);

describe('migration 0106 warehouse_locations (WMS B1)', () => {
  it('creates warehouse_locations with the location_type CHECK and self-ref FK (set null)', () => {
    const t = sql.match(/create table if not exists public\.warehouse_locations \([\s\S]*?\);/)?.[0];
    expect(t).toBeTruthy();
    expect(t!).toMatch(/org_id uuid not null references public\.organizations\(id\) on delete cascade/i);
    expect(t!).toMatch(/warehouse_id uuid not null references public\.warehouses\(id\)/i);
    expect(t!).toMatch(/code text not null/i);
    expect(t!).toMatch(/location_type text not null[\s\S]*?check \(location_type in \('bin', 'shelf', 'rack', 'dock', 'staging'\)\)/i);
    // nullable self-ref parent pointer, ON DELETE SET NULL (not cascade)
    expect(t!).toMatch(/parent_location_id uuid references public\.warehouse_locations\(id\) on delete set null/i);
    expect(t!).toMatch(/attributes jsonb not null default '\{\}'::jsonb/i);
    expect(t!).toMatch(/active boolean not null default true/i);
    expect(t!).toMatch(/deleted_at timestamptz/i);
  });

  it('partial-unique on (org_id, warehouse_id, code) among live rows', () => {
    expect(sql).toMatch(
      /create unique index if not exists warehouse_locations_org_warehouse_code_uniq\s*on public\.warehouse_locations \(org_id, warehouse_id, code\)\s*where deleted_at is null/i,
    );
  });

  it('creates the org / warehouse / parent partial indexes', () => {
    expect(sql).toMatch(/warehouse_locations_org_idx[\s\S]*?\(org_id\)\s*where deleted_at is null/i);
    expect(sql).toMatch(/warehouse_locations_org_warehouse_idx[\s\S]*?\(org_id, warehouse_id\)\s*where deleted_at is null/i);
    expect(sql).toMatch(/warehouse_locations_org_parent_idx[\s\S]*?\(org_id, parent_location_id\)\s*where deleted_at is null/i);
  });

  it('enables Pattern A RLS gated to the inventory 3-role set (org_owner, org_admin, ops)', () => {
    expect(sql).toMatch(/alter table public\.warehouse_locations enable row level security/i);
    const select = sql.match(/create policy warehouse_locations_select[\s\S]*?;/)?.[0];
    expect(select!).toMatch(/using \(org_id = public\.current_org_id\(\)\)/i);
    const write = sql.match(/create policy warehouse_locations_write[\s\S]*?with check \([\s\S]*?\);/)?.[0];
    expect(write).toBeTruthy();
    // INVENTORY 3-role set, NOT the 3PL commercial 4-role set (no 'sales').
    expect(write!).toMatch(/current_user_role\(\) in \('org_owner', 'org_admin', 'ops'\)/i);
    expect(write!).not.toMatch(/'sales'/i);
  });

  it('extends the audit_log entity_type CHECK with warehouse_location (strict superset)', () => {
    const check = sql.match(/add constraint audit_log_entity_type_check[\s\S]*?\)\);/)?.[0];
    expect(check).toBeTruthy();
    expect(check!).toContain("'warehouse_location'");
    // still a superset of the prior list (spot-check the 0102 tail and earlier)
    expect(check!).toContain("'billing_review'");
    expect(check!).toContain("'three_pl_account'");
    expect(check!).toContain("'job_run'");
    expect(check!).toContain("'kitting_job'");
    expect(check!).toContain("'organization'");
  });

  it('audits warehouse_locations as a config table (null from_state, action verb to_state)', () => {
    const fn = sql.match(/create or replace function public\.trg_audit_warehouse_locations[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    // config-table shape: p_from = null, to_state = created / updated / deleted
    expect(fn!).toMatch(/v_to_state := 'created'/i);
    expect(fn!).toMatch(/v_to_state := 'updated'/i);
    expect(fn!).toMatch(/v_to_state := 'deleted'/i);
    expect(fn!).toMatch(/audit_append_state_change\(\s*v_org_id,\s*'warehouse_location',\s*v_entity_id,\s*null,\s*v_to_state/i);
  });

  it('stamps updated_at via a BEFORE UPDATE trigger', () => {
    expect(sql).toMatch(/create or replace function public\.trg_warehouse_locations_set_updated_at/i);
    expect(sql).toMatch(/create trigger warehouse_locations_set_updated_at\s*before update on public\.warehouse_locations/i);
  });

  it('wires the audit trigger AFTER INSERT OR UPDATE OR DELETE', () => {
    expect(sql).toMatch(/create trigger audit_warehouse_locations\s*after insert or update or delete on public\.warehouse_locations/i);
  });
});
