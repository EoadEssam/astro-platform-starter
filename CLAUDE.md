# CLAUDE.md — AMBS Platform (frontend)

Working rules for any Claude session that opens this repository. They come from the owner and apply on every branch.

## What this is

- **AMBS Platform**: a coded, Arabic-first, multi-tenant business-management SaaS for companies. This repo is the **frontend** (Astro 7, static `[lang]` routes, Netlify adapter, Tailwind 4, vitest).
- The backend lives in a separate repo, `EoadEssam/ambs-platform`. Treat it as **read-only** from frontend work.
- The repo started from the Netlify Astro starter, so `main` still holds the template. The app work lives on `claude/*` branches until the owner merges them.
- Do not confuse this with the owner's other project (an ABMS system on Notion for a different business). Do not mention any company name, trade or sector in this repo's README.

## Skills to load first

- `.claude/skills/ambs-platform-working-rules` — standing rules (language, Git, secrets, tests, migrations).
- `.claude/skills/ambs-review-engineer` — the approved launch plan (2026-11-21) and the review procedure. Every task ends with its review report.

## Language and address

- Talk to the owner in **Arabic**, addressing him as **male**. Do not switch to English mid-conversation.
- Commands, code, file names and identifiers stay in English.

## Approved launch plan (owner approval: 2026-11-21)

- Frozen first-launch scope; anything outside it goes to an "after launch" list unless the owner decides otherwise.
- Claude pushes to short work branches (`feat/`, `fix/`, `chore/`, `ci/`) without asking each time. Never to `main`; never force-push a branch Claude did not create.
- GitHub Actions CI is the primary evidence. Ask the owner to run commands only for what needs his machine (local environment, deploy, secrets).
- Rigor by risk: full rigor for security, tenant isolation, identity and permissions, sessions, money and subscriptions. Normal screens and features: tests + green CI + one review.
- API contract first (OpenAPI); screens are built on sample data in parallel with the backend, then wired.

## Never without the owner's explicit approval

- No push to `main`, no pull request, no merge, no deploy. The owner opens and merges pull requests himself.
- No SQL or Docker against any real or local database. No change to the backend repo from frontend work. No change to the original v4 package.
- Never print passwords. `.env`, `userlist.txt` and `credentials.json` stay local and are never committed.
- Never edit a test to make it pass. A changed requirement that an existing test checks needs the owner's decision, recorded openly.
- Do not touch the financial engine or its protections (C15, C16).
- Do not re-do the demo separation or change the template's tests.

## Evidence over claims

- Verify with evidence: command output, SHA-256 for packages, test results. Fix whatever the checks reveal.
- Do not invent data. When unsure, say "مرجّح، لم يُتحقق" instead of asserting.
- A decision may be attributed to the owner only with a real approval reference. Otherwise mark it as a **proposal**.
- When access to something fails, report the actual address and the actual error.
- Sample data in the prototype is always marked as sample (identifiers start with `SAMPLE`). It must not pass for a real record.

## How to work

- Step by step. For critical-tier work show the design to the owner before implementing it; for normal work state the approach in a line or two, then build. For each recommendation explain its importance, its risk, whether the direction is right, and its value.
- Research the established professional systems before a risky decision.
- Open design decisions that belong to the reviewer are listed and left to the reviewer. Do not settle them silently.

## Commands

```
npm test              # vitest
npm run check         # astro check (must report 0 errors)
npm run build         # astro build
npm run format:check  # prettier
```

Where the demo-isolation script exists (`scripts/check-demo-build.mjs`, on the app branches): run a **clean** build and then `node scripts/check-demo-build.mjs off` **immediately**. Running `astro check` between them invalidates the build output the script reads and gives a false failure.

## Commits

Keep each commit small and described by what it changes and why. Migrations (backend) are immutable byte for byte; any change is a new migration with the baseline update shown to the owner first.
