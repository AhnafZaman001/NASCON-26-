// Read-only deployment checks. No login, test-data creation, or mutations.
const base = new URL(process.env.E2E_BASE_URL ?? 'https://web-fgg2.vercel.app');
if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/') throw new Error('E2E_BASE_URL must be an HTTPS origin without credentials or a path');
for (const path of ['/', '/signup', '/integrations?calendar=connected', '/calendar', '/api/health']) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20_000) });
  if (response.status !== 200) throw new Error(`${path}: expected HTTP 200, got ${response.status}`);
  if (path === '/api/health') {
    if ((await response.json()).ok !== true) throw new Error('API health response was not healthy');
  } else if (!(await response.text()).includes('<div id="root"></div>')) throw new Error(`${path}: missing app shell`);
  console.log(`PASS ${path}: HTTP 200`);
}
console.log('Read-only deployment smoke passed.');
