// BNEW-11: pin the freshness contract on useFlags. The v2 smoke surfaced
// stale-cache behaviour where a flag flip in the DB did not reach a
// long-lived SPA tab. The refetchOnWindowFocus + refetchOnMount = 'always'
// pair heals the drift within one focus-or-navigate event.
//
// This test reads the literal source of useFlags.ts and asserts the two
// query-config lines are present. Same posture as other migration / config
// pins in apps/web/test/regression: structural check, not behavioural,
// because the existing harness mocks TanStack at a level where querying
// the real refetch behaviour would require a live React tree.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_PATH = resolve(__dirname, 'useFlags.ts');
const source = readFileSync(SOURCE_PATH, 'utf8');

describe('useFlags freshness config (BNEW-11)', () => {
  it('declares refetchOnWindowFocus: true so focus revalidates flags', () => {
    expect(source).toMatch(/refetchOnWindowFocus:\s*true/);
  });

  it("declares refetchOnMount: 'always' so navigation revalidates flags", () => {
    expect(source).toMatch(/refetchOnMount:\s*['"]always['"]/);
  });

  it('keeps staleTime at 30_000 so quick re-mounts do not re-fire', () => {
    expect(source).toMatch(/staleTime:\s*30_000/);
  });
});
