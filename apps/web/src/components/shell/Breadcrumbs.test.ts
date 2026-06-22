// Tests for the retired Breadcrumbs component plus the eyebrow taxonomy.
//
// The parent-chain trail was removed as noisy navigation chrome (operator
// request); the component is now a no-op kept so existing detail-page call sites
// compile. The taxonomy block below still validates the domain words as a
// well-formed, branding-clean set (taxonomy.ts is unchanged).

import { describe, it, expect } from 'vitest';

import { Breadcrumbs, type BreadcrumbItem } from './Breadcrumbs';
import { SPINE_DOMAINS, ADDON_TAXONOMY } from './taxonomy';

describe('Breadcrumbs (retired)', () => {
  it('renders nothing regardless of items', () => {
    expect(Breadcrumbs({ items: [] })).toBeNull();
    expect(
      Breadcrumbs({ items: [{ label: 'Customers', to: '/crm/customers' }] }),
    ).toBeNull();
    const items: BreadcrumbItem[] = [
      { label: 'Customers', to: '/crm/customers' },
      { label: 'Smoke Co.', to: '/crm/customers/abc' },
      { label: 'SMOKE-001' },
    ];
    expect(Breadcrumbs({ items })).toBeNull();
  });
});

// Breadcrumb eyebrow taxonomy (R-W13-IA-01).
//
// The domain taxonomy words remain a well-formed, branding-clean, domain-specific
// set, independent of the sidebar's task axis. (The page eyebrow that rendered
// these was removed, but the taxonomy constants stay valid and tested.)
describe('Breadcrumb eyebrow taxonomy (R-W13-IA-01)', () => {
  const allTaxonomy = [
    ...Object.values(SPINE_DOMAINS),
    ...Object.values(ADDON_TAXONOMY),
  ];

  it('every taxonomy word is non-empty and branding-clean (no em dash, no double hyphen)', () => {
    for (const word of allTaxonomy) {
      expect(word.length, `word "${word}"`).toBeGreaterThan(0);
      expect(word, `word "${word}" no em dash`).not.toMatch(/—/);
      expect(word, `word "${word}" no double hyphen`).not.toMatch(/--/);
    }
  });

  it('taxonomy words are distinct', () => {
    const dupes = allTaxonomy.filter((w, i) => allTaxonomy.indexOf(w) !== i);
    expect(dupes, `duplicate taxonomy words: ${dupes.join(', ')}`).toEqual([]);
  });

  it('covers the core domains and add-on areas', () => {
    expect(Object.values(SPINE_DOMAINS)).toEqual(
      expect.arrayContaining(['CRM', 'Invoicing', 'Finance', 'Purchasing']),
    );
    expect(Object.values(ADDON_TAXONOMY)).toEqual(
      expect.arrayContaining(['3PL Operations', 'Manufacturing', 'WMS']),
    );
  });

  it('stays a domain axis: eyebrow words do not collapse into the retired job-mode words', () => {
    const retired = ['SELL', 'MAKE', 'SHIP', 'GET PAID', 'LIBRARY', 'WORKFORCE'];
    const upper = allTaxonomy.map((s) => s.toUpperCase());
    for (const word of retired) {
      expect(upper).not.toContain(word);
    }
  });
});
