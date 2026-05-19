# Dispatch Protocol

## Project Configuration

Reads from `_AGENT-CONFIG-TEMPLATE.md` / `PROJECT.md`. Key variables:
- `{{AGENTS_DIR}}`, `{{SHARED_CONTEXT_PATH}}`, `{{JOURNAL_DIR}}`, `{{API_CONTRACTS_DIR}}`, `{{DB_SCHEMAS_DIR}}`, `{{TESTS_DIR}}`
- `{{BRANCH_PATTERN}}`, `{{COMMIT_STYLE}}`, `{{PHASING_MODEL}}`

## Tailored Defaults

- Branch pattern: `{{BRANCH_PATTERN}}` (e.g., `<phase>/<domain>/<slug>`)
- Commit style: `{{COMMIT_STYLE}}` (e.g., Conventional Commits, phase-tagged)

---

This document defines exactly how the Orchestrator hands work to a specialized agent. Every dispatch is a structured prompt with mandatory sections. Sub-agents are entitled to refuse a dispatch that is missing required sections.

## The Roster

The specialized agent roles live in five sibling folders next to this one:

- **Build**: engineers who ship code. Backend, Frontend, Design System, DevOps, Migrations, Docs Writer, Integrations, Accessibility.
- **Audit**: planners and reviewers who shape and verify the system. PM Architect, Database Engineer, Performance Engineer, Tech Debt Auditor, Cost Auditor, UX Auditor.
- **Review**: gatekeepers who guard merge and ship. Code Reviewer, QA Engineer, Release Manager, Acceptance Tester.
- **Security**: security and privacy gatekeepers. Security Reviewer, Privacy Officer, Threat Modeler.
- **Operations**: live-system and human-process agents. Incident Commander, Support Engineer, Onboarding Engineer.

That is 24 specialist roles. Adapt the roster in your `PROJECT.md` if your project does not need all of these.

## The Dispatch Template

Every dispatch must be a Markdown block of this exact shape:

```
# Dispatch: <agent-role> | <phase> | <short-task-slug>

## Role
You are the <agent-role>. Your role definition is at `<path-to-agent-file>`. Read it before any action.

## Constitution
You must obey `{{SHARED_CONTEXT_PATH}}`. If this dispatch contradicts the constitution, refuse via the refused-dispatch pattern in your project's communication protocol.

## Context to load (in order)
1. {{SHARED_CONTEXT_PATH}}
2. <agent role file>
3. <architecture doc> (section: <if relevant>)
4. <build order doc> (phase <name>)
5. <module-specific files>

## Scope (DO)
- <crisp bullet>
- <crisp bullet>

## Out of scope (DO NOT)
- <crisp bullet>
- <crisp bullet>

## Branch
{{BRANCH_PATTERN}} resolved (e.g., wave-2/crm/leads-list, milestone-b/auth/oauth-flow, sprint-12/api/idempotency)

## Commits
{{COMMIT_STYLE}}. Example:
  feat(invoices): add credit notes
  test(invoices): credit notes contract parity
Use feat, fix, chore, docs, test, refactor, perf. Scope is the module slug.

## Inputs
- Wire contract: {{API_CONTRACTS_DIR}}/<contract>.md
- Schema fragment: {{DB_SCHEMAS_DIR}}/<schema>.md
- Acceptance: <module spec path>

## Outputs (deliverables)
- Files: <paths>
- Doc updates: <paths>
- Journal entry: {{JOURNAL_DIR}}/<date>-<slug>.md

## Gates that block merge
- typecheck
- lint
- unit
- contract parity (FE vs BE) (if applicable)
- security policy probe (if security-touching)
- migration applied to local + preview (if migration)
- e2e smoke (if user-facing path)
- a11y (if UI)
- docs updated (always)

## Success criteria
- <observable, measurable>
- <observable, measurable>

## Hand-off summary format
Return the summary in the format defined in your project's communication protocol.

## Permission to refuse
If this dispatch violates the constitution, asks you to bypass security from a user-facing path, introduces a banned dependency, or omits required sections above, refuse with the refused-dispatch pattern and ping the Orchestrator.
```

The Orchestrator does not omit any section. If a section does not apply, write "n/a" with a one-line justification.

## Parallelization Rules

Up to four dispatches per cycle, with these guardrails:

- One Migrations Engineer task at a time. Migrations are serial because the local DB state is shared.
- No two write tasks on the same component, page, backend function, or table per cycle. Reads and tests can overlap.
- Frontend and Backend for the same module are parallel-safe only after the wire contract is frozen. "Frozen" means PM Architect has signed off and the contract file has a `status: frozen` header.
- Docs Writer and QA Engineer can almost always run in parallel; reserve a Docs Writer slot every cycle.
- Code Reviewer is single-threaded per PR but parallel across PRs.
- Security Reviewer and Performance Engineer can run in parallel with feature work but block phase exit if they raise findings of severity High or above.

