# PROMPT.md - your operating instructions (follow exactly, in order)

You are an AI agent joining the NASCON X '26 project (a unified business management platform: CRM + guaranteed lead
protection + real Twilio, Stripe, Google Calendar and email integrations). You start with zero context. This repo
gives you all of it. Do NOT ask the human for the problem statement, a rubric, links, or background: it is written down.

## Step 1: Load context (before any planning or code)
1. Read `PROJECT_STATUS.md` completely. It is the single source of truth: product, every requirement (F, I, Q),
   metric definitions, links and environment, architecture and decisions, what is built, what is left.
2. Read `CLAUDE.md` for commands and coding rules (API, frontend, database, env files).
3. Run `git pull --rebase` and `git log --oneline -15` to see anything newer than `PROJECT_STATUS.md`. If the code and the
   status file disagree, the code wins; note the difference and fix the file when you finish.

## Step 2: Do the task the human gives you after this prompt
- The task is whatever the human wrote alongside or after this prompt. If they gave none, say what you understood
  from `PROJECT_STATUS.md` section 7 ("Left to build") and ask which item to take. Do not start unrequested work.
- Work only on that task. Keep changes small and in the files the task needs. Do not rewrite other people's work.
- Respect the decisions in `PROJECT_STATUS.md` section 5 (for example: Postgres owns lead timing, all writes go through the API,
  never add Next.js back). Reopen one only with a stated reason.
- If a requirement is ambiguous, pick the reading that best satisfies the requirement text in `PROJECT_STATUS.md`
  section 2, state your assumption in one line, and continue. Ask at most one question, and only if you are blocked.

## Step 3: Verify before you claim anything
- Run what applies: `npm run build && npm run lint && npm run typecheck`, `npm run test:engine -w @nascon/web`.
  Run `npm run bundle:api` and commit `apps/api/dist/app.cjs` after ANY `apps/api` change.
- Database changes: add a new numbered file in `supabase/migrations/` (never edit an applied one) and regenerate `supabase/setup_all.sql`.
- Be honest: say what you ran, what passed, what you could not run (for example no access to live services) and what is unverified.
  Never report something as working that you did not run.

## Step 4: Record your work (mandatory, same commit as the code)
Update `PROJECT_STATUS.md`: move finished items from "Left" to "Built" (with how it works and where it lives), fix any fact
that is now wrong, and append one entry to its Update log (commit hash from `git rev-parse --short HEAD`, date from
`date -u +%F`, what changed, how to verify, gotchas). If you stop partway, record what is done and what remains.

## Step 5: Push
`git pull --rebase`, then `git push origin main`. Several people and agents push to `main`: never force-push; if the push is
rejected, pull --rebase again and resolve conflicts keeping both sides' work (especially in `PROJECT_STATUS.md`).

## Always
- Never put secrets (passwords, service keys, tokens, SMTP passwords, API secrets) in git, code, logs, `PROJECT_STATUS.md` or chat.
  Use environment variable names only. If you see a secret in the repo, tell the human to rotate it.
- Finish with a short report: what you did, what you verified, what is left, and anything the human must do (keys, dashboard clicks).
