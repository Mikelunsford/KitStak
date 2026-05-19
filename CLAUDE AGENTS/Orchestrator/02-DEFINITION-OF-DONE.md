# Definition of Done

## Project Configuration

Reads from `PROJECT.md`. Tailor each gate to your stack. Mark gates `n/a` if they don't apply (e.g., no RLS on a non-multi-tenant app).

Variables this doc reads:
- `{{TEST_STACK}}`, `{{CI_PROVIDER}}`, `{{FRONTEND_STACK}}`, `{{BACKEND_STACK}}`, `{{DATABASE}}`
- `{{BRANCH_PATTERN}}`, `{{COMMIT_STYLE}}`, `{{MONEY_RULE}}`, `{{TENANT_MODEL}}`

## Tailored Defaults

Edit per project:
- Coverage floor: `{{COVERAGE_FLOOR}}` (e.g., 70 percent)
- Performance budgets: `{{PERF_BUDGETS}}` (TTI, LCP, INP, bundle size)
- a11y target: `{{A11Y_TARGET}}` (e.g., WCAG 2.1 AA)

---

Done is observable. Done is gated. Done is in the journal. This document defines the cross-cutting Definition of Done (DoD), per-phase DoD pattern, the central gate definitions, and the phase-exit ceremony the Orchestrator runs.

## Cross-Cutting DoD (applies to every PR)

A PR is mergeable only when all of the following are true (skip any that are `n/a` for your project):

1. Branch named per `{{BRANCH_PATTERN}}`.
2. Commits follow `{{COMMIT_STYLE}}`.
3. Typecheck: clean (e.g., `tsc --noEmit`).
4. Lint: clean, no warnings introduced.
5. Format: clean (CI runs `--check`).
6. Unit tests: green, coverage not regressed below the phase floor.
7. Contract parity: every endpoint touched has a contract test that runs both FE and BE against the same fixture envelope.
8. Security policy probe: if any policy-relevant table or rule is touched, the probe matrix passes for the changed table.
9. Migration: if a migration is added, it applied cleanly to local and to a fresh ephemeral preview environment, generated types are updated, and a rollback note exists.
10. e2e smoke: if a user-facing path is touched, the relevant smoke test runs green against preview.
11. a11y: if UI is touched, axe checks green at `{{A11Y_TARGET}}` on the changed components.
12. Bundle: if a route bundle changes, it remains within the performance budget for that route.
13. Docs: relevant docs updated. The PR description lists docs touched.
14. Journal: a journal entry exists at `{{JOURNAL_DIR}}/<date>-<slug>.md` capturing assumptions, decisions, and any deferred work.
15. Code Reviewer: one approval from the Code Reviewer agent. Self-approval forbidden.
16. No banned dependencies. CI checks against the banned list in `{{SHARED_CONTEXT_PATH}}`.
17. No secret values. CI runs gitleaks or equivalent. Findings block merge.
18. Money math touched: parity tests across FE and BE money helpers pass; both sides use the rule defined in `{{MONEY_RULE}}`.
19. Idempotency: any write endpoint accepts an `Idempotency-Key` header (or documents why not) and has a test asserting replay safety.
20. Wire contract envelope: every endpoint returns the agreed envelope shape (define in `PROJECT.md`, e.g., `{ data, error, meta }`).

## Per-Phase DoD

Each phase has its own exit checklist on top of the cross-cutting list above. Define each phase's deliverables in your project's build-order doc. Example phase shapes you can adapt:

### Phase: Foundations
- Project provisioned across dev/preview/prod with secrets stored properly.
- CI runs all named gates on every PR.
- Design tokens published; primitives library has stories and a11y tests.
- Shared helpers (money, dates, formatters) ship with property-based tests.
- Wire contract envelope documented.
- Auth scaffolding: sign in, sign up, magic link, sign out, session refresh.
- Security baseline: every existing table denies by default; admin claim has explicit allow.
- e2e harness boots and runs at least one green smoke.

### Phase: Identity / Tenancy (if multi-tenant)
- Orgs, memberships, roles, invites, audit tables migrated.
- JWT custom claims wired: org id, role, super admin.
- Security defense-in-depth: every tenant-scoped table has an org predicate AND a membership join check.
- Admin substrate gated by super admin claim.

