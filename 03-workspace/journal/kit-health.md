# Kit Health Report — Kitstak — 2026-05-18 (re-run after scrub)

Status: **YELLOW**

## Summary

Second Kit Validator pass after deleting the four trimmed agents (Compliance Auditor, Analytics Engineer, Mobile Engineer, Whitelabel Engineer) and scrubbing the Router, README, and Operator guide. Check E now passes cleanly: the router team rosters, the README folder tree, and the on-disk file list all agree (24 specialist agents). Zero RED findings.

The scrub did not chase down inbound references in surviving files: six agent and Orchestrator docs still name deleted agents in DO lists, handoff inputs, full dispatch sections, and Load Order entries. One escalation rule (R-10 "new plugin or external capability") is newly orphaned because its sole specialist citation lived in Whitelabel Engineer. Total findings: **20**, all YELLOW.

## Checks (delta from prior run)

- A. Ownership collisions: pass (no delta)
- B. DO / DO NOT contradictions: **7 new YELLOW** (stale inbound references to deleted agents in surviving files)
- C. Gate consistency: 9 findings YELLOW (unchanged)
- D. Placeholder coverage: 2 findings YELLOW (+1 — four template placeholders are now defined-but-unused)
- E. Roster integrity: **pass** (was 4 YELLOW; -4)
- F. Escalation routing: **1 new YELLOW** (R-10 now orphaned)
- G. Config sanity: 2 findings YELLOW (unchanged in count; G.1 re-evaluated and still YELLOW under spec rule G.5)
- H. Path-to-owner map: pass; table regenerated in `path-ownership.md`

## Findings

### B — Stale inbound references to deleted agents (7 YELLOW, all new)

1. YELLOW | B | `CLAUDE AGENTS/Security/PRIVACY-OFFICER.md:23` | DO line "Author consent and cookie banner copy with Legal / Compliance Auditor" names a deleted agent | Replace "Compliance Auditor" with "PM Architect" or drop the co-author clause.
2. YELLOW | B | `CLAUDE AGENTS/Security/PRIVACY-OFFICER.md:36` | Inputs list "5. Analytics Engineer's tracking plan" — input source no longer exists | Drop the line; mark analytics tracking-plan input as `n/a` for Kitstak.
3. YELLOW | B | `CLAUDE AGENTS/Operations/ONBOARDING-ENGINEER.md:10, 22, 34` | Three mentions of "Analytics Engineer" (activation funnel definition, iteration partner, activation events) — agent no longer exists | Replace with PM Architect or note "activation analytics out of scope per PROJECT.md `analytics_provider: n/a`."
4. YELLOW | B | `CLAUDE AGENTS/Build/DESIGN-SYSTEM-ENGINEER.md:33, 91-92, 124` | "Wire the runtime theming hook used by Whitelabel," DoD-DS-6 "Whitelabel safe," and "file a Whitelabel Engineer task" all reference deleted agent | Strip the Whitelabel hook from DO, remove or restate DoD-DS-6 (e.g., "tokens are read via CSS variables; no consumer-side fallback values"), rewrite the escalation line.
5. YELLOW | B | `CLAUDE AGENTS/Orchestrator/01-DISPATCH-PROTOCOL.md:22-23, 28, 262-340, 396, 430, 437` | Category roster line names "Whitelabel, Analytics, Mobile"; "Compliance Auditor"; agent count still "28 specialist roles"; four full per-agent dispatch sections remain; downstream references at :396 (analytics + PII) and :437 (Analytics Engineer activation tracking) | Remove the four dispatch sections; update count 28 → 24; strike deleted names from category line and from :396, :437.
6. YELLOW | B | `CLAUDE AGENTS/Orchestrator/04-CONTEXT-LOADING-ORDER.md:77, 186-196` | "Whitelabel Engineer Load Order" section references a file (`Build/WHITELABEL-ENGINEER.md`) that no longer exists; "theming runtime if changes intersect with whitelabel" MAY clause at :77 | Delete the Whitelabel Engineer Load Order section; remove or rephrase the MAY clause.
7. YELLOW | B | `CLAUDE AGENTS/Orchestrator/00-ORCHESTRATOR-PROMPT.md:60` | Wave list includes "Whitelabel" as a canonical wave | Remove "Whitelabel" from the wave list, or annotate "(Whitelabel — n/a for Kitstak)".

### C — Gate consistency (9 YELLOW, unchanged from prior run)

All nine entries from the prior run carry forward: `dependency audit`, `gitleaks`, `visual regression`, `stories build`, `license check`, `link check` + `lint markdown`, `docs build`, `load test` / `perf regression`, `lint workflow YAML` / `lint shell scripts` / `dry-run actions`. None promoted to the central gate dictionary in `Orchestrator/02-DEFINITION-OF-DONE.md`.

### D — Placeholder coverage (2 YELLOW)

