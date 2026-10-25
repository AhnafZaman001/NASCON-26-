# Browser automation

Node 24+, Docker, and Chromium are required. No production credentials are needed for local tests.

```sh
npm ci
# Needed only when Chromium is not installed locally:
npx playwright install --with-deps chromium
npm run test:e2e:smoke
```

The default quick smoke verifies real login, persistence across refresh, and logout. It starts a disposable PostgreSQL 17 / Supabase Auth / PostgREST stack, applies the repository migrations, and creates its own Owner, salesperson and workspace. The browser and API connect only to loopback ports. Existing cloud variables are overridden with disposable local credentials.

Commands:

| Command | Purpose |
| --- | --- |
| `npm run test:e2e:smoke` | Reset the disposable database and run one login smoke test |
| `npm run test:e2e` | Full local suite, explicitly on demand |
| `npm run test:e2e:run -- --grep "Offline salesperson"` | Run one relevant test against an already prepared local stack |
| `npm run test:e2e:types` | Check test/config types |
| `npm run test:e2e:report` | Open the local HTML report |
| `npm run e2e:stop` | Remove only containers/network labelled as this test stack |
| `npm run test:e2e:public` | Read-only HTTP checks of the production app |

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use a specific Chromium executable. Otherwise `/usr/bin/chromium` is used when present, with the Playwright browser as fallback. Test resources and credentials live under ignored `.e2e/`; screenshots, traces and reports are also ignored. Failed tests retain traces and screenshots. Local credentials are generated and are never copied from a real user.

## Coverage and limits

The suite includes login/logout, invalid login, navigation/direct links, automatic lead assignment, acknowledgement, Offline reassignment, manual reassignment/permission checks, disconnected-calendar booking, and calendar booking/conflict/reschedule/cancel contracts.

Calendar contract tests simulate only Google's HTTP API. The actual Express routes, authentication, encryption, database persistence, token-refresh path and booking logic execute. They do **not** verify real Google delivery or automate Google consent. The minimal local stack does not run Supabase Realtime, pg_cron, pg_net or SMTP delivery; lead reads invoke the application's normal escalation sweep.

As of 2026-10-25, only the login smoke has been executed successfully. The other tests are prepared and type-checked, and remain unverified until explicitly run. Full local runs are optional, not a prerequisite to each deployment.

## Staging and production

`E2E_BASE_URL=https://YOUR-STAGING-HOST npm run test:e2e:public` runs the same read-only HTTP checks on staging. This does not create data or require an authenticated staging backend. No staging host or separate Supabase staging project is configured yet. Authenticated staging tests require that separate backend and staging credentials; never point the local fixture suite at the live project.

The GitHub Actions workflow is manually triggered. Its default is the quick smoke; choose `full` only when a full run is useful. Local tests require no GitHub secrets. Reports are uploaded even on failure.

Changes are committed directly to `main` as requested. Undo a pushed change with `git revert <commit>` and push the revert; do not force-push shared history.
