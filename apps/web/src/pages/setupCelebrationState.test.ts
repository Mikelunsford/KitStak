// Unit tests for the setupCelebrationState pure helper.
//
// Pure (no React, no jsdom) per the repo convention; the helper itself
// guards every storage access, so we stub `globalThis.window` with a
// minimal Storage shim instead of pulling in jsdom. This matches the
// dashboardChecklistSteps test style: lock the public contract, don't
// reach into React.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  hasSetupCelebrationBeenShown,
  markSetupCelebrationShown,
  setupCelebrationStorageKey,
} from './setupCelebrationState';

// In-memory Storage shim. Mirrors enough of the DOM Storage interface for
// the helper to round-trip a value. Reset between tests so org isolation
// assertions stay honest.
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  } satisfies Storage;
}

// Storage that throws on every access. Used to assert that the helper
// degrades silently in private-browsing / SSR-like environments.
function makeThrowingStorage(): Storage {
  const fail = () => {
    throw new Error('storage unavailable');
  };
  return {
    get length(): number {
      throw new Error('storage unavailable');
    },
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  } as unknown as Storage;
}

interface StashedWindow {
  had: boolean;
  prev: unknown;
}

function installWindow(storage: Storage | null): StashedWindow {
  const stash: StashedWindow = {
    had: 'window' in globalThis,
    prev: (globalThis as { window?: unknown }).window,
  };
  if (storage === null) {
    // Simulate SSR: no window at all. Use Reflect.deleteProperty so the
    // typeof window === 'undefined' guard in the helper trips.
    Reflect.deleteProperty(globalThis as object, 'window');
  } else {
    (globalThis as { window: { localStorage: Storage } }).window = {
      localStorage: storage,
    };
  }
  return stash;
}

function restoreWindow(stash: StashedWindow) {
  if (stash.had) {
    (globalThis as { window: unknown }).window = stash.prev;
  } else {
    Reflect.deleteProperty(globalThis as object, 'window');
  }
}

describe('setupCelebrationStorageKey', () => {
  it('namespaces the key by org id so two orgs do not share state', () => {
    expect(setupCelebrationStorageKey('org-a')).toBe(
      'kitstak:setup-celebration-shown:org-a',
    );
    expect(setupCelebrationStorageKey('org-b')).toBe(
      'kitstak:setup-celebration-shown:org-b',
    );
  });
});

describe('hasSetupCelebrationBeenShown', () => {
  let stash: StashedWindow;

  beforeEach(() => {
    stash = installWindow(makeMemoryStorage());
  });

  afterEach(() => {
    restoreWindow(stash);
  });

  it('returns false when localStorage is empty', () => {
    expect(hasSetupCelebrationBeenShown('org-a')).toBe(false);
  });

  it('returns true after markSetupCelebrationShown is called for the same org', () => {
    markSetupCelebrationShown('org-a');
    expect(hasSetupCelebrationBeenShown('org-a')).toBe(true);
  });

  it('isolates state per org (different orgId still returns false)', () => {
    markSetupCelebrationShown('org-a');
    expect(hasSetupCelebrationBeenShown('org-b')).toBe(false);
  });

  it('treats empty orgId as not shown without touching storage', () => {
    expect(hasSetupCelebrationBeenShown('')).toBe(false);
  });
});

describe('hasSetupCelebrationBeenShown (defensive)', () => {
  it('does not throw and returns false when window is undefined (SSR)', () => {
    const stash = installWindow(null);
    try {
      expect(() => hasSetupCelebrationBeenShown('org-a')).not.toThrow();
      expect(hasSetupCelebrationBeenShown('org-a')).toBe(false);
    } finally {
      restoreWindow(stash);
    }
  });

  it('does not throw and returns false when localStorage access throws', () => {
    const stash = installWindow(makeThrowingStorage());
    try {
      expect(() => hasSetupCelebrationBeenShown('org-a')).not.toThrow();
      expect(hasSetupCelebrationBeenShown('org-a')).toBe(false);
    } finally {
      restoreWindow(stash);
    }
  });
});

describe('markSetupCelebrationShown (defensive)', () => {
  it('does not throw when window is undefined (SSR)', () => {
    const stash = installWindow(null);
    try {
      expect(() => markSetupCelebrationShown('org-a')).not.toThrow();
    } finally {
      restoreWindow(stash);
    }
  });

  it('does not throw when storage writes throw (quota exceeded)', () => {
    const stash = installWindow(makeThrowingStorage());
    try {
      expect(() => markSetupCelebrationShown('org-a')).not.toThrow();
    } finally {
      restoreWindow(stash);
    }
  });

  it('does nothing when orgId is empty', () => {
    const storage = makeMemoryStorage();
    const stash = installWindow(storage);
    try {
      markSetupCelebrationShown('');
      expect(storage.length).toBe(0);
    } finally {
      restoreWindow(stash);
    }
  });
});
