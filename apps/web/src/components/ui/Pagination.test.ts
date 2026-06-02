// Unit tests for the Pagination page-math helper (F-Wave10-UI-KIT-01).

import { describe, it, expect } from 'vitest';

import { paginate } from './Pagination';

describe('paginate', () => {
  it('computes the first page of a multi-page set', () => {
    const info = paginate(120, 50, 0);
    expect(info.pageCount).toBe(3);
    expect(info.sliceStart).toBe(0);
    expect(info.sliceEnd).toBe(50);
    expect(info.rangeStart).toBe(1);
    expect(info.rangeEnd).toBe(50);
    expect(info.canPrev).toBe(false);
    expect(info.canNext).toBe(true);
  });

  it('computes a middle page', () => {
    const info = paginate(120, 50, 1);
    expect(info.sliceStart).toBe(50);
    expect(info.sliceEnd).toBe(100);
    expect(info.rangeStart).toBe(51);
    expect(info.rangeEnd).toBe(100);
    expect(info.canPrev).toBe(true);
    expect(info.canNext).toBe(true);
  });

  it('clamps the last partial page', () => {
    const info = paginate(120, 50, 2);
    expect(info.sliceStart).toBe(100);
    expect(info.sliceEnd).toBe(120);
    expect(info.rangeEnd).toBe(120);
    expect(info.canNext).toBe(false);
  });

  it('clamps an out-of-range page into the valid window', () => {
    const info = paginate(120, 50, 99);
    expect(info.sliceStart).toBe(100);
    expect(info.canNext).toBe(false);
  });

  it('handles an empty set with one page and a zero range', () => {
    const info = paginate(0, 50, 0);
    expect(info.pageCount).toBe(1);
    expect(info.rangeStart).toBe(0);
    expect(info.rangeEnd).toBe(0);
    expect(info.canPrev).toBe(false);
    expect(info.canNext).toBe(false);
  });

  it('treats a non-positive page size as a single page rather than dividing by zero', () => {
    const info = paginate(10, 0, 0);
    expect(info.pageCount).toBe(10);
    expect(info.sliceEnd).toBe(1);
  });
});
