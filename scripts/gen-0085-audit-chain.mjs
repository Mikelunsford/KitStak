// One-shot generator for migration 0085_audit_chain_same_txn_ordering.sql.
//
// Reads the canonical body of every audit-log WRITER function from its source
// migration on disk, then rewrites ONLY the per-org chain-head lookup to call
// the shared public.kitstak_audit_chain_head(org_id) helper (which orders by
// the new monotonic `seq` column instead of (triggered_at, id)). The rest of
// each function body is copied byte-for-byte from the source so the canonical
// payload that gets hashed is identical to today.
//
// This script is a development aid that prints the CREATE OR REPLACE blocks to
// stdout for review and paste into 0085. It does NOT modify the database and
// is not part of any migration. Run: node scripts/gen-0085-audit-chain.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG = join(ROOT, 'supabase', 'migrations');

// Each writer: the source migration file and the exact function identifier.
// `org` is the SQL expression the source passes as the org scope in its WHERE
// clause (used to build the helper call argument). The latest definition of a
// CREATE-OR-REPLACEd function wins, so trg_audit_organizations_status and
// verify_audit_chain are sourced from 0003 (their newest body), not 0002.
const WRITERS = [
  { file: '0017_sales_audit_recompute_triggers.sql', fn: 'audit_append_state_change', org: 'p_org_id' },
  { file: '0024_finance_auto_je_triggers.sql', fn: 'kitstak_audit_state', org: 'p_org_id' },
  { file: '0070_audit_created_symmetry.sql', fn: 'kitstak_audit_created', org: 'p_org_id' },
  { file: '0003_fix_audit_search_path.sql', fn: 'trg_audit_organizations_status', org: 'new.id' },
  { file: '0010_crm_audit_state_triggers.sql', fn: 'tg_lead_audit_state_change', org: 'new.org_id' },
  { file: '0010_crm_audit_state_triggers.sql', fn: 'tg_opportunity_audit_stage_change', org: 'new.org_id' },
  { file: '0026_vendors_purchase_orders.sql', fn: 'trg_audit_purchase_orders_status', org: 'new.org_id' },
  { file: '0027_vendors_vendor_bills.sql', fn: 'trg_audit_vendor_bills_status', org: 'new.org_id' },
  { file: '0028_vendors_expenses.sql', fn: 'trg_audit_expenses_status', org: 'new.org_id' },
  { file: '0033_ops_audit_state_triggers.sql', fn: 'trg_audit_receiving_orders_status', org: 'new.org_id' },
  { file: '0033_ops_audit_state_triggers.sql', fn: 'trg_audit_production_runs_status', org: 'new.org_id' },
  { file: '0033_ops_audit_state_triggers.sql', fn: 'trg_audit_shipments_status', org: 'new.org_id' },
  { file: '0052_manufacturing_runs_schema.sql', fn: 'trg_audit_manufacturing_runs_status', org: 'new.org_id' },
  { file: '0061_manufacturing_run_created_audit.sql', fn: 'trg_audit_manufacturing_runs_created', org: 'new.org_id' },
  { file: '0067_org_membership_audit.sql', fn: 'trg_org_memberships_created_audit', org: 'new.org_id' },
  { file: '0068_org_membership_update_audit.sql', fn: 'trg_org_memberships_updated_audit', org: 'new.org_id' },
  { file: '0071_organizations_subscription.sql', fn: 'trg_audit_organizations_subscription_status', org: 'new.id' },
  { file: '0073_copack_channels_orders.sql', fn: 'trg_audit_sales_orders_status', org: 'new.org_id' },
  { file: '0074_copack_kitting_jobs.sql', fn: 'trg_audit_kitting_jobs_status', org: 'new.org_id' },
  { file: '0076_copack_fulfillments.sql', fn: 'trg_audit_fulfillments_status', org: 'new.org_id' },
  { file: '0078_kitforce_members_teams.sql', fn: 'trg_audit_workforce_members_status', org: 'new.org_id' },
  { file: '0079_kitforce_shifts.sql', fn: 'trg_audit_shifts_status', org: 'new.org_id' },
  { file: '0080_kitforce_assignments.sql', fn: 'trg_audit_work_assignments_status', org: 'new.org_id' },
];

// Extract the FIRST `create or replace function public.<fn>( ... ) ... $$;`
// block. All target functions use dollar-quoted ($$) bodies and end at the
// first `$$;` after the opening. We match the opening on a line boundary.
function extractFunction(sql, fn) {
  const startRe = new RegExp(
    `create or replace function public\\.${fn}\\s*\\(`,
    'i',
  );
  const m = startRe.exec(sql);
  if (!m) throw new Error(`function ${fn} not found`);
  const start = m.index;
  // Body opens at the first `$$` after the signature; closes at the next `$$;`.
  const bodyOpen = sql.indexOf('$$', start);
  if (bodyOpen === -1) throw new Error(`no $$ open for ${fn}`);
  const bodyClose = sql.indexOf('$$;', bodyOpen + 2);
  if (bodyClose === -1) throw new Error(`no $$; close for ${fn}`);
  const end = bodyClose + 3;
  return sql.slice(start, end);
}

// Replace the inline chain-head lookup with the shared helper call. The lookup
// always selects payload_hash into v_prev_hash, scoped to one org, ordered by
// triggered_at desc, id desc, limit 1. Whitespace and line breaks vary, so we
// match liberally on the structural tokens and require EXACTLY one hit.
function swapLookup(block, fn, orgExpr) {
  // select payload_hash [into v_prev_hash] from public.audit_log
  //   where org_id = <X> order by triggered_at desc, id desc [limit 1];
  const lookupRe =
    /select\s+payload_hash\s+into\s+v_prev_hash\s+from\s+public\.audit_log\s+where\s+org_id\s*=\s*[^\n]+?\s+order\s+by\s+triggered_at\s+desc\s*,\s*id\s+desc\s*(?:\n\s*)?limit\s+1\s*;/i;
  const hits = block.match(new RegExp(lookupRe, 'gi')) || [];
  if (hits.length !== 1) {
    throw new Error(
      `expected exactly 1 lookup in ${fn}, found ${hits.length}`,
    );
  }
  const replacement = `-- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.\n  v_prev_hash := public.kitstak_audit_chain_head(${orgExpr});`;
  return block.replace(lookupRe, replacement);
}

const out = [];
for (const w of WRITERS) {
  const sql = readFileSync(join(MIG, w.file), 'utf8');
  const block = extractFunction(sql, w.fn);
  const swapped = swapLookup(block, w.fn, w.org);
  // CREATE OR REPLACE FUNCTION preserves the existing privilege grants, so we
  // intentionally do NOT re-issue revoke/grant here (re-issuing would also be
  // wrong for the overloaded helper signatures).
  out.push(`-- ${w.fn} (source: ${w.file})\n${swapped}\n`);
}

process.stdout.write(out.join('\n'));
process.stderr.write(`\n[gen] rewrote ${WRITERS.length} writer functions OK\n`);
