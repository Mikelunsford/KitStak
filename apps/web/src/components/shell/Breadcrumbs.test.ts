// Component tests for Breadcrumbs (UX-Q10).
//
// Vitest in this repo runs pure-TS suites without jsdom or testing-library
// (mirrors the NextStepCTA.test.ts and sidebarGating.test.ts precedents).
// We exercise the function component by calling it directly and walking
// the returned React element tree. That is enough to lock the
// constitutional invariants:
//   - empty / single-item trails render nothing
//   - the trailing item is non-clickable and accent-styled
//   - ancestor items render as Link with the supplied `to`
//   - the dot separator (per CLAUDE.md branding) sits between items
//   - the order is preserved
//   - truncate-on-narrow class is wired
//
// React types are loose around children/elements so we walk via small
// helpers and a couple of well-typed casts where the JSX tree is known.

import { describe, it, expect } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

import { Breadcrumbs, type BreadcrumbItem } from './Breadcrumbs';
import { SPINE_DOMAINS, ADDON_TAXONOMY } from './taxonomy';

interface ElementProps {
  children?: ReactNode;
  to?: string;
  className?: string;
  'aria-current'?: string;
  'data-testid'?: string;
  [key: string]: unknown;
}

function elementProps(node: unknown): ElementProps {
  if (isValidElement(node)) {
    return (node as ReactElement<ElementProps>).props;
  }
  return {};
}

function elementType(node: unknown): unknown {
  if (isValidElement(node)) {
    return (node as ReactElement).type;
  }
  return null;
}

function asArray(children: ReactNode | undefined): ReactNode[] {
  if (children === undefined || children === null) return [];
  return Array.isArray(children) ? children : [children];
}

/**
 * Walk the tree and collect every <li> element it contains.
 * Breadcrumbs renders nav > ol > [li | Fragment(li, li)] so we flatten.
 */
function collectListItems(node: ReactNode): ReactElement<ElementProps>[] {
  const out: ReactElement<ElementProps>[] = [];
  const walk = (n: ReactNode) => {
    if (!isValidElement(n)) return;
    const el = n as ReactElement<ElementProps>;
    if (el.type === 'li') {
      out.push(el);
    }
    asArray(el.props.children).forEach(walk);
  };
  asArray(node).forEach(walk);
  return out;
}

