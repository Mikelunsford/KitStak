// R-W13-SEC-01: pin the JWT-verify route split.
//
// The threat: supabase/config.toml ran tenants-api and admin-console-api with
// verify_jwt = false, and _shared/tenant.ts only base64-decodes the JWT (no
// signature check), so a forged token reached authenticated handlers. The fix
// moves the one pre-auth public route (/tenants/resolve-host) into a new
// tenants-public-api bundle (verify_jwt = false) and flips the two
// authenticated bundles to verify_jwt = true so the Supabase gateway verifies
// the signature before any handler runs.
//
// The gateway behaviour itself (forged token rejected with 401) is only
// observable against a live Supabase project; that assertion lives in the
// Playwright rls-probe matrix (Category 8b) and runs in staging. This test is
// the local structural guard: it reads the literal source of the four touched
// files and asserts the split is wired correctly, the same posture as other
// config pins (cf. useFlags.test.ts). A regression here (e.g. flipping
// tenants-api back to verify_jwt = false, or pointing the SPA at the gated
// path) breaks this test before it can ship.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');

const tenantsService = readFileSync(
  resolve(__dirname, 'tenantsService.ts'),
  'utf8',
);
const configToml = readFileSync(
  resolve(REPO_ROOT, 'supabase/config.toml'),
  'utf8',
);
const deployWorkflow = readFileSync(
  resolve(REPO_ROOT, '.github/workflows/deploy-functions.yml'),
  'utf8',
);
const publicBundle = readFileSync(
  resolve(REPO_ROOT, 'supabase/functions/tenants-public-api/index.ts'),
  'utf8',
);
const tenantsApiBundle = readFileSync(
  resolve(REPO_ROOT, 'supabase/functions/tenants-api/index.ts'),
  'utf8',
);

// Pull the verify_jwt value for a named [functions.<bundle>] block.
function verifyJwtFor(bundle: string): string | null {
  const re = new RegExp(
    `\\[functions\\.${bundle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][^[]*?verify_jwt\\s*=\\s*(true|false)`,
  );
  const m = re.exec(configToml);
  return m && m[1] ? m[1] : null;
}

describe('tenants JWT-verify route split (R-W13-SEC-01)', () => {
  it('SPA resolveHost calls the public bundle path, not the gated tenants-api path', () => {
    expect(tenantsService).toMatch(
      /\/tenants-public-api\/tenants\/resolve-host/,
    );
    expect(tenantsService).not.toMatch(
      /\/tenants-api\/tenants\/resolve-host/,
    );
  });

  it('SPA authenticated tenant routes stay on tenants-api', () => {
    expect(tenantsService).toMatch(/\/tenants-api\/branding/);
    expect(tenantsService).toMatch(/\/tenants-api\/tenants\/me/);
  });

  it('config.toml enforces verify_jwt = true on the authenticated bundles', () => {
    expect(verifyJwtFor('tenants-api')).toBe('true');
    expect(verifyJwtFor('admin-console-api')).toBe('true');
  });

  it('config.toml keeps verify_jwt = false on the public bundle only', () => {
    expect(verifyJwtFor('tenants-public-api')).toBe('false');
  });

  it('deploy-functions.yml lists tenants-public-api so it actually deploys', () => {
    expect(deployWorkflow).toMatch(/^\s*tenants-public-api\s*$/m);
  });

  it('the public bundle owns resolve-host and no authenticated route', () => {
    expect(publicBundle).toMatch(/'\/tenants\/resolve-host'/);
    expect(publicBundle).toMatch(/resolve_org_by_host/);
    expect(publicBundle).not.toMatch(/requireCaller|requireCap/);
  });

  it('tenants-api no longer serves resolve-host', () => {
    expect(tenantsApiBundle).not.toMatch(/'\/tenants\/resolve-host'/);
    expect(tenantsApiBundle).toMatch(/'\/branding'/);
    expect(tenantsApiBundle).toMatch(/'\/tenants\/me'/);
  });
});
