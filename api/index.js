// Vercel serverless entry: the whole Express API (apps/api/src/app.ts), pre-bundled by
// `npm run bundle:api` into api/_lib/app.cjs. Re-run that script before pushing API changes.
module.exports = require("./_lib/app.cjs").default;
