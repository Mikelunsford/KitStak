# 2026-05-18 Drift Audit — PM Architect

**Status: YELLOW**

The Kitstak codebase tracks the constitution closely. Six of eight invariants are GREEN, two are YELLOW. Nothing on this slice is dispatch-blocking RED. The chassis is solid: money helpers byte-mirror with a behaviour test, RLS on every table, idempotency + capability checks live on every sampled non-GET handler, audit_log is append-only with a hash chain and a nightly verifier, and brand tokens match canon. The two YELLOWS are (a) capability-string shape drift in two domains, and (b) `bigintReplacer` defined but never wired to a serializer. A third minor observation is a numbering gap at 0005-0006 in the migration sequence (forward-only is not technically violated, but the four-digit sequence has holes the constitution does not contemplate).

---

## 1. Money rules — GREEN

- BIGINT cents with `_cents` suffix is the column pattern. Forty-plus declarations across 10 migrations (`supabase/migrations/0014_sales_quotes.sql`, `0018_invoicing_invoices.sql`, `0019_invoicing_payments.sql`, `0020_invoicing_credit_notes.sql`, `0022_finance_journal_entries.sql`, `0027_vendors_vendor_bills.sql`, `0028_vendors_expenses.sql` and others) follow the shape `<name>_cents bigint not null default 0`.
- The only non-bigint numeric columns in the migration set are quantity (`quantity_ordered numeric(18,4)` etc.) and tax rates (`tax_rate_snapshot numeric(7,4)` — `supabase/migrations/0018_invoicing_invoices.sql:104`). Neither stores money.
- `supabase/functions/_shared/money.ts` (lines 1-35) is byte-identical to `apps/web/src/lib/money.ts` (lines 1-35). Verified via the parity reader; both files export `ZERO_DECIMAL_CURRENCIES`, `roundHalfEven`, `formatCents`, `bigintReplacer`.
- Banker's rounding is implemented at `supabase/functions/_shared/money.ts:9-15`. The half-even branch (`floor % 2 === 0 ? floor : floor + 1`) is correct.
- `apps/web/test/contract/money.parity.test.ts:1-43` exercises `roundHalfEven` on the full set of half-integer cases plus `formatCents` across USD/JPY/KRW; the test runs under `pnpm --filter web test:contract`.
- `apps/web/test/contract/parity.test.ts:30-35` (under SINGULAR_PAIRS) asserts byte-identity of the money pair as a separate gate.
- CI wires both: `.github/workflows/ci.yml:25-26` calls `pnpm --filter web test` (catches the money parity test) and `pnpm --filter web test:contract` (catches the byte parity test).

## 2. RLS rules — GREEN

- Every tenant-scoped table has RLS enabled at creation. Cross-check: `create table` count and `enable row level security` count both equal 66 across the migration set.
- Pattern catalog is documented in `00-canon/01-architecture.md:110-138`. Pattern A (single-table `org_id = current_org_id()` plus role), Pattern B (parent-join), Pattern C (global `USING (true)`) are all named.
- Foundation tables ship with RLS from 0001: `organizations` (`supabase/migrations/0001_foundation.sql:91-101`), `idempotency_keys` (line 319-324, scoped by both `org_id` and `user_id`), `audit_log` (line 352-357, select-only for authenticated).
- Cross-tenant 404 enforcement is explicit. The most recent hotfix `supabase/migrations/0041_fix_convert_quote_to_project_cross_tenant.sql:1-30` documents a real bug found in 0016 (service-role bypass made the `<>` comparison NULL-NULL-true, returning 409 instead of 404) and corrects it forward, exactly the multi-stage discipline the constitution mandates.
- Per-route feature flag posture is correct at `supabase/functions/_shared/requireFlag.ts:32-45`: `403 FEATURE_DISABLED` with `details.flag`.
- Nightly RLS probe is scheduled at `.github/workflows/nightly-rls-probe.yml`, cron `0 9 * * *`. It does skip if staging secrets are unset (line 37-42); this is documented as deliberate so the gate is not falsely green from silence. Recommendation: configure staging secrets so the probe actually runs (handoff to Security Reviewer).

## 3. Migration rules — YELLOW

- Naming: every present file is `NNNN_snake_case.sql` four-digit zero-padded. **However, slots 0005 and 0006 are missing from the sequence** with no git history of having ever existed (`git log --all --name-status` returns nothing for those numbers). Forward-only is not technically violated, but the four-digit sequence has holes. The constitution prescribes ordered application; a missing slot can confuse a fresh `supabase db push` if any tool ever reasons about contiguity.
- Forward-only: spot-checked 0001, 0002, 0003, 0007, 0011, 0041 via git log. Each file has exactly one or two commits (the second is a merge), no post-apply modifications. The hotfix discipline (0003 fixing 0002's search path, 0041 fixing 0016's cross-tenant guard) shows the team writing new forward migrations rather than editing applied ones.
- Idempotent DDL: every migration uses `create table if not exists`, `drop policy if exists`, `if exists`/`if not exists` consistently. Sampled 0001, 0002, 0037, 0041.
- Header discipline: `0001_foundation.sql:1-15`, `0002_identity_branding_provisioning.sql:1-26`, `0037_audit_state_triggers_all_14.sql:1-46`, `0041_fix_convert_quote_to_project_cross_tenant.sql:1-25` all declare Wave, Phase, Closes, Date, DOWN MIGRATION posture, and Constitutional alignment block. Consistent across the 4 sampled migrations.

