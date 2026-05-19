# Agent Config Template

Every agent in this kit reads from a single project configuration block. Copy this file into your project root (or fill it in at the top of each agent when you instantiate it for a new project) and the agents will adapt to that project's stack, paths, and phasing.

## How to use

1. Copy this kit into a new project, or keep it central and reference it.
2. Fill in the variables below. Anything inside `{{DOUBLE_BRACES}}` is a placeholder the agents will look up.
3. Optionally drop project-specific overrides into a `PROJECT.md` next to the kit so the agents pick them up automatically.

## Required variables

```yaml
project:
  name: "{{PROJECT_NAME}}"
  short_code: "{{PROJECT_CODE}}"
  description: "{{ONE_LINE_DESCRIPTION}}"

stack:
  frontend: "{{FRONTEND_STACK}}"
  backend: "{{BACKEND_STACK}}"
  database: "{{DATABASE}}"
  hosting: "{{HOSTING}}"
  auth: "{{AUTH_PROVIDER}}"
  testing: "{{TEST_STACK}}"
  ci: "{{CI_PROVIDER}}"
  mobile: "{{MOBILE_STACK}}"
  analytics_provider: "{{ANALYTICS_PROVIDER}}"
  observability_sink: "{{OBSERVABILITY_SINK}}"
  load_tool: "{{LOAD_TOOL}}"
  bundle_tool: "{{BUNDLE_TOOL}}"
  design_system_stack: "{{DS_STACK}}"

paths:
  repo_root: "{{REPO_ROOT}}"
  shared_context: "{{SHARED_CONTEXT_PATH}}"
  agents_dir: "{{AGENTS_DIR}}"
  api_contracts: "{{API_CONTRACTS_DIR}}"
  db_schemas: "{{DB_SCHEMAS_DIR}}"
  migrations: "{{MIGRATIONS_DIR}}"
  tests: "{{TESTS_DIR}}"
  docs: "{{DOCS_DIR}}"
  journal: "{{JOURNAL_DIR}}"
  escalations: "{{ESCALATIONS_DIR}}"
  questions: "{{QUESTIONS_DIR}}"
  blueprint: "{{BLUEPRINT_DIR}}"
  deploy: "{{DEPLOY_DIR}}"
  ci_dir: "{{CI_DIR}}"
  design_system: "{{DS_DIR}}"
  whitelabel_lib: "{{WHITELABEL_LIB_DIR}}"
  plugins: "{{PLUGINS_DIR}}"
  types_file: "{{TYPES_FILE}}"

reference_docs:
  architecture: "{{ARCHITECTURE_DOC}}"
  build_order: "{{BUILD_ORDER_DOC}}"
  code_style: "{{CODE_STYLE_DOC}}"
  naming_conventions: "{{NAMING_CONVENTIONS_DOC}}"
  comms_protocol: "{{COMMS_PROTOCOL_DOC}}"
  glossary: "{{GLOSSARY_DOC}}"
  dx_testing: "{{DX_TESTING_DOC}}"

phasing:
  model: "{{PHASING_MODEL}}"
  phases:
    - "{{PHASE_1_NAME}}"
    - "{{PHASE_2_NAME}}"
    - "{{PHASE_3_NAME}}"
    # add as many as your project has

conventions:
  branch_pattern: "{{BRANCH_PATTERN}}"
  commit_style: "{{COMMIT_STYLE}}"
  money_handling: "{{MONEY_RULE}}"
  tenant_model: "{{TENANT_MODEL}}"
  api_envelope: "{{API_ENVELOPE}}"
  state_pattern: "{{STATE_PATTERN}}"

quality_targets:
  a11y_target: "{{A11Y_TARGET}}"
  coverage_floor: "{{COVERAGE_FLOOR}}"
  perf_budgets: "{{PERF_BUDGETS}}"
  themes: "{{THEMES}}"
  compliance_regimes: "{{COMPLIANCE_REGIMES}}"

tooling:
  types_regen_command: "{{TYPES_REGEN_COMMAND}}"

policy:
  banned_dependencies: []
  required_dependencies: []
  custom_rules: []
```

## Example values

These show the kind of value each variable expects. Replace with your own in `PROJECT.md`.