1. YELLOW | D | `_AGENT-CONFIG-TEMPLATE.md:16-17` | `PROJECT_CODE` / `ONE_LINE_DESCRIPTION` defined-and-valued but unused by any agent (carried from prior run) | Wire into at least one agent or remove from the schema.
2. YELLOW | D | `_AGENT-CONFIG-TEMPLATE.md:27, 28, 50, 84` | `MOBILE_STACK`, `ANALYTICS_PROVIDER`, `WHITELABEL_LIB_DIR`, `COMPLIANCE_REGIMES` are defined in the template and valued (`n/a`) in PROJECT.md, but with the four consumer agents deleted, nothing reads them | Prune from the template, or leave as `n/a`-only documentation slots and annotate accordingly.

### F — Escalation routing (1 YELLOW, new)

Rebuilt the R-NN → referencing-agents map for the 24 surviving specialist agents plus the Router. Result:

| Rule | Referenced by | Status |
|------|---------------|--------|
| R-01 | PM Architect, Backend, Frontend, Performance, Database, Threat Modeler, Privacy Officer, Tech Debt Auditor, Router | OK |
| R-02 | Backend, Frontend, Design System, Onboarding | OK |
| R-03 | Code Reviewer, QA, DevOps, Performance | OK |
| R-04 | PM Architect | OK |
| R-05 | DevOps, Migrations, Support, Release Manager | OK |
| R-06 | Security Reviewer, Incident Commander, Integrations, Privacy Officer, Support, UX Auditor, Release Manager | OK |
| R-07 | Threat Modeler, DevOps, Integrations, Incident Commander, Onboarding, Cost Auditor | OK |
| R-08 | Integrations, Cost Auditor, Release Manager, Router | OK |
| R-09 | Design System, Docs Writer, Accessibility, Frontend, UX Auditor, Acceptance Tester, Release Manager, Router | OK |
| R-10 | (none — Whitelabel was sole citer) | **ORPHAN** |
| R-11 | Tech Debt Auditor | OK |
| R-12 | (Orchestrator-internal: 00-PROMPT + 04-LOAD-ORDER) | OK by precedent — prior run also lacked a specialist cite and passed |

1. YELLOW | F | `CLAUDE AGENTS/Orchestrator/03-ESCALATION-RULES.md:120-122` | R-10 ("New plugin or external capability") no longer referenced by any surviving specialist agent's Escalation Criteria. Citation previously lived in Whitelabel Engineer | Retire R-10 in this kit instance, or add a citation under Integrations Engineer (most natural new owner — "new external capability" is integrations-land).

### G — Config sanity (2 YELLOW, unchanged in count)

1. YELLOW | G | `PROJECT.md` (tenant_model line 72) | Spec rule G.5 reads: *"`tenant_model: multi-tenant` but Whitelabel Engineer is trimmed: Yellow."* The rule does not distinguish "trimmed-and-deleted" from "trimmed-but-present" — both are absent at dispatch. The dated scrub note in AGENT-ROUTER.md documents intent but does not suppress the spec rule. **Still YELLOW, acknowledged-only** for Kitstak (single-brand product where whitelabel is genuinely out of scope).
2. YELLOW | G | `PROJECT.md` (conventions.branch_pattern, line 69) | `claude/<slug>` auto-detected; PROJECT.md self-flags as possibly not the intended human pattern | Unchanged. Confirm or override before first router dispatch.

## Resolved since prior run (-9 findings)

- All four Check E "trimmed-but-present" YELLOWs (Mobile, Analytics, Whitelabel, Compliance Auditor files now deleted).
- Router/README/Operator cheat-sheet references to the four deleted agents — zero remaining matches under grep.

## Total

- **20 findings total** (7 new B + 9 carried C + 2 D + 1 new F + 2 carried G)
- **0 RED**, all YELLOW
- **Net delta:** -9 resolved, +8 added (scrub follow-ups + one orphan surfaced)

The kit is materially cleaner than the prior run — every new finding is a direct follow-up to the scrub and is fixable in a single editing pass over six files.

## Next steps

- **Scrub round 2:** remove references to deleted agents in:
  - `Security/PRIVACY-OFFICER.md` (2 lines)
  - `Operations/ONBOARDING-ENGINEER.md` (3 lines)
  - `Build/DESIGN-SYSTEM-ENGINEER.md` (4 spots incl. DoD-DS-6)
  - `Orchestrator/01-DISPATCH-PROTOCOL.md` (4 dispatch sections + count + roster line + 2 downstream cites)
  - `Orchestrator/04-CONTEXT-LOADING-ORDER.md` (Whitelabel Load Order section + MAY clause at :77)
  - `Orchestrator/00-ORCHESTRATOR-PROMPT.md` (Whitelabel wave at :60)
  - Owner: PM Architect | Due: before first router dispatch.
- **Decide R-10:** retire as `n/a` for Kitstak, or add Escalation Criteria citation under Integrations Engineer | Owner: mike@team-01.com | Due: before first router dispatch.
- **Update `_AGENT-CONFIG-TEMPLATE.md`:** either prune the four orphaned placeholders or annotate as documentation-only | Owner: PM Architect | Due: before next phase exit.
- **Carried:** promote nine agent-owned CI gates into 02-DoD; confirm or override `conventions.branch_pattern`; acknowledge G.1.

See `path-ownership.md` next to this file for the regenerated path-to-agent map (now without the two trimmed-agent rows).
