import { spawn } from 'node:child_process';
import path from 'node:path';
import { localKeys, root } from './local-stack.mjs';

const keys = localKeys();
const env = { ...process.env, VITE_SUPABASE_URL: keys.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: keys.ANON_KEY };
const children = [
  spawn(process.execPath, ['e2e/gateway.mjs'], { cwd: root, env, stdio: 'inherit' }),
  spawn(path.join(root, 'node_modules/.bin/tsx'), ['e2e/server.mts'], { cwd: root, env, stdio: 'inherit' }),
  spawn(path.join(root, 'node_modules/.bin/vite'), ['--config', 'e2e/vite.config.mts'], { cwd: root, env, stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
for (const child of children) { child.on('error', () => stop(1)); child.on('exit', code => { if (!stopping) stop(code || 1); }); }
