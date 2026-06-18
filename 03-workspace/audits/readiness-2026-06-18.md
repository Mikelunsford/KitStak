# Production Readiness Scorecard — 2026-06-18

Scope: `all` (whole repo) · Target: 90 · Budget: 3 fix iterations
Branch: `main` · HEAD: `f7f8cd2` · Migrations: 0001..0125 (0005, 0006 absent) · Edge bundles: 33

Driver: `/ship-ready all`. Rubric: `.claude/PRODUCTION-READINESS.md`. Constitution: `CLAUDE.md`. DoD: `DEFINITION-OF-DONE.md`.

---

## Total: 78.0 / 100 — BLOCKED (1 hard gate failing)

A failing hard gate caps the total at 89 and marks its category BLOCKED. The weighted total (78.0) is
already below the cap, so the practical effect is: **the repo is below the 90 target AND blocked by one
hard gate.** Production grade requires 90+, zero failing hard gates, zero open P0/P1.

### Per-category breakdown

| # | Category | Weight | Score | Status | Hard gates |
|---|----------|--------|-------|--------|------------|
| 1 | Tenancy and RLS isolation | 14 | 12.0 | PARTIAL | 2/2 PASS |
| 2 | Money integrity | 10 | 7.5 | PARTIAL | 2/2 PASS |
| 3 | Migrations and schema discipline | 10 | 7.0 | **BLOCKED** | **0/1 — numbering gap** |
| 4 | Data integrity engines | 12 | 10.0 | PARTIAL | 2/2 PASS |
| 5 | AuthZ, capabilities, security depth | 12 | 11.0 | PARTIAL | 1/1 PASS |
| 6 | Contract, parity, type safety | 8 | 7.0 | PARTIAL | 1/1 PASS |
| 7 | Test coverage and DoD gates | 10 | 7.0 | PARTIAL | n/a |
| 8 | Performance, bundle, query health | 8 | 7.0 | PARTIAL | 1/1 PASS |
| 9 | Observability and operations | 8 | 5.0 | PARTIAL | n/a |
| 10 | Constitution and branding | 4 | 3.0 | PARTIAL | 1/1 PASS |
| 11 | Documentation and DX | 4 | 1.5 | PARTIAL | n/a |
| | **TOTAL** | **100** | **78.0** | **BLOCKED** | **8/9 hard gates pass** |

Cat 5 scored 11/12 (auditor returned 10/12 pending a live `get_advisors` run; the orchestrator ran it
live against prod `zmnvwhqjahwidprnjxrq` — only the documented deliberate exceptions are present, so the
advisor sub-check is PASS). See advisor note below.

### DoD automated gates (run live this session by the auditors)

| Gate | Result |
|------|--------|
| `pnpm lint` | GREEN (0 warnings, banned-import rule fires) |
| `pnpm typecheck` | GREEN (0 errors, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes) |
| `pnpm test` | GREEN (1768 passing, 2 skipped, 190 files) |
| `pnpm test:contract` | GREEN (28 passing — all byte-identical pairs verified) |
| `pnpm build` + `pnpm bundle-budget` | GREEN (index 37.13 kB gzip < 40 kB; all 9 budget lines pass) |
| `pnpm test:rls` | NOT RUN — skip-when-unconfigured (staging secrets absent) AND excluded from PR CI |
| `pnpm test:e2e` | NOT RUN — skip-when-unconfigured; axe-core installed but never invoked |
| `supabase db reset` | NOT RUN — no local Docker stack; DDL idempotency verified by file inspection |

### Live security advisors (prod `zmnvwhqjahwidprnjxrq`)

4 lints, no new release-blocker:
- `current_org_id()` / `current_user_role()` SECURITY DEFINER callable by authenticated — WARN, the two
  documented deliberate exceptions (they back the RLS policies).
- `stripe_webhook_events` RLS-enabled-no-policy — INFO, deny-all is intentional (service-role-only table).
- `citext` extension in public — WARN, longstanding.

---

## The one failing hard gate

**Category 3 / `F-Wave6-MIG-01` — numbering gap at 0005 and 0006.** Slots 0005 and 0006 never existed in
git history (chain runs 0001..0004, 0007..0125). The rubric hard gate reads "Numbering is gapless four
digit," which this violates on its face. Open and documented since 2026-05-18 (drift audit), re-confirmed
2026-05-23, never closed.

Important nuance for the operator decision: the **constitution itself** (`CLAUDE.md`, Migration rules)
requires "Files numbered `NNNN_snake_case.sql`, four-digit zero-padded" and forward-only. It does NOT say
"gapless" — that word is the rubric's stricter gloss. By the constitution's actual text, all 123 files
are four-digit zero-padded and the forward-only content property is intact (each file has exactly one
introducing commit; no applied migration was edited). The chain applies clean on every `supabase db reset`
because Postgres/Supabase do not enforce consecutive numbering. The gap is a cosmetic artifact with zero
tenant-data, money, or auth risk.

