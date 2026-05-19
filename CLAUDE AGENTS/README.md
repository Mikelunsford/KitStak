# Claude Agents Kit

A reusable orchestrator + sub-agent kit. Copy this whole folder into any project, fill in `PROJECT.md`, and a router decides which agents to run for any task you describe in plain English.

## Folder layout

```
CLAUDE AGENTS/
|-- _AGENT-CONFIG-TEMPLATE.md     Project config schema (the variables every agent reads)
|-- PROJECT-INIT.md               One-shot setup agent that drafts PROJECT.md from your repo
|-- AGENT-ROUTER.md               The "filter": maps plain English to a dispatch plan
|-- KIT-VALIDATOR.md              Health-check the kit before arming and at every phase exit
|-- OPERATOR.md                   Plain-English plug-and-play guide. Start here.
|-- README.md                     This file
|
|-- Orchestrator/                 The single agent that plans, dispatches, and gates
|   |-- 00-ORCHESTRATOR-PROMPT.md
|   |-- 01-DISPATCH-PROTOCOL.md
|   |-- 02-DEFINITION-OF-DONE.md
|   |-- 03-ESCALATION-RULES.md
|   `-- 04-CONTEXT-LOADING-ORDER.md
|
|-- Audit/                        Strategy, design, and review of the system
|   |-- PM-ARCHITECT.md
|   |-- DATABASE-ENGINEER.md
|   |-- PERFORMANCE-ENGINEER.md
|   |-- TECH-DEBT-AUDITOR.md
|   |-- COST-AUDITOR.md
|   `-- UX-AUDITOR.md
|
|-- Build/                        Engineers who ship code
|   |-- BACKEND-ENGINEER.md
|   |-- FRONTEND-ENGINEER.md
|   |-- DESIGN-SYSTEM-ENGINEER.md
|   |-- DEVOPS-ENGINEER.md
|   |-- MIGRATIONS-ENGINEER.md
|   |-- DOCS-WRITER.md
|   |-- INTEGRATIONS-ENGINEER.md
|   `-- ACCESSIBILITY-ENGINEER.md
|
|-- Review/                       Gatekeepers who guard merge and ship
|   |-- CODE-REVIEWER.md
|   |-- QA-ENGINEER.md
|   |-- RELEASE-MANAGER.md
|   `-- ACCEPTANCE-TESTER.md
|
|-- Security/                     Security and privacy gatekeepers
|   |-- SECURITY-REVIEWER.md
|   |-- PRIVACY-OFFICER.md
|   `-- THREAT-MODELER.md
|
`-- Operations/                   Live-system and human-process agents
    |-- INCIDENT-COMMANDER.md
    |-- SUPPORT-ENGINEER.md
    `-- ONBOARDING-ENGINEER.md
```

24 specialist agent files (6 Audit + 8 Build + 4 Review + 3 Security + 3 Operations) plus 5 Orchestrator files plus Router, Validator, Init, Operator, and Config template = a full kit.

> **Note:** This kit was scrubbed for Kitstak on 2026-05-18. Compliance Auditor, Analytics Engineer, Mobile Engineer, and Whitelabel Engineer were removed because `PROJECT.md` marks `compliance_regimes`, `analytics_provider`, `mobile`, and `whitelabel_lib` as `n/a`. Restore from a fresh kit copy if you need any of them back.

## How to use on a new project

1. **Copy** this folder into your project (or keep it central and symlink it).
2. **Run the Project Init agent.** Tell Claude: "Run the Project Init agent against this repo," pointing it at `PROJECT-INIT.md`. It scans the repo, infers stack/paths/conventions, asks you only what it cannot detect, and writes a filled-in `PROJECT.md` to the repo root.
3. **Trim** any further agents you don't need. The router auto-skips trimmed agents based on `PROJECT.md`.
4. **Run the Kit Validator.** Tell Claude: "Run the Kit Validator." It checks for ownership collisions, contradictions, missing placeholders, broken roster references, and config gaps. Must be green before any dispatch.
5. **Start by describing what you want in plain English.** Tell Claude: "Use the Agent Router. I want to <thing>." The router proposes a dispatch plan, the Orchestrator executes.

## How the router works

You describe work in your own words. The router classifies it (new feature, bug, incident, perf issue, security finding, refactor, cost cut, vendor integration, release, onboarding, UX, a11y, strategy, or unclear). For each work type it has a default team. It trims based on your `PROJECT.md` and proposes a Dispatch Plan you approve before anything runs.

You never need to know which agent does what. You describe outcomes.

## Categories at a glance

- **Orchestrator**: the conductor. Reads everything, writes almost nothing.
- **Audit**: strategy, design, drift, cost, UX evaluation.
- **Build**: the agents that write code, schema, infra, docs.
- **Review**: the gatekeepers (code review, QA, release, acceptance).
- **Security**: security, privacy, threat modeling.
- **Operations**: incidents, support, onboarding.

## Drift on an existing project

Drop the kit in, run Project Init, then ask the router: "Audit current state for drift against PROJECT.md." It dispatches Tech Debt Auditor, PM Architect, Security Reviewer, and Performance Engineer in parallel. You get a drift report before any new work starts.
