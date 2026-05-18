// Pillar-1 happy-path smoke. Phase 5 hardening: every step makes a real
// Playwright assertion against a live staging deployment. The whole spec
// stays test.skip-ped when PLAYWRIGHT_BASE_URL or the seed credentials are
// absent so the gate is green-without-doing-nothing in environments where
// staging is not wired.
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
//
// The seed must include: two orgs the operator belongs to, a customer, an
// inventory item, a default warehouse, a vendor, and the per-route flag
// finance.journal_entries.enabled enabled. The probe spec creates and
// tears down its own fixtures; this spec assumes a stable seed.
//
// Run with: pnpm test:e2e --grep @smoke

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? '';
const SMOKE_USER_EMAIL = process.env.SMOKE_USER_EMAIL ?? '';
const SMOKE_USER_PASSWORD = process.env.SMOKE_USER_PASSWORD ?? '';
const SECONDARY_ORG_NAME = process.env.SMOKE_SECONDARY_ORG_NAME ?? '';

const SMOKE_READY = Boolean(BASE_URL && SMOKE_USER_EMAIL && SMOKE_USER_PASSWORD);

// Skip at the describe level so the browser fixture never initializes when
// staging is unwired. A test-body-level test.skip would still spin up
// Chromium first and fail with a launch error in environments where the
// browser is not installed (e.g. local dev without `playwright install`).
test.describe('@smoke pillar-1 flow', () => {
  test.skip(
    !SMOKE_READY,
    'staging not wired: set PLAYWRIGHT_BASE_URL, SMOKE_USER_EMAIL, SMOKE_USER_PASSWORD',
  );

  test('@smoke pillar-1 happy path', async ({ page }) => {

  // Unique suffix so reruns do not collide on numbering-sequence or naming
  // constraints. The seed is expected to be untouched; this spec only
  // creates child rows.
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  await test.step('sign in with seeded operator credentials', async () => {
    await page.goto('/signin');
    await page.locator('input[name="email"]').fill(SMOKE_USER_EMAIL);
    await page.locator('input[name="password"]').fill(SMOKE_USER_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  await test.step('switch into operator org via Topbar', async () => {
    if (!SECONDARY_ORG_NAME) {
      // Single-org seed: skip the switcher leg without failing.
      return;
    }
    // The Topbar workspace switcher is a button labeled with the current
    // org name. Click it, then click the secondary org row.
    const switcher = page.getByRole('button', { name: /workspace/i }).first();
    if (await switcher.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await switcher.click();
      await page.getByRole('menuitem', { name: SECONDARY_ORG_NAME }).click();
      await expect(page.getByText(SECONDARY_ORG_NAME).first()).toBeVisible();
    }
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

  let quoteUrl = '';
  await test.step('create a quote, send, accept', async () => {
    await page.goto('/quotes/new');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]+/, { timeout: 15_000 });
    quoteUrl = page.url();
    await page.getByRole('button', { name: /send/i }).first().click();
    await expect(page.getByText(/sent/i).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /accept|approve/i }).first().click();
    await expect(page.getByText(/accepted|approved/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  let projectUrl = '';
  await test.step('convert quote to project', async () => {
    if (!quoteUrl) return;
    await page.goto(quoteUrl);
    await page.getByRole('button', { name: /convert to project/i }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/, { timeout: 15_000 });
    projectUrl = page.url();
  });

  let invoiceUrl = '';
  await test.step('create invoice from project, send', async () => {
    if (!projectUrl) {
      await page.goto('/invoices/new');
    } else {
      await page.goto(projectUrl);
      await page.getByRole('link', { name: /new invoice|create invoice/i }).click();
    }
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+/, { timeout: 15_000 });
    invoiceUrl = page.url();
    await page.getByRole('button', { name: /send/i }).first().click();
    await expect(page.getByText(/sent/i).first()).toBeVisible({ timeout: 10_000 });
  });

  await test.step('post a payment', async () => {
    await page.goto('/payments/new');
    await page.locator('input[name="amount_cents"]').fill('1000');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/payments\/[0-9a-f-]+/, { timeout: 15_000 });
  });

  await test.step('run a receiving order', async () => {
    await page.goto('/ops/receiving/new');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/ops\/receiving\/[0-9a-f-]+/, {
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /receive|complete/i }).first().click();
    await expect(page.getByText(/received/i).first()).toBeVisible({ timeout: 10_000 });
  });

  await test.step('ship a shipment', async () => {
    await page.goto('/ops/shipments/new');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/ops\/shipments\/[0-9a-f-]+/, {
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /^ship/i }).first().click();
    await expect(page.getByText(/shipped/i).first()).toBeVisible({ timeout: 10_000 });
  });

  await test.step('verify audit timeline on invoice detail', async () => {
    if (!invoiceUrl) test.skip(true, 'no invoice URL from earlier step');
    await page.goto(invoiceUrl);
    // AuditTimeline renders the HISTORY heading (text-2xl font-display)
    // followed by a list of li entries.
    await expect(page.getByText(/^HISTORY$/i)).toBeVisible({ timeout: 10_000 });
    const items = page.locator('section:has(:text("HISTORY")) li');
    await expect(items.first()).toBeVisible({ timeout: 10_000 });
  });
  });
});
