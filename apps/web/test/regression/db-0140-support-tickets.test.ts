// Regression suite for migration 0140: internal feedback / support ticketing.
// support_tickets is the org-scoped feedback header with a five-state FSM;
// support_ticket_comments is the two-way thread (is_internal staff notes never
// leave the staff surface); platform_staff is the global operator allowlist
// read only through is_platform_staff(). Cross-tenant staff reads are NOT in
// RLS; they go through the gated service-role feedback-admin-api.
//
// Static content checks against the migration SQL.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0140_support_tickets.sql'),
  'utf8',
);

describe('migration 0140: support tickets (feedback channel)', () => {
  it('creates support_tickets with the five-state FSM, type and priority CHECKs, and context jsonb', () => {
    const t = sql.match(/create table if not exists public\.support_tickets \([\s\S]*?\);/)?.[0];
    expect(t).toBeTruthy();
    expect(t!).toMatch(/org_id uuid not null references public\.organizations\(id\) on delete cascade/i);
    expect(t!).toMatch(/type text not null[\s\S]*?check \(type in \('bug', 'suggestion', 'question'\)\)/i);
    expect(t!).toMatch(/status text not null default 'open'[\s\S]*?check \(status in \('open', 'triaged', 'in_progress', 'resolved', 'closed'\)\)/i);
    expect(t!).toMatch(/priority text[\s\S]*?check \(priority is null or priority in \('low', 'normal', 'high', 'urgent'\)\)/i);
    expect(t!).toMatch(/context jsonb not null default '\{\}'::jsonb/i);
    // No monetary columns on this entity.
    expect(t!).not.toMatch(/_cents/i);
  });

  it('enables Pattern A RLS on support_tickets: org-scoped SELECT, self INSERT, no authenticated write-all', () => {
    expect(sql).toMatch(/alter table public\.support_tickets enable row level security/i);
    const sel = sql.match(/create policy support_tickets_select[\s\S]*?using \([\s\S]*?\);/)?.[0];
    expect(sel!).toMatch(/org_id = public\.current_org_id\(\)/i);
    const ins = sql.match(/create policy support_tickets_insert[\s\S]*?with check \([\s\S]*?\);/)?.[0];
    expect(ins!).toMatch(/org_id = public\.current_org_id\(\)/i);
    expect(ins!).toMatch(/created_by = auth\.uid\(\)/i);
    // Lifecycle is staff-driven via the service role: tenants get no UPDATE/DELETE.
    expect(sql).not.toMatch(/create policy support_tickets_write[\s\S]*?for all/i);
  });

  it('creates support_ticket_comments with is_internal notes and tenant-only public INSERT', () => {
    const t = sql.match(/create table if not exists public\.support_ticket_comments \([\s\S]*?\);/)?.[0];
    expect(t).toBeTruthy();
    expect(t!).toMatch(/ticket_id uuid not null references public\.support_tickets\(id\) on delete cascade/i);
    expect(t!).toMatch(/author_kind text not null[\s\S]*?check \(author_kind in \('tenant_user', 'platform_staff'\)\)/i);
    expect(t!).toMatch(/is_internal boolean not null default false/i);
    const sel = sql.match(/create policy support_ticket_comments_select[\s\S]*?using \([\s\S]*?\);/)?.[0];
    expect(sel!).toMatch(/org_id = public\.current_org_id\(\)/i);
    expect(sel!).toMatch(/is_internal = false/i);
    const ins = sql.match(/create policy support_ticket_comments_insert[\s\S]*?with check \([\s\S]*?\);/)?.[0];
    expect(ins!).toMatch(/author_id = auth\.uid\(\)/i);
    expect(ins!).toMatch(/author_kind = 'tenant_user'/i);
    expect(ins!).toMatch(/is_internal = false/i);
  });

  it('creates platform_staff plus a security-definer is_platform_staff() gated to authenticated/service_role', () => {
    expect(sql).toMatch(/create table if not exists public\.platform_staff \(/i);
    expect(sql).toMatch(/alter table public\.platform_staff enable row level security/i);
    const fn = sql.match(/create or replace function public\.is_platform_staff\(p_uid uuid\)[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(/security definer/i);
    expect(fn!).toMatch(/from public\.platform_staff where user_id = p_uid/i);
    expect(sql).toMatch(/revoke execute on function public\.is_platform_staff\(uuid\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.is_platform_staff\(uuid\) to authenticated, service_role/i);
  });

  it('seeds the founder operator into platform_staff by email (no hardcoded auth uuid)', () => {
    const seed = sql.match(/insert into public\.platform_staff[\s\S]*?on conflict \(user_id\) do nothing;/)?.[0];
    expect(seed).toBeTruthy();
    expect(seed!).toMatch(/from auth\.users/i);
    expect(seed!).toMatch(/where email = 'mike@team-01\.com'/i);
  });

  it('extends the audit_log entity_type CHECK with support_ticket (superset of prior list)', () => {
    const check = sql.match(/add constraint audit_log_entity_type_check[\s\S]*?\)\);/)?.[0];
    expect(check!).toContain("'support_ticket'");
    // still a strict superset of the recent additions
    expect(check!).toContain("'billing_review'");
    expect(check!).toContain("'recurring_schedule'");
    expect(check!).toContain("'quote_tier'");
  });

  it('audits support_tickets as an FSM through audit_append_state_change', () => {
    const fn = sql.match(/create or replace function public\.trg_audit_support_tickets[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/v_from := old\.status; v_to := new\.status/i);
    expect(fn!).toMatch(/audit_append_state_change\(\s*v_org_id, 'support_ticket', v_entity_id, v_from, v_to/i);
    expect(sql).toMatch(/create trigger audit_support_tickets[\s\S]*?after insert or update or delete on public\.support_tickets/i);
  });
});
