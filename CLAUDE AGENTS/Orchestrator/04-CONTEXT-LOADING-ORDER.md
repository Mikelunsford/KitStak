# Context Loading Order

## Project Configuration

Reads from `PROJECT.md`. Substitute your project's paths for every `{{PLACEHOLDER}}`. If a folder doesn't exist in your project, drop the rule for it.

Variables this doc reads:
- `{{SHARED_CONTEXT_PATH}}`, `{{AGENTS_DIR}}`, `{{JOURNAL_DIR}}`, `{{QUESTIONS_DIR}}`
- `{{API_CONTRACTS_DIR}}`, `{{DB_SCHEMAS_DIR}}`, `{{TESTS_DIR}}`, `{{DOCS_DIR}}`
- `{{ARCHITECTURE_DOC}}`, `{{BUILD_ORDER_DOC}}`, `{{CODE_STYLE_DOC}}`, `{{NAMING_CONVENTIONS_DOC}}`, `{{COMMS_PROTOCOL_DOC}}`, `{{GLOSSARY_DOC}}`, `{{DX_TESTING_DOC}}`

---

Every agent (including the Orchestrator) starts a fresh task by loading context in a defined order. This file is the authoritative order list. Agents that load context out of order risk acting on stale assumptions and may be required to redo work.

## Convention

- "MUST" load: skipping is a hard error; refuse the dispatch.
- "SHOULD" load: skip only with a one-line justification in the journal.
- "MAY" load: read on demand when the task touches that area.

Every load list ends with a "Targets" item: the actual files the task will write to or change.

## Orchestrator Load Order

When the Orchestrator wakes for any cycle, load in this order:

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Orchestrator/00-ORCHESTRATOR-PROMPT.md`
3. MUST: `{{AGENTS_DIR}}/Orchestrator/02-DEFINITION-OF-DONE.md`
4. MUST: `{{AGENTS_DIR}}/Orchestrator/03-ESCALATION-RULES.md`
5. MUST: `{{ARCHITECTURE_DOC}}`
6. MUST: `{{BUILD_ORDER_DOC}}`
7. MUST: the most recent standup in `{{JOURNAL_DIR}}`
8. SHOULD: `{{QUESTIONS_DIR}}` (all open files)
9. SHOULD: open escalations
10. MAY: suggestions and recommendations docs as relevant
11. MAY: per-phase module specs

## Backend Engineer Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Build/BACKEND-ENGINEER.md`
3. MUST: `{{CODE_STYLE_DOC}}`
4. MUST: `{{COMMS_PROTOCOL_DOC}}`
5. MUST: `{{API_CONTRACTS_DIR}}/00-envelope.md` and any contract file in scope
6. MUST: `{{DB_SCHEMAS_DIR}}/<module>.md` (security policy intent)
7. MUST: `{{DX_TESTING_DOC}}`
8. SHOULD: `{{ARCHITECTURE_DOC}}`
9. SHOULD: existing backend functions adjacent to the new one
10. MAY: blueprint materials for the module
11. Targets: backend function dirs, contract tests, contract doc updates

## Frontend Engineer Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Build/FRONTEND-ENGINEER.md`
3. MUST: `{{CODE_STYLE_DOC}}`
4. MUST: `{{NAMING_CONVENTIONS_DOC}}`
5. MUST: `{{API_CONTRACTS_DIR}}/<contract>.md` (frozen status)
6. MUST: `{{GLOSSARY_DOC}}`
7. SHOULD: existing pages adjacent to the new one
8. SHOULD: UI specs
9. SHOULD: `{{DX_TESTING_DOC}}`
10. MAY: design system stories for primitives used
11. Targets: app routes, services, hooks, unit tests

## Design System Engineer Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Build/DESIGN-SYSTEM-ENGINEER.md`
3. MUST: `{{NAMING_CONVENTIONS_DOC}}`
4. MUST: existing tokens
5. MUST: existing primitives
6. SHOULD: UI specs
7. SHOULD: a11y reference for the primitive type
8. Targets: primitive files, stories, a11y tests

