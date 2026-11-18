# CLAUDE.md — AMBS Platform (frontend)

Working rules for any Claude session that opens this repository. They come from the owner and apply on every branch.

## What this is

- **AMBS Platform**: a coded, Arabic-first, multi-tenant business-management SaaS for companies. This repo is the **frontend** (Astro 7, static `[lang]` routes, Netlify adapter, Tailwind 4, vitest).
- The backend lives in a separate repo, `EoadEssam/ambs-platform`. Treat it as **read-only** from frontend work.
- The repo started from the Netlify Astro starter, so `main` still holds the template. The app work lives on `claude/*` branches until the owner merges them.
- Do not confuse this with the owner's other project (an ABMS system on Notion for a different business). Do not mention any company name, trade or sector in this repo's README.

## Language and address

- Talk to the owner in **Arabic**, addressing him as **male**. Do not switch to English mid-conversation.
- Commands, code, file names and identifiers stay in English.

## Never without the owner's explicit approval

- No push to `main`, no pull request, no merge, no deploy. Pushing a feature branch needs approval too. The owner opens and merges pull requests himself.
- No SQL, no Docker, no change to the backend repo, no change to the original v4 package.
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

- Step by step. Show the design to the owner before implementing it. For each recommendation explain its importance, its risk, whether the direction is right, and its value.
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
