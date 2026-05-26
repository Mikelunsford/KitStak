// Unit tests for the firstSigninPromptState pure helper.
//
// Mirrors setupCelebrationState.test.ts: no jsdom; the helper guards every
// storage access, so we stub `globalThis.window` with a minimal Storage
// shim. Locks the public contract (per-user isolation, defensive against
// SSR, throwing storage, empty userId).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  hasSeenPasswordPrompt,
  markPasswordPromptSeen,
  passwordPromptStorageKey,
} from './firstSigninPromptState';

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

describe('passwordPromptStorageKey', () => {
  it('namespaces the key by user id so two users do not share state', () => {
    expect(passwordPromptStorageKey('user-a')).toBe(
      'kitstak:password-prompt-seen:user-a',
    );
    expect(passwordPromptStorageKey('user-b')).toBe(
      'kitstak:password-prompt-seen:user-b',
    );
  });
});

describe('hasSeenPasswordPrompt', () => {
  let stash: StashedWindow;

  beforeEach(() => {
    stash = installWindow(makeMemoryStorage());
  });

  afterEach(() => {
    restoreWindow(stash);
  });

  it('returns false when localStorage is empty', () => {
    expect(hasSeenPasswordPrompt('user-a')).toBe(false);
  });

  it('returns true after markPasswordPromptSeen is called for the same user', () => {
    markPasswordPromptSeen('user-a');
    expect(hasSeenPasswordPrompt('user-a')).toBe(true);
  });

  it('isolates state per user (different userId still returns false)', () => {
    markPasswordPromptSeen('user-a');
    expect(hasSeenPasswordPrompt('user-b')).toBe(false);
  });

  it('treats empty userId as not seen without touching storage', () => {
    expect(hasSeenPasswordPrompt('')).toBe(false);
  });
});

describe('hasSeenPasswordPrompt (defensive)', () => {
  it('does not throw and returns false when window is undefined (SSR)', () => {
    const stash = installWindow(null);
    try {
      expect(() => hasSeenPasswordPrompt('user-a')).not.toThrow();
      expect(hasSeenPasswordPrompt('user-a')).toBe(false);
    } finally {
      restoreWindow(stash);
    }
  });

  it('does not throw and returns false when localStorage access throws', () => {
    const stash = installWindow(makeThrowingStorage());
    try {
      expect(() => hasSeenPasswordPrompt('user-a')).not.toThrow();
      expect(hasSeenPasswordPrompt('user-a')).toBe(false);
    } finally {
      restoreWindow(stash);
    }
  });
});

describe('markPasswordPromptSeen (defensive)', () => {
  it('does not throw when window is undefined (SSR)', () => {
    const stash = installWindow(null);
    try {
      expect(() => markPasswordPromptSeen('user-a')).not.toThrow();
    } finally {
      restoreWindow(stash);
    }
  });

  it('does not throw when storage writes throw (quota exceeded)', () => {
    const stash = installWindow(makeThrowingStorage());
    try {
      expect(() => markPasswordPromptSeen('user-a')).not.toThrow();
    } finally {
      restoreWindow(stash);
    }
  });

  it('does nothing when userId is empty', () => {
    const storage = makeMemoryStorage();
    const stash = installWindow(storage);
    try {
      markPasswordPromptSeen('');
      expect(storage.length).toBe(0);
    } finally {
      restoreWindow(stash);
    }
  });
});