Resolution options (operator decision — both are stop-and-ask territory):
- (a) Ratify the gap as a documented accepted exception (one-line note in `CLAUDE.md` + close
  `F-Wave6-MIG-01`). Lowest risk; aligns the rubric to the constitution's actual rule. Recommended.
- (b) Backfill no-op placeholder migrations `0005`/`0006`. This inserts "new" migrations that apply after
  0125 on existing DBs, which is itself awkward under forward-only and adds noise. Not recommended.

---

## Prioritized fix queue

### STOP-AND-ASK (operator decision required before any change)

1. `F-Wave6-MIG-01` numbering gap — the only hard gate. Pick (a) ratify or (b) backfill. Recommend (a).
2. `R-W14-MONEY-02` SQL `round()` half-up in 6 migrations — fix is a forward migration touching money math. Stop-and-ask per constitution.
3. `R-W14-MONEY-01` project line tax-rate not snapshotted — forward migration (schema/money). Stop-and-ask.
4. `R-W14-CAT4-CREATED-AUDIT-01` incomplete created-event audit triggers — forward migration touching audit_log. Stop-and-ask.

### P1 (safe, non-schema — fix this iteration)

5. `R-W14-TEST-01` wire `pnpm test:rls` + `pnpm test:e2e` into PR CI. Effort S.
6. `R-W14-TEST-02` invoke `@axe-core/playwright` in the smoke spec (installed, never called). Effort S.
7. `R-W14-OBS-03` author `docs/operations/deploy.md` + `incidents.md` (deploy/rollback/top incident classes). Effort M.

### P2 (safe, non-schema — ranked by points recoverable / inverse effort)

8. `R-W14-DOCS-05` README: add DB setup (`supabase db reset`), fix stale 0117→0125 / 31→33 bundle counts, point at `apps/web/.env.example`. S.
9. `R-W14-DOCS-02` fix false "on the roadmap" branding-upload claim in `docs/users/identity.md`; add upload-url endpoint to `docs/api/identity.md`. S.
10. `R-W14-DOCS-03` write WMS Body B closeout journal. S.
11. `R-W14-DOCS-01` author docs for manufacturing / copack / kitforce / kitcost add-ons. M.
12. `R-W14-RLS-PROBE-GAP-01` add 9 missing tables (0089–0110) to the nightly RLS probe matrix + fix the runbook claim. S.
13. `R-W14-OBS-01` / `R-W14-CAT4-GC-SECRET-01` / `R-W14-OBS-02` make nightly probe + GC + chain-verify jobs fail (not silent-green) on missing secrets, and add an external alert channel. S.
14. `R-W14-SEC-CAT5-01` add lint rule forbidding direct `req.json()` outside `handler-helpers.ts`. S.
15. `R-W14-TEST-03/04/05` add FSM transition tests: period-close, organization, three-pl supply_plan/job_run/billing_review. S–M.
16. `R-W14-TEST-06` un-skip the quote-to-cash smoke chain (`F-Wave5-TEST-02-CHAIN-01`) using the rls-probe fixture bootstrap. M.
17. `R-W14-PERF-01` set `LIGHTHOUSE_ENABLED=true` repo var (operator). S.

### P3 (polish — schedule, do not block)

- `R-W14-BRAND-01` `KITSTAK` all-caps → `Kitstak` in `Logo.tsx`, `FirstSigninWelcomeBanner.tsx` (renders identically in Bebas Neue).
- `R-W14-BRAND-02` remove `TS1` codename from `docs/api/sales.md`.
- `R-W14-CONTRACT-01` behavioral parity test for `CAPABILITIES_BY_ROLE`.
- `R-W14-MONEY-03` KitCost display average → `roundHalfEven`.
- `R-W-MIG-HEADER-01` reformat 4 non-canonical migration headers (read-only artifacts; ADR or accept).
- `R-W14-PERF-02/03/04` index-chunk headroom, KitCost chunk headroom, `CREATE INDEX CONCURRENTLY` (filed).

---

## Path to 90

The weighted gap is +12.0 from 78.0. The largest safe (non-schema) recoverable chunks:
- Docs (Cat 11): 1.5 → ~3.5 (+2.0) via items 8–11.
- Observability (Cat 9): 5.0 → ~7.0 (+2.0) via runbook (item 7) + probe alerting (item 13).
- Tests (Cat 7): 7.0 → ~9.0 (+2.0) via CI wiring + axe (items 5, 6) + FSM tests (item 15).
- RLS (Cat 1): 12.0 → ~13.5 (+1.5) via probe matrix (item 12).
- Security (Cat 5): 11.0 → ~12.0 (+1.0) via Zod lint rule (item 14).
- Contract (Cat 6): 7.0 → 8.0 (+1.0) via capabilities behavioral test.
- Money (Cat 2): 7.5 → 9.5 (+2.0) — but requires migrations (stop-and-ask items 2, 3).

Safe non-schema work alone gets to roughly 87–88. Crossing 90 cleanly also needs the money-SQL rounding
fix (items 2–3, operator-gated migrations). And regardless of weighted total, the Category 3 hard gate
(item 1) must be resolved for the repo to leave BLOCKED status.
