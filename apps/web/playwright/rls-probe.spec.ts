// Cross-tenant RLS probe matrix. Phase 5 deliverable.
//
// Constitutional rules being verified (see CLAUDE.md "RLS rules"):
//   1. Pattern A (single-table org-scoped) cross-tenant reads return
//      200 + empty array. RLS filters, never throws.
//   2. Workflow POSTs targeting a tenant the caller is not in return 404
//      NOT_FOUND. A 403 where 404 is the constitutional answer is a
//      release blocker.
//   3. Bundle gates (plugins.three_pl on ops-api, platform_admin.enabled on
//      admin-console-api) return 404 when off. Per-route flags (e.g.
//      finance.journal_entries.enabled) return 403 FEATURE_DISABLED with
//      details.flag set.
//   4. Pattern C global tables (currencies, exchange_rates, roles) stay
//      readable by every authenticated caller.
//   5. Unauthenticated callers hit 401 UNAUTHORIZED on guarded routes.
//   6. customer-portal-api 404s any non-customer_user role.
//
// Fixture strategy: a test.beforeAll creates two ephemeral orgs (A and B)
// plus one user per org via the supabase-js auth admin client. Org A is
// seeded with one row per primary entity. The probes then authenticate as
// userB and assert that none of orgA's data is reachable.
//
// test.afterAll tears down fixtures via service-role. The teardown is
// best-effort: a partial-setup failure must not leave fixtures stranded.
//
// Env contract (set by .github/workflows/nightly-rls-probe.yml):
//   VITE_SUPABASE_URL              staging Supabase project URL
//   VITE_SUPABASE_ANON_KEY         staging anon key
//   SUPABASE_SERVICE_ROLE_KEY      staging service role key
// When any of these is missing the entire suite skips with a clear message.
//
// Tag: every test is tagged @rls so pnpm test:rls (`--grep @rls`) picks it up.

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SECRETS_PRESENT = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY,
);

const FUNCTIONS_BASE = SECRETS_PRESENT
  ? `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`
  : '';

// Same suffix across both orgs so a stranded fixture is easy to identify
// during operator triage. Adds the current ISO date plus a short random
// segment so concurrent CI runs do not collide.
const FIXTURE_SUFFIX = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const GATE_404_MESSAGE = 'gate-miss MUST 404, never 403';

// ---------------------------------------------------------------------------
// Fixture shape
// ---------------------------------------------------------------------------

interface OrgFixture {
  id: string;
  slug: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerJwt: string;
  warehouseId: string;
  customerId: string;
  contactId: string;
  leadId: string;
  opportunityId: string;
  itemId: string;
  quoteId: string;
  projectId: string;
  invoiceId: string;
  paymentId: string;
  creditNoteId: string;
  vendorId: string;
  purchaseOrderId: string;
  vendorBillId: string;
  expenseId: string;
  receivingOrderId: string;
  productionRunId: string;
  shipmentId: string;
  journalEntryId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function anonForJwt(jwt: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

async function setFlag(
  orgId: string,
  flagKey: string,
  isEnabled: boolean,
): Promise<void> {
  const sb = admin();
  const { error } = await sb
    .from('org_feature_flags')
    .upsert(
      {
        org_id: orgId,
        flag_key: flagKey,
        is_enabled: isEnabled,
        config: {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,flag_key' },
    );
  if (error) {
    throw new Error(`setFlag failed for ${flagKey}: ${error.message}`);
  }
}

async function getRoleId(code: string): Promise<string> {
  const sb = admin();
  const { data, error } = await sb
    .from('roles')
    .select('id')
    .eq('code', code)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`role ${code} lookup failed: ${error?.message ?? 'missing'}`);
  }
  return data.id as string;
}

async function signinPassword(
  email: string,
  password: string,
): Promise<string> {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`signin failed for ${email}: ${error?.message ?? 'no session'}`);
  }
  return data.session.access_token;
}

