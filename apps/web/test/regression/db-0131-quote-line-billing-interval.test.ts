// Regression for ADR 0005 Phase 1a: billing_interval on quote lines (migration
// 0131). Asserts the additive column, its enum CHECK, and the default. Like
// db-0094, this checks the migration SQL, not a live DB. The column was applied
// and validated on staging in an aborting transaction.

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
  '0131_quote_line_billing_interval.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');

describe('migration 0131 - quote line billing_interval (ADR 0005 Phase 1a)', () => {
  it('adds billing_interval to quote_line_items, not null default one_time', () => {
    expect(sql).toMatch(
      /alter table public\.quote_line_items\s+add column if not exists billing_interval text\s+not null default 'one_time'/i,
    );
  });

  it('constrains the value to the one_time / monthly enum', () => {
    expect(sql).toMatch(
      /check \(billing_interval in \('one_time', 'monthly'\)\)/i,
    );
  });

  it('is additive only: Phase 1a alters no other line table', () => {
    // The active migration only ADDs a column; the DOWN-migration drop is an
    // operator-only comment. This checks the forward body does not reach into
    // project / invoice lines (that carry is Phase 1b).
    expect(sql).not.toMatch(
      /alter table public\.(project_line_items|invoice_line_items)/i,
    );
  });
});
