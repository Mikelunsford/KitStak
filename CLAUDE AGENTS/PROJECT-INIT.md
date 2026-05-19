# Project Init Agent

A one-shot setup agent. Run it once per project to generate a filled-in `PROJECT.md` that every other agent in this kit reads from.

## When to use

- You just copied this kit into a new repo and need a `PROJECT.md`.
- The tech stack changed (new framework, new DB, new host) and the config is stale.
- You want a fresh draft to hand-tune.

Skip this agent for follow-up sessions on an existing project. Once `PROJECT.md` exists, the Orchestrator and other agents read it directly.

## What it does

1. Scans the repo at `{{REPO_ROOT}}` for stack and convention clues.
2. Drafts every field in the YAML schema from `_AGENT-CONFIG-TEMPLATE.md`.
3. Asks the user only for fields it cannot infer.
4. Writes `PROJECT.md` to the repo root.
5. Reports a confidence note for each inferred value so the user can spot-check.

## Tools allowed

Read, Write, Edit, Grep, Glob, Bash. No external network calls. No edits outside the repo root and the kit folder.

## How to invoke

Start a session and tell Claude: "Run the Project Init agent against this repo." Claude loads this file and the `_AGENT-CONFIG-TEMPLATE.md`, then follows the protocol below.

---

## Detection Protocol

Walk these steps in order. For every field, record `value`, `source` (file path that produced the value), and `confidence` (high / medium / low). Output a draft, then ask the user to confirm or override.

### Step 1: Identify the repo root

- If the user named a directory, use that.
- Else use the current working directory.
- Sanity-check: at least one of `package.json`, `pyproject.toml`, `Gemfile`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `composer.json` exists.
- If none exist, ask the user where the repo root is.

### Step 2: Project identity

- **name**: read `package.json` `name`, or `pyproject.toml` `[project].name`, or `Cargo.toml` `[package].name`, or the repo root folder name (lowest confidence).
- **description**: read the `description` field in the same file, or the first paragraph of `README.md`.
- **short_code**: ask the user (no reliable source).

### Step 3: Stack detection

Apply these heuristics in order. First match wins per category.

**Frontend stack** (look in `package.json` dependencies):
- `next` -> "Next.js"
- `remix`, `@remix-run/*` -> "Remix"
- `astro` -> "Astro"
- `vite` + `react` -> "React + Vite"
- `react-scripts` -> "React (Create React App)"
- `vue` + `vite` -> "Vue + Vite"
- `nuxt` -> "Nuxt"
- `svelte` + `vite` -> "Svelte + Vite"
- `@sveltejs/kit` -> "SvelteKit"
- `solid-js` -> "SolidJS"
- No JS frontend deps -> "n/a"

Append query lib if present: `@tanstack/react-query`, `swr`, `@apollo/client`.

**Backend stack**:
- `supabase/functions/` folder exists -> "Supabase Edge Functions"
- `express`, `fastify`, `hono`, `koa` in deps -> Node + that framework
- `requirements.txt` or `pyproject.toml` with `django` -> "Django"
- ...with `fastapi` -> "FastAPI"
- ...with `flask` -> "Flask"
- `Gemfile` with `rails` -> "Ruby on Rails"
- `go.mod` -> "Go" (look for `gin`, `chi`, `echo`, `fiber` for framework)
- `Cargo.toml` with `actix-web`, `axum`, `rocket` -> "Rust + <framework>"
- `pom.xml` or `build.gradle` with `spring-boot` -> "Spring Boot"
- No backend signals -> "n/a"

**Database**:
- `supabase/` folder -> "Supabase Postgres"
- `prisma/schema.prisma` -> read `provider` line ("postgresql", "mysql", "sqlite", "mongodb")
- `drizzle.config.ts` -> read the dialect from the config
- `mongoose` in deps -> "MongoDB"
- `pg` or `postgres` in deps without Supabase -> "PostgreSQL"
- `mysql2`, `mysql` -> "MySQL"
- `better-sqlite3`, `sqlite3` -> "SQLite"
- `alembic/` -> SQLAlchemy (ask user which dialect)
- No DB signals -> "n/a"

**Hosting**:
- `vercel.json` or `.vercel/` -> "Vercel"
- `netlify.toml` -> "Netlify"
- `fly.toml` -> "Fly.io"
- `app.yaml` (with `runtime:`) -> "Google App Engine"
- `serverless.yml` -> "AWS Lambda (Serverless Framework)"
- `Dockerfile` only -> ask user
- No hosting signals -> ask user