## Branching

Branch names follow `{{BRANCH_PATTERN}}`. Define your domains list in `PROJECT.md` (examples: identity, crm, billing, inventory, ops, accounting, foundations, infra, docs, security, perf). The slug is kebab-case.

Branches always derive from `main` (or your default branch). Long-lived feature branches are forbidden; rebase or merge within one cycle of opening.

## Prompt Templates Per Role

These are minimal nuclei the Orchestrator fills in. The full dispatch wraps each.

### Backend Engineer
```
## Scope (DO)
- Implement backend function/endpoint <name>.
- Implement security policies on tables: <list>.
- Write contract tests that match the wire envelope.

## Out of scope (DO NOT)
- Frontend pages or components.
- Schema migrations (Migrations Engineer owns).
- Anything not in the contract.
```

### Frontend Engineer
```
## Scope (DO)
- Implement pages and components for module <slug>.
- Hooks and services consuming the frozen contract.
- Unit tests, contract parity vs BE.

## Out of scope (DO NOT)
- New primitives (Design System Engineer owns).
- Backend function or security policy changes.
- New tokens or theme additions.
```

### Migrations Engineer
```
## Scope (DO)
- Author and verify migration <NNNN>_<slug>.
- Run forward, run idempotently, document rollback.
- Update generated types.

## Out of scope (DO NOT)
- App code.
- Backend functions or security policies (Backend Engineer owns; you only embed the policy SQL that ships with the migration if explicitly scoped).
```

### Design System Engineer
```
## Scope (DO)
- Add or modify primitives.
- Update tokens.
- Add stories with a11y check.

## Out of scope (DO NOT)
- Page-level layouts.
- Business logic.
```

### Database Engineer
```
## Scope (DO)
- Schema design for module <slug>.
- Security policy intent documented.
- Performance review of queries against the perf budget doc.

## Out of scope (DO NOT)
- Writing the migration SQL (Migrations Engineer owns).
- App code.
```

### DevOps Engineer
```
## Scope (DO)
- CI workflow changes.
- Hosting config.
- Database project config.
- Secrets baseline (no secret values committed).

## Out of scope (DO NOT)
- App code.
- Database migrations.
```

### QA Engineer
```
## Scope (DO)
- Tests in {{TESTS_DIR}}/<level>/<module>/.
- Fixtures and factories.
- Mocking handlers.

## Out of scope (DO NOT)
- Implementation code.
- Schema or migrations.
```

### Security Reviewer
```
## Scope (DO)
- Security policy coverage probe across listed tables/endpoints.
- Threat model update.
- Dependency audit.

## Out of scope (DO NOT)
- Fixes (raise findings; Orchestrator dispatches a fix).
```

### Performance Engineer
```
## Scope (DO)
- Query plan review for listed endpoints.
- Bundle size audit.
- Caching strategy doc updates.

## Out of scope (DO NOT)
- Feature work.
- New indexes (raise as recommendation; Migrations Engineer authors).
```

### Docs Writer
```
## Scope (DO)
- User, admin, dev, API docs.
- Update changelog.

## Out of scope (DO NOT)
- Code changes (raise issues if docs reveal bugs).
```

### PM Architect
```
## Scope (DO)
- Architecture, build order, risk register, open question resolution drafts.
- Ratification proposals for the constitution (user signs off under R-01).

## Out of scope (DO NOT)
- Implementation.
```

### Code Reviewer
```
## Scope (DO)
- Review PR <id> against the constitution, code style guide, and phase DoD.
- Approve, request changes, or block with justification.

## Out of scope (DO NOT)
- Implementing fixes; comment them.
```

### Integrations Engineer
```
## Scope (DO)
- Per-vendor adapter module + webhook handler.
- Signature verification, retry/backoff, idempotent processing.
- Vendor matrix doc updates.

## Out of scope (DO NOT)
- Reaching into core business modules. Expose an interface and let core consume.
- Calling live vendor APIs from CI.
```

### Accessibility Engineer
```
## Scope (DO)
- Manual screen reader and keyboard walkthroughs on critical flows.
- a11y test cases beyond axe (focus order, name/role/value, live regions).
- a11y checklist per page type.

## Out of scope (DO NOT)
- Authoring primitives (Design System Engineer owns).
- Visual redesigns (UX Auditor / Design System Engineer).
```

### Tech Debt Auditor
```
## Scope (DO)
- Catalog and classify debt items (severity, age, domain, fix estimate, blast radius).
- Top-10 recommendation per phase.

## Out of scope (DO NOT)
- Fix the debt yourself; route to the right Build agent.
```

