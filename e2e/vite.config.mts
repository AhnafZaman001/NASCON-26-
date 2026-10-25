import { mergeConfig } from 'vite';
import path from 'node:path';
import config from '../apps/web/vite.config.ts';
import { root } from './local-stack.mjs';

export default mergeConfig(config, {
  root: path.join(root, 'apps/web'),
  cacheDir: path.join(root, '.e2e/vite-cache'),
  server: { host: '127.0.0.1', port: 5179, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4100' } },
});
