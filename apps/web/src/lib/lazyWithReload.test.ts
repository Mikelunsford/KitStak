import { describe, it, expect, vi } from 'vitest';

import { RELOAD_FLAG, resolveLazyChunk, type ReloadDeps } from './lazyWithReload';

function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      map.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      map.delete(k);
    }),
    _peek: () => Object.fromEntries(map),
  };
}

function makeDeps(initial: Record<string, string> = {}): ReloadDeps & {
  reload: ReturnType<typeof vi.fn>;
} {
  const reload = vi.fn();
  return {
    storage: makeStorage(initial),
    reload,
  };
}

describe('resolveLazyChunk', () => {
  it('returns the module on a successful factory call and clears any stale flag', async () => {
    const deps = makeDeps({ [RELOAD_FLAG]: 'true' });
    const mod = { default: () => null };
    const factory = vi.fn().mockResolvedValue(mod);

    const result = await resolveLazyChunk(factory, deps);

    expect(result).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.storage!.getItem(RELOAD_FLAG)).toBeNull();
  });

  it('on first failure, sets the flag and triggers reload (no rethrow)', async () => {
    const deps = makeDeps();
    const factory = vi.fn().mockRejectedValue(new Error('Failed to load module script'));

    let settled = false;
    void resolveLazyChunk(factory, deps).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    // The promise never resolves on the reload path; flush microtasks twice
    // so factory().catch() and the subsequent setFlag/reload have run.
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(deps.storage!.getItem(RELOAD_FLAG)).toBe('true');
    expect(settled).toBe(false);
  });

  it('on second failure (flag already set), rethrows instead of reloading again', async () => {
    const deps = makeDeps({ [RELOAD_FLAG]: 'true' });
    const err = new Error('Failed to load module script');
    const factory = vi.fn().mockRejectedValue(err);

    await expect(resolveLazyChunk(factory, deps)).rejects.toBe(err);
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('handles a null storage (e.g. SSR) without throwing — still reloads once', async () => {
    const reload = vi.fn();
    const factory = vi.fn().mockRejectedValue(new Error('chunk gone'));

    void resolveLazyChunk(factory, { storage: null, reload });

    await Promise.resolve();
    await Promise.resolve();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('tolerates a storage that throws (privacy mode) — still reloads', async () => {
    const reload = vi.fn();
    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      removeItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    };
    const factory = vi.fn().mockRejectedValue(new Error('chunk gone'));

    void resolveLazyChunk(factory, { storage: throwingStorage, reload });

    await Promise.resolve();
    await Promise.resolve();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
