import { describe, it, expect } from 'vitest';

import { moveTierOrder } from './quoteTierOrder';

describe('moveTierOrder', () => {
  const ids = ['a', 'b', 'c'];

  it('moves a tier up one slot', () => {
    expect(moveTierOrder(ids, 'b', -1)).toEqual(['b', 'a', 'c']);
  });

  it('moves a tier down one slot', () => {
    expect(moveTierOrder(ids, 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op moving the first tier up', () => {
    expect(moveTierOrder(ids, 'a', -1)).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op moving the last tier down', () => {
    expect(moveTierOrder(ids, 'c', 1)).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op for an unknown tier id', () => {
    expect(moveTierOrder(ids, 'zzz', 1)).toEqual(['a', 'b', 'c']);
  });

  it('returns a new array and does not mutate the input', () => {
    const input = ['a', 'b'];
    const out = moveTierOrder(input, 'a', 1);
    expect(out).toEqual(['b', 'a']);
    expect(input).toEqual(['a', 'b']);
  });
});
