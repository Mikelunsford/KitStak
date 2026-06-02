import {
  lazy as reactLazy,
  type LazyExoticComponent,
  type ComponentType,
} from 'react';

export const RELOAD_FLAG = 'lazy-chunk-reload-attempted';

export interface ReloadDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  reload: () => void;
}

/**
 * Inner logic exposed for unit testing. Production code should call
 * `lazyWithReload` instead.
 */
export async function resolveLazyChunk<T>(
  factory: () => Promise<T>,
  deps: ReloadDeps,
): Promise<T> {
  const alreadyReloaded = readFlag(deps.storage) === 'true';
  try {
    const mod = await factory();
    clearFlag(deps.storage);
    return mod;
  } catch (err) {
    if (!alreadyReloaded) {
      setFlag(deps.storage);
      deps.reload();
      return new Promise<T>(() => {});
    }
    throw err;
  }
}

/**
 * Wrap React.lazy so a chunk-load failure triggers exactly one full reload.
 *
 * Why: a user with an open tab during a redeploy will navigate to a route
 * whose lazy chunk Vite fingerprinted away in the new build. Vercel serves
 * the SPA index.html as the catch-all (text/html), and the browser refuses
 * to execute HTML as a JS module:
 *   "Failed to load module script: Expected a JavaScript-or-Wasm module
 *    script but the server responded with a MIME type of 'text/html'."
 *
 * The session-storage flag prevents an infinite reload loop: if the first
 * reload does not resolve the failure (e.g. a real bug in the module),
 * the second attempt rethrows and the Suspense boundary surfaces it.
 */
// `ComponentType<any>` mirrors React's own `lazy` signature so that
// component-specific prop types (e.g. PhasesSectionProps) are preserved
// at the call site instead of being collapsed to `unknown`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return reactLazy(() =>
    resolveLazyChunk(factory, {
      storage: typeof window !== 'undefined' ? window.sessionStorage : null,
      reload: () => window.location.reload(),
    }),
  );
}

function readFlag(storage: ReloadDeps['storage']): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(RELOAD_FLAG);
  } catch {
    return null;
  }
}

function setFlag(storage: ReloadDeps['storage']): void {
  if (!storage) return;
  try {
    storage.setItem(RELOAD_FLAG, 'true');
  } catch {
    // sessionStorage unavailable (privacy mode etc.). The reload still
    // fires; worst case the second failure also reloads and the SPA's
    // Suspense fallback eventually surfaces.
  }
}

function clearFlag(storage: ReloadDeps['storage']): void {
  if (!storage) return;
  try {
    storage.removeItem(RELOAD_FLAG);
  } catch {
    // Best-effort cleanup; mirrors setFlag.
  }
}
