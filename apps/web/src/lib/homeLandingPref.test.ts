// Pin the per-user default-landing preference helper.

import { afterEach, describe, it, expect } from 'vitest';

import {
  DEFAULT_LANDING,
  getHomeLanding,
  isValidLanding,
  setHomeLanding,
  validLandings,
} from './homeLandingPref';
import { SIDEBAR_MODES } from '@/components/shell/sidebarModes';

type WindowHost = { window?: { localStorage: Storage } };

function installMockStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      map.set(k, v);
    },
    removeItem: (k: string): void => {
      map.delete(k);
    },
    clear: (): void => map.clear(),
    key: (): string | null => null,
    length: 0,
  } as unknown as Storage;
  (globalThis as unknown as WindowHost).window = { localStorage: storage };
  return map;
}

afterEach(() => {
  delete (globalThis as unknown as WindowHost).window;
});

describe('validLandings / isValidLanding', () => {
  it('includes the dashboard and the section homes', () => {
    const v = validLandings();
    expect(v).toContain('/dashboard');
    expect(v).toContain('/sell');
    expect(v).toContain('/money');
  });

  it('rejects unknown paths and sub-routes', () => {
    expect(isValidLanding('/dashboard')).toBe(true);
    expect(isValidLanding('/sell')).toBe(true);
    expect(isValidLanding('/bogus')).toBe(false);
    // A section sub-route is not itself a valid landing target.
    expect(isValidLanding('/crm/leads')).toBe(false);
  });

  // The valid landings are hardcoded in homeLandingPref (to keep sidebarModes
  // out of the eager IndexRoute bundle); this guards against drift.
  it('stays in sync with the sidebar section homes', () => {
    expect(validLandings()).toEqual([
      DEFAULT_LANDING,
      ...SIDEBAR_MODES.map((m) => m.homePath),
    ]);
  });
});

describe('getHomeLanding / setHomeLanding', () => {
  it('defaults to the dashboard when storage is unreachable (SSR / node)', () => {
    expect(getHomeLanding()).toBe(DEFAULT_LANDING);
  });

  it('round-trips a valid section landing', () => {
    installMockStorage();
    setHomeLanding('/money');
    expect(getHomeLanding()).toBe('/money');
  });

  it('clears the key when set back to the default', () => {
    const map = installMockStorage();
    setHomeLanding('/sell');
    expect(getHomeLanding()).toBe('/sell');
    setHomeLanding(DEFAULT_LANDING);
    expect(getHomeLanding()).toBe(DEFAULT_LANDING);
    expect(map.size).toBe(0);
  });

  it('ignores an invalid path', () => {
    installMockStorage();
    setHomeLanding('/bogus');
    expect(getHomeLanding()).toBe(DEFAULT_LANDING);
  });
});
