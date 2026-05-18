import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Byte-identical canon files. SPA copy is the authority developers edit;
// the _shared copy is what edge functions import. Drift is a release blocker.
//
// If this test fails: copy the SPA file over the _shared file (or vice versa,
// after operator review) and ship a single commit that closes the drift.

const PAIRS: ReadonlyArray<{ name: string; spa: string; shared: string }> = [
  {
    name: 'types',
    spa: 'src/lib/types.ts',
    shared: '../../supabase/functions/_shared/types.ts',
  },
  {
    name: 'workflow',
    spa: 'src/lib/workflow.ts',
    shared: '../../supabase/functions/_shared/workflow.ts',
  },
  {
    name: 'capabilities',
    spa: 'src/lib/capabilities.ts',
    shared: '../../supabase/functions/_shared/capabilities.ts',
  },
  {
    name: 'money',
    spa: 'src/lib/money.ts',
    shared: '../../supabase/functions/_shared/money.ts',
  },
];

const here = dirname(fileURLToPath(import.meta.url));
const appsWebRoot = resolve(here, '..', '..');

describe('contract canon byte parity', () => {
  for (const pair of PAIRS) {
    it(`${pair.name}: SPA and _shared copies are byte-identical`, () => {
      const spaBytes    = readFileSync(resolve(appsWebRoot, pair.spa));
      const sharedBytes = readFileSync(resolve(appsWebRoot, pair.shared));
      expect(spaBytes.equals(sharedBytes)).toBe(true);
    });
  }
});
