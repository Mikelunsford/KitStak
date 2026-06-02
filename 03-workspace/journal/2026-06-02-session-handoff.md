# Session handoff: 2026-06-02 (Customer 0, identity fixes, UI kit overhaul)

Branch state at handoff: `main` clean and synced to origin, single branch, single
worktree, working tree clean. Latest commit `fe94642`.

## What shipped this session

Seven PRs merged to prod, plus one prod provisioning action and one prod data
backfill.

### Identity and onboarding

1. **Customer 0 provisioned** (no PR; direct service-role call on prod
   `zmnvwhqjahwidprnjxrq`). Org "Team 1 Supplier Services",
   id `4e234c7d-4a1e-4764-9a4e-c275586c803e`, slug `team-1-supplier-services`,
   status active. Owner `mike@team-01.com`
   (`ce7c0eaf-bda3-407e-ad69-1f9223db47e4`), org_owner, claim stamped (the
   account carried no prior org claim, so this was additive). Full seed verified:
   branding, 10 feature flags, 17 numbering sequences, 13 chart_of_accounts rows,
   1 default warehouse. 3PL Pillar 1 flags lit: `plugins.three_pl`,
   `feature.collaboration`, `feature.global_search`, `feature.imports`,
   `feature.exports`. Profile display name set to "Team 1 Supplier Services".
   Roster: mike (org_owner), chris.harrison@team-01.com (sales),
   accounts@team-01.com (ops).

2. **PR #210** F-Wave10-MEMBERS-UNCLAIMED-VISIBILITY-01. Invited staff did not
   appear on /admin/members because `GET /auth-api/members` dropped any member
   without a `public.profiles` row, and the invite flow never creates one.
   Fix: fall back to the auth.users email already fetched per member, so
   unclaimed members render with `claimed: false`. Chris and accounts@ were also
   backfilled with profiles rows on prod out-of-band for immediate visibility.

3. **PR #211** docs: re-homed an orphaned closeout journal that had been
   committed to local main last session but never pushed (it was stranded when
   #210 squash-merged onto the true origin tip).

4. **PR #212** F-Wave10-WELCOME-PASSWORD-SERVER-GATE-01. The "Welcome to Kitstak
   / set a password" prompt re-fired for users who already had a password,
   because it was gated only on a per-browser localStorage flag. Fix: migration
   0088 adds a read-only `user_has_password(uuid)` helper (service_role only,
   returns a boolean, never the hash); getMe returns `MeResponse.password_set`;
   DashboardPage only redirects when `password_set === false`. getMe defaults the
   flag to true on lookup error so it can never break the dashboard. Applied to
   prod and staging; auth-api redeployed. Verified the function returns true for
   all three team-01 accounts.

### UI overhaul

5. **docs/design/ui-wireframes.md** (shipped inside PR #213). Source-verified
   end-to-end wireframes of the whole app (shell, sitemap, every page archetype,
   admin, auth, portal, quote-to-cash journey), a gap analysis, and the proposed
   "after" overhaul direction. Read this first before continuing the overhaul.

6. **PR #213** the shared UI kit plus the Quotes list migration. Kit in
   `apps/web/src/components/ui/`: StatusBadge (promoted from the portal, which
   now re-exports it), PageHeader, DataTable, Pagination, Select, FilterBar.

7. **PR #214** DetailLayout primitive plus the Quote detail and create
   migration. Every FSM transition, PDF gating, send-feedback, and
   destructive-confirm preserved verbatim (JSX reorg plus table swap, not a
   logic change).

8. **PR #215** F-Wave10-MEMBERS-LIST-TEST-ISOLATION-01. The audit superset guard
   test wrote a synthetic 9990 migration into the real `supabase/migrations` dir
   and the parallel db-0083 test's readdirSync intermittently picked it up. Fix:
   the script takes an `AUDIT_MIGRATIONS_DIR` override and the test runs against
   an OS-temp copy. Verified with four consecutive clean full-regression runs.
   The regression suite is now genuinely flake-free.

9. **PR #216** Customers vertical onto the kit. List full kit; detail gets
   PageHeader plus StatusBadge plus formatCents (fixed the raw `amount_cents`
   display in the PAYMENTS section); create and edit get PageHeader. Customer
   statuses (new / active / inactive) added to StatusBadge. The customer detail
   stays single-column on purpose: it is a relationship hub with six related
   sections, not an FSM detail.

## Open verification items (operator-side, not blockers)

- Sign out and back in as `mike@team-01.com` to mint a JWT carrying the new
  Team 1 Supplier Services org claim. Until then the live session has no claim.
- Have chris.harrison@ and accounts@ sign in to claim their accounts and set
  display names; their `claimed` flag flips to true and the Resend button drops.
- Manual click-through of the Quote detail page on prod after PR #214: try a
  state transition, add a line item, the Send and Download PDF buttons. The repo
  has no render-test harness, so the detail reorg was merged on typecheck plus
  build plus unchanged logic, not an automated click test.

## Next session: continue the UI overhaul

State: 2 of ~14 verticals migrated (Quotes, Customers). The pattern is proven.

Proven migration recipe (per vertical):
1. List: PageHeader + FilterBar (search and/or Select, with active-filter chips)
   + DataTable + StatusBadge + Pagination. Money via formatCents, right-aligned
   mono. Preserve any existing deep-link filter.
2. Detail: PageHeader for the header. FSM detail pages use DetailLayout
   (main = work surface, rail = status/facts/history). Relationship-hub details
   stay single-column. Swap raw status text to StatusBadge and raw cents to
   formatCents.
3. Create and edit: PageHeader for the header at minimum.
4. Tests: kit components are tested via pure helpers and element-tree walks (no
   jsdom in this repo). Page logic is covered by the page's existing pure-helper
   tests, which should stay green.
5. Gates per PR: typecheck, lint, `pnpm --filter web test`, build, bundle budget.

Recommended next vertical: Invoices (GET PAID core, carries the raw-status-text
pattern). Then Items, Vendors, Payments, and the rest.

Standalone follow-ups (not per-vertical):
- Form-field primitives so create/edit forms stop hand-rolling raw inputs.
- DataTable column sort (F-Wave10-UI-KIT-DATATABLE-SORT-01).
- Server-side pagination once DataTable adoption is wide
  (F-WS7-SERVER-PAGINATION). Today lists fetch all rows and slice client-side.
- Normalize the remaining 3xl-sentence-case admin headings to the kit scale.

## Carried from earlier (pre-UI-overhaul, still open)

From the full-DoD plan: audit_log historical residue disposition (2 of 3 prod
orgs have irreducible pre-0085 same-txn branches), Lighthouse Vercel bypass
secret, fresh-org E2E re-smoke, Stripe live checkout round-trip, 30-day green
streaks. See the kitstak-full-dod-plan memory.

## Pointers

- Design spec: `docs/design/ui-wireframes.md`.
- Memory: ui-kit-overhaul, customer-zero-team1-provisioned, and the standing
  session-start sync-check note.
