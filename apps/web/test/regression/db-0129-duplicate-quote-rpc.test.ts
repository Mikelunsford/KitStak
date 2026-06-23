// Regression suite for Quote flow P1-3: the duplicate_quote RPC (migration
// 0129). Clones a quote header plus its lines into a new draft in one atomic
// SECURITY DEFINER call, so a tiered-quoting operator only edits quantity and
// unit price per tier instead of re-entering the whole quote.
//
// Like db-0094, this regression cannot exercise the DB function directly (no DB
// harness is wired into apps/web/test), so it asserts the migration declares the
// expected signature, the cross-tenant guard, the draft reset, the line copy,
// the numbering, the totals recompute, and the grants. The function is validated
// against a live database (staging, aborting transaction) as part of the
// pre-merge migration review.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
  '0129_duplicate_quote_rpc.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');

function rpcBody(): string {
  const body = sql.match(
    /create or replace function public\.duplicate_quote[\s\S]*?\$\$;/,
  )?.[0];
  expect(body).toBeTruthy();
  return body as string;
}

describe('migration 0129 - duplicate_quote RPC (P1-3)', () => {
  it('declares duplicate_quote(uuid, uuid, uuid) returns uuid, security definer, search_path public', () => {
    expect(sql).toMatch(
      /create or replace function public\.duplicate_quote\(\s*p_source_quote_id uuid,\s*p_actor uuid,\s*p_caller_org_id uuid\s*\)\s*returns uuid/i,
    );
    const body = rpcBody();
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = public/i);
  });

  it('guards a cross-tenant or missing source as NOT_FOUND, never 403/FORBIDDEN', () => {
    const body = rpcBody();
    expect(body).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
    expect(body).toMatch(/NOT_FOUND: quote not found/);
    // Must not reach for the FORBIDDEN/403 branch the constitution forbids here.
    expect(body).not.toMatch(/FORBIDDEN/);
  });

  it('allocates a gap-free number from the org-scoped numbering chassis', () => {
    expect(rpcBody()).toMatch(
      /public\.next_doc_number\(\s*v_org_id\s*,\s*'quote'\s*\)/i,
    );
  });

  it('inserts the new quote in draft and suffixes the title with " (copy)"', () => {
    const body = rpcBody();
    const insertBlock = body.match(
      /insert into public\.quotes \([\s\S]*?returning id into v_new_quote_id;/,
    )?.[0];
    expect(insertBlock).toBeTruthy();
    // 'draft' is selected as the new state.
    expect(insertBlock!).toMatch(/'draft'/);
    // Title copy suffix.
    expect(insertBlock!).toMatch(/title \|\| ' \(copy\)'/);
  });

  it('does not carry lifecycle fields (state stamps, sent/accepted, conversion pointer)', () => {
    const body = rpcBody();
    const insertBlock = body.match(
      /insert into public\.quotes \([\s\S]*?returning id into v_new_quote_id;/,
    )?.[0] as string;
    // The clone resets lifecycle: these columns must not appear in the header
    // INSERT column list.
    expect(insertBlock).not.toMatch(/converted_to_project_id/);
    expect(insertBlock).not.toMatch(/sent_at/);
    expect(insertBlock).not.toMatch(/accepted_at/);
    expect(insertBlock).not.toMatch(/submitted_at/);
  });

  it('copies every line from the source quote into quote_line_items', () => {
    const body = rpcBody();
    expect(body).toMatch(/insert into public\.quote_line_items/i);
    expect(body).toMatch(/from public\.quote_line_items\s+where quote_id = p_source_quote_id/i);
    // Positions and per-line cents carry over verbatim.
    expect(body).toMatch(/line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents/);
  });

  it('recomputes the new quote header totals from the copied lines', () => {
    expect(rpcBody()).toMatch(
      /perform public\.recompute_quote_totals\(v_new_quote_id\)/i,
    );
  });

  it('grants execute to authenticated + service_role only', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.duplicate_quote\(uuid, uuid, uuid\)\s*from public, anon/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.duplicate_quote\(uuid, uuid, uuid\)\s*to authenticated, service_role/i,
    );
  });
});
