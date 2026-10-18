// Vercel "api" service entrypoint (see vercel.json). Serves the pre-bundled Express app
// (apps/api/src/app.ts -> dist/app.cjs via `npm run bundle:api`), which carries all its
// dependencies, so the service needs no install step. Re-run the bundle after API changes.
module.exports = require("./dist/app.cjs").default;
