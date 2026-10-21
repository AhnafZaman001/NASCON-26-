# AGENTS.md - start here (every human and AI agent)

This repo is the **single source of truth** for the NASCON '26 "Lead Shield" CRM. Several agents (Claude, ChatGPT/Codex,
Gemini, Kimi, Cursor...) work on it at the same time and share no memory except what is written here.

## Read, in this order (about 5 minutes)
1. `CLAUDE.md` - architecture, commands, API and DB rules. It applies to ALL agents, whatever their name.
2. `docs/STATUS.md` - live task board: what is done, what is unclaimed, who is doing what. **Claim before you start.**
3. `docs/modules.md` - the problem statement split into modules with requirement IDs (F / I / Q).
4. `docs/DECISIONS.md` - choices already made. Do not reopen them without a reason.

## Working rules (prevents agents overwriting each other)
- **Claim a task** in `docs/STATUS.md` (write your agent name in Owner, set Status to `in progress`) and push that change
  FIRST: `git pull --rebase && git add docs/STATUS.md && git commit -m "claim T2" && git push`. If the push is rejected,
  someone claimed something first: pull and pick another task.
- Stay inside the files your task lists. Need a change elsewhere? Make it tiny, or leave a note in STATUS.md.
- `git pull --rebase` before every commit. Small commits, pushed often. Never force-push.
- Before pushing: `npm run build && npm run lint && npm run typecheck`. After ANY `apps/api` change run `npm run bundle:api`
  and commit `apps/api/dist/app.cjs`.
- Database changes: new numbered file in `supabase/migrations/` only (never edit an applied one), then regenerate `supabase/setup_all.sql`.
- When you finish: set the task to `done`, add one line of what changed and how to verify it, push.
- Learned something the next agent needs (a gotcha, a decision)? Add it to `docs/DECISIONS.md` in one or two lines.
- Never put secrets in git, in code, or in chat. Keys live in `.env` files and Vercel env vars only.
