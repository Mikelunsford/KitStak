// Pillar-1 happy-path smoke. F-Wave5-TEST-02 selector dry-run pass:
// staged the spec against the actual SPA route table and FSM. The top-level
// describe stays test.skip-ped when PLAYWRIGHT_BASE_URL or the seed
// credentials are absent so the gate is green-without-doing-nothing in
// environments where staging is not wired.
//
// Required env:
//   PLAYWRIGHT_BASE_URL          staging SPA URL
//   SMOKE_USER_EMAIL             seeded operator email
//   SMOKE_USER_PASSWORD          seeded operator password
// Optional:
//   SMOKE_SECONDARY_ORG_NAME     name shown in the Topbar workspace
//                                switcher when the operator belongs to >1
//                                org. When unset the switch-org step is
//                                a no-op.
//   SMOKE_SEEDED_INVOICE_URL     full path (no host) to an invoice the
//                                seeded operator can see, with at least one
//                                audit_log row. Used by the audit-timeline
//                                step. When unset the timeline step is a
//                                no-op rather than a hard fail.
//
// The seed must include: at least one org the operator belongs to. The
// optional cross-domain quote-to-cash chain (currently test.skip-ped, see
// F-Wave5-TEST-02-CHAIN-01) additionally needs a customer, an inventory
// item, a default warehouse, a vendor, and the per-route flag
// finance.journal_entries.enabled enabled. The probe spec creates and
// tears down its own fixtures; this spec assumes a stable seed.
//
// Run with: pnpm test:e2e --grep @smoke
//
// Selector contracts (additive, never delete from this list without
// updating the spec):
//   input[name="email"]               SignInPage email field
//   input[name="password"]            SignInPage password field
//   button[type="submit"]             every form submit
//   input[name="display_name"]        CustomerCreatePage primary input
//   input[name="amount_cents"]        PaymentCreatePage amount input
//   [data-testid="workspace-switcher"] Topbar org switcher button
//   [data-testid="audit-timeline"]     AuditTimeline ordered list

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? '';
const SMOKE_USER_EMAIL = process.env.SMOKE_USER_EMAIL ?? '';
const SMOKE_USER_PASSWORD = process.env.SMOKE_USER_PASSWORD ?? '';
const SECONDARY_ORG_NAME = process.env.SMOKE_SECONDARY_ORG_NAME ?? '';
const SEEDED_INVOICE_URL = process.env.SMOKE_SEEDED_INVOICE_URL ?? '';

const SMOKE_READY = Boolean(BASE_URL && SMOKE_USER_EMAIL && SMOKE_USER_PASSWORD);

