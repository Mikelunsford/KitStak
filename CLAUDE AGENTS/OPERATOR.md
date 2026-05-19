# Operator Guide

For you. Plain English. Copy / paste the prompts as written and you'll be running a professional-grade agent team in under 10 minutes.

If you ever forget something, come back here. This is the only file you need to read.

---

## 60-second mental model

You have a team of about 30 specialist agents living in this folder. You never have to remember their names.

The flow is always the same:

1. **You describe what you want** in your own words.
2. **The Router** picks the right team for the job.
3. **The Orchestrator** runs the team and reports back.
4. **The Validator** makes sure nobody stepped on anyone's toes.

You stay in plain English. The kit handles the rest.

---

## Phase 1: First time on a project (do once)

Open Claude in your project folder. Copy and paste these three prompts in order. Wait for each to finish before sending the next.

### Step 1: Set the project up

```
Please load PROJECT-INIT.md from the CLAUDE AGENTS folder and run it against this repo. Scan what you can. Ask me anything you cannot figure out. When done, write a PROJECT.md file at the repo root.
```

Claude will look at your code, guess as much as it can (framework, database, hosting, etc.), and ask you a few simple questions for the rest. End result: a filled-in `PROJECT.md` file at your repo root.

### Step 2: Trim the team to fit

```
Please look at the PROJECT.md you just wrote, then look at the agents in CLAUDE AGENTS. Recommend which agents I should remove because they do not apply to my project. Show me the list before deleting anything.
```

Example: any agent whose corresponding `PROJECT.md` field is `n/a` (no mobile app, no analytics provider, no compliance regime, no whitelabel library, etc.) is removed. You approve the trim list before any file is deleted.

### Step 3: Run the health check

```
Please load KIT-VALIDATOR.md and run all eight checks. Write the result to the journal as kit-health.md and tell me if anything is yellow or red.
```

You want **green**. Yellow is fine to start, you can fix later. Red means something is wrong (two agents claim the same job, a setting is missing, etc.) and you should fix that before doing real work.

You are now armed and ready.

---

## Phase 2: Every session (use whenever you want work done)

You never tell Claude "hey use the Backend Engineer." You describe the outcome and the Router picks.

The opening line of every session is the same:

```
Use the Agent Router. <one or two sentences describing what you want>.
```

That's it. The Router will respond with a plan: who it wants to dispatch, in what order, and why. You approve, adjust, or change direction.

### Examples (copy / paste, edit the description)

Building something new:
```
Use the Agent Router. I want to add a referral program where users can invite friends and get credit when they sign up.
```

Fixing a bug:
```
Use the Agent Router. Customers say the password reset email never arrives. Figure out why and fix it.
```

Production is on fire:
```
Use the Agent Router. The site is down for everyone. This is urgent.
```

Things feel slow:
```
Use the Agent Router. Checkout takes 5 seconds and customers are complaining.
```

Cleaning up drift:
```
Use the Agent Router. Audit the project for drift between PROJECT.md and the actual code. I want a prioritized list of what to fix.
```

Cost is too high:
```
Use the Agent Router. My hosting bill jumped 40 percent. Find out why and recommend cuts.
```

Vendor integration:
```
Use the Agent Router. Add Stripe so we can charge customers.
```

Privacy / data request:
```
Use the Agent Router. A customer asked for all their data to be deleted. Walk me through it.
```

Release time:
```
Use the Agent Router. I think we are ready to ship. Run the release readiness check.
```

Onboarding pain:
```
Use the Agent Router. New users keep dropping off in the first 5 minutes. Help me figure out why.
```

Accessibility concern:
```
Use the Agent Router. I want a full accessibility audit on our top 3 pages.
```

Strategic question:
```
Use the Agent Router. Should we build feature X ourselves or use a vendor? Give me the trade-offs.
```

If you are not sure which category your work falls into, just describe it and let the Router classify. It will ask if it gets stuck.

---

## Phase 3: During a session (how to steer)

The Router will hand you a **Dispatch Plan** before any agent starts working. It looks roughly like this:

```
Plan:
Cycle 1 (parallel):
- PM Architect: write referral spec
- Database Engineer: design referral_codes table

Cycle 2 (after cycle 1):
- Migrations Engineer: ship the schema
- Backend Engineer: build the endpoints
- Frontend Engineer: build the invite UI
...
```

You have four ways to respond:

**Approve as-is:**
```
Looks good. Proceed.
```

**Tweak it:**
```
Looks good but skip the Performance Engineer for now, we can profile after launch. Also add Accessibility Engineer so we cover keyboard navigation.
```

**Change scope:**
```
Actually I just want a quick spec for now, do not build yet. Stop after PM Architect.
```

**Pause:**
```
Hold on. I want to think about this. Save the plan and we will pick up tomorrow.
```

### When an agent comes back to you

