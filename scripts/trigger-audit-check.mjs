#!/usr/bin/env node
/*
 * trigger-audit-check.mjs
 * Closes: F-Wave7-TRIGGER-AUDIT-01
 *
 * Grep guardrail that catches the two known shapes of trigger-body NOT NULL
 * violations from Phase 6 / Phase 6.5:
 *
 *   - PR #24 (F-Wave6-AUDIT-01): trg_audit_project_line_items() passed two
 *     literal `null`s to audit_append_state_change(...); the 5th positional
 *     argument maps to audit_log.to_state which is NOT NULL. Every insert
 *     into project_line_items raised a not-null violation.
 *
 *   - PR #28 (F-Wave6-EMIT-MOVEMENTS-01): tg_*_emit_movements() inserted
 *     (v_line ->> 'item_id')::uuid directly into stock_movements.item_id
 *     (NOT NULL). When the JSON payload omitted item_id the cast yielded
 *     NULL and the transition rolled back.
 *
 * Perfect SQL parsing is out of scope (dispatch explicitly permits a regex
 * heuristic). The script catches the obvious shapes; false positives are
 * suppressible via scripts/trigger-audit-allowlist.txt.
 *
 * Zero top-level dependencies. Targets Node 20+ via a .mjs ESM file.
 *
 * Exits 0 on a clean tree, 1 with a per-file:line report on violations.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'trigger-audit-allowlist.txt');

// --------------------------------------------------------------------------
// Special-case: audit_append_state_change(p_org, p_entity_type, p_entity_id,
//                                        p_from, p_to, p_action, p_actor,
//                                        p_diff)
// p_to maps to audit_log.to_state (NOT NULL). PR #24 shape: a literal `null`
// in the 5th positional argument. Defined in migration 0017.
// --------------------------------------------------------------------------
const AUDIT_HELPER = {
  name: 'audit_append_state_change',
  notNullPositionalIndex: 4, // 0-based; the 5th argument
  notNullColumn: 'audit_log.to_state',
};

// --------------------------------------------------------------------------
// Filesystem helpers.
// --------------------------------------------------------------------------

function readMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((n) => join(MIGRATIONS_DIR, n));
  return files.map((f) => ({ path: f, text: readFileSync(f, 'utf8') }));
}

function rel(p) {
  return relative(ROOT, p).split(sep).join('/');
}

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

// --------------------------------------------------------------------------
// Allowlist.
// --------------------------------------------------------------------------

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return new Set();
  const raw = readFileSync(ALLOWLIST_PATH, 'utf8');
  const out = new Set();
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    // Format: <rule>|<file>|<snippet>
    out.add(line);
  }
  return out;
}

function isAllowed(v, allow) {
  return allow.has(`${v.rule}|${v.file}|${v.snippet}`);
}

// --------------------------------------------------------------------------
// Pass 1: collect NOT NULL columns per public table.
//
// Heuristic: parse `create table [if not exists] [<schema>.]<table> ( ... );`
// blocks and any `alter table ... alter column ... set not null` or
// `alter table ... add column ... not null` statements. We intentionally
// over-detect (union over migrations) rather than try to track `drop not
// null` — the goal is to flag suspicious inserts, not to model the live
// schema.
// --------------------------------------------------------------------------

function collectNotNullColumns(migrations) {
  const map = new Map(); // table-name (no schema) -> Set<colName>
  const addNN = (table, col) => {
    const t = table.toLowerCase();
    const c = col.toLowerCase();
    if (!map.has(t)) map.set(t, new Set());
    map.get(t).add(c);
  };
  for (const { text } of migrations) {
    // Strip line comments to keep the regex simple.
    const stripped = text.replace(/--[^\n]*/g, '');

    // create table blocks. Match the table name then the parenthesised body.
    const reCreate =
      /create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
    let m;
    while ((m = reCreate.exec(stripped)) !== null) {
      const table = m[1];
      // Find the matching close paren by depth.
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < stripped.length && depth > 0) {
        const ch = stripped[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        i += 1;
      }
      const body = stripped.slice(start, i - 1);
      // Split top-level on commas (depth=0). For NOT NULL detection we only
      // care about column lines; constraint lines (primary key (...) etc.)
      // are harmless.
      const parts = [];
      let buf = '';
      let d = 0;
      for (const ch of body) {
        if (ch === '(') d += 1;
        else if (ch === ')') d -= 1;
        if (ch === ',' && d === 0) {
          parts.push(buf);
          buf = '';
        } else {
          buf += ch;
        }
      }
      if (buf.trim() !== '') parts.push(buf);
      for (const partRaw of parts) {
        const part = partRaw.trim();
        // Skip explicit table-level constraints.
        if (/^(primary\s+key|foreign\s+key|constraint|unique|check)\b/i.test(part)) {
          continue;
        }
        const colMatch = /^([a-z_][a-z0-9_]*)\s+/i.exec(part);
        if (!colMatch) continue;
        const col = colMatch[1];
        if (/\bnot\s+null\b/i.test(part)) {
          addNN(table, col);
        }
      }
    }

    // alter table ... add column ... not null
    const reAlterAdd =
      /alter\s+table(?:\s+if\s+exists)?\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+add\s+column(?:\s+if\s+not\s+exists)?\s+([a-z_][a-z0-9_]*)\s+[^;]*?not\s+null/gi;
    while ((m = reAlterAdd.exec(stripped)) !== null) {
      addNN(m[1], m[2]);
    }
    // alter table ... alter column ... set not null
    const reAlterSet =
      /alter\s+table(?:\s+if\s+exists)?\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+alter\s+column\s+([a-z_][a-z0-9_]*)\s+set\s+not\s+null/gi;
    while ((m = reAlterSet.exec(stripped)) !== null) {
      addNN(m[1], m[2]);
    }
  }
  return map;
}