async function bootstrapOrg(
  label: 'A' | 'B',
  password: string,
): Promise<OrgFixture> {
  const sb = admin();
  const slug = `rls_probe_org_${label.toLowerCase()}_${FIXTURE_SUFFIX}`;
  const email = `rls.probe.${label.toLowerCase()}.${FIXTURE_SUFFIX}@kitstak.local`;
  const display = `RLS Probe Org ${label}`;

  // Create the owner user first so provision_organization can stamp the
  // membership. email_confirm=true short-circuits the magic-link flow.
  const { data: userCreate, error: userErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !userCreate.user) {
    throw new Error(`createUser ${label} failed: ${userErr?.message ?? 'no user'}`);
  }
  const ownerUserId = userCreate.user.id;

  // Provision the org via the canonical RPC. Idempotent on slug collision.
  const { data: orgIdData, error: provErr } = await sb.rpc(
    'provision_organization',
    {
      p_slug: slug,
      p_display_name: display,
      p_owner_user_id: ownerUserId,
      p_owner_email: email,
    },
  );
  if (provErr || !orgIdData) {
    throw new Error(
      `provision_organization ${label} failed: ${provErr?.message ?? 'no id'}`,
    );
  }
  const orgId = orgIdData as string;

  // Stamp the active-org claim onto app_metadata so the JWT carries the
  // kitstak_org_id / kitstak_org_role pair the edge functions expect.
  const ownerRoleId = await getRoleId('org_owner');
  void ownerRoleId;
  const { error: updateErr } = await sb.auth.admin.updateUserById(ownerUserId, {
    app_metadata: {
      kitstak_org_id: orgId,
      kitstak_org_role: 'org_owner',
    },
  });
  if (updateErr) {
    throw new Error(`stamp claim ${label} failed: ${updateErr.message}`);
  }

  // Sign in to mint a JWT that carries the new claim.
  const ownerJwt = await signinPassword(email, password);

  // Enable feature flags this org needs for the probes that hit ops-api,
  // admin-console, and finance journal entries. plugins.three_pl on org A
  // and (by default) on org B; we will flip these mid-test for the gate
  // probes.
  await setFlag(orgId, 'plugins.3pl', true);
  await setFlag(orgId, 'finance.journal_entries.enabled', true);
  // platform_admin.enabled stays off everywhere; the probe verifies that
  // a non-platform-admin caller hitting admin-console-api gets 404.

  // Default warehouse: provision_organization may seed one, fall back to
  // an insert if absent. We need an id to attach inventory / ops fixtures.
  let warehouseId: string;
  const { data: existingWh } = await sb
    .from('warehouses')
    .select('id')
    .eq('org_id', orgId)
    .limit(1)
    .maybeSingle();
  if (existingWh?.id) {
    warehouseId = existingWh.id as string;
  } else {
    const { data: whData, error: whErr } = await sb
      .from('warehouses')
      .insert({
        org_id: orgId,
        code: 'MAIN',
        display_name: 'Main',
        is_default: true,
        created_by: ownerUserId,
        updated_by: ownerUserId,
      })
      .select('id')
      .single();
    if (whErr) throw new Error(`warehouse seed failed: ${whErr.message}`);
    warehouseId = whData.id as string;
  }

  // Seed one row per primary entity. Each insert minimal-fields-only;
  // defaults from the schema fill the rest. Any failure aborts the
  // fixture so the teardown runs cleanly.

  const auditBy = { created_by: ownerUserId, updated_by: ownerUserId };

  const ins = async (table: string, values: Record<string, unknown>) => {
    const { data, error } = await sb
      .from(table)
      .insert({ org_id: orgId, ...auditBy, ...values })
      .select('id')
      .single();
    if (error) {
      throw new Error(`seed ${table} failed: ${error.message}`);
    }
    return data.id as string;
  };

  // Short, unique-per-fixture document numbers so the (org_id, *_number)
  // uniques never collide across concurrent probe runs.
  const docNum = (prefix: string) => `${prefix}-${label}-${FIXTURE_SUFFIX}`.slice(0, 32);
  const today = new Date();
  const period_year = today.getUTCFullYear();
  const period_month = today.getUTCMonth() + 1;

  const customerId = await ins('customers', {
    display_name: `Probe Customer ${label}`,
  });
  const contactId = await ins('contacts', {
    customer_id: customerId,
    first_name: 'Probe',
    last_name: label,
    email: `contact.${label.toLowerCase()}.${FIXTURE_SUFFIX}@kitstak.local`,
  });
  const leadId = await ins('leads', {
    display_name: `Probe Lead ${label}`,
    status: 'new',
  });
  const opportunityId = await ins('opportunities', {
    customer_id: customerId,
    display_name: `Probe Opp ${label}`,
    stage: 'discovery',
  });
  const itemId = await ins('items', {
    sku: `RLS-PROBE-${label}-${FIXTURE_SUFFIX}`.slice(0, 32),
    name: `Probe Item ${label}`,
  });
  const quoteId = await ins('quotes', {
    number: docNum('Q'),
    customer_id: customerId,
    currency_code: 'USD',
    state: 'draft',
  });
  const projectId = await ins('projects', {
    number: docNum('P'),
    customer_id: customerId,
    name: `Probe Project ${label}`,
    state: 'pending',
  });
  const invoiceId = await ins('invoices', {
    invoice_number: docNum('INV'),
    customer_id: customerId,
    currency_code: 'USD',
    status: 'draft',
  });
  const paymentId = await ins('payments', {
    payment_number: docNum('PMT'),
    customer_id: customerId,
    currency_code: 'USD',
    amount_cents: 1,
    received_at: new Date().toISOString(),
  });
  const creditNoteId = await ins('credit_notes', {
    credit_note_number: docNum('CN'),
    customer_id: customerId,
    currency_code: 'USD',
    status: 'draft',
  });
  const vendorId = await ins('vendors', {
    display_name: `Probe Vendor ${label}`,
  });
  const purchaseOrderId = await ins('purchase_orders', {
    vendor_id: vendorId,
    currency_code: 'USD',
    status: 'draft',
  });
  const vendorBillId = await ins('vendor_bills', {
    vendor_id: vendorId,
    currency_code: 'USD',
    status: 'draft',
  });
  const expenseId = await ins('expenses', {
    vendor_id: vendorId,
    currency_code: 'USD',
    amount_cents: 0,
    status: 'draft',
  });
  const receivingOrderId = await ins('receiving_orders', {
    warehouse_id: warehouseId,
    status: 'created',
    payload: {},
  });
  const productionRunId = await ins('production_runs', {
    warehouse_id: warehouseId,
    output_item_id: itemId,
    status: 'planned',
    payload: {},
  });
  const shipmentId = await ins('shipments', {
    warehouse_id: warehouseId,
    status: 'created',
    payload: {},
  });
  const journalEntryId = await ins('journal_entries', {
    entry_number: docNum('JE'),
    entry_date: today.toISOString().slice(0, 10),
    period_year,
    period_month,
    status: 'draft',
  });

  return {
    id: orgId,
    slug,
    ownerUserId,
    ownerEmail: email,
    ownerJwt,
    warehouseId,
    customerId,
    contactId,
    leadId,
    opportunityId,
    itemId,
    quoteId,
    projectId,
    invoiceId,
    paymentId,
    creditNoteId,
    vendorId,
    purchaseOrderId,
    vendorBillId,
    expenseId,
    receivingOrderId,
    productionRunId,
    shipmentId,
    journalEntryId,
  };
}

