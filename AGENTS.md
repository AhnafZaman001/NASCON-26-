# AGENTS.md - read this first

**Before you build, change or plan anything, read `PROJECT_STATUS.md` (repo root) in full.**
It is the single source of truth: what the product is, every requirement and metric definition, the links and
environment, the architecture and decisions, what is built, and what is left. You do not need the problem statement,
a rubric or a verbal briefing; it is all in that file.

**When you finish, update `PROJECT_STATUS.md` in the same commit as your code** (Built, Left, any corrected facts,
and a new entry in its Update log). Never put secrets in git or in that file.

Then read `CLAUDE.md` for commands and coding rules (API, frontend, database, env files). Both files apply to every
agent, whatever its name. Several people and agents push to `main`: `git pull --rebase` before you start and before every commit.
