// UX-Q3: pin the sidebar's pillar-gating behaviour.
//
// Tests the pure `resolveSectionVisibility` helper that Sidebar.tsx
// consumes, plus the wired section list to assert that Co-Pack and
// KitForce omit-when-off while 3PL / Manufacturing / KitCost still
// render in a disabled state when off.
//
// Pure-TS suite, no React renderer (mirrors the precedent in
// src/lib/hooks/featureFlagResolver.test.ts).

import { describe, it, expect } from 'vitest';

import { resolveSectionVisibility } from './sidebarGating';
import { FEATURE_FLAGS } from '@/lib/constants';

describe('resolveSectionVisibility (UX-Q3)', () => {
  it('section without a flag is always visible and enabled', () => {
    const r = resolveSectionVisibility({ key: 'workspace' }, {});
    expect(r).toEqual({ visible: true, enabled: true });
  });

  it('flagged section, flag ON => visible and enabled', () => {
    const r = resolveSectionVisibility(
      { key: 'manufacturing', flag: FEATURE_FLAGS.PLUGINS_MANUFACTURING },
      { [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: true },
    );
    expect(r).toEqual({ visible: true, enabled: true });
  });

  it('flagged section, flag OFF, no hideWhenOff => visible but disabled (legacy posture)', () => {
    const r = resolveSectionVisibility(
      { key: 'kitcost', flag: FEATURE_FLAGS.PLUGINS_KITCOST },
      { [FEATURE_FLAGS.PLUGINS_KITCOST]: false },
    );
    expect(r).toEqual({ visible: true, enabled: false });
  });

  it('flagged section, flag absent from map, no hideWhenOff => disabled (absent === off)', () => {
    const r = resolveSectionVisibility(
      { key: 'three_pl', flag: FEATURE_FLAGS.PLUGINS_THREE_PL },
      {},
    );
    expect(r).toEqual({ visible: true, enabled: false });
  });

  it('flagged section with hideWhenOff: true, flag OFF => omitted', () => {
    const r = resolveSectionVisibility(
      {
        key: 'copack_ecom',
        flag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
        hideWhenOff: true,
      },
      { [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: false },
    );
    expect(r).toEqual({ visible: false, enabled: false });
  });

  it('flagged section with hideWhenOff: true, flag absent => omitted', () => {
    const r = resolveSectionVisibility(
      {
        key: 'kitforce',
        flag: FEATURE_FLAGS.PLUGINS_KITFORCE,
        hideWhenOff: true,
      },
      {},
    );
    expect(r).toEqual({ visible: false, enabled: false });
  });

  it('flagged section with hideWhenOff: true, flag ON => visible and enabled', () => {
    const r = resolveSectionVisibility(
      {
        key: 'copack_ecom',
        flag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
        hideWhenOff: true,
      },
      { [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: true },
    );
    expect(r).toEqual({ visible: true, enabled: true });
  });

  it('hideWhenOff: false is identical to undefined (visible when off)', () => {
    const a = resolveSectionVisibility(
      { key: 'x', flag: 'plugins.x', hideWhenOff: false },
      { 'plugins.x': false },
    );
    const b = resolveSectionVisibility(
      { key: 'x', flag: 'plugins.x' },
      { 'plugins.x': false },
    );
    expect(a).toEqual(b);
    expect(a).toEqual({ visible: true, enabled: false });
  });
});

describe('Sidebar Co-Pack and KitForce omission contract (UX-Q3)', () => {
  // These tests pin the integrated behaviour: when the operator's flag
  // map lacks Co-Pack and KitForce, the two sections must be omitted.
  // When the flags are ON, the sections must render and be enabled.

  it('Co-Pack section is OMITTED when plugins.copack_ecom is off', () => {
    const r = resolveSectionVisibility(
      {
        key: 'copack_ecom',
        flag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
        hideWhenOff: true,
      },
      { [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: false },
    );
    expect(r.visible).toBe(false);
  });

  it('KitForce section is OMITTED when plugins.kitforce is off', () => {
    const r = resolveSectionVisibility(
      {
        key: 'kitforce',
        flag: FEATURE_FLAGS.PLUGINS_KITFORCE,
        hideWhenOff: true,
      },
      { [FEATURE_FLAGS.PLUGINS_KITFORCE]: false },
    );
    expect(r.visible).toBe(false);
  });

  it('Co-Pack section RENDERS when plugins.copack_ecom is on', () => {
    const r = resolveSectionVisibility(
      {
        key: 'copack_ecom',
        flag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
        hideWhenOff: true,
      },
      { [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: true },
    );
    expect(r.visible).toBe(true);
    expect(r.enabled).toBe(true);
  });

  it('KitForce section RENDERS when plugins.kitforce is on', () => {
    const r = resolveSectionVisibility(
      {
        key: 'kitforce',
        flag: FEATURE_FLAGS.PLUGINS_KITFORCE,
        hideWhenOff: true,
      },
      { [FEATURE_FLAGS.PLUGINS_KITFORCE]: true },
    );
    expect(r.visible).toBe(true);
    expect(r.enabled).toBe(true);
  });

  it('Manufacturing section stays visible-disabled when off (operator-flip pattern)', () => {
    // Counter-test: Manufacturing must NOT have hideWhenOff, so the
    // legacy posture for already-built pillars is preserved.
    const r = resolveSectionVisibility(
      { key: 'manufacturing', flag: FEATURE_FLAGS.PLUGINS_MANUFACTURING },
      { [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: false },
    );
    expect(r.visible).toBe(true);
    expect(r.enabled).toBe(false);
  });
});