async function teardownOrg(fixture: OrgFixture | null): Promise<void> {
  if (!fixture) return;
  const sb = admin();
  const tables = [
    'journal_entry_lines', 'journal_entries',
    'shipments', 'production_runs', 'receiving_orders',
    'expenses', 'vendor_bill_payments', 'vendor_bills',
    'po_line_items', 'purchase_orders', 'vendors',
    'stock_movements', 'stock_levels',
    'credit_note_allocations', 'credit_notes',
    'payment_allocations', 'payments',
    'invoice_line_items', 'invoice_versions', 'invoices',
    'project_phases', 'projects',
    'quote_approvals', 'quote_versions', 'quote_line_items', 'quotes',
    'items', 'opportunities', 'leads', 'contacts', 'customers',
    'warehouses',
    'org_feature_flags', 'org_branding', 'org_settings',
    'org_memberships', 'audit_log', 'numbering_sequences',
  ];
  for (const t of tables) {
    try {
      await sb.from(t).delete().eq('org_id', fixture.id);
    } catch {
      // best-effort; partial setup may leave some rows absent
    }
  }
  try {
    await sb.from('organizations').delete().eq('id', fixture.id);
  } catch {
    // best-effort
  }
  try {
    await sb.auth.admin.deleteUser(fixture.ownerUserId);
  } catch {
    // best-effort
  }
}

