// Pin the Topbar Create (+) menu gating: capability AND entitlement, both must
// hold. Pure data + pure filter, tested without a renderer (mirrors the
// sidebarModes / commandBarModel test precedent).

import { describe, it, expect } from 'vitest';

import { CREATE_ACTIONS, visibleCreateActions } from './createMenuActions';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { Capability } from '@/lib/capabilities';

describe('visibleCreateActions', () => {
  const allow = () => true;
  const deny = () => false;
  const noFlags: Record<string, boolean> = {};

  it('hides every action when the caller holds no capabilities', () => {
    expect(visibleCreateActions(CREATE_ACTIONS, deny, noFlags)).toEqual([]);
  });

  it('shows only spine creates when entitled to no add-ons', () => {
    const visible = visibleCreateActions(CREATE_ACTIONS, allow, noFlags);
    expect(visible.every((a) => a.plugin === undefined)).toBe(true);
    expect(visible.map((a) => a.href)).toContain('/quotes/new');
    expect(visible.map((a) => a.href)).toContain('/crm/customers/new');
  });

  it('reveals a plugin-gated action only when its flag is on', () => {
    const flags = { [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: true };
    const visible = visibleCreateActions(CREATE_ACTIONS, allow, flags);
    expect(visible.map((a) => a.href)).toContain('/copack/orders/new');
    // The manufacturing flag is still off, so its create stays hidden.
    expect(visible.map((a) => a.href)).not.toContain('/manufacturing/runs/new');
  });

  it('gates per capability: only actions whose cap is granted appear', () => {
    const onlyQuotes = (cap: Capability) => cap === 'quotes.quote.write';
    const visible = visibleCreateActions(CREATE_ACTIONS, onlyQuotes, noFlags);
    expect(visible.map((a) => a.cap)).toEqual(['quotes.quote.write']);
  });

  it('every action targets a create route and a real plugin flag', () => {
    const flagValues = new Set<string>(Object.values(FEATURE_FLAGS));
    for (const action of CREATE_ACTIONS) {
      expect(action.href.endsWith('/new'), action.label).toBe(true);
      if (action.plugin !== undefined) {
        expect(flagValues.has(action.plugin), action.label).toBe(true);
      }
    }
  });
});
