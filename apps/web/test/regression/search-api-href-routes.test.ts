// Regression for the 2026-06-01 completeness sweep finding: search-api
// emitted dead hrefs for all four entity groups. Every href prefix must
// correspond to a real SPA route pattern declared in apps/web/src/routes.ts
// so a global-search result click lands on an existing page.
//
// Entities covered:
//   customer  /crm/customers/:id
//   quote     /3pl-operations/quotes/:id
//   invoice   /invoicing/invoices/:id
//   project   /3pl-operations/projects/:id
//   item      /catalog/items/:id            (R-W13-SRCH-01)
//   job_run   /3pl-operations/job-runs/:id  (R-W13-SRCH-01)
//
// This test reads both source files as plain text and does not import or
// execute them. That makes it safe in a Node environment (no Deno shim
// needed for search-api; no jsdom needed for routes.ts) and lets the test
// describe exactly which string it is asserting against.
//
// Red/green verification: the old dead href prefixes (/sales/customers,
// /sales/quotes, /billing/invoices, /sales/projects) are NOT registered in
// routes.ts. Any revert of the search-api fix will make the corresponding
// assertion below fail, proving this test would have caught the original bug.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// apps/web/test/regression/ -> repo root (four levels up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

const SEARCH_API_PATH = resolve(
  REPO_ROOT,
  'supabase',
  'functions',
  'search-api',
  'index.ts',
);
const ROUTES_PATH = resolve(REPO_ROOT, 'apps', 'web', 'src', 'routes.ts');

// Extract every href template literal prefix from the search-api handler.
// The handler emits lines of the shape:
//   href: `/some/path/${r.id}`,
// This regex captures the static prefix (everything before the interpolation).
function extractHrefPrefixes(src: string): string[] {
  const pattern = /href:\s*`(\/[^$`]+)\$\{r\.id\}`/g;
  const prefixes: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(src)) !== null) {
    prefixes.push(match[1]);
  }
  return prefixes;
}

// Check whether routes.ts declares a detail route for the given href prefix.
// A detail route has the shape `path: '/prefix/:id'` (with a parameter
// segment following the static prefix). We check the exact string so the
// test fails if someone adds a typo or an extra segment.
function routesDeclaresDetailRoute(routesSrc: string, prefix: string): boolean {
  // The routes table uses both multi-line and inline forms. A simple
  // substring check on `/prefix/:id` covers both because the path value
  // is always a string literal and the :id segment always follows directly.
  const needle = `'${prefix}:id'`;
  return routesSrc.includes(needle);
}

describe('search-api href prefixes point at real SPA routes', () => {
  const searchApiSrc = readFileSync(SEARCH_API_PATH, 'utf8');
  const routesSrc = readFileSync(ROUTES_PATH, 'utf8');

  const prefixes = extractHrefPrefixes(searchApiSrc);

  it('extracts exactly six href prefixes from search-api/index.ts', () => {
    // Four original groups (customer, quote, invoice, project) plus the two
    // R-W13-SRCH-01 additions (item, job_run).
    expect(prefixes).toHaveLength(6);
  });

  it('customer href prefix is /crm/customers/ (not /sales/customers/)', () => {
    const customerPrefix = prefixes.find((p) => p.includes('customer'));
    expect(customerPrefix).toBe('/crm/customers/');
    // Ensure the old dead prefix is absent.
    expect(searchApiSrc).not.toContain('/sales/customers/');
  });

  it('quote href prefix is /3pl-operations/quotes/ (not /sales/quotes/)', () => {
    const quotePrefix = prefixes.find((p) => p.includes('quote'));
    expect(quotePrefix).toBe('/3pl-operations/quotes/');
    expect(searchApiSrc).not.toContain('/sales/quotes/');
  });

  it('invoice href prefix is /invoicing/invoices/ (not /billing/invoices/)', () => {
    const invoicePrefix = prefixes.find((p) => p.includes('invoice'));
    expect(invoicePrefix).toBe('/invoicing/invoices/');
    expect(searchApiSrc).not.toContain('/billing/invoices/');
  });

  it('project href prefix is /3pl-operations/projects/ (not /sales/projects/)', () => {
    const projectPrefix = prefixes.find((p) => p.includes('project'));
    expect(projectPrefix).toBe('/3pl-operations/projects/');
    expect(searchApiSrc).not.toContain('/sales/projects/');
  });

  it('item href prefix is /catalog/items/ (canonical spine catalog route)', () => {
    const itemPrefix = prefixes.find((p) => p.includes('/items/'));
    expect(itemPrefix).toBe('/catalog/items/');
    // The 3PL-namespaced catalog path is a redirect alias, not the search
    // target; the canonical detail route lives on the spine.
    expect(searchApiSrc).not.toContain('/3pl-operations/items/');
  });

  it('job_run href prefix is /3pl-operations/job-runs/ (job number lookup)', () => {
    const jobRunPrefix = prefixes.find((p) => p.includes('/job-runs/'));
    expect(jobRunPrefix).toBe('/3pl-operations/job-runs/');
  });

  it('every href prefix has a matching :id detail route in routes.ts', () => {
    const missing: string[] = [];
    for (const prefix of prefixes) {
      if (!routesDeclaresDetailRoute(routesSrc, prefix)) {
        missing.push(prefix);
      }
    }
    expect(
      missing,
      `search-api href prefix(es) with no matching detail route in routes.ts: ${missing.join(', ')}. ` +
        'Add the route or correct the href prefix in supabase/functions/search-api/index.ts.',
    ).toEqual([]);
  });
});
