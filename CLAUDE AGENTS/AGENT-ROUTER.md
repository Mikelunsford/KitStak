# Agent Router

This is the front door. You describe what you want in plain English, the router picks the right agents in the right order, and the Orchestrator dispatches them. You should never have to remember which agent does what.

## How to use

1. Tell Claude: "Use the Agent Router. Here is what I want to do: <plain English>."
2. Claude loads this file, classifies your request, checks repo signals, and proposes a dispatch plan.
3. You approve or adjust. The Orchestrator runs the plan.

The router is consulted **before every Orchestrator dispatch**. It is not a one-time decision; it runs each cycle so the right agents come in at the right moment.

## Inputs the router considers

- **Your intent** (free-form text from you).
- **Phase** (from `PROJECT.md` `phasing` block + the current standup).
- **Repo signals** (what files changed in the last N PRs, what's in flight).
- **Open items** (questions, risks, escalations, incidents).
- **Calendar pressure** (phase exit imminent? release window? audit deadline?).
- **Roster trim** (what agents your project actually has).

## Output of the router

A **Dispatch Plan**:

```
# Dispatch Plan for: <one-line restatement of intent>

## Detected
- Phase: <name>
- Repo signals: <key files / domains affected>
- Open items relevant: <list>

## Plan
Cycle 1 (parallel):
- <Agent> | <scope> | <branch> | <gates>
- <Agent> | <scope> | <branch> | <gates>

Cycle 2 (after cycle 1 lands):
- <Agent> | <scope> | <branch> | <gates>

## Out of scope this round
- <thing> -> reason -> revisit when

## Confidence
high | medium | low (with one-line reason)
```

The Orchestrator follows the plan; you can edit it before approval.

---

## Classification rubric

The router maps intent + signals to one of these **work types**. Each work type has a default agent team.

### A. New feature
Signals: "build", "add", "ship", "implement", "we need X."
Team (in order):
1. PM Architect (spec + freeze contract)
2. Database Engineer (schema intent, if data-touching)
3. Migrations Engineer (after schema intent lands)
4. Backend Engineer (parallel with Frontend after contract freeze)
5. Frontend Engineer
6. Design System Engineer (only if a new primitive is needed)
7. QA Engineer (fixtures, factories, contract tests)
8. Docs Writer (user/admin/dev/api docs)
9. Code Reviewer
10. Security Reviewer (if RLS/auth/payments touched)
11. Performance Engineer (if list/aggregation endpoints)
12. Acceptance Tester
13. Release Manager (when ready to ship)

### B. Bug fix
Signals: "fix", "broken", "regression", "doesn't work", "stack trace."
Team:
1. QA Engineer (reproduce, write failing test)
2. The owning Build agent (smallest scope fix)
3. Code Reviewer
4. Release Manager (if hot-fix release needed)

### C. Production incident
Signals: "down", "outage", "slow", "alerts firing", "customer reports widespread."
Team:
1. Incident Commander (declare SEV, run the room)
2. DevOps Engineer (logs, traffic, rollback)
3. The Build agent owning the failing surface
4. Support Engineer (customer comms)
5. After resolution: Incident Commander writes postmortem; Tech Debt Auditor captures action items.

### D. Performance issue (not an incident)
Signals: "slow", "p95", "bundle bloat", "query plan."
Team:
1. Performance Engineer (measure, recommend)
2. Migrations Engineer (if index)
3. Backend or Frontend Engineer (apply fix)
4. Code Reviewer

### E. Security finding
Signals: "vulnerability", "CVE", "exposure", "PII leak", "auth bypass."
Team:
1. Security Reviewer (confirm, classify severity)
2. Threat Modeler (if architectural)
3. Privacy Officer (if PII)
4. The owning Build agent (fix)
5. Incident Commander (if exploitable today)

### F. Drift / refactor / tech-debt sweep
Signals: "messy", "drift", "refactor", "cleanup", "we keep tripping over X."
Team:
1. Tech Debt Auditor (catalog, prioritize)
2. PM Architect (ratify priorities)
3. The owning Build agents (fix in priority order)
4. Code Reviewer

### G. Cost / efficiency
Signals: "bill", "spend", "expensive", "budget."
Team:
1. Cost Auditor (analyze)
2. Performance Engineer (cost-tied perf wins)
3. DevOps Engineer (execute the change)

### H. Integration with vendor
Signals: "Stripe", "Slack", "Twilio", "HubSpot", "webhook from X."
Team:
1. Integrations Engineer (adapter + webhook)
2. Security Reviewer (signature, secrets)
3. Privacy Officer (sub-processor + data registry)
4. Backend Engineer (consume internally)

### I. Release / ship
Signals: "ship", "release", "deploy", "tag", "go live."
Team:
1. Release Manager (readiness check)
2. DevOps Engineer (rollout)
3. Support Engineer (CX comms)
4. Acceptance Tester (final spot check)

### J. Onboarding / setup
Signals: "new dev", "onboarding", "getting started", "activation."
Team:
1. Onboarding Engineer (audit and update)
2. Docs Writer (guides)

### K. UX / usability concern
Signals: "confusing", "users complain", "low conversion", "feels off."
Team:
1. UX Auditor (heuristic eval)
2. Support Engineer (ticket themes)
3. Frontend / Design System Engineer (apply fixes)

### L. Accessibility focus
Signals: "screen reader", "keyboard", "a11y", "WCAG."
Team:
1. Accessibility Engineer (deep audit)
2. Design System Engineer (primitive fixes)
3. Frontend Engineer (compose-level fixes)

### M. Strategic / planning
Signals: "roadmap", "what's next", "should we", "trade-off."
Team:
1. PM Architect (options + recommendation)
2. Performance Engineer / Security Reviewer / Cost Auditor (as inputs)
3. User decides via R-01 / R-08 / R-09 as appropriate.

### N. Unclear / mixed
If the router cannot classify with confidence, it asks you one question to disambiguate. It never invents a classification.

---

## Trim rules

The router skips agents that don't apply to your project. From `PROJECT.md`:

- No money math in scope -> skip money math gates in DoD.

> **Note:** Earlier versions of this kit included Compliance Auditor, Analytics Engineer, Mobile Engineer, and Whitelabel Engineer (with their own trim rules and work types F, I, O, P). Those agents were removed from this kit on 2026-05-18 because Kitstak's `PROJECT.md` marks `compliance_regimes`, `analytics_provider`, `mobile`, and `whitelabel_lib` as `n/a`. If a future Kitstak project needs any of them, restore from a fresh kit copy and re-add the corresponding trim rule.

## Tie-breakers

When multiple work types fit, prefer the one with the **smallest blast radius** first. A bug fix that becomes a refactor request needs an explicit handoff, not a silent expansion.

## What the router does NOT do

- It does not author code.
- It does not skip the constitution.
- It does not override the Orchestrator's escalation rules.
- It does not change `PROJECT.md`.

## How the Orchestrator uses the router

The Orchestrator, on every cycle:

1. Reads the standup and any new user input.
2. Calls the router with intent + signals.
3. Reviews the dispatch plan; adjusts only if it knows something the router doesn't.
4. Confirms with the user (only for new work types or when confidence is low).
5. Dispatches per the plan.

If the user is non-technical, the Orchestrator can present the plan as: "Here's who I want to put on this and why. Approve, adjust, or skip." Plain English, not branch names and SQL.