### Cost Auditor
```
## Scope (DO)
- Monthly cost report by service and environment.
- Anomaly flags and value-mapping.
- Optimization recommendations ranked by ROI.

## Out of scope (DO NOT)
- Cancel or downsize resources unilaterally; DevOps Engineer executes.
```

### UX Auditor
```
## Scope (DO)
- Heuristic + WCAG evaluation per critical flow.
- Findings with severity, evidence, recommendation.
- Top-5 quick wins.

## Out of scope (DO NOT)
- Redesigns; recommend, route to Design System / Frontend.
```

### Release Manager
```
## Scope (DO)
- Pre-release readiness checklist.
- Release notes (user-facing + internal).
- Phased rollout coordination + post-release watch.

## Out of scope (DO NOT)
- Fix issues; block the release and dispatch the right agent.
```

### Acceptance Tester
```
## Scope (DO)
- Walk every acceptance criterion as the named user.
- Test happy path, alternates, edges, errors on target devices.
- Match / partial / mismatch report with evidence.

## Out of scope (DO NOT)
- Block on issues outside the acceptance criteria; raise separately.
```

### Privacy Officer
```
## Scope (DO)
- Data registry per personal data element.
- DSR runbook (access, export, rectification, deletion).
- Privacy impact review on new features.

## Out of scope (DO NOT)
- Sign off as legal counsel.
- Approve analytics that collect PII without consent + retention plan.
```

### Threat Modeler
```
## Scope (DO)
- STRIDE walk across architecture components.
- Threats table with likelihood, impact, residual.
- Mitigations routed to owners.

## Out of scope (DO NOT)
- Fix threats; recommend and route.
```

### Incident Commander
```
## Scope (DO)
- Declare SEV within 5 minutes, run the incident channel.
- Assign Commander/Comms/Ops/Scribe.
- Drive postmortem within 5 business days.

## Out of scope (DO NOT)
- Fix the bug yourself.
- Speculate publicly about cause during the incident.
```

### Support Engineer
```
## Scope (DO)
- Triage tickets, resolve KB-solvable, escalate the rest with full context.
- Weekly themes report.

## Out of scope (DO NOT)
- Promise features to customers.
- Edit production data directly (R-05).
```

### Onboarding Engineer
```
## Scope (DO)
- Dev onboarding guide + user getting-started guide.
- Activation funnel tracking when an analytics provider is configured.
- Quarterly dev setup re-time.

## Out of scope (DO NOT)
- Marketing copy.
- One-and-done onboarding; re-walk every phase.
```

## Worked Example: One Full Sequence

Goal: ship a new feature (example: credit notes for invoices).

Cycle 1 dispatches (parallel where allowed):

1. PM Architect: ratify the data model. Output: design doc plus close any open questions.
2. Database Engineer: schema fragment and security policy intent. Output: schema doc.
3. Wait. Migrations Engineer, Backend Engineer, and Frontend Engineer cannot start until 1 and 2 land.

Cycle 2 dispatches:

1. Migrations Engineer: write the migration from the schema fragment. Output: migration applied locally, generated types updated.
2. Backend Engineer: function/endpoint plus security policies on the new tables, contract authored. Output: contract tests pass.
3. QA Engineer: factories and fixtures. Output: fixtures committed.
4. Docs Writer: stub user doc.

Cycle 3 dispatches (contract is frozen):

1. Frontend Engineer: pages, hooks, services. Output: pages and tests.
2. Design System Engineer: any new primitive needed (likely none; raise if so).
3. Code Reviewer: review the Backend Engineer PR from cycle 2.

Cycle 4 dispatches:

1. Security Reviewer: security policy probe across new tables.
2. Performance Engineer: query plan review on list and detail.
3. Docs Writer: finalize user, admin, dev, and API docs.
4. Code Reviewer: review Frontend Engineer PR.

Phase exit ceremony (Orchestrator runs): see `02-DEFINITION-OF-DONE.md`.

## What The Orchestrator Does With Returned Hand-Offs

For each returned summary:
1. Read it. Do not paraphrase into the journal; link it.
2. Check each gate listed in the dispatch against the summary's gate results.
3. If any gate is yellow, demand a fix or escalate under R-03.
4. If all green, dispatch the Code Reviewer if not already done.
5. After Code Reviewer green, merge. Update the phase exit checklist.

## Dispatch Anti-Patterns

- "Build the invoices module." Too broad. Split per sub-module and per role.
- "Quickly add field X to the schema." Migrations are never "quick"; full migration dispatch every time.
- "Reviewer, also fix what you find." No. Reviewers raise; engineers fix.
- "Skip the contract test, we will add it later." No. The contract test is the wire seal.
- "Dispatch the same agent twice in one cycle for two parallel writes." No. One scope per agent per cycle.
