#!/usr/bin/env node
/*
 * migration-header-format-check.mjs
 * Closes: F-Wave10-REVIEW-REMEDIATION (WS-F / F3)
 *
 * Every FUTURE numbered migration in supabase/migrations MUST carry the
 * canonical header block (see CLAUDE.md "Migration rules"):
 *
 *   -- ============================================================ (separator)
 *   -- Migration: NNNN_snake_case.sql
 *   -- Wave: <n>
 *   -- Phase: <text>
 *   -- Closes: <risk/follow-up id>
 *   -- Date: <YYYY-MM-DD>
 *   -- Constitutional alignment: <text>     (the label may be followed by the
 *                                            body on the next comment lines)
 *
 * The DOWN MIGRATION block is recommended but NOT required by this guard:
 * purely additive idempotent migrations (e.g. 0086) omit it deliberately, and
 * the constitution only mandates it as an operator-only note where a rollback
 * path is non-obvious.
 *
 * Forward-only honesty: the header format drifted on a handful of EARLY,
 * already-applied migrations. Those files are frozen by the forward-only rule
 * and CANNOT be edited, so the guard only enforces the format for migrations
 * numbered at or above ENFORCE_FROM. Pre-ENFORCE_FROM files are grandfathered
 * and skipped. The known cosmetic deviations are documented in the WS-F
 * closeout journal (0041 / 0047 / 0048 / 0071).
 *
 * Perfect SQL parsing is out of scope. The guard scans the leading comment
 * band of each file (the contiguous run of `--` lines plus blank lines before
 * the first non-comment statement) for the required field labels.
 *
 * Zero top-level dependencies. Targets Node 20+ via a .mjs ESM file.
 *
 * Exits 0 on a clean tree, 1 with a per-file report when an enforced migration
 * is missing one or more required header fields.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

// First migration number the canonical header format is enforced from.
// Everything below this is an already-applied, forward-only-frozen file whose
// cosmetic header deviations are documented in the closeout journal.
const ENFORCE_FROM = 87;

// Required header field labels, matched case-insensitively at the start of a
// comment line (after the `--` and optional whitespace). The separator rule is
// handled separately because it is a run of `=` rather than a labelled field.
const REQUIRED_FIELDS = [
  { key: 'Migration', re: /^--\s*Migration:/i },
  { key: 'Wave', re: /^--\s*Wave:/i },
  { key: 'Phase', re: /^--\s*Phase:/i },
  { key: 'Closes', re: /^--\s*Closes:/i },
  { key: 'Date', re: /^--\s*Date:/i },
  { key: 'Constitutional alignment', re: /^--\s*Constitutional alignment:/i },
];

// Canonical separator: a comment line that is `--` followed by a run of `=`.
const SEPARATOR_RE = /^--\s*={5,}\s*$/;

// Pull the leading comment band: from the top of the file up to (but not
// including) the first line that is neither a `--` comment nor blank.
function leadingCommentBand(sql) {
  const lines = sql.split(/\r?\n/);
  const band = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('--')) {
      band.push(line);
      continue;
    }
    break;
  }
  return band;
}

function checkFile(file, sql) {
  const band = leadingCommentBand(sql);
  const problems = [];

  if (!band.some((l) => SEPARATOR_RE.test(l.trim()))) {
    problems.push('missing canonical `-- ====` separator line');
  }

  for (const field of REQUIRED_FIELDS) {
    const present = band.some((l) => field.re.test(l.trim()));
    if (!present) {
      problems.push(`missing required header field: ${field.key}`);
    }
  }

  return problems;
}

function main() {
  if (!existsSync(MIGRATIONS_DIR)) {
    process.stdout.write(
      'migration-header-format-check: no supabase/migrations directory\n',
    );
    return;
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const violations = [];
  for (const file of files) {
    const numMatch = file.match(/^(\d{4})_/);
    if (!numMatch) continue;
    const num = Number(numMatch[1]);
    if (num < ENFORCE_FROM) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const problems = checkFile(file, sql);
    for (const p of problems) {
      violations.push(`${file}: ${p}`);
    }
  }

  if (violations.length === 0) {
    return;
  }

  process.stdout.write('migration-header-format-check: violations found\n');
  process.stdout.write(`Total: ${violations.length}\n\n`);
  for (const v of violations) {
    process.stdout.write(`  ${v}\n`);
  }
  process.stdout.write('\n');
  process.stdout.write(
    'Fix: give the migration the canonical header block. Required fields:\n',
  );
  process.stdout.write(
    '  -- ============================================================\n',
  );
  process.stdout.write('  -- Migration: NNNN_snake_case.sql\n');
  process.stdout.write('  -- Wave: <n>\n');
  process.stdout.write('  -- Phase: <text>\n');
  process.stdout.write('  -- Closes: <risk/follow-up id>\n');
  process.stdout.write('  -- Date: <YYYY-MM-DD>\n');
  process.stdout.write('  -- Constitutional alignment: <text>\n');
  process.stdout.write(
    'A DOWN MIGRATION operator-only note is recommended where rollback is non-obvious.\n',
  );
  process.exitCode = 1;
}

main();
