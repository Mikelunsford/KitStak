# 2026-05-27 day closeout

**Scope**: 5 PRs merged, 2 migrations to prod, customer portal smoke-validated end-to-end, Cowork E2E plan drafted + executed, 2 memory entries added, 1 doc-only PR for this closeout.

## What shipped

| PR | Risk closed | Surface |
|---|---|---|
| [#154](https://github.com/Mikelunsford/KitStak/pull/154) | `F-Wave9-CANON-STEWARD-ROUTE-HINT-01` | `canon-steward-check.mjs` emits an allowlist hint on orphan-route violation; agents self-heal without re-push |
| [#155](https://github.com/Mikelunsford/KitStak/pull/155) | `F-Wave9-STAFF-INVITE-MEMBERS-LIST-01` | Real `GET /auth-api/members` endpoint + members list UI replacing the v1 stub |
| [#156](https://github.com/Mikelunsford/KitStak/pull/156) | `F-Wave9-INVITE-EMAIL-SUBJECT-COPY-01` + `F-Wave9-STAFF-INVITE-AUDIT-01` | Humane invite email subject/body + migration 0067 (org_membership in audit_log enum + INSERT trigger) |
| [#157](https://github.com/Mikelunsford/KitStak/pull/157) | `F-Wave9-STAFF-INVITE-PATCH-01` + `F-Wave9-STAFF-INVITE-RESEND-01` | Per-row role change + deactivate + resend on members admin; migration 0068 (audit trigger on UPDATE) |
| [#158](https://github.com/Mikelunsford/KitStak/pull/158) | 4-finding portal UX bundle | PortalTopbar, null-date placeholder, status humanizer, invoice + quote PDF download |

The staff invite + admin chassis closed end-to-end: invite → claim → password → list → role change → deactivate → resend, with audit chain coverage on INSERT and UPDATE.

The customer portal closed at v0.6: section nav, brand-aligned table treatments, PDF downloads on invoice + quote rows. Cross-tenant attack probes (`?org_id=` query param injection + cross-customer entity-id fetch) all returned the constitutional Pattern B answer (404 NOT_FOUND, never 403). Probe report at the bottom of `03-workspace/smoke-plans/2026-05-27-customer-portal-smoke.md`.

## Migrations shipped

- `0067_org_membership_audit.sql` — extends `audit_log_entity_type_check` to include `org_membership`, adds AFTER INSERT trigger on `org_memberships`, backfills 7 existing org_memberships rows on prod
- `0068_org_membership_update_audit.sql` — extends the audit trigger to fire on UPDATE (role change, deactivate). Hash chain integrity verified live on staging before prod apply.

## Process gotchas captured

### MCP apply_migration phantom version IDs

The agents for #156 and #157 used Supabase MCP `apply_migration` to push 0067 and 0068 to prod (to verify trigger behavior end-to-end before merging). MCP stamps timestamp-style version IDs (`20260526235238`, `20260527012938`) instead of canonical numeric file IDs. The post-merge `supabase db push` workflow saw phantom remote versions, errored, and turned the migrate workflow red.

Diagnosed + fixed via direct SQL rename on `supabase_migrations.schema_migrations` (UPDATE version=NNNN where version matches `^\d{14}$`). Then the same drift was discovered on staging going back to 0047 (10 phantom rows + 1 duplicate). Staging history cleaned too.

Recorded as a permanent process rule in memory: **agents apply migrations to STAGING only via MCP; let the post-merge workflow ship to prod via file-based push.** Memory entry at `memory/mcp_apply_migration_phantom_version.md`.

### Supabase preview branch architecture exposed

Investigation into staging migration drift surfaced that the project's "staging" environment is actually a Supabase preview branch (`dnkgaufydcnedgkuoyml` is the branch's project_ref under prod `zmnvwhqjahwidprnjxrq`). The constitution's D-009 reference describing staging as a preview branch was correct all along; my earlier read that it was a standalone project was wrong.

Two preview branches exist:
- `main` (default, tied to git `main`) → status `MIGRATIONS_FAILED` since 2026-05-18 (failed Wave 2 migration storm, never recovered). This is what causes the persistent "Supabase Preview - Failing after 3s" red check on every push to main.
- `Staging` (no git_branch tie) → status currently `MIGRATIONS_FAILED` after a reset attempt this session.

**Structural Supabase Branching limitation**: the API refuses to delete OR reset the default branch (`main`). Recovery requires disabling + re-enabling Branching at the project level. Documented for next session under a dedicated infra cleanup task.

## Cowork E2E smoke executed against prod

Drafted a 13-phase exhaustive org_owner E2E plan at `03-workspace/smoke-plans/2026-05-27-org-owner-e2e-cowork.md` and Claude Cowork ran it autonomously on a fresh prod test org. Surfaced 3 P1s, 3 P2s, 4 P3s in ~90 min. Full closeout at `03-workspace/journal/2026-05-26-cowork-e2e-smoke-closeout.md`.

### P1 findings (escalate next session)

- **`F-Wave9-COWORK-SMOKE-02`** — `provision_organization()` does NOT stamp `kitstak_org_id` + `kitstak_org_role` on the owner's `auth.users.raw_app_meta_data`. Fresh users land in NO_ACTIVE_ORG state; dashboard renders silently empty. Fix shape: mirror the claim-stamp pattern PR #150 added to the staff invite handler.
- **`F-Wave9-COWORK-SMOKE-05`** — entity creates (`customer.created`, `item.created`, `quote.created`, `project.created`, `invoice.created`) NOT in audit_log. Only state transitions + 1 line-item insert fire. Mirrors the deferred `F-Wave9-AUDIT-CREATED-SYMMETRY-01` from 2026-05-22. Constitutional violation of "auto-state-transition triggers on every entity with a state machine."
- **`F-Wave9-COWORK-SMOKE-06`** — plugin bundle gates partially wired. With `plugins.three_pl=false`, the entire `/3pl-operations/*` surface still works end-to-end. `/manufacturing/runs` is half-gated. Only `/kitcost/dashboard` honours the flag. Constitution says "Plugin bundle gates return 404."

### Punch list also in memory

Indexed at `memory/cowork_smoke_2026_05_26_punch_list.md` so it surfaces at next session start with all severities + reproductions + dispatch recommendations.

## Bundle posture

Main SPA index chunk: started day at ~30.40 kB gzipped, ended at **30.98 kB** gzipped (well under the 40 kB cap). +0.58 kB across 5 PRs. Per-page chunks land lazy with their pages.

## Constitutional invariants

All 5 PRs and 2 migrations preserved:
- Money in cents (untouched this session)
- RLS Pattern A (`org_id = current_org_id()`); Pattern B (portal 404 on cross-customer) verified by cross-tenant attack probes
- Forward-only migrations; both 0067 and 0068 idempotent
- Idempotency-Key required on new PATCH + RESEND endpoints
- Audit log hash chain integrity verified live on staging before prod apply
- Byte-mirror Zod parity asserted via `pnpm test:contract` (20/20 green)
- 8 roles preserved; 2 new caps added (`org.member.list`, `org.member.update`, `org.member.resend`)
- Brand discipline: no em-dashes, no double hyphens, no emojis on disk across all 5 PRs

## Memory entries added

- `memory/mcp_apply_migration_phantom_version.md` — full diagnosis + fix paths + the new rule
- `memory/cowork_smoke_2026_05_26_punch_list.md` — Cowork findings + recommended dispatch

Both indexed in `MEMORY.md` for session-start visibility.

## What lands first tomorrow

Per the Cowork punch list, three P1 dispatches in parallel (different surfaces, low file overlap):

1. **SMOKE-02** — extend `provision_organization` to stamp owner's auth metadata. New migration. Mirror PR #150's claim-stamp pattern.
2. **SMOKE-05** — extend audit triggers to fire on CREATE across all 14 state-machine entities. Migration-only.
3. **SMOKE-06** — wire plugin bundle gate enforcement on `/3pl-operations/*`. Handler-side cap-gate add + SPA route-guard add.

Plus one small doc PR for SMOKE-04 (Cowork plan signature/route/state drift) — ~15 min.

After those land, the natural strategic next move per the pillar wiring sequence memory is **Stripe scoping** (the third leg of Path B). Portal v0.6 is shipped + smoke-validated; the missing piece for revenue is payment collection.

## Sessions count

- Sessions today: 4 (morning open through evening close)
- Cumulative session count: 58
- Active phase: customer-zero
- Estimated pct complete: 60 (per Socials recap)
