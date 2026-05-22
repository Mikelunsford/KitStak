// UX-Q3: pure gating helper extracted from Sidebar so the
// "hide entirely vs disable in place" decision can be regression-tested
// without a React renderer (the repo has no jsdom / @testing-library
// dependency; see featureFlagResolver.test.ts for the precedent).
//
// Behaviour model:
//
//   - Section has no `flag`            => always visible, always enabled.
//   - Section has a `flag` and flag ON => visible, enabled.
//   - Section has a `flag` and flag OFF:
//       * hideWhenOff: true            => OMITTED from the list.
//       * hideWhenOff: false/undefined => VISIBLE but disabled (the
//                                          legacy posture; how the
//                                          operator flips on
//                                          Manufacturing/KitCost/3PL).
//
// Co-Pack and KitForce set hideWhenOff: true so unbuilt pillars stop
// leaking into the first-impression sidebar and dashboard. The
// underlying 403 FEATURE_DISABLED API guard is unchanged; this is a
// pure SPA-render adjustment.

export interface FlagGatedSection {
  key: string;
  /** Optional `org_feature_flags.flag_key`. */
  flag?: string;
  /**
   * When true AND the gating flag is off, the section is omitted from
   * the rendered list instead of being shown in a disabled state.
   * Defaults to false for backward compatibility with the existing
   * disabled-when-off treatment used by 3PL / Manufacturing / KitCost.
   */
  hideWhenOff?: boolean;
}

export interface SectionVisibility {
  /** Render the section at all. */
  visible: boolean;
  /**
   * When visible, whether the section is interactive. False means the
   * legacy disabled-greyed-out treatment. Not meaningful when
   * `visible` is false.
   */
  enabled: boolean;
}

/**
 * Compute whether a flag-gated section should render and whether it
 * should be interactive, given the current org flag map.
 *
 * @param section the section to evaluate
 * @param flags   the resolved `useOrgFlags` map; absent keys are
 *                treated as off, matching the useOrgFlags contract
 */
export function resolveSectionVisibility(
  section: FlagGatedSection,
  flags: Record<string, boolean>,
): SectionVisibility {
  if (section.flag === undefined) {
    return { visible: true, enabled: true };
  }
  const isOn = flags[section.flag] === true;
  if (isOn) {
    return { visible: true, enabled: true };
  }
  if (section.hideWhenOff === true) {
    return { visible: false, enabled: false };
  }
  return { visible: true, enabled: false };
}
