import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.e2e');
const stateFile = path.join(runtime, 'local-stack.json');
const containers = ['nascon-e2e-rest', 'nascon-e2e-auth', 'nascon-e2e-db'];
const label = 'io.nascon.e2e';
const network = 'nascon-e2e';
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Local Docker operation failed: ${args[0]} ${args[1] ?? ''} (details suppressed to protect local test credentials)`);
  return result.stdout;
}
function inspect(name) {
  const result = spawnSync('docker', ['inspect', name], { encoding: 'utf8' });
  return result.status === 0 ? JSON.parse(result.stdout)[0] : null;
}
export function localKeys() {
  if (!existsSync(stateFile)) throw new Error('Run npm run e2e:prepare first');
  const data = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (data.API_URL !== 'http://127.0.0.1:55321' || data.DB_URL !== 'postgresql://127.0.0.1:55322/postgres') throw new Error('Refusing to use a non-local test database');
  return data;
}
function jwt(role, secret) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role, iss: 'supabase', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+86400*7 })}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}
export function localSql(sql) {
  localKeys();
  return docker(['exec', '-i', 'nascon-e2e-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], sql);
}
export function stop() {
  for (const name of containers) {
    const info = inspect(name);
    if (!info) continue;
    if (info.Config.Labels?.[label] !== 'local') throw new Error(`Refusing to remove an unowned container: ${name}`);
    docker(['rm', '-f', name]);
  }
  const net = spawnSync('docker', ['network', 'inspect', network], { encoding: 'utf8' });
  if (net.status === 0 && JSON.parse(net.stdout)[0].Labels?.[label] === 'local') docker(['network', 'rm', network]);
  rmSync(stateFile, { force: true });
}
async function ready(check, name) {
  for (let i=0; i<90; i++) {
    try { if (await check()) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not become ready`);
}
export async function prepare({ reset = false } = {}) {
  if (!reset && existsSync(stateFile) && containers.every(name => inspect(name)?.State.Running)) { console.log('Reusing isolated local test services.'); return; }
  stop();
  mkdirSync(runtime, { recursive: true });
  const secret = randomBytes(32).toString('hex');
  const password = randomBytes(24).toString('hex');
  const state = { API_URL: 'http://127.0.0.1:55321', DB_URL: 'postgresql://127.0.0.1:55322/postgres', ANON_KEY: jwt('anon', secret), SERVICE_ROLE_KEY: jwt('service_role', secret) };
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  docker(['network', 'create', '--label', `${label}=local`, network]);
  const run = (name, image, env, ports, command = []) => docker(['run', '-d', '--name', name, '--label', `${label}=local`, '--network', network, ...ports.flatMap(p => ['-p', p]), ...Object.entries(env).flatMap(([key,value]) => ['-e', `${key}=${value}`]), image, ...command]);
  console.log('Starting isolated PostgreSQL 17.');
  run('nascon-e2e-db', 'postgres:17-alpine', { POSTGRES_PASSWORD: password }, ['127.0.0.1:55322:5432'], ['postgres', '-c', 'wal_level=logical']);
  await ready(() => spawnSync('docker', ['exec', 'nascon-e2e-db', 'pg_isready', '-U', 'postgres']).status === 0, 'Local PostgreSQL');
  localSql(`create schema if not exists extensions; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator login noinherit password '${password}'; grant anon, authenticated, service_role to authenticator;
    create role supabase_auth_admin login createrole password '${password}'; create schema auth authorization supabase_auth_admin;
    grant all on database postgres to supabase_auth_admin; grant usage, create on schema public to supabase_auth_admin;
    alter role supabase_auth_admin set search_path = auth, public;
    create publication supabase_realtime;
    grant usage on schema public, extensions, auth to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on tables to service_role;
    alter default privileges for role postgres in schema public grant all on sequences to service_role;`);
  console.log('Starting Supabase Auth.');
  run('nascon-e2e-auth', 'supabase/gotrue:v2.197.0', {
    GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: `${state.API_URL}/auth/v1`,
    GOTRUE_SITE_URL: 'http://127.0.0.1:5179', GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${password}@nascon-e2e-db:5432/postgres`,
    GOTRUE_DB_NAMESPACE: 'auth', GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_ADMIN_ROLES: 'service_role', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_DISABLE_SIGNUP: 'false', GOTRUE_MAILER_AUTOCONFIRM: 'true', GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS: '1000',
  }, ['127.0.0.1:55324:9999']);
  await ready(async () => (await fetch('http://127.0.0.1:55324/health')).ok, 'Supabase Auth');
  localSql(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid $$;
    create or replace function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claims',true)::jsonb ->> 'role' $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`);
  for (const file of readdirSync(path.join(root,'supabase/migrations')).filter(file => file.endsWith('.sql')).sort()) {
    localSql(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
    console.log(`Applied local migration ${file}`);
  }
  console.log('Starting PostgREST.');
  run('nascon-e2e-rest', 'postgrest/postgrest:v16.5', { PGRST_DB_URI: `postgres://authenticator:${password}@nascon-e2e-db:5432/postgres`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret, PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions' }, ['127.0.0.1:55325:3000']);
  await ready(async () => (await fetch('http://127.0.0.1:55325/')).ok, 'PostgREST');
  console.log('Local database and authentication are ready. No cloud credentials were used.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'stop') stop();
  else await prepare({ reset: process.argv[2] === 'reset' });
}
