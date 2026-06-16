// Unit tests for the debounce timer core (R-W13-SRCH-01). The React hook is a
// thin adapter over scheduleDebounce; the timing contract that matters for the
// command bar (commit only after quiet period, cancel supersedes a pending
// commit) is exercised here with fake timers and no renderer, matching the
// repo's no-jsdom test style.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { scheduleDebounce } from './useDebouncedValue';

describe('scheduleDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not commit before the delay elapses', () => {
    const commit = vi.fn();
    scheduleDebounce('ac', 200, commit);
    vi.advanceTimersByTime(199);
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits the value once after the delay', () => {
    const commit = vi.fn();
    scheduleDebounce('acme', 200, commit);
    vi.advanceTimersByTime(200);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('acme');
  });

  it('cancel before the delay prevents the commit (rapid keystrokes)', () => {
    const commit = vi.fn();
    const cancel = scheduleDebounce('a', 200, commit);
    vi.advanceTimersByTime(100);
    cancel();
    vi.advanceTimersByTime(200);
    expect(commit).not.toHaveBeenCalled();
  });

  it('only the last unchancelled schedule commits across a typing burst', () => {
    const commit = vi.fn();
    // Simulate three keystrokes: each new value cancels the prior pending one.
    const c1 = scheduleDebounce('a', 200, commit);
    vi.advanceTimersByTime(50);
    c1();
    const c2 = scheduleDebounce('ac', 200, commit);
    vi.advanceTimersByTime(50);
    c2();
    scheduleDebounce('acm', 200, commit);
    vi.advanceTimersByTime(200);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('acm');
  });
});
