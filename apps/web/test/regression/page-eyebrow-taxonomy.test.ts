// Regression for R-W13-IA-01: page-header eyebrows align to the pillar IA.
//
// The eyebrow above every list and detail title is the breadcrumb taxonomy the
// operator reads to know where a page sits. Before Wave 13 these eyebrows used
// the retired UX-Q1 job-mode words (SELL, MAKE, SHIP, GET PAID, LIBRARY,
// WORKFORCE). The sidebar moved to a pillar-grouped IA in ADR 0003 (one
// always-on SPINE section sub-grouped by domain, then one section per add-on),
// leaving the eyebrows stale: a page could read "Library / Vendors" while the
// sidebar filed Vendors under the Purchasing domain.
//
// This test walks every PageHeader eyebrow string literal in apps/web/src/pages
// and asserts:
//   1. no eyebrow uses a retired job-mode word, and
//   2. representative surfaces carry the pillar/domain taxonomy that matches
//      the sidebar grouping in sidebarModes.ts.
//
// SPA-only guardrail. It reads source text (not a running app), in the same
// element-tree-free style as the other regression suites here.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// apps/web/test/regression/ -> repo root.
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const PAGES_DIR = resolve(REPO_ROOT, 'apps', 'web', 'src', 'pages');

// Retired job-mode words. None may appear as the leading token of any eyebrow.
const RETIRED_TAXONOMY_WORDS = [
  'Sell',
  'Make',
  'Ship',
  'Get paid',
  'Library',
  'Workforce',
];

/** Collect every .tsx file under a directory tree. */
function collectTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsxFiles(full));
    } else if (entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract every string-literal eyebrow value from a page source. Matches
 * `eyebrow="..."` (the only form the pages use). Dynamic eyebrows (none
 * exist today) are intentionally not matched.
 */
function extractEyebrows(src: string): string[] {
  const matches = src.matchAll(/eyebrow="([^"]+)"/g);
  return Array.from(matches, (m) => m[1]!);
}

const PAGE_FILES = collectTsxFiles(PAGES_DIR);

describe('page eyebrow taxonomy (R-W13-IA-01)', () => {
  it('finds eyebrows to check (guards against the regex silently matching nothing)', () => {
    const total = PAGE_FILES.reduce(
      (sum, file) => sum + extractEyebrows(readFileSync(file, 'utf8')).length,
      0,
    );
    // There are well over 100 eyebrowed surfaces; assert a healthy floor so a
    // future refactor that changes the eyebrow prop name cannot make this
    // suite vacuously pass.
    expect(total).toBeGreaterThan(80);
  });

  it('uses no retired job-mode word as the leading taxonomy token on any page', () => {
    const offenders: string[] = [];
    for (const file of PAGE_FILES) {
      const eyebrows = extractEyebrows(readFileSync(file, 'utf8'));
      for (const eyebrow of eyebrows) {
        const leading = eyebrow.split(' / ')[0]!.trim();
        if (RETIRED_TAXONOMY_WORDS.includes(leading)) {
          offenders.push(`${file.replace(REPO_ROOT, '')}: "${eyebrow}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Representative surface -> expected eyebrow taxonomy. Each maps a page file
  // (relative to apps/web/src/pages) to the pillar/domain taxonomy the sidebar
  // groups it under. One per SPINE domain plus one per add-on.
  const REPRESENTATIVE: ReadonlyArray<[string, string]> = [
    // SPINE domains
    ['crm/customers/CustomersListPage.tsx', 'CRM / Customers'],
    ['3pl-operations/quotes/QuotesListPage.tsx', 'Quotes'],
    ['3pl-operations/projects/ProjectsListPage.tsx', 'Projects'],
    ['3pl-operations/items/ItemsListPage.tsx', 'Catalog / Items'],
    ['3pl-operations/warehouses/WarehousesListPage.tsx', 'Inventory / Warehouses'],
    ['3pl-operations/vendors/VendorsListPage.tsx', 'Purchasing / Vendors'],
    ['3pl-operations/invoicing/InvoicesListPage.tsx', 'Invoicing / Invoices'],
    ['finance/PeriodClosePage.tsx', 'Finance / Period close'],
    ['3pl-operations/sales-config/TaxesPage.tsx', 'Settings / Sales config / Taxes'],
    // Add-ons
    ['3pl-operations/shipments/ShipmentsListPage.tsx', '3PL Operations / Shipments'],
    ['manufacturing/ManufacturingRunsListPage.tsx', 'Manufacturing / Runs'],
    ['copack/SalesOrdersListPage.tsx', 'Co-Pack and Ecom / Sales orders'],
    ['kitforce/MembersListPage.tsx', 'KitForce / Members'],
    ['wms/WmsLotsListPage.tsx', 'WMS'],
  ];

  it.each(REPRESENTATIVE)(
    'page %s carries the eyebrow taxonomy "%s"',
    (relPath, expectedEyebrow) => {
      const full = resolve(PAGES_DIR, relPath);
      const src = readFileSync(full, 'utf8');
      const eyebrows = extractEyebrows(src);
      expect(eyebrows).toContain(expectedEyebrow);
    },
  );
});