### Phase: Core Domain (example: CRM Core)
- Module tables and pages.
- Polymorphic attachments via `(subject_type, subject_id)` with check constraint registry.
- Mentions parser + notifications.
- Saved views persisted per user with scope.
- Audit log writes from triggers on every insert/update/delete to in-scope tables.

### Phase: Hardening (final)
- Performance budgets met on every route.
- a11y full sweep at `{{A11Y_TARGET}}`.
- Security audit complete with all High and above closed.
- End-user, admin, and developer docs complete.
- Migration rehearsal: fresh DB, all migrations, all seeds, smoke pass.
- Launch checklist signed off.

Add phases that match your project. Delete those that don't apply.

## Central Gate Definitions

These are the named gates referenced everywhere. Substitute your tooling.

- **typecheck**: zero errors (e.g., `tsc --noEmit`, `mypy`).
- **lint**: zero errors, zero new warnings.
- **unit**: green, coverage floor enforced.
- **contract**: contract parity tests. FE and BE both call a shared fixture set; envelopes match byte-for-byte after canonical JSON.
- **security probe**: matrix of (role X table X action) asserts allow/deny matches the policy intent file.
- **migration applied**: migration runs, types regenerated, diff committed; the migration is idempotent on re-run; rollback note exists.
- **e2e smoke**: smoke suite. Runs against a preview deployment.
- **a11y**: axe integration. Zero serious or critical violations.
- **bundle**: route bundle within budget. Budget enforced in CI by size-limit (or equivalent).
- **docs updated**: PR description names the docs path(s) updated; absence is a gate failure.

## Yellow vs Red Status

Sub-agents report status per gate as green, yellow, or red.

- Green: passes cleanly.
- Yellow: passes with a known caveat documented in the journal. Yellow does not block merge by itself, but two yellows on the same PR force escalation under R-03.
- Red: fails. Red blocks merge full stop. The Orchestrator may not override a red. Only the user may, under R-03, and only with a written rationale in the journal.

Examples of legitimate yellows:
- Bundle within budget but trending up 10 percent week over week (open a Performance task).
- a11y passes axe but a manual reviewer noted a color contrast edge case on a state not in the default story (open a Design System task).

Examples of illegitimate yellows (must be red):
- A money math test that is "flaky."
- A security probe that "sometimes passes."
- A contract test skipped to ship faster.

## Phase-Exit Ceremony

The Orchestrator runs this ceremony at the end of each phase. All steps must pass for the phase to close.

1. Read the phase's DoD. Walk each item. For each, link the closing PR or doc.
2. Run the full gate matrix on the default branch. All gates green.
3. Migration rehearsal: from an empty DB, run all migrations and all seeds. Smoke green.
4. Risk register review with PM Architect. New risks logged, closed risks archived.
5. Security Reviewer signs off: no High or above open.
6. Performance Engineer signs off: budgets met on changed routes.
7. Docs Writer signs off: docs reflect the phase's surface area.
8. Update the build-order doc's phase status table.
9. Append a phase close note to `{{JOURNAL_DIR}}/phase-<name>-close.md` linking every PR, every doc, every gate result.
10. Announce phase close in the standup. Begin the next phase's planning.

If any step fails:
- Roll the phase back to "in progress" status.
- Open targeted tasks to close the gap.
- Do not begin the next phase.
- Escalate to the user only if a gap blocks for more than one full cycle.

## Cross-Phase Invariants

These hold across every phase (define yours in `PROJECT.md`). Examples:

- Money is handled per `{{MONEY_RULE}}` only.
- Every tenant-scoped read goes through your security policy. Privileged service roles are never used from a user-facing path.
- Every write endpoint is idempotent on `Idempotency-Key` or has a documented reason.
- Every audit-relevant change emits to the audit log via trigger.
- Every page has an empty state, a loading state, an error state, and an a11y check.
- Every primitive has a story and at least one a11y test.
- Every plugin (if applicable) obeys the substrate boundary; no plugin reaches into core tables without an extension point.

## The Bar In One Sentence

If you cannot trace a feature from journal entry to PR to green gates to docs to phase-exit checklist, it is not done.
