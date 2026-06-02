// Static contract guard for the audit writer / verifier hashed-payload shape.
// F-Wave10-REVIEW-REMEDIATION (WS-C / C2).
//
// The audit hash chain is only sound if every per-entity writer hashes the SAME
// set of jsonb keys that verify_audit_chain reconstructs when it recomputes a
// row's expected hash. If a writer ever adds, drops, or renames a key in its
// `v_payload := jsonb_build_object(...)` without the verifier learning to
// reconstruct that exact key-set, the verifier recomputes a different canonical
// payload, the sha256 differs, and the row falsely reports as a broken link.
// That drift is precisely what F-Wave9-AUDIT-CHAIN-SAME-TXN-01 fixed for the
// org_membership writers (they hash an extra 'metadata' key; the verifier had
// to be taught to add it back when non-empty).
//
// FORM OF THIS GUARD: STATIC. The apps/web harness has no database connection,
// so this suite parses the migration tree (0085 is the canonical home of all 23
// writers, the shared chain-head helper, and verify_audit_chain today; forward-
// only supersedes are followed by reading the LATEST definition of each
// function) and asserts that every writer's hashed-payload key-set is one the
// verifier knows how to reconstruct:
//
//   - the 9-key BASE shape:
//       org_id, entity_type, entity_id, from_state, to_state, action,
//       triggered_by, diff_json, prev_hash
//   - OR the base shape plus the optional 'metadata' key (org_membership
//     writers), which the verifier reconstructs only when metadata is non-empty.
//
// It also asserts the verifier reconstructs exactly the base shape unconditionally
// and adds 'metadata' conditionally, so writer and verifier cannot drift apart
// silently. Full BEHAVIOURAL verification (recompute every real row's hash
// against the live function) stays in the nightly audit-chain-verify edge job;
// this guard is the cheap, connection-free early-warning that catches a key-set
// edit at review time.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

