# 2026-05-25 — Provision Organization Completeness (Migration 0064)

Status: shipped via PR (pending).
Branch: `feat/0064-provision-org-completeness`
Closes: `F-Wave9-PROVISION-NUMBERING-SEED-01`, `F-Wave9-PROVISION-COA-SEED-01`, `F-Wave9-PROVISION-WAREHOUSE-SEED-01`, `F-Wave9-SEED-ORG-SETTINGS-SILENT-FAIL-01`.

## Why this work

A four-slice audit run earlier this session (DB provisioning + auth/membership + SPA first-run surface + workflow dependency derivation) surfaced that `provision_organization` was incomplete in three concrete ways and silently broken in a fourth:

1. **`seed_org_numbering` not called** — every org provisioned via the canonical RPC ships without the 11 (or 10 on staging) doc-type sequences. `next_doc_number(...)` auto-heals on first call but loses the configured prefix, pad_width, and reset_period.
2. **`seed_org_chart_of_accounts` not called** — new orgs ship with zero COA rows. Any COA-gated finance feature fails open until an operator manually runs the seed.
3. **`seed_org_default_warehouse` not called** — new orgs ship with no warehouse. HARD blocker for receiving orders, shipments, and manufacturing runs which all require `warehouse_id`.
4. **`seed_org_settings` `org_settings` branch silently failed** — the function tried `insert into org_settings (org_id) values (...)` against a table with a `(org_id, group_key, setting_key)` PK and NOT NULL on all three. The error was eaten by `when others then null`.

All four seed functions existed and were correct in isolation. They simply were never wired into `provision_organization`. Migration 0043 wired in `seed_org_settings` only; the other three were left orphaned.

## What shipped

Single migration: `supabase/migrations/0064_provision_organization_completeness.sql`.

### Function changes

