import http from 'node:http';
import { localKeys } from './local-stack.mjs';
localKeys();
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  const auth = req.url.startsWith('/auth/v1');
  const rest = req.url.startsWith('/rest/v1');
  if (!auth && !rest) { res.writeHead(404, cors); res.end(); return; }
  const upstream = http.request({ hostname: '127.0.0.1', port: auth ? 55324 : 55325, method: req.method, path: req.url.replace(auth ? '/auth/v1' : '/rest/v1', '') || '/', headers: { ...req.headers, host: '127.0.0.1' } }, response => {
    res.writeHead(response.statusCode, { ...response.headers, ...cors }); response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, cors); res.end('Local upstream unavailable'); });
  req.pipe(upstream);
}).listen(55321, '127.0.0.1', () => console.log('Local Supabase gateway ready.'));
