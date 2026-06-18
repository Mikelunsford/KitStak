# System-wide default quote expiration

Date: 2026-06-18
CHANGELOG: `0.29.0`
PR: #341

## Scope

The operator asked to apply the default-currency methodology to the quote expiration date: a system-wide default set in organization settings, with the field moved off the main create flow into Advanced. The requested duration choices: 1, 5, 7, 14, 30, 60, 90 days, 6 months, 1 year, and custom.

Expiration is quote-specific (invoices have due dates, POs have expected dates), so this is a single-form change plus the Settings control, smaller than the nine-form currency sweep.

## What shipped

- **`lib/quoteExpiration.ts`** (pure): the `ExpirationDuration` model (`{ unit: 'day' | 'month' | 'year', amount }`), the preset table (the operator's nine choices), `resolveDefaultExpiration` (reads the `quotes/default_expiration` setting row, returns a duration or null), `addExpiration` (date math: days reuse the TZ-safe `addDaysIso`, months and years use calendar arithmetic so "6 Months" lands on the same day-of-month), and `presetIdForDuration` / `durationForPresetId` for the Settings dropdown mapping. No React or supabase import, so it unit-tests without env vars (resolver, day/month/year math including the documented Jan-31 + 1-month rollover, and the preset round-trip; `lib/quoteExpiration.test.ts`).
- **`lib/hooks/useDefaultExpiration.ts`**: returns the default duration, `null` when none is set, or `undefined` while the settings query loads (so the form seeds exactly once).
- **Settings page**: a "Default quote expiration" control. A dropdown of the nine presets plus "Custom (days)" (reveals a number input) and "No default". Save upserts `{ unit, amount }` to `quotes/default_expiration`, or deletes the row for "No default". The current value is read with `resolveDefaultExpiration` and mapped back to the dropdown with `presetIdForDuration`.
- **Quote create form**: the expiration date field moved from the main flow into the existing "Advanced (optional)" section (next to currency). A ref-guarded effect seeds it to `today + duration` once the setting resolves, leaving it blank when no default is set and never clobbering an operator's own date. The form still sends `expiration_date`, so the wire contract is unchanged.

## Decisions

- "Custom" is a custom number of days (the form's date input is the per-quote override, so a custom default duration is the natural reading).
- Added a "No default" option so the feature is reversible and matches today's behavior (no auto-expiration); the operator's list did not include it but it would otherwise be a one-way door once set.
- 6 Months and 1 Year use real calendar math, not 180/365 days, which reads more naturally for an expiration date. The JS end-of-month rollover (e.g. Jan 31 + 1 month into early March) is documented and acceptable for a default.
- Stored in the settings store (`quotes/default_expiration`), not a new column, consistent with the default-currency feature and readable by every staff role.

## Verification

- Gates green: typecheck, lint (max-warnings 0), tests (the new `quoteExpiration` suite plus the existing tests), build (SPA index ~36.5 kB gz under the 40 kB budget), and bundle-budget.
- No render test covers the quote form (the repo runs Vitest without jsdom); the resolver and date math are covered by unit tests, and the seeding plus the Advanced placement by an operator click-through.

## Constitutional invariants

SPA presentation only. No schema, migration, RLS, money math, idempotency, `audit_log`, capability, or byte-mirror contract change. No new dependency.

## Follow-ups

- The same default could extend to other dated documents if wanted (invoice due-date already derives from customer payment terms, so it has its own default path).
- If the default should live on the `organizations` record rather than the settings store, that pairs with the same follow-up noted for the default currency.