// --------------------------------------------------------------------------
// Pass 2: scan trigger / function bodies for suspect insert + helper-call
// shapes.
//
// We identify "trigger / function body" loosely as any `create [or replace]
// function ...` block. We then scan its body for:
//   (a) `insert into [<schema>.]<table> ( col1, col2, ... ) values ( v1, v2,
//       ... );` and check each NOT NULL column's value expression for known
//       unsafe shapes.
//   (b) `audit_append_state_change( ... )` calls with a literal `null` in
//       the 5th positional argument (maps to audit_log.to_state which is
//       NOT NULL).
// --------------------------------------------------------------------------

function findFunctionBodies(text) {
  // Return an array of { start, end } offsets covering each function body
  // (between the `as $$` ... `$$` markers). Functions can also use $tag$
  // delimiters but the repo uses $$ throughout; handle the common case and
  // ignore the rest.
  const out = [];
  // [\s\S] (not [^\n]) so the header can span lines: `create function ...\n
  //   returns trigger\n   language plpgsql\n   security definer\n   as $$`.
  const re = /create\s+(?:or\s+replace\s+)?function\s+[\s\S]*?\bas\s+\$\$/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const closeIdx = text.indexOf('$$', start);
    if (closeIdx === -1) continue;
    out.push({ start, end: closeIdx });
  }
  return out;
}

function splitTopLevelCommas(s) {
  const parts = [];
  let buf = '';
  let depth = 0;
  let inSingle = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inSingle) {
      buf += ch;
      if (ch === "'" && s[i + 1] !== "'") inSingle = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim() !== '') parts.push(buf);
  return parts.map((p) => p.trim());
}

