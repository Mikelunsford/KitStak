# Escalation Rules

## Project Configuration

Reads from `PROJECT.md`. Tailor each rule's trigger to your project. Mark any rule `n/a` if it doesn't apply (e.g., no pricing rule on an internal tool).

Variables this doc reads:
- `{{JOURNAL_DIR}}`, `{{ESCALATIONS_DIR}}` (defaults to `{{JOURNAL_DIR}}/escalations`)
- `{{SHARED_CONTEXT_PATH}}`

---

The Orchestrator decides autonomously inside the constitution, and escalates outside it. This file enumerates twelve generic rules (R-01 through R-12), explains how to escalate, and lists anti-escalations (things that look like they need a human but do not).

## How To Escalate

When a rule fires, the Orchestrator:
1. Writes an entry to `{{ESCALATIONS_DIR}}/<date>-<slug>.md`.
2. Pings the user in the standup under "Escalate to user," linking the entry.
3. Pauses the affected dispatches (not all dispatches, only the affected ones).
4. Does not resume until the user replies in writing.
5. After the user reply, logs the decision and the rationale in the journal and resumes.

The escalation entry follows this shape:

```
# Escalation <date>-<slug>

## Rule
R-NN: <rule name>

## Context
<5 to 10 lines describing the situation>

## Options
1. <option> - cost / risk / who pays
2. <option> - cost / risk / who pays
3. <option> - cost / risk / who pays

## Orchestrator recommendation
<one clear pick with one paragraph rationale>

## Affected dispatches paused
- <branch> | <agent>
- <branch> | <agent>

## Decision (filled by user)
- Choice:
- Constraints:
- Effective phase:
```

## The Twelve Rules

### R-01: Constitution-level changes
Fires when a request touches a project-defined invariant. Define yours in `PROJECT.md`. Common examples:
- Money math rules
- Security policy intent (who can read or write what)
- Identity model (org, membership, role, claim shape)
- Audit semantics (what writes to audit log, when, by whom, immutability rules)

Action: only the PM Architect may draft the change. User ratifies in writing. The constitution file is updated as part of the change.

### R-02: Banned or keep list dependency change
Fires when an agent requests adding a dependency on the banned list or removing one on the keep list (both in `{{SHARED_CONTEXT_PATH}}`).

Action: refuse the dispatch in flight. Open an escalation. User decides; if approved, the constitution is updated by PM Architect first.

### R-03: Gate skip or weakening
Fires when an agent or reviewer asks to:
- Skip a gate listed in `02-DEFINITION-OF-DONE.md` for a single PR.
- Permanently weaken a gate threshold.
- Merge with two yellows on the same PR.

Action: escalate. The Orchestrator never approves a gate skip on its own. If the user approves, the rationale is recorded in the journal AND in the gate file's "exceptions" section so future agents see the precedent.

### R-04: Stale open question
Fires when an open question is older than 3 cycles, or blocks any task on the critical path of the active phase.

Action: escalate with options drafted by PM Architect. The user picks one within one cycle, or the phase timeline slips and R-11 also fires.

### R-05: Production data touch
Fires for any of:
- Running a migration against a production database.
- Rotating a secret outside the scheduled rotation.
- Restoring from backup.
- Editing prod rows by hand.
- Importing or exporting prod customer data.

Action: never autonomous. The user must approve and supervise. The DevOps Engineer runs the change, and the Orchestrator logs it.

### R-06: Security finding High or above
Fires when the Security Reviewer reports a finding at severity High, Critical, or "exploitable today."

Action: pause the affected dispatch and open an immediate fix task. Inform the user. Phase exit is blocked until closed.

### R-07: Vendor or hosting change
Fires when an agent proposes switching a major vendor: database provider, hosting provider, auth provider, payments processor, registrar / DNS. Tailor to your stack in `PROJECT.md`.

Action: escalate. These are constitution-level on infrastructure and require user sign-off.

### R-08: Pricing or licensing change (if applicable)
Fires when an agent proposes:
- New plan tiers.
- Moving a feature between free and paid.
- Changing trial length.
- Changing per-seat versus per-org pricing.

Action: escalate. The Orchestrator does not set pricing.

### R-09: Brand substrate change
Fires when an agent proposes:
- New brandable token surfaces.

Action: escalate. The brand substrate is a contract with users and must be approved.

### R-10: New external capability
Fires when an agent proposes a new external integration or capability not in the constitution.

Action: escalate. Define the capability and integration contract before scope grows.

### R-11: Phase timeline slip
Fires when a phase has been "in progress" for more than one full target cycle past its planned exit.

Action: escalate with a slip analysis (what slipped, why, options). User picks: continue, descope, parallelize differently, or pause.

### R-12: New agent role required
Fires when the Orchestrator believes the existing roster is insufficient for an actual task.

Action: escalate. The user approves a new role definition. The Orchestrator does not invent roles unilaterally.

## Anti-Escalations

These look like they need a human but do not. Decide autonomously and log the rationale.

- Choosing a library inside the keep list: autonomous.
- Naming a new table inside the naming conventions: autonomous.
- Picking between two parallel-safe dispatches: autonomous.
- Adjusting which agent handles a task that fits multiple roles: autonomous, but document.
- Resolving a small contract envelope ambiguity that the constitution already covers: autonomous.
- Deciding to dispatch a Docs Writer "preemptively": autonomous.
- Choosing the test fixture style: autonomous.
- Picking between two equally-valid index strategies for a perf fix: autonomous, with Performance Engineer review.
- Reordering tasks inside a phase (not crossing phase boundaries): autonomous.
- Splitting one big dispatch into smaller dispatches: autonomous and encouraged.

## Escalation Severity vs Urgency

- High severity, high urgency: R-05 (prod touch), R-06 (security High+), R-11 (phase slip causing cascading delay). Page the user same day.
- High severity, normal urgency: R-01 (constitution), R-07 (vendor), R-08 (pricing), R-09 (brand substrate). Standup mention is enough.
- Normal severity: R-02 through R-04, R-10, R-12. Standup mention.

## When The User Is Silent

If the user does not reply within the time the escalation says is needed:
- R-05 / R-06: hold; do not proceed. Repeat the ping in the next standup.
- R-01 / R-07 / R-08 / R-09: hold the constitution change; let parallel work continue.
- R-04: the affected task remains paused. Other tasks proceed.
- R-11: the slip becomes the new normal until the user weighs in.

The Orchestrator never invents a user decision. Silence is not approval.

## After A Decision

For every decision returned:
1. Update the escalation file's "Decision" block.
2. If constitutional, update `{{SHARED_CONTEXT_PATH}}` via PM Architect.
3. If gate-related, update `02-DEFINITION-OF-DONE.md` exceptions.
4. If timeline-related, update the build-order doc.
5. Log the decision in the journal and resume dispatches.

## Examples

Example 1: A Backend Engineer wants to use a stored procedure that returns rows bypassing security for speed. This is R-01 (security intent) and R-03 (effective gate weakening). Escalate; recommend a security-definer function with explicit access checks instead.

Example 2: A Frontend Engineer wants to add a library that is on the banned list. R-02 fires. Refuse; suggest the keep-list equivalent.

Example 3: An open question on a domain decision has been open for 4 cycles. R-04 fires. Escalate with PM Architect's drafted options.

Example 4: DevOps Engineer wants to rotate a production secret before launch. R-05 fires. User approves and supervises.

Example 5: Security Reviewer finds that an endpoint allows user A to read user B's audit rows. Severity High. R-06 fires. Open a hotfix dispatch immediately; pause phase exit.
