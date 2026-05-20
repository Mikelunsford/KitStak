import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Byte-identical canon files. SPA copy is the authority developers edit;
// the _shared copy is what edge functions import. Drift is a release blocker.
//
// If this test fails: copy the SPA file over the _shared file (or vice versa,
// after operator review) and ship a single commit that closes the drift.

type Pair = { name: string; spa: string; shared: string };

const SINGULAR_PAIRS: ReadonlyArray<Pair> = [
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
  {
    name: 'constants',
    spa: 'src/lib/constants.ts',
    shared: '../../supabase/functions/_shared/constants.ts',
  },
];

// Domain side-cars: each agent ships its types/workflow/capabilities as a
// per-domain file. Both copies must be byte-identical (same contract).
const DOMAINS = [
  'identity',
  'crm',
  'sales',
  'finance',
  'vendors_inventory_ops',
  'cross_cutting',
] as const;

// Capabilities are no longer a side-car — folded into the singular canon
// (apps/web/src/lib/capabilities.ts and _shared/capabilities.ts) at
// F-Wave2-AGENT-A-05. Domain types and workflow remain per-domain.
const SIDE_CAR_KINDS = ['types', 'workflow'] as const;

const SIDE_CAR_PAIRS: ReadonlyArray<Pair> = DOMAINS.flatMap((domain) =>
  SIDE_CAR_KINDS.map((kind) => ({
    name: `${kind}/${domain}`,
    spa: `src/lib/${kind}/${domain}.ts`,
    shared: `../../supabase/functions/_shared/${kind}/${domain}.ts`,
  })),
);

const here = dirname(fileURLToPath(import.meta.url));
const appsWebRoot = resolve(here, '..', '..');

describe('contract canon byte parity (singular)', () => {
  for (const pair of SINGULAR_PAIRS) {
    it(`${pair.name}: SPA and _shared copies are byte-identical`, () => {
      const spaBytes    = readFileSync(resolve(appsWebRoot, pair.spa));
      const sharedBytes = readFileSync(resolve(appsWebRoot, pair.shared));
      expect(spaBytes.equals(sharedBytes)).toBe(true);
    });
  }
});

describe('contract canon byte parity (side-cars)', () => {
  for (const pair of SIDE_CAR_PAIRS) {
    it(`${pair.name}: SPA and _shared copies are byte-identical`, () => {
      const spaBytes    = readFileSync(resolve(appsWebRoot, pair.spa));
      const sharedBytes = readFileSync(resolve(appsWebRoot, pair.shared));
      expect(spaBytes.equals(sharedBytes)).toBe(true);
    });
  }
});
