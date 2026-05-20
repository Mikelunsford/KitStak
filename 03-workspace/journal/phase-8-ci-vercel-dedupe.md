# Close F-Wave8-CI-VERCEL-DEDUPE-01 — delete duplicative `deploy-preview.yml`

**Date:** 2026-05-20
**Decision:** Pure deletion.
**Filed by:** Operator dispatch following PR #50 / PR #51 audit sweep.

## Context

`F-Wave8-CI-VERCEL-DEDUPE-01` (filed in PR #51 against baseline `8dd0a42`) flagged a duplication on every PR:

- `.github/workflows/deploy-preview.yml` ran `npx vercel pull` then `vercel build` then `vercel deploy --prebuilt` on `pull_request`.
- Vercel's native Git integration is already configured at the project level and also deploys the same preview on every PR commit.

PR #52 and PR #53 check rollups both showed the duplication clearly: the `Vercel` StatusContext (Git integration) and a separate `vercel-preview` CheckRun (the workflow). The duplicative workflow is what burned through the 100/day free-tier deploy quota and turned PR rollups red even when `build` was green, contributing zero code-correctness signal.

## Decision

Delete `.github/workflows/deploy-preview.yml` outright. Reasoning:

1. **Single source of truth.** Vercel's Git integration covers PR previews; the CLI workflow is redundant.
2. **Quota pressure.** The duplicative job was the proximate cause of free-tier exhaustion and red PR rollups.
3. **Reversibility.** If a future need arises (e.g. preview deploys gated on a label, or a non-Vercel preview target), write a new workflow forward-only rather than resurrect this file.

`.github/workflows/deploy-prod.yml` is **retained, untouched**. The operator explicitly wants the explicit CLI deploy on `main` push as belt-and-suspenders for production. Same Vercel project, different purpose.

## Changes shipped in this PR

- `.github/workflows/deploy-preview.yml` — deleted (23 lines).
- `STATUS.md` — moved `F-Wave8-CI-VERCEL-DEDUPE-01` out of the Phase 8 carryover bucket into a new "Closed in this session (Phase 8 follow-up batch)" bucket; date stamp bumped to 2026-05-20.
- This journal entry.

## Verification

Gates green locally on the deletion-only diff (no app code touched, byte-mirror parity untouched, no migrations, no side-car drift).

## Constitutional alignment

- **Forward-only mindset:** deletion is fine; any future preview-deploy need writes a new workflow rather than resurrecting this file.
- **TS1 read-only zone:** untouched.
- **Side-car parity:** untouched (no side-car files involved).
- **Brand discipline:** no user-facing copy.
- **No new top-level deps.**

## Closes

- `F-Wave8-CI-VERCEL-DEDUPE-01`.

## Preserved

- `.github/workflows/deploy-prod.yml` (explicit CLI prod deploy on `main` push).