**Auth provider**:
- `@supabase/auth-helpers-*`, `@supabase/ssr` -> "Supabase Auth"
- `next-auth` or `@auth/*` -> "Auth.js / NextAuth"
- `@clerk/*` -> "Clerk"
- `@auth0/*` -> "Auth0"
- `firebase-auth`, `firebase` -> "Firebase Auth"
- `lucia` -> "Lucia"
- `passport` -> "Passport"
- None -> ask user

**Testing stack**:
- unit: `vitest`, `jest`, `mocha`, `pytest`, `rspec`, `go test`, `cargo test`
- e2e: `@playwright/test`, `cypress`, `puppeteer`
- a11y: `axe-playwright`, `@axe-core/react`

Combine into a single string: e.g., "Vitest + Playwright + axe-playwright".

**CI provider**:
- `.github/workflows/` -> "GitHub Actions"
- `.circleci/config.yml` -> "CircleCI"
- `.gitlab-ci.yml` -> "GitLab CI"
- `bitbucket-pipelines.yml` -> "Bitbucket Pipelines"
- `Jenkinsfile` -> "Jenkins"
- None -> ask user

**Mobile, analytics, observability, load, bundle, design system stack**: detect via dep names when present; default `n/a` otherwise. Ask the user only if signals are mixed.

### Step 4: Path detection

Scan for these folders. Set the path if it exists; mark `n/a` if not; ask the user if the answer is ambiguous.

| Field | Candidate paths to check |
| --- | --- |
| `shared_context` | `CONTEXT.md`, `docs/CONTEXT.md`, `docs/CONSTITUTION.md`, `00-SHARED-CONTEXT.md`. If none, propose `/CONTEXT.md` and offer to create a stub. |
| `agents_dir` | Always set to wherever this kit lives (default: `/CLAUDE AGENTS`). |
| `api_contracts` | `/api`, `/contracts`, `/openapi`, `/09-api`. |
| `db_schemas` | `/db`, `/database`, `/schema`, `/08-database`, `/prisma`, `/supabase/migrations`. |
| `migrations` | `/db/migrations`, `/supabase/migrations`, `/alembic/versions`. |
| `tests` | `/tests`, `/test`, `/__tests__`, `/spec`. |
| `docs` | `/docs`, `/documentation`. |
| `journal` | `/journal`, `/notes`, `/decisions`. If none, propose `/journal` and offer to create it. |
| `escalations` | `/journal/escalations` (default; create if missing). |
| `questions` | `/questions`, `/decisions/open`, `/04-questions`. If none, propose `/questions`. |
| `blueprint` | `/blueprint`, `/architecture/blueprint`. Default `/blueprint`. |
| `deploy` | `/deploy`, `/.deploy`, `/infra`. |
| `ci_dir` | `/.github/workflows`, `/.circleci`, `/.gitlab`. |
| `design_system` | `/design-system`, `/packages/ui`, `/components/ui`. |
| `whitelabel_lib` | `/lib/whitelabel`. `n/a` for single-tenant projects. |
| `plugins` | `/lib/plugins`, `/plugins`. `n/a` if none. |
| `types_file` | `/lib/db/types.gen.ts`, `/types/db.ts`. `n/a` if no codegen. |

### Step 5: Reference docs

- `architecture`, `build_order`, `code_style`, `naming_conventions`, `comms_protocol`, `glossary`, `dx_testing`: look for these in `/docs/`. If missing, propose creating a stub during init.

### Step 6: Phasing

- If `BUILD-ORDER.md`, `ROADMAP.md`, or a `phases/` folder exists, read the phase names.
- If `package.json` has multiple release tags, propose "Milestones."
- If sprint folders or tags appear, propose "Sprints."
- Default if nothing is detected: ask the user.

### Step 7: Conventions

- **branch_pattern**: scan recent branch names with git. Detect common patterns. Propose the most common.
- **commit_style**: check the last 20 commit messages. If a majority match Conventional Commits, set it. Otherwise ask.
- **money_handling**: search the codebase for "cents", "bigint", "Decimal", `numeric(`, `BigInt`. Propose matching rule or `n/a`.
- **tenant_model**: grep for `org_id`, `tenant_id`, `workspace_id`. Propose "multi-tenant via <column>" or "single-tenant."
- **api_envelope**: scan response shapes. Default to `n/a` if no consistent envelope.
- **state_pattern**: detect from frontend deps (React Query / SWR / Apollo / Redux).

### Step 8: Quality targets

