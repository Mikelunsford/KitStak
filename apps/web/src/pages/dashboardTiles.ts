// UX-Q3: dashboard pillar-tile spec + pure visibility filter.
//
// Extracted from DashboardPage.tsx so the gating decision can be
// regression-tested without a React renderer (the repo has no jsdom or
// testing-library dependency; see featureFlagResolver.test.ts for
// precedent).
//
// Behaviour mirrors the Sidebar's `hideWhenOff` model:
//
//   - Tile has no `flag`             => always visible.
//   - Tile has `flag` and flag ON    => visible.
//   - Tile has `flag`, flag OFF:
//       * hideWhenOff: true          => OMITTED.
//       * hideWhenOff: false/absent  => visible (informational).
//
// Co-Pack and KitForce mark hideWhenOff: true so unbuilt pillars stop
// advertising 404 routes on the first-impression surface. The
// constitutional `403 FEATURE_DISABLED` API guard is unchanged.

import { FEATURE_FLAGS } from '@/lib/constants';

export interface PillarTileSpec {
  key: string;
  title: string;
  body: string;
  /** Optional `org_feature_flags.flag_key`. */
  flag?: string;
  /**
   * When true AND the gating flag is off, omit the tile from the
   * dashboard grid. Used for unbuilt pillars whose routes return 404.
   */
  hideWhenOff?: boolean;
}

export const PILLAR_TILES: ReadonlyArray<PillarTileSpec> = [
  {
    key: 'three_pl',
    title: '3PL OPERATIONS',
    body: 'Receiving, kitting, production, shipments.',
    flag: FEATURE_FLAGS.PLUGINS_THREE_PL,
  },
  {
    key: 'manufacturing',
    title: 'MANUFACTURING',
    body: 'BOMs, runs, finished goods, output movements.',
    flag: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
  },
  {
    key: 'copack_ecom',
    title: 'CO-PACK AND ECOM',
    body: 'Channel intake, kit-to-order, packaging.',
    flag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
    hideWhenOff: true,
  },
  {
    key: 'kitforce',
    title: 'KITFORCE',
    body: 'Labor, time, and crew assignment.',
    flag: FEATURE_FLAGS.PLUGINS_KITFORCE,
    hideWhenOff: true,
  },
  {
    key: 'kitcost',
    title: 'KITCOST',
    body: 'Job costing rolled up by run and SKU.',
    flag: FEATURE_FLAGS.PLUGINS_KITCOST,
  },
];

/**
 * Filter the tile spec list down to the tiles that should render given
 * the current org flag map. Absent flag keys are treated as off, matching
 * the `useOrgFlags` contract.
 */
export function visiblePillarTiles(
  tiles: ReadonlyArray<PillarTileSpec>,
  flags: Record<string, boolean>,
): ReadonlyArray<PillarTileSpec> {
  return tiles.filter((tile) => {
    if (tile.flag === undefined) return true;
    const isOn = flags[tile.flag] === true;
    if (isOn) return true;
    return tile.hideWhenOff !== true;
  });
}
