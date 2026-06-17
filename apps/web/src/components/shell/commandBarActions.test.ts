// F-UIUX-PALETTE-VERBS-01: pin the palette action-verb filter. Pure-TS suite,
// no React renderer (mirrors createMenuActions, dashboardTiles precedent).

import { describe, it, expect } from 'vitest';

import {
  ACTION_VERBS,
  visibleActionVerbs,
  type ActionVerb,
} from './commandBarActions';
import type { Capability } from '@/lib/capabilities';
import { FEATURE_FLAGS } from '@/lib/constants';

const VERBS: ReadonlyArray<ActionVerb> = [
  { label: 'New quote', href: '/quotes/new', cap: 'quotes.quote.write' },
  {
    label: 'New sales order',
    href: '/copack/orders/new',
    cap: 'copack.order.create',
    plugin: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
  },
  {
    label: 'Go to period close',
    href: '/finance/period-close',
    cap: 'period_close.read',
  },
];

const allow = (_cap: Capability): boolean => true;
const deny = (_cap: Capability): boolean => false;

describe('visibleActionVerbs', () => {
  it('returns no verbs for a blank or whitespace-only query', () => {
    expect(visibleActionVerbs(VERBS, '', allow, {})).toEqual([]);
    expect(visibleActionVerbs(VERBS, '   ', allow, {})).toEqual([]);
  });

  it('matches the query against the label case-insensitively', () => {
    const rows = visibleActionVerbs(VERBS, 'QUOTE', allow, {});
    expect(rows.map((r) => r.title)).toEqual(['New quote']);
  });

  it('returns command rows with an href, an Action subtitle, and a stable key', () => {
    const rows = visibleActionVerbs(VERBS, 'period', allow, {});
    expect(rows[0]).toMatchObject({
      title: 'Go to period close',
      href: '/finance/period-close',
      subtitle: 'Action',
    });
    expect(rows[0]?.key).toContain('/finance/period-close');
  });

  it('hides a verb the caller lacks the capability for', () => {
    const canQuoteOnly = (cap: Capability) => cap === 'quotes.quote.write';
    const rows = visibleActionVerbs(VERBS, 'new', canQuoteOnly, {
      [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: true,
    });
    expect(rows.map((r) => r.title)).toEqual(['New quote']);
  });

  it('hides a plugin-gated verb when the add-on is off', () => {
    expect(visibleActionVerbs(VERBS, 'sales order', allow, {})).toEqual([]);
  });

  it('shows a plugin-gated verb when the add-on is on', () => {
    const rows = visibleActionVerbs(VERBS, 'sales order', allow, {
      [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: true,
    });
    expect(rows.map((r) => r.title)).toEqual(['New sales order']);
  });

  it('returns nothing when the capability predicate denies all', () => {
    expect(visibleActionVerbs(VERBS, 'new', deny, {})).toEqual([]);
  });
});

describe('ACTION_VERBS registry', () => {
  it('reuses the create registry plus nav verbs with no duplicate hrefs', () => {
    const hrefs = ACTION_VERBS.map((v) => v.href);
    const dupes = hrefs.filter((h, i) => hrefs.indexOf(h) !== i);
    expect(dupes, `duplicate hrefs: ${dupes.join(', ')}`).toEqual([]);
    expect(ACTION_VERBS.some((v) => v.label === 'New quote')).toBe(true);
    expect(ACTION_VERBS.some((v) => v.label === 'Go to period close')).toBe(true);
  });
});
