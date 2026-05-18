import { test } from '@playwright/test';

/**
 * RLS probe placeholder. Wave 2 ships the bundle-gate 404 expectation; the
 * cross-tenant probe and per-route flag probe land in Phase 5 once staging
 * secrets are wired. Tagged @rls so the `test:rls` script targets this file.
 */
test('@rls cross-tenant read returns empty result placeholder', async () => {
  test.skip(true, 'RLS probe wires in Phase 5');
});