describe('Breadcrumbs (UX-Q10)', () => {
  it('renders nothing when items is empty', () => {
    const result = Breadcrumbs({ items: [] });
    expect(result).toBeNull();
  });

  it('renders nothing when items has length 1 (no point in a one-link trail)', () => {
    const result = Breadcrumbs({ items: [{ label: 'Customers', to: '/crm/customers' }] });
    expect(result).toBeNull();
  });

  it('renders a nav with role/label and an ordered list when items has length >= 2', () => {
    const items: BreadcrumbItem[] = [
      { label: 'Customers', to: '/crm/customers' },
      { label: 'Smoke Co.' },
    ];
    const result = Breadcrumbs({ items });
    expect(result).not.toBeNull();
    const props = elementProps(result);
    expect(elementType(result)).toBe('nav');
    expect(props['aria-label']).toBe('Breadcrumb');
    expect(props['data-testid']).toBe('breadcrumbs');
  });

  it('renders ancestor items as <Link> with the supplied `to` and the current item as <span>', () => {
    const items: BreadcrumbItem[] = [
      { label: 'Customers', to: '/crm/customers' },
      { label: 'Smoke Co.', to: '/crm/customers/abc' },
      { label: 'SMOKE-001' },
    ];
    const result = Breadcrumbs({ items });
    const lis = collectListItems(result);
    // 3 label li's + 2 separator li's = 5 li's total.
    expect(lis.length).toBe(5);

    // Label li's are at indices 0, 2, 4. Separator li's at 1, 3.
    const labelLis = [lis[0], lis[2], lis[4]];
    const sepLis = [lis[1], lis[3]];

    // First two labels: contain Link children with the correct `to`.
    const firstLabelChild = asArray(labelLis[0]!.props.children)[0];
    const secondLabelChild = asArray(labelLis[1]!.props.children)[0];
    const thirdLabelChild = asArray(labelLis[2]!.props.children)[0];

    // The Link component is the function imported from react-router-dom.
    // We assert structurally: it has a `to` prop matching the breadcrumb,
    // and its type is not the literal string 'span'.
    expect(elementProps(firstLabelChild).to).toBe('/crm/customers');
    expect(elementType(firstLabelChild)).not.toBe('span');
    expect(elementProps(secondLabelChild).to).toBe('/crm/customers/abc');
    expect(elementType(secondLabelChild)).not.toBe('span');

    // Third (trailing) label has no `to`; it renders as a span with
    // aria-current="page".
    expect(elementType(thirdLabelChild)).toBe('span');
    expect(elementProps(thirdLabelChild)['aria-current']).toBe('page');

    // Separators carry the constitutional dot character and a data-testid.
    sepLis.forEach((sep) => {
      const text = asArray(sep!.props.children)[0];
      expect(text).toBe('·');
      expect(sep!.props['data-testid']).toBe('breadcrumb-separator');
    });
  });

  it('treats trailing item as current page even when `to` is supplied (defensive)', () => {
    // A caller might mistakenly pass `to` on the last item. We still want
    // the trailing item to be non-clickable so the operator doesn't navigate
    // to the page they're already on. This matches the prop documentation.
    const items: BreadcrumbItem[] = [
      { label: 'Customers', to: '/crm/customers' },
      { label: 'Smoke Co.', to: '/crm/customers/abc' },
    ];
    const result = Breadcrumbs({ items });
    const lis = collectListItems(result);
    // 2 labels + 1 separator = 3.
    expect(lis.length).toBe(3);
    const trailingChild = asArray(lis[2]!.props.children)[0];
    expect(elementType(trailingChild)).toBe('span');
    expect(elementProps(trailingChild)['aria-current']).toBe('page');
  });

  it('preserves item order in the rendered list', () => {
    const items: BreadcrumbItem[] = [
      { label: 'A', to: '/a' },
      { label: 'B', to: '/b' },
      { label: 'C', to: '/c' },
      { label: 'D' },
    ];
    const result = Breadcrumbs({ items });
    const lis = collectListItems(result);
    // 4 labels + 3 separators = 7.
    expect(lis.length).toBe(7);
    const labels = [lis[0], lis[2], lis[4], lis[6]].map((li) => {
      const child = asArray(li!.props.children)[0];
      return asArray(elementProps(child).children)[0];
    });
    expect(labels).toEqual(['A', 'B', 'C', 'D']);
  });

  it('applies truncate class to label items so long labels ellipsize on narrow viewports', () => {
    const items: BreadcrumbItem[] = [
      { label: 'Customers', to: '/crm/customers' },
      { label: 'A Very Long Customer Display Name That Could Easily Overflow', to: '/crm/customers/abc' },
      { label: 'SMOKE-001' },
    ];
    const result = Breadcrumbs({ items });
    const lis = collectListItems(result);
    const labelLis = [lis[0], lis[2], lis[4]];
    labelLis.forEach((li) => {
      const child = asArray(li!.props.children)[0];
      const className = elementProps(child).className ?? '';
      expect(className).toContain('truncate');
      expect(className).toContain('max-w-');
    });
  });

  it('passes the full label as a `title` attribute so the operator can hover to see truncated text', () => {
    const items: BreadcrumbItem[] = [
      { label: 'Customers', to: '/crm/customers' },
      { label: 'Smoke Co.', to: '/crm/customers/abc' },
      { label: 'SMOKE-001' },
    ];
    const result = Breadcrumbs({ items });
    const lis = collectListItems(result);
    const labelLis = [lis[0], lis[2], lis[4]];
    const titles = labelLis.map((li) => {
      const child = asArray(li!.props.children)[0];
      return elementProps(child).title;
    });
    expect(titles).toEqual(['Customers', 'Smoke Co.', 'SMOKE-001']);
  });
});

// Breadcrumb eyebrow taxonomy (R-W13-IA-01).
//
// The page-header eyebrow on every surface is the domain taxonomy the operator
// reads to know where a page sits (for example "Invoicing / Invoices",
// "3PL Operations / Accounts"). This is a DOMAIN axis. The UI/UX
// reconfiguration regrouped the sidebar onto a separate TASK axis (SELL, BUY,
// INVENTORY AND WAREHOUSE, ...), so the eyebrow taxonomy and the sidebar section
// labels are intentionally decoupled now: the eyebrow tells you the domain, the
// sidebar tells you the task. These tests lock the eyebrow taxonomy as a
// well-formed, branding-clean, domain-specific set, independent of the sidebar.
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
    // The eyebrow is a domain axis. The task sidebar legitimately uses task
    // words (SELL, WORKFORCE, ...); the eyebrow taxonomy must not, so a page
    // never reads a bare task word where its domain belongs.
    const retired = ['SELL', 'MAKE', 'SHIP', 'GET PAID', 'LIBRARY', 'WORKFORCE'];
    const upper = allTaxonomy.map((s) => s.toUpperCase());
    for (const word of retired) {
      expect(upper).not.toContain(word);
    }
  });
});