**Remediation**: open `F-Wave6-MIG-01`. Either (a) document why 0005-0006 were reserved and never filled, in a short ADR; or (b) write two no-op forward migrations to claim the slots and explain. Adding language to the constitution that explicitly allows numeric gaps would also resolve it.

## 4. Zod canon — GREEN

- `apps/web/src/lib/types.ts` and `supabase/functions/_shared/types.ts` are byte-mirrored, asserted at `apps/web/test/contract/parity.test.ts:14-19` (SINGULAR_PAIRS entry `types`).
- Side-cars are also byte-mirrored: `apps/web/test/contract/parity.test.ts:39-56` (DOMAINS × SIDE_CAR_KINDS = 6 domains × 3 kinds = 18 side-car pairs covered). Domain set is `identity, crm, sales, finance, vendors_inventory_ops, cross_cutting`.
- CI: `.github/workflows/ci.yml:26` runs `pnpm --filter web test:contract`. The contract test is wired to the main CI workflow on push and pull_request.
- Filesystem check: `apps/web/src/lib/types/` and `supabase/functions/_shared/types/` both contain six side-car files (`crm.ts`, `cross_cutting.ts`, `finance.ts`, `identity.ts`, `sales.ts`, `vendors_inventory_ops.ts`). No drift in directory contents.

## 5. Idempotency — GREEN

- `idempotency_keys` table exists in `supabase/migrations/0001_foundation.sql:304-314` with PK `(key, user_id, org_id, route_hash)` per the constitution exactly.
- The helper `supabase/functions/_shared/idempotency.ts:115-133` enforces UUID v4 via `UUID_V4_RE` and throws `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_INVALID_KEY`.
- RFC 8785 canonical JSON body hashing: `supabase/functions/_shared/idempotency.ts:83-101` (sorted keys, no whitespace, recursive). SHA-256 via `crypto.subtle.digest` at lines 71-77.
- 409 IDEMPOTENCY_CONFLICT on body-hash mismatch: line 242-248.
- 24h replay window: line 55 (`REPLAY_WINDOW_MS`).
- Nightly GC: `supabase/functions/idempotency-gc/index.ts:10` (`RETENTION_DAYS = 7`); cron `30 8 * * *` in `.github/workflows/idempotency-gc.yml:5-6`; gated by `GC_TRIGGER_SECRET` bearer token.
- Sampled non-GET handlers: `invoicing-api/handlers/invoices.ts` (createInvoice line 154-193, patchInvoice 195+ — both wrapped), `crm-api/handlers/customers.ts:143/178/221`, `invoicing-api/handlers/payments.ts:135/180/213/242`, `quotes-api/index.ts:70/94/113/160/224/252/290/313/384/406`. Pattern is: `requireCap → parseBody → respondWithIdempotency(req, caller, BUNDLE, route, body, handler)`.

## 6. Audit log — GREEN

- `audit_log` table at `supabase/migrations/0001_foundation.sql:332-347` with `prev_hash` and `payload_hash` columns from migration zero, exactly as the constitution requires.
- Append-only via RLS by omission: only a SELECT policy exists (line 354-357). No INSERT, UPDATE, or DELETE policies for `authenticated`, which under RLS denies those operations. Comment at line 359 makes this explicit: "No INSERT, UPDATE, DELETE policy for authenticated. Service-role writes only." Verified via `Grep` over all migrations for any subsequent `audit_log` policy: only the original `audit_log_select` exists; no later migration ever added a write policy.
- Hash chain active: 11 migrations reference `prev_hash` / `payload_hash` (foundation through 0037). The chain is consumed by `supabase/functions/audit-chain-verify` and verified nightly by `.github/workflows/audit-chain-verify.yml` (cron `0 9 * * *`); broken count != 0 fails the workflow (line 25-28).
- Auto-state-transition triggers: `supabase/migrations/0037_audit_state_triggers_all_14.sql:19-30` documents all 15 state machines (organizations.status from Wave 1; 14 from Wave 2: lead.status, opportunity.stage, quote.status, project.status, project_phase.status, invoice.status, credit_note.status, journal_entry.status, purchase_order.status, vendor_bill.status, expense.status, receiving_order.status, production_run.status, shipment.status). Each is the single writer; no best-effort handler writes.