function findMatchingParen(text, openIdx) {
  // openIdx points at '('. Return index of matching ')'.
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

// A value expression is "safe" for a NOT NULL column if it is none of:
//   - a literal `null`
//   - an unguarded `(jsonb_expr ->> 'key')::type` cast
// "Guarded" = wrapped in coalesce(...) or nullif(...) at the top level, OR
// the expression is the result of a variable that was previously assigned
// inside an exception-catching block. We can't fully track variable
// lifetimes with a regex; rely on coalesce/nullif as the safe shape.

function isLiteralNull(expr) {
  return /^null$/i.test(expr.trim());
}

function isUnguardedJsonbCast(expr) {
  const t = expr.trim();
  // Top-level wrapped in coalesce / nullif is safe by construction.
  if (/^coalesce\s*\(/i.test(t)) return false;
  if (/^nullif\s*\(/i.test(t)) return false;
  // Match `(...->>...)::type` or `... ->> '...' ::type`.
  return /\(\s*[^)]*->>\s*'[^']+'\s*\)\s*::/i.test(t);
}

function scanFunctionBody(filePath, text, body, notNullByTable) {
  const out = [];
  const slice = text.slice(body.start, body.end);

  // (b) audit_append_state_change calls.
  const reHelper = new RegExp(
    `\\b${AUDIT_HELPER.name}\\s*\\(`,
    'gi',
  );
  let m;
  while ((m = reHelper.exec(slice)) !== null) {
    const openIdx = body.start + m.index + m[0].length - 1; // points at '('
    const closeIdx = findMatchingParen(text, openIdx);
    if (closeIdx === -1) continue;
    const argsStr = text.slice(openIdx + 1, closeIdx);
    const args = splitTopLevelCommas(argsStr);
    const idx = AUDIT_HELPER.notNullPositionalIndex;
    if (args.length > idx) {
      const arg = args[idx];
      if (isLiteralNull(arg)) {
        const ln = lineOf(text, openIdx);
        out.push({
          rule: 'trigger-helper-null',
          file: rel(filePath),
          line: ln,
          message: `${AUDIT_HELPER.name}() called with literal null in positional argument ${idx + 1}, which feeds ${AUDIT_HELPER.notNullColumn}`,
          snippet: `${AUDIT_HELPER.name}(... ${arg} ...)`,
        });
      }
    }
  }

  // (a) direct inserts.
  const reInsert =
    /\binsert\s+into\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  while ((m = reInsert.exec(slice)) !== null) {
    const table = m[1].toLowerCase();
    const colsOpenIdx = body.start + m.index + m[0].length - 1;
    const colsCloseIdx = findMatchingParen(text, colsOpenIdx);
    if (colsCloseIdx === -1) continue;
    const colsStr = text.slice(colsOpenIdx + 1, colsCloseIdx);
    const cols = splitTopLevelCommas(colsStr).map((c) =>
      c.replace(/[\s\r\n]+/g, '').toLowerCase(),
    );

    // Find the following `values (`.
    const after = text.slice(colsCloseIdx + 1, body.end);
    const valsMatch = /\bvalues\s*\(/i.exec(after);
    if (!valsMatch) continue;
    const valsOpenIdx = colsCloseIdx + 1 + valsMatch.index + valsMatch[0].length - 1;
    const valsCloseIdx = findMatchingParen(text, valsOpenIdx);
    if (valsCloseIdx === -1) continue;
    const valsStr = text.slice(valsOpenIdx + 1, valsCloseIdx);
    const vals = splitTopLevelCommas(valsStr);

    if (cols.length !== vals.length) continue; // column / value count mismatch; skip

    const notNullCols = notNullByTable.get(table);
    if (!notNullCols) continue;

    for (let i = 0; i < cols.length; i += 1) {
      const col = cols[i];
      if (!notNullCols.has(col)) continue;
      const val = vals[i];
      if (isLiteralNull(val)) {
        const ln = lineOf(text, valsOpenIdx);
        out.push({
          rule: 'trigger-insert-null',
          file: rel(filePath),
          line: ln,
          message: `insert into ${table}(${col}) inside trigger function passes literal null to a NOT NULL column`,
          snippet: `${table}.${col} <- ${val.trim().slice(0, 80)}`,
        });
      } else if (isUnguardedJsonbCast(val)) {
        const ln = lineOf(text, valsOpenIdx);
        out.push({
          rule: 'trigger-insert-unguarded-cast',
          file: rel(filePath),
          line: ln,
          message: `insert into ${table}(${col}) feeds an unguarded jsonb ->> cast to a NOT NULL column (wrap in coalesce/nullif, or pre-check via exception block)`,
          snippet: `${table}.${col} <- ${val.trim().slice(0, 80)}`,
        });
      }
    }
  }

  return out;
}

// --------------------------------------------------------------------------
// Main.
// --------------------------------------------------------------------------

function main() {
  const migrations = readMigrations();
  if (migrations.length === 0) {
    process.stdout.write('trigger-audit-check: no migrations found at supabase/migrations\n');
    return;
  }
  const notNullByTable = collectNotNullColumns(migrations);
  const allow = loadAllowlist();

  const all = [];
  for (const { path, text } of migrations) {
    const bodies = findFunctionBodies(text);
    for (const body of bodies) {
      all.push(...scanFunctionBody(path, text, body, notNullByTable));
    }
  }

  const filtered = all.filter((v) => !isAllowed(v, allow));
  if (filtered.length === 0) {
    return;
  }

  process.stdout.write('trigger-audit-check: violations found\n');
  process.stdout.write(`Total: ${filtered.length}\n\n`);
  const byRule = new Map();
  for (const v of filtered) {
    const list = byRule.get(v.rule) ?? [];
    list.push(v);
    byRule.set(v.rule, list);
  }
  for (const [rule, list] of byRule) {
    process.stdout.write(`[${rule}] ${list.length} violation(s):\n`);
    for (const v of list) {
      process.stdout.write(`  ${v.file}:${v.line}\n`);
      process.stdout.write(`    ${v.message}\n`);
      if (v.snippet) process.stdout.write(`    > ${v.snippet}\n`);
    }
    process.stdout.write('\n');
  }
  process.stdout.write(
    'Fix the trigger body, or add an explicit entry to scripts/trigger-audit-allowlist.txt\n',
  );
  process.stdout.write(
    'in the form: <rule>|<file>|<snippet>\n',
  );
  process.stdout.write(
    'Acceptable safe shapes: coalesce(<expr>, <fallback>), nullif(<expr>, ...),\n',
  );
  process.stdout.write(
    'or a preceding exception-catching block that assigns the variable and a\n',
  );
  process.stdout.write(
    '`continue` / `return` guard before the insert.\n',
  );
  process.exitCode = 1;
}

main();