## Database Engineer Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Audit/DATABASE-ENGINEER.md`
3. MUST: existing schema files in `{{DB_SCHEMAS_DIR}}`
4. MUST: security conventions in `{{SHARED_CONTEXT_PATH}}`
5. MUST: `{{DX_TESTING_DOC}}` (perf budgets)
6. SHOULD: existing migrations to spot duplicate intent
7. SHOULD: `{{ARCHITECTURE_DOC}}`
8. MAY: database engine docs for the feature in use
9. Targets: schema intent docs, feeds Migrations Engineer

## DevOps Engineer Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Build/DEVOPS-ENGINEER.md`
3. MUST: deploy and ops directory
4. MUST: CI workflow directory
5. MUST: `{{AGENTS_DIR}}/Orchestrator/02-DEFINITION-OF-DONE.md` (which gates CI must run)
6. SHOULD: hosting and database provider current configuration
7. SHOULD: secrets rotation schedule
8. MAY: observability config files
9. Targets: CI workflows, deploy docs, hosting config

## QA Engineer Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Review/QA-ENGINEER.md`
3. MUST: `{{DX_TESTING_DOC}}`
4. MUST: existing fixtures at `{{TESTS_DIR}}/fixtures/`
5. MUST: existing factories at `{{TESTS_DIR}}/factories/`
6. SHOULD: mock handlers at `{{TESTS_DIR}}/msw/`
7. SHOULD: contract envelope at `{{API_CONTRACTS_DIR}}/00-envelope.md`
8. MAY: e2e config and patterns
9. Targets: tests by level and module

## Security Reviewer Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Security/SECURITY-REVIEWER.md`
3. MUST: project threat model
4. MUST: security probe matrix file
5. MUST: backend function code for the module under review
6. SHOULD: dependency manifest (lockfile)
7. SHOULD: secrets baseline
8. MAY: prior security findings
9. Targets: threat model updates, security tests, findings reports

## Performance Engineer Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Audit/PERFORMANCE-ENGINEER.md`
3. MUST: `{{DX_TESTING_DOC}}` (budgets)
4. MUST: queries and endpoints under review
5. SHOULD: bundle reports from CI
6. SHOULD: query plans attached to the PR
7. MAY: caching strategy docs
8. Targets: perf review notes, recommendations for Migrations Engineer or feature owner

## Migrations Engineer Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Build/MIGRATIONS-ENGINEER.md`
3. MUST: `{{DB_SCHEMAS_DIR}}/<module>.md` (intent from Database Engineer)
4. MUST: existing migrations directory to pick next sequence
5. MUST: rollback pattern from the role doc
6. SHOULD: `{{DX_TESTING_DOC}}` (perf)
7. MAY: database engine reference for the feature in use
8. Targets: migration files, rollback notes

## Docs Writer Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Build/DOCS-WRITER.md`
3. MUST: `{{GLOSSARY_DOC}}`
4. MUST: the PR or feature spec being documented
5. SHOULD: existing user, admin, dev docs in `{{DOCS_DIR}}`
6. SHOULD: API contracts in `{{API_CONTRACTS_DIR}}`
7. MAY: screenshots, UI walkthroughs
8. Targets: user/admin/dev/API docs, changelog

## PM Architect Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Audit/PM-ARCHITECT.md`
3. MUST: `{{ARCHITECTURE_DOC}}`
4. MUST: `{{BUILD_ORDER_DOC}}`
5. MUST: `{{QUESTIONS_DIR}}` (open)
6. MUST: open escalations
7. SHOULD: blueprint materials
8. SHOULD: suggestions docs
9. MAY: prior journal entries for context
10. Targets: architecture docs, module specs, blueprints, question resolutions, ratification proposals

## Code Reviewer Load Order

1. MUST: `{{SHARED_CONTEXT_PATH}}`
2. MUST: `{{AGENTS_DIR}}/Review/CODE-REVIEWER.md`
3. MUST: `{{CODE_STYLE_DOC}}`
4. MUST: `{{AGENTS_DIR}}/Orchestrator/02-DEFINITION-OF-DONE.md`
5. MUST: the PR diff
6. SHOULD: the dispatch prompt that produced the PR
7. SHOULD: contract or schema files the PR touches
8. MAY: related stories or fixtures
9. Targets: PR review comments, approve or request changes

## Loading Rule

If a "MUST" file does not exist when an agent loads context, the agent stops and pings the Orchestrator with a refusal naming the missing file. The Orchestrator either creates the file via the appropriate agent, or escalates under R-12 if a new role is needed to author it.