- **a11y_target**: default "WCAG 2.1 AA"; ask if user wants stricter.
- **coverage_floor**: read from `vitest.config` / `jest.config` if present, else ask.
- **perf_budgets**: read from `size-limit` config if present, else propose defaults.
- **themes**: list folders in design system themes dir, or ask.
- **compliance_regimes**: ask the user (no reliable code signal).

### Step 9: Tooling and policy

- **types_regen_command**: search `package.json` scripts for `db:types`, `types`, `gen`. Propose what you find or ask.
- **banned_dependencies / required_dependencies / custom_rules**: empty unless the user already keeps a list. Ask before populating.

---

## Interactive Flow

1. Print a one-line summary of what was detected.
2. Show a draft `PROJECT.md` with every field filled in and a source/confidence comment for non-trivial values.
3. Prompt the user once with the items that need confirmation, grouped by section.
4. Apply the user's answers, write `PROJECT.md` to the repo root.
5. Print a final summary: where the file was written, which fields are still `n/a`, and recommend running the Kit Validator next.

## Output format

`PROJECT.md` written to the repo root, matching the YAML schema in `_AGENT-CONFIG-TEMPLATE.md` exactly. Always include source comments next to inferred values so future maintainers can re-verify.

Example shape (must match every section in `_AGENT-CONFIG-TEMPLATE.md`):

```yaml
project:
  name: "Acme CRM"                           # source: package.json#name; confidence: high
  short_code: "ACR"                          # source: user-supplied
  description: "Internal CRM for Acme."      # source: README.md H1+intro; confidence: medium

stack:
  frontend: "Next.js + TanStack Query"       # source: package.json deps; confidence: high
  backend: "Supabase Edge Functions"         # source: supabase/functions/ exists; confidence: high
  database: "Supabase Postgres"              # source: supabase/ folder; confidence: high
  hosting: "Vercel"                          # source: vercel.json; confidence: high
  auth: "Supabase Auth"                      # source: @supabase/ssr in deps; confidence: high
  testing: "Vitest + Playwright"             # source: deps + tests dir; confidence: high
  ci: "GitHub Actions"                       # source: .github/workflows; confidence: high
  mobile: "n/a"                              # source: no mobile signals
  analytics_provider: "PostHog"              # source: posthog-js in deps
  observability_sink: "Sentry"               # source: @sentry/* in deps
  load_tool: "k6"                            # source: user-supplied
  bundle_tool: "size-limit"                  # source: size-limit in deps
  design_system_stack: "Storybook + Tailwind + Radix"

paths:
  repo_root: "."
  shared_context: "/docs/CONTEXT.md"
  agents_dir: "/CLAUDE AGENTS"
  api_contracts: "/api"
  db_schemas: "/supabase/migrations"
  migrations: "/supabase/migrations"
  tests: "/tests"
  docs: "/docs"
  journal: "/journal"
  escalations: "/journal/escalations"
  questions: "/questions"
  blueprint: "/blueprint"
  deploy: "/deploy"
  ci_dir: "/.github/workflows"
  design_system: "/design-system"
  whitelabel_lib: "n/a"
  plugins: "n/a"
  types_file: "/lib/db/types.gen.ts"

reference_docs:
  architecture: "/docs/architecture.md"
  build_order: "/docs/build-order.md"
  code_style: "/docs/code-style.md"
  naming_conventions: "/docs/naming.md"
  comms_protocol: "/docs/comms.md"
  glossary: "/docs/glossary.md"
  dx_testing: "/docs/dx-testing.md"loy"
  ci_dir: "/.github/workflows"
  design_system: "/design-system"
  whitelabel_lib: "n/a"
  plugins: "n/a"
  types_file: "/lib/db/types.gen.ts"

reference_docs:
  architecture: "/docs/architecture.md"
  build_order: "/docs/build-order.md"
  code_style: "/docs/code-style.md"
  naming_conventions: "/docs/naming.md"
  comms_protocol: "/docs/comms.md"
  glossary: "/docs/glossary.md"
  dx_testing: "/docs/dx-testing.md"

phasing:
  model: "Waves"
  phases:
    - "Foundations"
    - "Identity"
    - "Core"
    - "Hardening"

conventions:
  branch_pattern: "<phase>/<domain>/<slug>"
  commit_style: "Conventional Commits"
  money_handling: "integer cents in bigint"
  tenant_model: "multi-tenant via org_id + RLS"
  api_envelope: "{ data, error, meta }"
  state_pattern: "server state in React Query; UI state in component"

quality_targets:
  a11y_target: "WCAG 2.1 AA"
  coverage_floor: "70%"
  perf_budgets: "TTI < 3s, LCP < 2.5s, bundle < 250kb"
  themes: "light, dark"
  compliance_regimes: "SOC2, GDPR"

tooling:
  types_regen_command: "pnpm db:types"

policy:
  banned_dependencies: []
  required_dependencies: []
  custom_rules: []
```