- `{{PROJECT_NAME}}`: "Acme CRM"
- `{{PROJECT_CODE}}`: "ACR1"
- `{{ONE_LINE_DESCRIPTION}}`: "Internal CRM for Acme sales team."
- `{{FRONTEND_STACK}}`: "React + Vite + TanStack Query"
- `{{BACKEND_STACK}}`: "Supabase Edge Functions" or "Node + Express" or "Django"
- `{{DATABASE}}`: "PostgreSQL", "MySQL", "MongoDB"
- `{{HOSTING}}`: "Vercel", "AWS", "Fly.io"
- `{{AUTH_PROVIDER}}`: "Supabase Auth", "Auth0", "Clerk"
- `{{TEST_STACK}}`: "Vitest + Playwright"
- `{{CI_PROVIDER}}`: "GitHub Actions", "CircleCI"
- `{{MOBILE_STACK}}`: "React Native + Expo" or "n/a"
- `{{ANALYTICS_PROVIDER}}`: "PostHog", "Mixpanel", "n/a"
- `{{OBSERVABILITY_SINK}}`: "Sentry", "Datadog"
- `{{LOAD_TOOL}}`: "k6", "locust"
- `{{BUNDLE_TOOL}}`: "size-limit"
- `{{DS_STACK}}`: "Storybook + Tailwind + Radix"
- `{{REPO_ROOT}}`: "." or absolute path
- `{{SHARED_CONTEXT_PATH}}`: "/docs/CONTEXT.md"
- `{{AGENTS_DIR}}`: "/CLAUDE AGENTS"
- `{{API_CONTRACTS_DIR}}`: "/api"
- `{{DB_SCHEMAS_DIR}}`: "/db"
- `{{MIGRATIONS_DIR}}`: "/db/migrations" or "/supabase/migrations"
- `{{TESTS_DIR}}`: "/tests"
- `{{DOCS_DIR}}`: "/docs"
- `{{JOURNAL_DIR}}`: "/journal"
- `{{ESCALATIONS_DIR}}`: "/journal/escalations"
- `{{QUESTIONS_DIR}}`: "/questions"
- `{{BLUEPRINT_DIR}}`: "/blueprint"
- `{{DEPLOY_DIR}}`: "/deploy"
- `{{CI_DIR}}`: "/.github/workflows"
- `{{DS_DIR}}`: "/design-system"
- `{{WHITELABEL_LIB_DIR}}`: "/lib/whitelabel"
- `{{PLUGINS_DIR}}`: "/lib/plugins"
- `{{TYPES_FILE}}`: "/lib/db/types.gen.ts"
- `{{ARCHITECTURE_DOC}}`: "/docs/architecture.md"
- `{{BUILD_ORDER_DOC}}`: "/docs/build-order.md"
- `{{CODE_STYLE_DOC}}`: "/docs/code-style.md"
- `{{NAMING_CONVENTIONS_DOC}}`: "/docs/naming.md"
- `{{COMMS_PROTOCOL_DOC}}`: "/docs/comms.md"
- `{{GLOSSARY_DOC}}`: "/docs/glossary.md"
- `{{DX_TESTING_DOC}}`: "/docs/dx-testing.md"
- `{{PHASING_MODEL}}`: "Waves", "Milestones", "Sprints", "n/a"
- `{{PHASE_1_NAME}}`, `{{PHASE_2_NAME}}`, `{{PHASE_3_NAME}}`, ...: ordered list of phase names, e.g. "Foundations", "Identity", "Core", "Hardening"
- `{{BRANCH_PATTERN}}`: "<phase>/<domain>/<slug>"
- `{{COMMIT_STYLE}}`: "Conventional Commits"
- `{{MONEY_RULE}}`: "integer cents in bigint" or "n/a"
- `{{TENANT_MODEL}}`: "multi-tenant via org_id + RLS" or "single-tenant"
- `{{API_ENVELOPE}}`: "{ data, error, meta }" or "n/a"
- `{{STATE_PATTERN}}`: "server state in React Query; UI state in component"
- `{{A11Y_TARGET}}`: "WCAG 2.1 AA"
- `{{COVERAGE_FLOOR}}`: "70%"
- `{{PERF_BUDGETS}}`: "TTI < 3s, LCP < 2.5s, bundle < 250kb"
- `{{THEMES}}`: "light, dark, high-contrast"
- `{{COMPLIANCE_REGIMES}}`: "SOC2, GDPR" or "[]"
- `{{TYPES_REGEN_COMMAND}}`: "pnpm db:types"

## How agents read this

Each agent file starts with a "Project Configuration" section that points at this file. When you start a new session for a project, either:

- Tell the agent "use the PROJECT.md in this repo," or
- Paste the filled-in YAML at the start of the conversation.

The agent will substitute placeholders with your values. Any rule that does not apply to your project can be marked `n/a` and the agent will skip those checks.

## Copying for a new project

1. Duplicate the whole `CLAUDE AGENTS` folder into the new repo (or symlink it).
2. Create a `PROJECT.md` in the repo with the YAML above filled in.
3. Edit any agent's "Tailored Defaults" section if you want stricter or looser rules than the defaults.
4. Run the Kit Validator. Fix any reds.
5. Start your orchestrator session by pointing it at `PROJECT.md` and the orchestrator folder.
