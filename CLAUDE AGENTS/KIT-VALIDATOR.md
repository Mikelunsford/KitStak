# Kit Validator

Runs before the kit is armed against a repo. Re-runs whenever any agent file changes or before every phase exit. Produces a kit health report. The Orchestrator refuses to dispatch if the report is red.

## When to run

- After **Project Init**, before the first dispatch.
- After **adding or editing** any file in `Orchestrator/`, `Audit/`, `Build/`, `Review/`, `Security/`, `Operations/`, `AGENT-ROUTER.md`, or `_AGENT-CONFIG-TEMPLATE.md`.
- At every **phase exit** as part of the ceremony.
- When the **roster is trimmed** in `PROJECT.md` (drop Mobile, drop Whitelabel, etc.).

## How to invoke

Tell Claude: "Run the Kit Validator." Claude loads this file and walks every check below. Output is written to `{{JOURNAL_DIR}}/kit-health.md` with a green / yellow / red status.

## Output

```
# Kit Health Report — <date>

Status: GREEN | YELLOW | RED

## Summary
<one paragraph: what passed, what's flagged, what's blocking>

## Checks
- A. Ownership collisions: <pass | N findings>
- B. DO / DO NOT contradictions: <pass | N findings>
- C. Gate consistency: <pass | N findings>
- D. Placeholder coverage: <pass | N findings>
- E. Roster integrity: <pass | N findings>
- F. Escalation routing: <pass | N findings>
- G. Config sanity: <pass | N findings>
- H. Path-to-owner map: <pass | N findings>

## Findings
1. <severity> | <check ID> | <file:line> | <one-line description> | <suggested fix>
2. ...

## Next steps
- <action> | owner | due
```

Severity ladder:
- **Red**: blocks all dispatch. Examples: two agents own the same write path; a referenced gate does not exist; PROJECT.md missing required field.
- **Yellow**: dispatch allowed with the user's acknowledgement, logged in the journal. Examples: minor wording drift; an optional placeholder unused.
- **Green**: all checks pass.

---

## The Eight Checks

### A. Ownership collisions

Goal: only one agent writes to any given path or surface.

How:
1. Parse every agent file's **DO** section.
2. Extract every "Author X at <path>" or "Maintain <path>" or "Author <surface>" line.
3. Build a map: path -> [agents].
4. Any path with two or more agents that **write** is a Red finding (reads are fine).

Common collisions to look for:
- Two agents claiming `tokens` (Design System vs Whitelabel).
- Two agents claiming `migrations` (Database Engineer "writes intent," Migrations Engineer "writes SQL" — that is OK if intent vs SQL is the split; flag if both claim the SQL).
- Two agents claiming a docs surface (Docs Writer vs role-specific docs in another agent).

Suggested fix: edit one DO list to narrow the claim, or merge the agents.

### B. DO / DO NOT contradictions

Goal: Agent A's DO must not equal Agent B's DO NOT and vice versa.

How:
1. Build two maps: do[agent] = {claims}, dont[agent] = {forbiddens}.
2. For each claim in agent A, search for the same claim in agent B's dont list. If A claims it as DO and B forbids it for everyone (not just themselves), that is a contradiction — Red.
3. For each forbidden in agent A, check no agent B has a DO that matches. If A says "never use service role in user-facing paths" and B says "use service role for admin reads," that is a Red.

Yellow case: similar wording, different intent. Suggest harmonization.

### C. Gate consistency

Goal: every gate any agent references is defined exactly once in `Orchestrator/02-DEFINITION-OF-DONE.md`.

How:
1. Grep across all agent files for gate names (typecheck, lint, unit, contract, security probe, RLS probe, migration applied, e2e smoke, a11y, bundle, docs updated, etc.).
2. Compare to the gates defined in `02-DEFINITION-OF-DONE.md`.
3. Reference without definition: Red.
4. Definition without reference: Yellow (unused gate, consider removing).

### D. Placeholder coverage

Goal: every `{{PLACEHOLDER}}` used in any agent file is defined in `_AGENT-CONFIG-TEMPLATE.md` and has a value in `PROJECT.md` (or is explicitly `n/a`).

How:
1. Grep for `\{\{[A-Z0-9_]+\}\}` across all `*.md`.
2. Remove the **ignore list** (see below). These are documentation literals, not real variables.
3. Build a set of placeholders used.
4. Build a set of placeholders defined in `_AGENT-CONFIG-TEMPLATE.md`.
5. Used minus defined: Red (undefined placeholders).
6. Defined minus used: Yellow (dead variable).
7. If `PROJECT.md` exists, check each used placeholder has a value or `n/a`. Missing value: Red.

