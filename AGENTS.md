# AGENTS.md - shared context for every agent

This repo is the single source of truth for the NASCON '26 "Lead Shield" CRM. Several agents (Claude, ChatGPT/Codex,
Gemini, Kimi, Cursor...) and people work on it at the same time. You get your task from the person who started you;
this file only gives you the context.

## Read for context
- `CLAUDE.md` - architecture, commands, API and database rules. It applies to every agent, whatever its name.
- `docs/modules.md` - the problem statement split into modules, with requirement IDs (F / I / Q) and status.
- `docs/DECISIONS.md` - choices already made, so you don't reopen them.

## Working conventions (several people push to `main`)
- `git pull --rebase` before you start and before every commit. Small commits. Never force-push.
- Before pushing: `npm run build && npm run lint && npm run typecheck`.
- After ANY `apps/api` change run `npm run bundle:api` and commit `apps/api/dist/app.cjs`.
- Database changes: add a new numbered file in `supabase/migrations/` (never edit an applied one), then regenerate `supabase/setup_all.sql`.
- Learned a gotcha or made a decision the next agent needs? Add one or two lines to `docs/DECISIONS.md`.
- Never put secrets in git, code or chat. Keys live in `.env` files and Vercel env vars only.
