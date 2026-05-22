// Component-prop validation tests for NextStepCTA (UX-Q4).
//
// The component itself renders JSX, which this repo's test runner is set up
// to handle only at the pure-logic level (no jsdom / no testing-library).
// We can still cover the constitutional invariant the component enforces:
// the `onClick` and `to` props are mutually exclusive — exactly one must be
// supplied. Calling the function-component as a plain function and asserting
// it throws is enough to lock that contract.

import { describe, it, expect } from 'vitest';

import { NextStepCTA } from './NextStepCTA';

describe('NextStepCTA prop discrimination', () => {
  it('throws when both onClick and to are supplied', () => {
    expect(() =>
      NextStepCTA({
        label: 'Do thing',
        onClick: () => {},
        to: '/somewhere',
      }),
    ).toThrowError(/either `onClick` or `to`/);
  });

  it('throws when neither onClick nor to is supplied', () => {
    expect(() =>
      NextStepCTA({ label: 'Do thing' }),
    ).toThrowError(/must pass either/);
  });

  it('accepts onClick alone', () => {
    expect(() =>
      NextStepCTA({ label: 'Do thing', onClick: () => {} }),
    ).not.toThrow();
  });

  it('accepts to alone', () => {
    expect(() =>
      NextStepCTA({ label: 'Do thing', to: '/somewhere' }),
    ).not.toThrow();
  });

  it('accepts pending and error optionally', () => {
    expect(() =>
      NextStepCTA({
        label: 'Do thing',
        onClick: () => {},
        pending: true,
        error: 'oops',
      }),
    ).not.toThrow();
  });
});