// Skip at the describe level so the browser fixture never initializes when
// staging is unwired. A test-body-level test.skip would still spin up
// Chromium first and fail with a launch error in environments where the
// browser is not installed.
test.describe('@smoke pillar-1 flow', () => {
  test.skip(
    !SMOKE_READY,
    'staging not wired: set PLAYWRIGHT_BASE_URL, SMOKE_USER_EMAIL, SMOKE_USER_PASSWORD',
  );

  test('@smoke pillar-1 sign-in + shell load', async ({ page }) => {
    await test.step('sign in with seeded operator credentials', async () => {
      await page.goto('/signin');
      await page.locator('input[name="email"]').fill(SMOKE_USER_EMAIL);
      await page.locator('input[name="password"]').fill(SMOKE_USER_PASSWORD);
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    });

    await test.step('workspace switcher renders for multi-org operator', async () => {
      // The switcher is rendered for every authenticated user; it disables
      // itself when the operator belongs to zero or one org. The button
      // exposes aria-label="Workspace switcher" and data-testid for a
      // refactor-stable selector.
      const switcher = page.getByTestId('workspace-switcher');
      await expect(switcher).toBeVisible({ timeout: 10_000 });

      if (!SECONDARY_ORG_NAME) return;
      const isDisabled = await switcher.isDisabled().catch(() => true);
      if (isDisabled) return;
      await switcher.click();
      const row = page.getByRole('menuitemradio', { name: SECONDARY_ORG_NAME });
      if (await row.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await row.click();
        await expect(page.getByText(SECONDARY_ORG_NAME).first()).toBeVisible();
      }
    });

    await test.step('audit timeline renders on a seeded invoice', async () => {
      // Audit timeline is the highest-value cross-domain assertion that does
      // not require write-path FK fixtures. Walks to a known-seeded invoice
      // (the seed needs at least one with audit_log rows; the create step
      // below would produce one but is currently test.skip-ped pending
      // F-Wave5-TEST-02-CHAIN-01 — see footer comment).
      if (!SEEDED_INVOICE_URL) {
        test.info().annotations.push({
          type: 'smoke-skip',
          description:
            'SMOKE_SEEDED_INVOICE_URL not set; audit-timeline coverage skipped',
        });
        return;
      }
      await page.goto(SEEDED_INVOICE_URL);
      // AuditTimeline renders an <ol data-testid="audit-timeline"> after
      // load; an empty timeline renders the "No history yet." string
      // instead. Either is a valid render; both confirm the route loaded
      // and the audit-log fetch did not 403/500.
      const timeline = page.getByTestId('audit-timeline');
      const empty = page.getByText('No history yet.');
      await Promise.race([
        timeline.waitFor({ state: 'visible', timeout: 10_000 }),
        empty.waitFor({ state: 'visible', timeout: 10_000 }),
      ]);
    });
  });

  // ---------------------------------------------------------------------
  // The cross-domain quote-to-cash chain below is the original scope of
  // F-Wave5-TEST-02. Selector dry-run revealed that every create step in
  // this chain requires a populated FK picker (customer_id, warehouse_id,
  // item_id, etc.) that cannot be exercised by a "click empty form,
  // submit" smoke. The honest paths forward are: (a) seed the staging org
  // with a known fixture set and document the seed shape; or (b) extend
  // this spec with a service-role bootstrap that creates ephemeral fixtures
  // (mirror the rls-probe.spec.ts pattern). Both are scoped under
  // F-Wave5-TEST-02-CHAIN-01.
  // ---------------------------------------------------------------------
  test.skip('@smoke pillar-1 quote-to-cash chain (pending fixture seed)', async ({
    page,
  }) => {
    // Unique suffix so reruns do not collide on numbering-sequence or
    // naming constraints. The seed is expected to be untouched; this
    // spec only creates child rows.
    const suffix = `${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    await test.step('sign in', async () => {
      await page.goto('/signin');
      await page.locator('input[name="email"]').fill(SMOKE_USER_EMAIL);
      await page.locator('input[name="password"]').fill(SMOKE_USER_PASSWORD);
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    });

    await test.step('create a customer', async () => {
      await page.goto('/crm/customers/new');
      await page
        .locator('input[name="display_name"]')
        .fill(`Smoke Customer ${suffix}`);
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/crm\/customers\/[0-9a-f-]+/, {
        timeout: 15_000,
      });
    });

    // The quote create requires a customer_id picker that is populated by
    // CustomerPicker (a typeahead component, not a name="" input). The
    // FSM flow is: draft -> submit -> approve -> send -> convert. The
    // original spec assumed send -> accept|approve which does not match
    // QUOTE_FSM.
    let quoteUrl = '';
    await test.step('create a quote, submit, approve, send', async () => {
      await page.goto('/3pl-operations/quotes/new');
      // TODO(F-Wave5-TEST-02-CHAIN-01): drive CustomerPicker via typeahead
      // and select the seeded customer. Single-FK pickers do not expose a
      // name="" attribute; a data-testid contract on CustomerPicker is the
      // canonical solution.
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/3pl-operations\/quotes\/[0-9a-f-]+/, {
        timeout: 15_000,
      });
      quoteUrl = page.url();
      // QUOTE_FSM order. Submit first, then Approve, then Send.
      await page.getByRole('button', { name: /^submit$/i }).click();
      await page.getByRole('button', { name: /^approve$/i }).click();
      await page.getByRole('button', { name: /^send$/i }).click();
    });

    let projectUrl = '';
    await test.step('convert quote to project', async () => {
      if (!quoteUrl) return;
      await page.goto(quoteUrl);
      await page.getByRole('button', { name: /convert to project/i }).click();
      await expect(page).toHaveURL(/\/3pl-operations\/projects\/[0-9a-f-]+/, {
        timeout: 15_000,
      });
      projectUrl = page.url();
    });

    let invoiceUrl = '';
    await test.step('create invoice, send', async () => {
      // TODO(F-Wave5-TEST-02-CHAIN-01): InvoiceCreatePage requires a
      // customer FK too. From the project page the operator may have a
      // "Create invoice" link wired; absent that, hit /invoicing/invoices/new
      // and fill the customer picker.
      if (projectUrl) await page.goto(projectUrl);
      await page.goto('/invoicing/invoices/new');
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/invoicing\/invoices\/[0-9a-f-]+/, {
        timeout: 15_000,
      });
      invoiceUrl = page.url();
      await page.getByRole('button', { name: /^send$/i }).first().click();
    });

    await test.step('post a payment', async () => {
      // PaymentCreatePage requires payment_number + customer_id picker +
      // amount_cents. Spec previously only filled amount_cents.
      await page.goto('/3pl-operations/payments/new');
      await page.locator('input[name="amount_cents"]').fill('1000');
      await page.locator('button[type="submit"]').click();
      // PaymentCreatePage navigates to /invoicing/invoices/:id when an
      // invoice was pre-allocated, else /invoicing/payments. No
      // /payments/:id route exists.
      await expect(page).toHaveURL(
        /\/invoicing\/(invoices\/[0-9a-f-]+|payments)/,
        { timeout: 15_000 },
      );
    });

    await test.step('run a receiving order', async () => {
      // ReceivingOrderCreatePage requires warehouse_id (a typeahead) plus
      // a JSON lines payload. Click-empty submit will fail validation.
      await page.goto('/3pl-operations/receiving/new');
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(
        /\/3pl-operations\/receiving\/[0-9a-f-]+/,
        { timeout: 15_000 },
      );
    });

    await test.step('ship a shipment', async () => {
      await page.goto('/3pl-operations/shipments/new');
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(
        /\/3pl-operations\/shipments\/[0-9a-f-]+/,
        { timeout: 15_000 },
      );
    });

    await test.step('verify audit timeline on invoice detail', async () => {
      if (!invoiceUrl) test.skip(true, 'no invoice URL from earlier step');
      await page.goto(invoiceUrl);
      await expect(page.getByTestId('audit-timeline')).toBeVisible({
        timeout: 10_000,
      });
    });
  });
});