- `seed_org_settings` — `CREATE OR REPLACE` removing the broken `org_settings` insert branch. Feature-flag seeding portion (the function's primary purpose) is unchanged. Updated `COMMENT ON FUNCTION` to reflect the actual scope.
- `provision_organization` — `CREATE OR REPLACE` adding three new `PERFORM` calls in dependency order after the existing `seed_org_settings` call: `seed_org_numbering`, `seed_org_chart_of_accounts`, `seed_org_default_warehouse`. Signature `(text, text, uuid, text)` matches 0002 / 0043 verbatim; no overload created, no GRANT changes needed.

### Backfill

`DO $$ ... $$;` block iterates every existing organization and calls all four seed functions. Idempotent via `ON CONFLICT DO NOTHING` inside each seed function. Safe to re-run.

## Constitutional invariants verified

| Invariant | Outcome |
|---|---|
| Money rules | Untouched. No `_cents` columns added or modified. |
| RLS rules | Untouched. Seed functions are SECURITY DEFINER + `service_role`-only. Seeded rows inherit Pattern A from their parent tables. |
| Audit rules | `trg_audit_organizations_status` still fires on the org-status UPDATE. The three new PERFORM calls write metadata rows that do not carry audit triggers. Audit chain unbroken. |
| Migration rules | Forward-only. All DDL idempotent. Down migration is operator-only and documented in the header. |
| Idempotency | Verified on staging: re-running the backfill produced zero new inserts on a second call against the same orgs. |
| Zod canon | No schema-touching changes; byte-mirror parity test unaffected. |

## Verification on staging (`dnkgaufydcnedgkuoyml`)

### Pre-state

```
orgs:              4
warehouses:        0
chart_of_accounts: 0
numbering_sequences: 0
org_feature_flags: 8   (incomplete from pre-canon era)
```

### Post-migration (backfill landed)

```
orgs:              4
warehouses:        4    (1 per org via seed_org_default_warehouse)
chart_of_accounts: 52   (13 per org)
numbering_sequences: 40 (10 per org; staging is missing 0054 so the 11th
                         doc_type 'manufacturing_run' is correctly absent)
org_feature_flags: 48   (12 per org; the 10 canonical + 2 pre-existing
                         non-canonical flags that pre-date the 0040 canon)
```

### End-to-end provision test

```sql
select public.provision_organization(
  'test_0064_verify_provision',
  'Test 0064 Verify Provision',
  '5cd57c0d-506f-4b0f-a225-1ee7f4313dfb'::uuid,
  'rls.probe.a.20260518_14b7co@kitstak.local'
);
-- Returns: 72f8088a-9c73-43dd-9247-66759639e774

-- Verify:
status:       active
warehouses:   1
coa:          13
numbering:    10   (would be 11 on prod where 0054 is applied)
flags:        10
memberships:  1
branding:     1
```

Cleanup: `delete from organizations where slug = 'test_0064_verify_provision'` cascaded to all child rows. Staging back to 4 orgs.

## Surprises and notes

- **Staging is behind prod by at least one migration.** Staging's `seed_org_numbering` has 10 doc types; prod has 11 (per 0054 which adds `manufacturing_run`). Migration 0064 is correct on both because it does not redefine `seed_org_numbering` — it calls whatever's installed. When staging catches up on 0054, the next provision will pick up the 11th doc type automatically. Worth flagging this drift for a future staging-sync follow-up.
- **The 2 extra historical flags on existing orgs are not touched.** Some staging orgs carry 12 feature flags instead of the canonical 10. These pre-date the 0040 canon and the backfill is purely additive (`ON CONFLICT DO NOTHING`), so the existing extras stay put. No regression.
- **No code-side changes.** This is a pure SQL migration. The SPA never directly calls `provision_organization` (it's `service_role`-only, called via operator tooling or future signup flow). No SPA tests or types need updating.

## Out of scope (filed as follow-ups)

| Follow-up | Why deferred |
|---|---|
| `F-Wave9-PROVISION-TIER-FLAGS-01` | Tier-aware feature flag defaults based on `plan_code`. Today all flags seed as `false` regardless. Operator can flip per-org manually; the tier-defaults layer in `_shared/feature-defaults.ts` exists but is unwired. |
| `F-Wave9-PROVISION-TAX-SEED-01` | Operator chose to skip tax seeding. Quote / invoice forms use free-text `tax_id` inputs (not enforced pickers), verified pre-merge to render gracefully on an empty `taxes` table. |
| `F-Wave9-STAFF-INVITE-CHASSIS-01` | No staff invite handler exists. `org.member.invite` capability declared in `capabilities.ts` but no Edge Function route, no `create_staff_membership` RPC, no `/admin/members` page. The dashboard "Invite a teammate" card is currently a dead-end link to `/admin/settings`. |
| `F-Wave9-SELF-SERVE-SIGNUP-01` | No `SignupPage` / `/signup` route / `auth.signUp` call anywhere. No Edge Function wrapping `provision_organization`. Parked behind the Stripe milestone — no commerce loop yet, so self-serve signup would just be a free invite-anyone surface. |
| `F-Wave9-STAGING-MIGRATION-DRIFT-01` | Staging is at least one migration behind prod (missing 0054). Filing as a follow-up to align before the next major change so staging probes test against the same surface as prod. |

## Process notes

- The pre-work audit fanned out across four code-explorer agents (DB, auth, SPA, workflow deps) in parallel + two Supabase MCP queries in parallel. Total wall time for the audit: ~12 minutes vs the 30-45 min that a sequential single-agent walk would have taken. Each agent had a tight slice and a hard "do not investigate X" boundary, which prevented the open-ended-audit thrash documented in the `parallel_audit_agents_thrash` memory.
- Operator chose Option B (provisioning fixes only, no UI) over Option A (UI polish on top of broken provisioning) and Option C (also build staff invite). Right call: the next layer (checklist UI) is correct only when it sits on top of a complete provisioning surface.
