// SMOKE-09 / UX-Q3: dashboard pillar-tile gating behaviour.
//
// SMOKE-09 contract: a pillar card renders if and only if the org has
// that pillar's plugin flag enabled. All five pillars are now gated by
// hideWhenOff: true so the dashboard never shows a tile for a plugin the
// org has not purchased/enabled.
//
// Previous behaviour (UX-Q3 pre-SMOKE-09): 3PL, Manufacturing, and
// KitCost used to render regardless of their flag state ("operator-flip
// posture"). SMOKE-09 tightens this so every tile obeys its flag.
//
// Pure-TS suite, no React renderer (mirrors the precedent in
// src/lib/hooks/featureFlagResolver.test.ts).

import { describe, it, expect } from 'vitest';

import { PILLAR_TILES, visiblePillarTiles } from './dashboardTiles';
import { FEATURE_FLAGS } from '@/lib/constants';

const ALL_ON: Record<string, boolean> = {
  [FEATURE_FLAGS.PLUGINS_THREE_PL]: true,
  [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: true,
  [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: true,
  [FEATURE_FLAGS.PLUGINS_KITFORCE]: true,
  [FEATURE_FLAGS.PLUGINS_KITCOST]: true,
};

const ALL_OFF: Record<string, boolean> = {
  [FEATURE_FLAGS.PLUGINS_THREE_PL]: false,
  [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: false,
  [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: false,
  [FEATURE_FLAGS.PLUGINS_KITFORCE]: false,
  [FEATURE_FLAGS.PLUGINS_KITCOST]: false,
};

describe('PILLAR_TILES wiring (SMOKE-09)', () => {
  it('declares exactly the five pillars in canonical order', () => {
    expect(PILLAR_TILES.map((t) => t.key)).toEqual([
      'three_pl',
      'manufacturing',
      'copack_ecom',
      'kitforce',
      'kitcost',
    ]);
  });

  it('all five pillars are marked hideWhenOff (SMOKE-09)', () => {
    for (const tile of PILLAR_TILES) {
      expect(
        tile.hideWhenOff,
        `Expected tile "${tile.key}" to have hideWhenOff: true`,
      ).toBe(true);
    }
  });

  it('all five pillars have a plugin flag wired', () => {
    for (const tile of PILLAR_TILES) {
      expect(
        tile.flag,
        `Expected tile "${tile.key}" to declare a plugin flag`,
      ).toBeTruthy();
    }
  });
});

describe('visiblePillarTiles (SMOKE-09)', () => {
  it('all flags ON => all five tiles render', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, ALL_ON);
    expect(visible.map((t) => t.key)).toEqual([
      'three_pl',
      'manufacturing',
      'copack_ecom',
      'kitforce',
      'kitcost',
    ]);
  });

  it('all flags OFF => zero tiles render (SMOKE-09 core contract)', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, ALL_OFF);
    expect(visible).toHaveLength(0);
  });

  it('empty flag map (fresh org, nothing flipped) => zero tiles render', () => {
    // Absent keys are treated as off per the useOrgFlags contract.
    // The empty state is handled gracefully in PillarGrid.
    const visible = visiblePillarTiles(PILLAR_TILES, {});
    expect(visible).toHaveLength(0);
  });

  it('only three_pl ON => only the 3PL card renders', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_OFF,
      [FEATURE_FLAGS.PLUGINS_THREE_PL]: true,
    });
    expect(visible.map((t) => t.key)).toEqual(['three_pl']);
  });

  it('only manufacturing ON => only the Manufacturing card renders', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_OFF,
      [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: true,
    });
    expect(visible.map((t) => t.key)).toEqual(['manufacturing']);
  });

  it('only kitcost ON => only the KitCost card renders', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_OFF,
      [FEATURE_FLAGS.PLUGINS_KITCOST]: true,
    });
    expect(visible.map((t) => t.key)).toEqual(['kitcost']);
  });

  it('Co-Pack flag ON, all others OFF => only Co-Pack renders', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_OFF,
      [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: true,
    });
    expect(visible.map((t) => t.key)).toEqual(['copack_ecom']);
  });

  it('KitForce flag ON, all others OFF => only KitForce renders', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_OFF,
      [FEATURE_FLAGS.PLUGINS_KITFORCE]: true,
    });
    expect(visible.map((t) => t.key)).toEqual(['kitforce']);
  });

  it('three_pl + manufacturing ON, others OFF => only those two render in order', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_OFF,
      [FEATURE_FLAGS.PLUGINS_THREE_PL]: true,
      [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: true,
    });
    expect(visible.map((t) => t.key)).toEqual(['three_pl', 'manufacturing']);
  });

  it('manufacturing OFF hides the Manufacturing tile (SMOKE-09)', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_ON,
      [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: false,
    });
    const keys = visible.map((t) => t.key);
    expect(keys).not.toContain('manufacturing');
  });

  it('three_pl OFF hides the 3PL tile (SMOKE-09)', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_ON,
      [FEATURE_FLAGS.PLUGINS_THREE_PL]: false,
    });
    const keys = visible.map((t) => t.key);
    expect(keys).not.toContain('three_pl');
  });

  it('kitcost OFF hides the KitCost tile (SMOKE-09)', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_ON,
      [FEATURE_FLAGS.PLUGINS_KITCOST]: false,
    });
    const keys = visible.map((t) => t.key);
    expect(keys).not.toContain('kitcost');
  });
});
