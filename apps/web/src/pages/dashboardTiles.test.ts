// UX-Q3: pin the dashboard pillar-tile gating behaviour.
//
// Asserts that:
//   - Co-Pack and KitForce tiles are OMITTED when their `plugins.*`
//     flags are off (the first-impression surface no longer advertises
//     404 routes).
//   - Co-Pack and KitForce tiles RENDER when the flags are on.
//   - 3PL / Manufacturing / KitCost preserve the legacy "render when
//     off too" posture so the operator can recognise the surface
//     during the flip-on dry run.
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

describe('PILLAR_TILES wiring (UX-Q3)', () => {
  it('declares exactly the five pillars in canonical order', () => {
    expect(PILLAR_TILES.map((t) => t.key)).toEqual([
      'three_pl',
      'manufacturing',
      'copack_ecom',
      'kitforce',
      'kitcost',
    ]);
  });

  it('Co-Pack and KitForce are marked hideWhenOff', () => {
    const copack = PILLAR_TILES.find((t) => t.key === 'copack_ecom');
    const kitforce = PILLAR_TILES.find((t) => t.key === 'kitforce');
    expect(copack?.hideWhenOff).toBe(true);
    expect(kitforce?.hideWhenOff).toBe(true);
  });

  it('3PL, Manufacturing, and KitCost are NOT hideWhenOff (operator-flip posture)', () => {
    const threePl = PILLAR_TILES.find((t) => t.key === 'three_pl');
    const mfg = PILLAR_TILES.find((t) => t.key === 'manufacturing');
    const kitcost = PILLAR_TILES.find((t) => t.key === 'kitcost');
    expect(threePl?.hideWhenOff).toBeUndefined();
    expect(mfg?.hideWhenOff).toBeUndefined();
    expect(kitcost?.hideWhenOff).toBeUndefined();
  });
});

describe('visiblePillarTiles (UX-Q3)', () => {
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

  it('all flags OFF => Co-Pack and KitForce OMITTED, others remain', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, ALL_OFF);
    const keys = visible.map((t) => t.key);
    expect(keys).not.toContain('copack_ecom');
    expect(keys).not.toContain('kitforce');
    expect(keys).toEqual(['three_pl', 'manufacturing', 'kitcost']);
  });

  it('empty flag map (fresh org, nothing flipped yet) => Co-Pack and KitForce OMITTED', () => {
    // Absent keys are treated as off per the useOrgFlags contract.
    const visible = visiblePillarTiles(PILLAR_TILES, {});
    const keys = visible.map((t) => t.key);
    expect(keys).not.toContain('copack_ecom');
    expect(keys).not.toContain('kitforce');
    expect(keys).toEqual(['three_pl', 'manufacturing', 'kitcost']);
  });

  it('Co-Pack flag ON, KitForce OFF => Co-Pack renders, KitForce omitted', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_OFF,
      [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: true,
    });
    const keys = visible.map((t) => t.key);
    expect(keys).toContain('copack_ecom');
    expect(keys).not.toContain('kitforce');
  });

  it('KitForce flag ON, Co-Pack OFF => KitForce renders, Co-Pack omitted', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_OFF,
      [FEATURE_FLAGS.PLUGINS_KITFORCE]: true,
    });
    const keys = visible.map((t) => t.key);
    expect(keys).toContain('kitforce');
    expect(keys).not.toContain('copack_ecom');
  });

  it('Manufacturing flag OFF still renders the tile (legacy operator-flip posture)', () => {
    const visible = visiblePillarTiles(PILLAR_TILES, {
      ...ALL_ON,
      [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: false,
    });
    const keys = visible.map((t) => t.key);
    expect(keys).toContain('manufacturing');
  });
});
