# System-wide default currency; currency off the main create flow

Date: 2026-06-18
CHANGELOG: `0.28.0`
PR: #340

## Scope

The operator asked for a system-wide "Default Currency" in Settings so the currency field could come off the main create/money pages (an extra option that almost always takes the org default), available under Advanced for the rare override.

## Approach decision

Two stores already touch "currency for the org": the `organizations.default_currency_code` column (read-only in the SPA via `getActiveTenant`; there is no org-update route today) and the generic settings store behind the admin Settings page. `Currency` itself has no `default_for_org` flag (unlike taxes and payment methods), so there was no existing default-currency pattern to reuse.

`settings.read` is held by every staff role (owner, admin, sales, ops, accounting, viewer), so the settings store is readable by everyone who creates a document. That makes a SPA-only path viable: store the default in the settings store, no edge route, no migration, no byte-mirror change. Writing `organizations.default_currency_code` would have required a new `tenants-api` PATCH plus an org-update cap and request schema; deferred. The operator chose to apply the change to all money create pages.

## What shipped

- **`lib/defaultCurrency.ts`** (pure): `resolveDefaultCurrency(settings)` pulls the three-letter code out of the `general/default_currency` setting row, with constants and a USD fallback. No React or supabase import, so it unit-tests without env vars (five tests in `lib/defaultCurrency.test.ts`). This split mirrors the `entityPickerModel` pattern and was the fix for a first cut where the test imported the hook and tripped the supabase-env guard at module load.
- **`lib/hooks/useDefaultCurrency.ts`**: returns the resolved default, or `undefined` while the settings query is loading so a form seeds exactly once and does not lock in the fallback over a later real value.
- **`components/ui/CurrencyField.tsx`**: the shared currency control. It seeds the hosting form's currency from the org default exactly once (a ref guard, so a later user choice is never overwritten) and renders a dropdown over the active currencies. Hosting forms keep their own `currency` string state, so there is no type ripple.
- **Settings page**: a dedicated "Default Currency" dropdown over `general/default_currency`, reading the current value with `resolveDefaultCurrency` and saving with the existing `useUpsertSetting` (settings.write). The raw JSON settings editor below it is unchanged.
- **Nine create/money forms**: quote, invoice, purchase order, sales order, payment, credit note, vendor bill, expense, project. Each drops its inline currency input (free-text on most, a `Select` on quote/project) and exposes `CurrencyField` under an "Advanced (optional)" disclosure. The quote form reused its existing Advanced section; the others gained one. Every form still sends `currency_code`, so the wire contract is unchanged.

## Verification

- Gates green: typecheck, lint (max-warnings 0), tests (the five new resolver tests plus the existing suite), build (SPA index ~36.5 kB gz under the 40 kB budget), and bundle-budget.
- No render test covers the forms (the repo runs Vitest without jsdom); the seeding and the Advanced placement are verified by the resolver tests plus an operator click-through.

## Constitutional invariants

SPA presentation only. No schema, migration, RLS, money math, idempotency, `audit_log`, capability, or byte-mirror contract change. Currency is still set on every document (defaulted, not dropped), so the issuance-time currency snapshot is unaffected. No new dependency.

## Follow-ups

- If the org default should live on the `organizations` record (for reporting or API consumers) rather than the settings store, that is a small `tenants-api` PATCH plus an org-update cap, deferred here.
- The default could later seed customer/vendor currency or the sales-config currency list, not just the document forms.