Every agent that finishes work returns a **handoff summary**: what they did, which gates passed, what is open. The Orchestrator reads it, checks it against the plan, and either accepts or sends back.

When you see a handoff, you can:

**Accept and continue:**
```
Looks good, move on to the next cycle.
```

**Ask for more detail:**
```
Walk me through the security gate result in plain English.
```

**Reject:**
```
This does not match what I asked for. The referral code should be 8 letters not 6. Send it back.
```

### When you want to escalate or pause

```
Pause everything. I need to think about a constitutional change.
```

```
Stop. I have a question about <topic>.
```

```
Roll back the last dispatch.
```

---

## Phase 4: After a session (wrapping up)

End every working session with one of these:

**End-of-session journal:**
```
Wrap up the session. Write a one-page summary in the journal: what we did, what is open, what is the next obvious step.
```

**Before phase exit:**
```
Run the phase exit ceremony. Walk through the Definition of Done for the current phase. Show me anything that is not green yet.
```

**Before a release:**
```
Use the Agent Router. We want to ship. Run release readiness.
```

**Periodic check-up (do monthly):**
```
Run the Kit Validator and the Tech Debt Auditor. Show me the kit health and the top 10 debt items.
```

---

## Cheat sheet: how the Router classifies your words

You do not need to memorize this. It is here so you can sanity-check the Router's pick. Common phrases and which team you'll get:

| What you say | What team you get |
| --- | --- |
| "add / build / ship / implement" | New Feature team (PM, DB, Backend, Frontend, QA, Docs, Reviewer) |
| "broken / fix / regression" | Bug Fix team (QA, owning Build agent, Reviewer) |
| "down / outage / customers report" | Incident team (Commander, DevOps, Build, Support) |
| "slow / p95 / bundle / bloated" | Performance team (Performance, Migrations, Build) |
| "vulnerability / leak / exposure / bypass" | Security team (Security, Threat Modeler, Privacy, Build) |
| "messy / drift / cleanup / refactor" | Drift team (Tech Debt, PM, Build agents, Reviewer) |
| "bill / spend / expensive" | Cost team (Cost, Performance, DevOps) |
| "Stripe / Slack / vendor / webhook" | Integration team (Integrations, Security, Privacy, Backend) |
| "ship / release / deploy / go live" | Release team (Release Manager, DevOps, Support, Acceptance) |
| "new dev / onboarding / activation" | Onboarding team (Onboarding, Docs) |
| "confusing / users complain / low conversion" | UX team (UX Auditor, Support, Frontend) |
| "screen reader / keyboard / WCAG / a11y" | Accessibility team |
| "roadmap / what's next / should we" | Strategic team (PM Architect drafts options) |

---

## When things go sideways

**The Router seems confused:**
```
The plan does not match what I want. Let me restate: <plain English re-statement>.
```

**Two agents seem to be doing the same thing:**
```
Stop. Run the Kit Validator. I think there is an ownership collision.
```

**A handoff summary makes no sense to you:**
```
Explain this handoff in plain English. Pretend I am a non-technical founder.
```

**You disagree with an escalation:**
```
I do not want to escalate this. Decide it autonomously and document the rationale in the journal.
```

**You want to add a new agent:**
```
I want to add a new agent for <role>. Draft the agent file using the same shape as the existing ones, then run the Kit Validator to make sure it does not collide.
```

**You want to delete an agent:**
```
Remove the <name> agent from the kit. Update the Router and the README. Re-run the Kit Validator.
```

**You changed PROJECT.md and want to reapply:**
```
PROJECT.md changed. Re-trim the roster, re-run the Kit Validator, and tell me what is different.
```

---

## Glossary (no jargon)

- **Constitution**: the rules of your project, written in `PROJECT.md` and the shared context file. It tells the agents what is sacred (money math, security, who owns what).
- **Phase**: a chunk of work. Could be "Wave 1," "Sprint 12," or "MVP." Defined in your `PROJECT.md`.
- **Dispatch**: when the Orchestrator hands a job to one specialist agent.
- **Hand-off**: the report an agent returns when its job is done.
- **Gate**: a check that has to pass before code can ship (tests pass, security clean, docs updated, etc.).
- **DoD (Definition of Done)**: the full checklist of gates.
- **Cycle**: one round of dispatches. Usually a few agents working in parallel.
- **R-NN escalation**: a numbered rule that forces the kit to ask you instead of deciding alone. Constitution changes, security findings, vendor swaps, etc.
- **Red / Yellow / Green**: the validator's traffic light. Green is good. Yellow is a watch. Red blocks work.

---

## Your daily mantra

> Describe the outcome, not the steps.

If you ever catch yourself typing "tell the Backend Engineer to..." stop and rewrite as "I want X to work." Let the Router pick. That is the whole point of the kit.

You got this.