## 7. Capabilities — YELLOW

- Eight roles defined at `supabase/functions/_shared/capabilities.ts:5-13` and seeded in `supabase/migrations/0001_foundation.sql:365-375`: org_owner, org_admin, sales, ops, accounting, viewer, customer_user, vendor_user. Matches the constitution exactly.
- Capability side-car files exist for all six domains in `supabase/functions/_shared/capabilities/` and mirrored at `apps/web/src/lib/capabilities/`.
- `requireCap(caller, cap)` is defined at `supabase/functions/_shared/handler-helpers.ts:212-219` and called on every state-changing handler sampled: see grep counts above. Throws `FORBIDDEN 403` if denied. Server is authority; SPA mirrors for button hiding only.
- **Capability shape drift**: the constitution mandates `<domain>.<resource>.<action>`. CRM and identity follow this (`crm.customers.read`, `org.member.invite`). **Finance does not**: `supabase/functions/_shared/capabilities/finance.ts:17-40` ships 2-part names (`invoices.read`, `invoices.write`, `payments.read`, `coa.read`, `journal_entries.post`, `period_close.close`). **Sales is mixed**: most caps are 3-part (`quotes.quote.read`, `items.item.read`, `taxes.tax.read`) but a handful collapse to 2-part action verbs (`quotes.send`, `quotes.accept`, `quotes.convert_to_project` at lines 53-55) — these read as action-on-quote without the resource middle. Same handlers consume both: `supabase/functions/quotes-api/index.ts:288-313`.

**Remediation**: open `F-Wave6-CAP-01`. Either (a) rename finance caps to `finance.<resource>.<action>` and sales action caps to `quotes.quote.send` / `.accept` / `.convert_to_project` in a single forward PR, mirrored across SPA + shared, with parity test re-run; or (b) amend the constitution via R-01 to allow a 2-part `<resource>.<action>` shape where the resource and domain are the same word. Option (b) is cheaper but bends the rule.

## 8. Branding rules — GREEN

- Em dashes in user-facing copy: zero. Grep over `apps/web/src/**/*.tsx` for U+2014 returns no files.
- Double hyphens in user-facing copy: only CSS variable identifiers (`--brand`, `--accent`, `--ink`, `--font-sans` in `apps/web/src/whitelabel/BrandingProvider.tsx:57-73`). No prose double-hyphens.
- Emojis: zero in `apps/web/src/**/*.tsx`. Grep over emoji Unicode blocks returns no files.
- Brand colors: `apps/web/src/styles.css:61-71` defines `--bg: 10 22 40` (= #0a1628 navy), `--ink: 245 241 232` (= #f5f1e8 ink), `--accent: 200 16 46` (= #c8102e). Inline comments document the hex. `apps/web/tailwind.config.js:30-31` mirrors with `danger: '#c8102e'`.
- Fonts: `apps/web/tailwind.config.js:34-38` declares `display: ['Bebas Neue', ...]`, `sans: [..., 'Inter Tight', ...]`, `mono: ['JetBrains Mono', ...]`. Matches canon.
- Pillar names use the constitutional ordering. Spot-check sidebar journals (`03-workspace/journal/wave-6-customer-zero.md`).

---

## Summary table

| # | Invariant | Status |
|---|-----------|--------|
| 1 | Money rules | GREEN |
| 2 | RLS rules | GREEN |
| 3 | Migration rules | YELLOW (numbering gap 0005-0006) |
| 4 | Zod canon | GREEN |
| 5 | Idempotency | GREEN |
| 6 | Audit log | GREEN |
| 7 | Capabilities | YELLOW (shape drift: finance 2-part, sales mixed) |
| 8 | Branding rules | GREEN |

## Carries / follow-ups proposed

- `F-Wave6-MIG-01`: explain or fill the 0005-0006 numbering gap (or amend constitution to allow gaps).
- `F-Wave6-CAP-01`: rename finance + sales action caps to 3-part `<domain>.<resource>.<action>`, or amend constitution via R-01 to permit `<resource>.<action>` where domain == resource. Mirror, then re-run `pnpm test:contract`.
- `F-Wave6-WIRE-01` (advisory, not blocking): `bigintReplacer` is defined in both money files but no call site uses it. Today money fits in JS safe-integer range and the parity tests pass, so nothing breaks; but the constitution names it as the wire serializer. Either wire it into `apps/web/src/lib/apiClient.ts:79` (`JSON.stringify(options.body, bigintReplacer)`) and the edge-side response builders, or remove it from the constitution as YAGNI.
- Operational: configure staging secrets so the nightly RLS probe (`.github/workflows/nightly-rls-probe.yml`) actually runs instead of skipping. Hand off to Security Reviewer slice.

No dispatch-blocking RED on this slice.