// userB-flavored fetch against an edge function bundle. Adds Authorization
// and a fresh Idempotency-Key for every non-GET (matching production SPA
// behavior).
async function callFn(
  jwt: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (method !== 'GET' && method !== 'OPTIONS') {
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined && method !== 'GET' && method !== 'OPTIONS') {
    init.body = JSON.stringify(body);
  }
  return fetch(`${FUNCTIONS_BASE}${path}`, init);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('@rls cross-tenant probe matrix', () => {
  test.beforeAll(() => {
    if (!SECRETS_PRESENT) {
      // Module-scope skip: every test in the suite is skipped uniformly so
      // the Actions log shows "skipped" with a single clear reason.
      test.skip(
        true,
        'staging secrets missing: set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY',
      );
    }
  });

  let orgA: OrgFixture | null = null;
  let orgB: OrgFixture | null = null;
  const probePassword = `Rls-Probe-${FIXTURE_SUFFIX}!`;

  test.beforeAll(async () => {
    if (!SECRETS_PRESENT) return;
    try {
      orgA = await bootstrapOrg('A', probePassword);
      orgB = await bootstrapOrg('B', probePassword);
    } catch (err) {
      // Make sure a partial setup gets cleaned up before the suite bails.
      await teardownOrg(orgA);
      await teardownOrg(orgB);
      throw err;
    }
  });

  test.afterAll(async () => {
    if (!SECRETS_PRESENT) return;
    await teardownOrg(orgA);
    await teardownOrg(orgB);
  });

  // --- Category 1: cross-tenant list reads (Pattern A) -> 200 + [] -------

  const listReadCases = [
    'customers', 'contacts', 'leads', 'opportunities', 'items',
    'quotes', 'projects', 'invoices', 'vendors', 'expenses',
  ];

  for (const table of listReadCases) {
    test(`@rls list ${table} from another tenant returns empty array`, async () => {
      if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
      const sb = anonForJwt(orgB!.ownerJwt);
      const { data, error } = await sb
        .from(table)
        .select('*')
        .eq('org_id', orgA!.id);
      expect(error, `read ${table} should not error: ${error?.message}`).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data, `RLS leak: cross-tenant ${table} read returned rows`).toEqual([]);
    });
  }

  test('@rls list quotes without org filter still scopes to caller org', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const sb = anonForJwt(orgB!.ownerJwt);
    const { data, error } = await sb.from('quotes').select('id, org_id');
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    const leaked = (data ?? []).filter((r) => r.org_id === orgA!.id);
    expect(leaked, 'RLS leak: unqualified quote read crossed tenants').toEqual([]);
  });

  test('@rls list customers without org filter still scopes to caller org', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const sb = anonForJwt(orgB!.ownerJwt);
    const { data, error } = await sb.from('customers').select('id, org_id');
    expect(error).toBeNull();
    const leaked = (data ?? []).filter((r) => r.org_id === orgA!.id);
    expect(leaked, 'RLS leak: unqualified customer read crossed tenants').toEqual([]);
  });

  // --- Category 2: cross-tenant detail reads (Pattern A) -> 200 + [] ----

  const detailReadCases: Array<[string, keyof OrgFixture]> = [
    ['quotes', 'quoteId'],
    ['invoices', 'invoiceId'],
    ['projects', 'projectId'],
    ['vendors', 'vendorId'],
    ['purchase_orders', 'purchaseOrderId'],
    ['journal_entries', 'journalEntryId'],
  ];

  for (const [table, key] of detailReadCases) {
    test(`@rls detail read ${table} from another tenant returns empty`, async () => {
      if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
      const sb = anonForJwt(orgB!.ownerJwt);
      const targetId = orgA![key] as string;
      const { data, error } = await sb
        .from(table)
        .select('*')
        .eq('id', targetId);
      expect(error).toBeNull();
      expect(data, `RLS leak: detail ${table} returned cross-tenant row`).toEqual([]);
    });
  }

  // --- Category 3: cross-tenant workflow POSTs -> 404 (never 403) -------

  test('@rls quotes-api send across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'POST',
      `/quotes-api/quotes/${orgA!.quoteId}/send`,
      {},
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls quotes-api approve across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'POST',
      `/quotes-api/quotes/${orgA!.quoteId}/approve`,
      {},
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls quotes-api convert-to-project across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'POST',
      `/quotes-api/quotes/${orgA!.quoteId}/convert-to-project`,
      {},
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls quotes-api update across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'PATCH',
      `/quotes-api/quotes/${orgA!.quoteId}`,
      { notes: 'cross-tenant attempt' },
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls invoicing-api update across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'PATCH',
      `/invoicing-api/invoices/${orgA!.invoiceId}`,
      { notes: 'cross-tenant attempt' },
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls invoicing-api send across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'POST',
      `/invoicing-api/invoices/${orgA!.invoiceId}/send`,
      {},
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls crm-api lead detail across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'GET',
      `/crm-api/leads/${orgA!.leadId}`,
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls projects-api detail across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'GET',
      `/projects-api/projects/${orgA!.projectId}`,
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls vendors-api purchase-order detail across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'GET',
      `/vendors-api/purchase-orders/${orgA!.purchaseOrderId}`,
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls ops-api receiving detail across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'GET',
      `/ops-api/receiving-orders/${orgA!.receivingOrderId}`,
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls ops-api shipment ship across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'POST',
      `/ops-api/shipments/${orgA!.shipmentId}/ship`,
      { lines: [] },
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls finance-api journal-entry post across tenants 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'POST',
      `/finance-api/journal-entries/${orgA!.journalEntryId}/post`,
      {},
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  // --- Category 4: bundle gate probes ----------------------------------

  test('@rls ops-api with plugins.3pl off returns 404 (bundle gate)', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    await setFlag(orgB!.id, 'plugins.3pl', false);
    try {
      // The bundle cache is 5 min. The CI run is fresh, so this read sees
      // the just-written flag. For a long-lived worker we'd need a
      // cache-invalidation hook; the probe documents the assumption.
      const res = await callFn(
        orgB!.ownerJwt,
        'GET',
        `/ops-api/receiving-orders`,
      );
      expect(res.status, GATE_404_MESSAGE).toBe(404);
    } finally {
      await setFlag(orgB!.id, 'plugins.3pl', true);
    }
  });

  test('@rls ops-api with plugins.3pl off returns 404 on shipments too', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    await setFlag(orgB!.id, 'plugins.3pl', false);
    try {
      const res = await callFn(orgB!.ownerJwt, 'GET', `/ops-api/shipments`);
      expect(res.status, GATE_404_MESSAGE).toBe(404);
    } finally {
      await setFlag(orgB!.id, 'plugins.3pl', true);
    }
  });

  test('@rls admin-console-api hidden from non-platform-admin returns 404', async () => {
    if (!orgB) test.skip(true, 'fixtures not ready');
    // platform_admin.enabled defaults off; userB is not a platform admin.
    const res = await callFn(orgB!.ownerJwt, 'GET', `/admin-console-api/orgs`);
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls admin-console-api hidden from anonymous caller returns 404', async () => {
    if (!SECRETS_PRESENT) test.skip(true, 'staging not wired');
    const res = await callFn(null, 'GET', `/admin-console-api/orgs`);
    // Anonymous still gets 404; never leak that the bundle exists.
    expect(res.status).toBe(404);
  });

  // --- Category 5: per-route feature flag -> 403 FEATURE_DISABLED -------

  test('@rls finance.journal_entries flag off returns 403 FEATURE_DISABLED', async () => {
    if (!orgB) test.skip(true, 'fixtures not ready');
    await setFlag(orgB!.id, 'finance.journal_entries.enabled', false);
    try {
      const res = await callFn(
        orgB!.ownerJwt,
        'POST',
        `/finance-api/journal-entries/${orgB!.journalEntryId}/post`,
        {},
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        error?: { code?: string; details?: { flag?: string } };
      };
      expect(body.error?.code).toBe('FEATURE_DISABLED');
      expect(body.error?.details?.flag).toBe('finance.journal_entries.enabled');
    } finally {
      await setFlag(orgB!.id, 'finance.journal_entries.enabled', true);
    }
  });

  test('@rls finance.journal_entries flag off also blocks list endpoint with 403', async () => {
    if (!orgB) test.skip(true, 'fixtures not ready');
    await setFlag(orgB!.id, 'finance.journal_entries.enabled', false);
    try {
      const res = await callFn(orgB!.ownerJwt, 'GET', `/finance-api/journal-entries`);
      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        error?: { code?: string; details?: { flag?: string } };
      };
      expect(body.error?.code).toBe('FEATURE_DISABLED');
      expect(body.error?.details?.flag).toBe('finance.journal_entries.enabled');
    } finally {
      await setFlag(orgB!.id, 'finance.journal_entries.enabled', true);
    }
  });

  // --- Category 6: customer-portal-api Pattern B ------------------------

  test('@rls customer-portal-api 404s a non-customer-user caller', async () => {
    if (!orgB) test.skip(true, 'fixtures not ready');
    // userB is an org_owner, not a customer_user. The bundle returns 404
    // to avoid leaking existence to staff callers.
    const res = await callFn(orgB!.ownerJwt, 'GET', `/customer-portal-api/invoices`);
    expect(res.status).toBe(404);
  });

  test('@rls customer-portal-api 404s an anonymous caller', async () => {
    if (!SECRETS_PRESENT) test.skip(true, 'staging not wired');
    const res = await callFn(null, 'GET', `/customer-portal-api/invoices`);
    // No JWT means the bundle resolver short-circuits before role check.
    expect([401, 404]).toContain(res.status);
  });

  // --- Category 7: Pattern C global tables stay readable ----------------

  test('@rls currencies (Pattern C) readable by any tenant', async () => {
    if (!orgB) test.skip(true, 'fixtures not ready');
    const sb = anonForJwt(orgB!.ownerJwt);
    const { data, error } = await sb.from('currencies').select('code').limit(10);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  test('@rls exchange_rates (Pattern C) readable by any tenant', async () => {
    if (!orgB) test.skip(true, 'fixtures not ready');
    const sb = anonForJwt(orgB!.ownerJwt);
    const { data, error } = await sb.from('exchange_rates').select('*').limit(5);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  test('@rls roles (Pattern C) readable by any tenant', async () => {
    if (!orgB) test.skip(true, 'fixtures not ready');
    const sb = anonForJwt(orgB!.ownerJwt);
    const { data, error } = await sb.from('roles').select('code').limit(10);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  // --- Category 8: unauthenticated guard ---------------------------------

  test('@rls anonymous quotes-api list returns 401', async () => {
    if (!SECRETS_PRESENT) test.skip(true, 'staging not wired');
    const res = await callFn(null, 'GET', `/quotes-api/quotes`);
    expect(res.status).toBe(401);
  });

  test('@rls anonymous auth-api switch-org returns 401', async () => {
    if (!SECRETS_PRESENT) test.skip(true, 'staging not wired');
    const res = await callFn(null, 'POST', `/auth-api/sessions/switch-org`, {
      org_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(401);
  });

  test('@rls anonymous tenants-api resolve-host (verify_jwt=false) succeeds', async () => {
    if (!SECRETS_PRESENT) test.skip(true, 'staging not wired');
    const res = await callFn(
      null,
      'GET',
      `/tenants-api/tenants/resolve-host?host=does-not-resolve.kitstak.local`,
    );
    // Positive control: bundle is reachable without a JWT. Any non-401
    // response (200 with null match, 404 lookup miss) is acceptable; the
    // probe asserts the gate did not falsely 401.
    expect(res.status).not.toBe(401);
  });

  // --- Category 9: switch-org cross-tenant reject ------------------------

  test('@rls switch-org into a tenant the caller does not belong to 404s', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'POST',
      `/auth-api/sessions/switch-org`,
      { org_id: orgA!.id },
    );
    expect(res.status, GATE_404_MESSAGE).toBe(404);
  });

  test('@rls switch-org into own tenant succeeds with 201', async () => {
    if (!orgB) test.skip(true, 'fixtures not ready');
    const res = await callFn(
      orgB!.ownerJwt,
      'POST',
      `/auth-api/sessions/switch-org`,
      { org_id: orgB!.id },
    );
    // The handler emits 201 via created(). Accept 200 too in case the
    // shared response helper changes shape between waves.
    expect([200, 201]).toContain(res.status);
  });

  // --- Category 10: audit_log read RLS -----------------------------------

  test('@rls audit_log cross-tenant read returns empty array', async () => {
    if (!orgA || !orgB) test.skip(true, 'fixtures not ready');
    const sb = anonForJwt(orgB!.ownerJwt);
    const { data, error } = await sb
      .from('audit_log')
      .select('*')
      .eq('org_id', orgA!.id)
      .limit(50);
    expect(error).toBeNull();
    expect(data, 'RLS leak: audit_log cross-tenant read returned rows').toEqual([]);
  });

  test('@rls audit_log same-tenant read returns own-org rows', async () => {
    if (!orgB) test.skip(true, 'fixtures not ready');
    const sb = anonForJwt(orgB!.ownerJwt);
    const { data, error } = await sb
      .from('audit_log')
      .select('org_id')
      .eq('org_id', orgB!.id)
      .limit(50);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // provision_organization fired the audit trigger on org creation, so
    // at least one row should exist for org B.
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const r of data ?? []) {
      expect(r.org_id).toBe(orgB!.id);
    }
  });
});