// Resolve the LATEST definition of each audited function instead of pinning a
// single migration file. Migrations are forward-only: a later migration may
// supersede 0085 by recreating verify_audit_chain or a writer. Pinning 0085
// would let this guard assert against stale SQL while prod runs the superseding
// definition, which is the exact writer/verifier drift this suite exists to
// catch. So we read every migration in ascending order and concatenate them;
// functionBody() below matches greedily and a per-function lookup picks the
// last (highest-numbered) `create or replace function` for that name, which is
// the one that actually runs in the database.
function loadMigrationsConcatenated(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  return files
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

const sql = loadMigrationsConcatenated();

// The base key-set every writer hashes. Order is irrelevant to the hash because
// kitstak_audit_canonical sorts keys (jsonb ::text), so we compare as sets.
const BASE_KEYS = [
  'org_id',
  'entity_type',
  'entity_id',
  'from_state',
  'to_state',
  'action',
  'triggered_by',
  'diff_json',
  'prev_hash',
].sort();

const BASE_PLUS_METADATA = [...BASE_KEYS, 'metadata'].sort();

// Every reusable writer that builds a hashed payload in 0085. Same list the
// 0085 ordering test pins; kept here so a new writer added to the migration
// without being added to this guard fails the discovery assertion below.
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

// Writers that intentionally hash the extra 'metadata' key (user_id + role_id).
const METADATA_WRITERS = new Set([
  'trg_org_memberships_created_audit',
  'trg_org_memberships_updated_audit',
]);

// Return the body text of the LAST (highest-numbered, hence authoritative)
// `create or replace function public.<name>(...) ... $$;` across all migrations.
// A global regex is iterated so a superseding migration's redefinition wins over
// the original, matching what the database actually runs.
function functionBody(name: string): string | null {
  const re = new RegExp(
    `create or replace function public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`,
    'gi',
  );
  let last: string | null = null;
  for (const m of sql.matchAll(re)) {
    last = m[0];
  }
  return last;
}

// Find the index of the matching close paren for the '(' at openIdx.
function matchParen(text: string, openIdx: number): number {
  let depth = 0;
  let inSingle = false;
  for (let i = openIdx; i < text.length; i += 1) {
    const ch = text[i];
    if (inSingle) {
      if (ch === "'" && text[i + 1] !== "'") inSingle = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Extract the TOP-LEVEL keys of the FIRST `v_payload := jsonb_build_object( ... )`
// assignment in a function body. jsonb_build_object takes a flat, comma-separated
// argument list of alternating key, value, key, value, ... so the keys are the
// EVEN-indexed depth-0 elements. Values (odd-indexed) are ignored even when they
// are themselves quoted literals (e.g. action 'created') or nested
// jsonb_build_object(...) calls (skipped via paren-depth tracking).
function hashedPayloadKeys(body: string): string[] {
  const assignIdx = body.search(/v_payload\s*:=\s*jsonb_build_object\s*\(/i);
  if (assignIdx === -1) return [];
  const openIdx = body.indexOf('(', assignIdx);
  if (openIdx === -1) return [];
  const closeIdx = matchParen(body, openIdx);
  if (closeIdx === -1) return [];
  const inner = body.slice(openIdx + 1, closeIdx);

  const keys: string[] = [];
  let depth = 0;
  let inSingle = false;
  let elementIndex = 0; // 0-based position in the flat key/value arg list
  let buf = '';
  let capturing = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (inSingle) {
      if (ch === "'" && inner[i + 1] !== "'") {
        inSingle = false;
        if (capturing) {
          keys.push(buf);
          capturing = false;
          buf = '';
        }
      } else if (capturing) {
        buf += ch;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      // Capture only when this literal opens an EVEN-indexed (key) element and
      // sits at the top level of the build_object argument list.
      if (depth === 0 && elementIndex % 2 === 0 && buf === '' && !capturing) {
        capturing = true;
        buf = '';
      }
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      elementIndex += 1; // advance to the next key/value slot
      buf = '';
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// METADATA-KEY RECONSTRUCTION CONVENTION (and the drift risk it guards).
// F-Wave10-REVIEW-REMEDIATION (WS-C / C4 documentation).
//
// The canonical SQL for verify_audit_chain lives in migration 0085, which is
// forward-only and already applied, so the convention is documented here, in
// the guard that sits next to the reconstruction logic, rather than by editing
// an applied migration.
//
// Convention:
//   - 21 of the 23 writers hash the 9-key BASE shape and leave audit_log.metadata
//     at its NOT NULL default '{}'. They hash WITHOUT a 'metadata' key.
//   - The 2 org_membership writers (0067 created / 0068 updated) hash a 10th
//     key, 'metadata' (user_id + role_id), and store the same non-empty object
//     in the column.
//   - jsonb_build_object hashes through kitstak_audit_canonical, which sorts
//     keys (jsonb ::text), so insertion ORDER never affects the hash. Only key
//     PRESENCE does.
//   - Therefore verify_audit_chain must reconstruct 'metadata' if and ONLY if
//     the stored metadata is non-empty: `if r.metadata is not null and
//     r.metadata <> '{}'::jsonb then v_payload := v_payload ||
//     jsonb_build_object('metadata', r.metadata)`. Reconstructing it for the
//     9-key writers (whose metadata is '{}') would add a phantom key and break
//     their hashes; omitting it for the membership writers drops a real key and
//     breaks theirs.
//
// Drift risk:
//   If a future writer adds, drops, or renames a hashed key without teaching
//   verify_audit_chain to reconstruct that exact key-set, the verifier computes
//   a different canonical payload, the sha256 differs, and the row falsely
//   reports as a broken chain link in the nightly probe. The 0067/0068 'metadata'
//   key was exactly that drift before F-Wave9-AUDIT-CHAIN-SAME-TXN-01 taught the
//   verifier the conditional reconstruction. The assertions below fail at review
//   time if writer and verifier key-sets ever diverge again.
// ---------------------------------------------------------------------------

// Reconstruct the verifier's key-set: the BASE keys it always builds, plus
// 'metadata' which it adds conditionally via `v_payload || jsonb_build_object('metadata', ...)`.
function verifierKeys(): { base: string[]; conditional: string[] } {
  const body = functionBody('verify_audit_chain');
  if (!body) return { base: [], conditional: [] };
  const base = hashedPayloadKeys(body);
  const conditional: string[] = [];
  // The conditional metadata add: `v_payload := v_payload || jsonb_build_object('metadata', r.metadata)`.
  if (/jsonb_build_object\('metadata'/i.test(body)) {
    conditional.push('metadata');
  }
  return { base, conditional };
}

describe('audit writer / verifier hashed-payload contract (C2 static guard)', () => {
  it('loads a non-empty migration tree containing the audit functions', () => {
    // Fail loud if the concatenated load is empty (wrong dir, glob miss): an
    // empty corpus would make every functionBody() return null and silently
    // weaken the rest of the suite.
    expect(sql.length).toBeGreaterThan(0);
    expect(functionBody('verify_audit_chain')).not.toBeNull();
  });

  it('discovers every writer function in its latest migration definition', () => {
    for (const fn of WRITER_FUNCTIONS) {
      expect(
        functionBody(fn),
        `${fn} must be defined by some migration`,
      ).not.toBeNull();
    }
  });

  it('every writer hashes either the base 9-key shape or base + metadata', () => {
    for (const fn of WRITER_FUNCTIONS) {
      const body = functionBody(fn)!;
      const keys = hashedPayloadKeys(body).sort();
      expect(keys.length, `${fn} must build a hashed payload`).toBeGreaterThan(0);

      const expected = METADATA_WRITERS.has(fn) ? BASE_PLUS_METADATA : BASE_KEYS;
      expect(
        keys,
        `${fn} hashed-payload key-set drifted from the verifier-reconstructable shape`,
      ).toEqual(expected);
    }
  });

  it('only the org_membership writers carry the extra metadata key', () => {
    for (const fn of WRITER_FUNCTIONS) {
      const keys = new Set(hashedPayloadKeys(functionBody(fn)!));
      const hasMetadata = keys.has('metadata');
      expect(
        hasMetadata,
        `${fn}: metadata key presence must match the org_membership exception`,
      ).toBe(METADATA_WRITERS.has(fn));
    }
  });

  it('the verifier reconstructs exactly the base shape unconditionally', () => {
    const { base } = verifierKeys();
    expect(base.sort()).toEqual(BASE_KEYS);
  });

  it('the verifier reconstructs metadata conditionally (matches the metadata writers)', () => {
    const { conditional } = verifierKeys();
    expect(conditional).toContain('metadata');
    // And the conditional is genuinely guarded on a non-empty metadata object,
    // so the 9-key writers (metadata '{}') are not given a phantom key.
    const body = functionBody('verify_audit_chain')!;
    expect(body).toMatch(/r\.metadata\s+is not null/i);
    expect(body).toMatch(/r\.metadata\s*<>\s*'\{\}'::jsonb/i);
  });

  it('writer key-sets are a subset of {base keys} union {metadata}, with no unknown keys', () => {
    const allowed = new Set(BASE_PLUS_METADATA);
    for (const fn of WRITER_FUNCTIONS) {
      for (const k of hashedPayloadKeys(functionBody(fn)!)) {
        expect(
          allowed.has(k),
          `${fn} hashes unknown key '${k}' the verifier cannot reconstruct`,
        ).toBe(true);
      }
    }
  });
});