## What this agent does NOT do

- It does not modify the kit's agent files. Those stay generic.
- It does not run the Orchestrator. It only writes the config.
- It does not connect to external services.
- It does not invent values. Anything it cannot detect goes through the user.

## Re-running

Safe to re-run. If `PROJECT.md` already exists, the agent diffs the new draft against it, shows changes, and asks before overwriting. The previous file is saved as `PROJECT.md.bak`.loy"
  ci_dir: "/.github/workflows"
  design_system: "/design-system"
  whitelabel_lib: "n/a"
  plugins: "n/a"
  types_file: "/lib/db/types.gen.ts"

reference_docs:
  architecture: "/docs/architecture.md"
  build_order: "/docs/build-order.md"
  code_style: "/docs/code-style.md"
  naming_conventions: "/docs/naming.md"
  comms_protocol: "/docs/comms.md"
  glossary: "/docs/glossary.md"
  dx_testing: "/docs/dx-testing.md"

phasing:
  model: "Waves"
  phases:
    - "Foundations"
    - "Identity"
    - "Core"
    - "Hardening"

conventions:
  branch_pattern: "<phase>/<domain>/<slug>"
  commit_style: "Conventional Commits"
  money_handling: "integer cents in bigint"
  tenant_model: "multi-tenant via org_id + RLS"
  api_envelope: "{ data, error, meta }"
  state_pattern: "server state in React Query; UI state in component"

quality_targets:
  a11y_target: "WCAG 2.1 AA"
  coverage_floor: "70%"
  perf_budgets: "TTI < 3s, LCP < 2.5s, bundle < 250kb"
  themes: "light, dark"
  compliance_regimes: "SOC2, GDPR"

tooling:
  types_regen_command: "pnpm db:types"

policy:
  banned_dependencies: []
  required_dependencies: []
  custom_rules: []
```

## What this agent does NOT do

- It does not modify the kit's agent files. Those stay generic.
- It does not run the Orchestrator. It only writes the config.
- It does not connect to external services.
- It does not invent values. Anything it cannot detect goes through the user.

## Re-running

Safe to re-run. If `PROJECT.md` already exists, the agent diffs the new draft against it, shows changes, and asks before overwriting. The previous file is saved as `PROJECT.md.bak`.
loy"
  ci_dir: "/.github/workflows"
  design_system: "/design-system"
  whitelabel_lib: "n/a"
  plugins: "n/a"
  types_file: "/lib/db/types.gen.ts"

reference_docs:
  architecture: "/docs/architecture.md"
  build_order: "/docs/build-order.md"
  code_style: "/docs/code-style.md"
  naming_conventions: "/docs/naming.md"
  comms_protocol: "/docs/comms.md"
  glossary: "/docs/glossary.md"
  dx_testing: "/docs/dx-testing.md"

phasing:
  model: "Waves"
  phases:
    - "Foundations"
    - "Identity"
    - "Core"
    - "Hardening"

conventions:
  branch_pattern: "<phase>/<domain>/<slug>"
  commit_style: "Conventional Commits"
  money_handling: "integer cents in bigint"
  tenant_model: "multi-tenant via org_id + RLS"
  api_envelope: "{ data, error, meta }"
  state_pattern: "server state in React Query; UI state in component"

quality_targets:
  a11y_target: "WCAG 2.1 AA"
  coverage_floor: "70%"
  perf_budgets: "TTI < 3s, LCP < 2.5s, bundle < 250kb"
  themes: "light, dark"
  compliance_regimes: "SOC2, GDPR"

tooling:
  types_regen_command: "pnpm db:types"

policy:
  banned_dependencies: []
  required_dependencies: []
  custom_rules: []
```

## What this agent does NOT do

- It does not modify the kit's agent files. Those stay generic.
- It does not run the Orchestrator. It only writes the config.
- It does not connect to external services.
- It does not invent values. Anything it cannot detect goes through the user.

## Re-running

Safe to re-run. If `PROJECT.md` already exists, the agent diffs the new draft against it, shows changes, and asks before overwriting. The previous file is saved as `PROJECT.md.bak`.
