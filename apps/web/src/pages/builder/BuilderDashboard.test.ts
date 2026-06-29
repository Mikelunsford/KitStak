// Unit tests for the builder dashboard's pure engine resolution (ADR 0006 P3).
// The component itself uses a hook (useOrgFlags); the gating logic lives in the
// pure availableEngines helper so it is testable here.

import { describe, it, expect } from 'vitest';

import { availableEngines } from './builderEngines';
import { FEATURE_FLAGS } from '@/lib/constants';

describe('availableEngines', () => {
  it('always offers the Estimate Engine', () => {
    expect(availableEngines({}).map((e) => e.id)).toContain('estimate');
  });

  it('hides the Job Builder when the 3PL plugin is off', () => {
    const ids = availableEngines({}).map((e) => e.id);
    expect(ids).not.toContain('job');
  });

  it('offers the Job Builder when the 3PL plugin is on', () => {
    const ids = availableEngines({ [FEATURE_FLAGS.PLUGINS_THREE_PL]: true }).map((e) => e.id);
    expect(ids).toContain('estimate');
    expect(ids).toContain('job');
  });
});