**Ignore list** (these are prose / instructional examples that look like placeholders but are not real variables; the validator must treat them as literals):

```
{{DOUBLE_BRACES}}        # used in docs to explain what a placeholder is
{{PLACEHOLDER}}          # singular form, instructional
{{PLACEHOLDERS}}         # plural form, instructional
{{PHASE_1_NAME}}         # numbered phase slots in the template list shape
{{PHASE_2_NAME}}
{{PHASE_3_NAME}}
{{PHASE_N_NAME}}         # any further numbered phase slots
```

Rule for adding to the ignore list: only add tokens that appear inside prose or YAML list-item examples explaining the shape of the config. Real config variables (anything in the YAML schema's leaf positions) must never be on this list.

Alternative implementation (stricter, optional): instead of an ignore list, exclude any double-brace token that appears inside a fenced code block whose language is `yaml` AND whose key is a list item placeholder under `phases:`. This avoids the ignore list but is more complex to implement.

### E. Roster integrity

Goal: the Router's teams reference only agents that actually exist after trimming.

How:
1. Parse `AGENT-ROUTER.md` work types and extract every agent name.
2. List actual agent files present in the kit folders.
3. Apply trim rules from `PROJECT.md` (single-tenant -> drop Whitelabel; mobile n/a -> drop Mobile; analytics_provider n/a -> drop Analytics; etc.).
4. Router references a non-existent agent: Red.
5. Agent file exists but no work type uses it: Yellow.

### F. Escalation routing

Goal: no two escalation rules in `Orchestrator/03-ESCALATION-RULES.md` claim the same trigger with different actions.

How:
1. Read each rule (R-01 through R-12).
2. Build a trigger -> action map.
3. Overlapping triggers with conflicting actions: Red.
4. Triggers never referenced by any agent's Escalation Criteria: Yellow.

### G. Config sanity

Goal: `PROJECT.md` is complete and internally consistent.

How:
1. Compare `PROJECT.md` keys to `_AGENT-CONFIG-TEMPLATE.md` schema.
2. Required keys missing: Red.
3. `stack.frontend` and `stack.backend` are both `n/a` and yet Build agents are armed: Red (you have no surface to build).
4. `compliance_regimes` is non-empty but Compliance Auditor is trimmed out: Red.
5. `tenant_model: multi-tenant` but Whitelabel Engineer is trimmed: Yellow.
6. `analytics_provider` set but Analytics Engineer trimmed: Yellow.

### H. Path-to-owner map

Goal: produce a single canonical map of "path or surface" -> "owning agent" so future contributors know where work goes.

How:
1. From check A's collisions-cleared map, write a clean two-column table.
2. Save to `{{JOURNAL_DIR}}/path-ownership.md`.
3. Any path mentioned in `PROJECT.md` `paths:` that has no owner: Red (you have a directory nobody owns).

Example:
```
| Path / surface              | Owning agent           |
| --------------------------- | ---------------------- |
| /app/<module>/              | Frontend Engineer      |
| /design-system/             | Design System Engineer |
| /supabase/functions/        | Backend Engineer       |
| /supabase/migrations/       | Migrations Engineer    |
| /docs/users/                | Docs Writer            |
| /docs/devs/design-system/   | Design System Engineer |
| /tests/contract/            | QA Engineer (+ BE/FE)  |
| /tests/security/            | Security Reviewer (+ QA)|
| /lib/integrations/          | Integrations Engineer  |
| /lib/whitelabel/            | Whitelabel Engineer    |
| /docs/analytics/            | Analytics Engineer     |
```

---

## Adding a new agent (the validator gate)

When a user adds a new agent file:

1. Place the file in the right folder (Audit / Build / Review / Security / Operations).
2. Run the Kit Validator.
3. The validator checks the new agent against A, B, C, D, F, H.
4. Red findings block arming. Yellow findings are surfaced to the user.
5. After fixes, validator green -> Orchestrator dispatches to the new agent in future cycles.

The validator never edits the agent files itself. It surfaces findings and suggests fixes; the user (or PM Architect) makes the edit, then re-runs.

## What the validator does NOT do

- It does not execute the agents.
- It does not modify `PROJECT.md`.
- It does not change agent files.
- It does not call external services.

## How the Orchestrator uses the validator

On a cold start the Orchestrator checks for a recent `kit-health.md` (within the last 7 days). If missing or red, it pauses and asks the user to run the validator. On phase exit it always re-runs the validator and includes the report in the phase close note.
