// useDebouncedValue. Hand-rolled debounce hook (no lodash, no third-party
// debounce dependency per the constitution). Returns a copy of `value` that
// only updates after `delay` ms have elapsed without a further change.
//
// Used by the Cmd/Ctrl-K command bar to keep the live search-api query from
// firing on every keystroke. Mirrors the inline 250 ms timer the older
// GlobalSearchBar used, lifted into one reusable hook so the timing logic is
// testable in isolation.
//
// The timer-scheduling core is factored into `scheduleDebounce` so the
// debounce behaviour can be unit-tested with fake timers without a React
// renderer (the repo runs Vitest without jsdom). The hook is the thin React
// adapter around it.

import { useEffect, useState } from 'react';

/**
 * Schedule a debounced commit. Calls `commit(value)` after `delayMs` unless the
 * returned canceller fires first. Returns the canceller so a caller (the hook's
 * effect cleanup, or a test) can clear a pending commit when the value changes
 * again before the delay elapses.
 */
export function scheduleDebounce<T>(
  value: T,
  delayMs: number,
  commit: (value: T) => void,
): () => void {
  const handle = setTimeout(() => commit(value), delayMs);
  return () => clearTimeout(handle);
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(
    () => scheduleDebounce(value, delayMs, setDebounced),
    [value, delayMs],
  );

  return debounced;
}
