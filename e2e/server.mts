import express from 'express';
import { createHash } from 'node:crypto';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { localKeys } from './local-stack.mjs';

const keys = localKeys();
Object.assign(process.env, {
  SUPABASE_URL: keys.API_URL, SUPABASE_SECRET_KEY: keys.SERVICE_ROLE_KEY,
  GOOGLE_CLIENT_ID: 'local-calendar-contract', GOOGLE_CLIENT_SECRET: 'local-calendar-contract',
  TOKEN_ENCRYPTION_KEY: createHash('sha256').update(keys.SERVICE_ROLE_KEY).digest('hex'),
  WEB_URL: 'http://127.0.0.1:5179', CORS_ORIGIN: 'http://127.0.0.1:5179',
  EMAIL_SWEEP: 'off', ESCALATION_SWEEP: 'off',
});

// Only Google is simulated. Supabase Auth, SQL, RLS and the Express routes are real.
// This module is never imported by the production application.
const mock = new MockAgent();
mock.disableNetConnect();
mock.enableNetConnect(/^(127\.0\.0\.1|localhost)(:\d+)?$/);
setGlobalDispatcher(mock);
type Event = { id: string; summary: string; start: { dateTime: string }; end: { dateTime: string }; htmlLink: string };
const events = new Map<string, Event>();
let refreshes = 0;
const google = mock.get('https://www.googleapis.com');
mock.get('https://oauth2.googleapis.com').intercept({ path: '/token', method: 'POST' }).reply(() => {
  refreshes++;
  return { statusCode: 200, data: { access_token: 'local-calendar-access', expires_in: 3600, token_type: 'Bearer' } };
}).persist();
google.intercept({ path: '/calendar/v3/calendars/primary', method: 'GET' }).reply(200, { timeZone: 'America/New_York' }).persist();
google.intercept({ path: '/calendar/v3/freeBusy', method: 'POST' }).reply(options => {
  const q = JSON.parse(String(options.body));
  const busy = [...events.values()].filter(e => e.start.dateTime < q.timeMax && e.end.dateTime > q.timeMin).map(e => ({ start: e.start.dateTime, end: e.end.dateTime }));
  return { statusCode: 200, data: { calendars: { primary: { busy } } } };
}).persist();
google.intercept({ path: '/calendar/v3/calendars/primary/events?sendUpdates=none', method: 'POST' }).reply(options => {
  const e = JSON.parse(String(options.body));
  if (events.has(e.id)) return { statusCode: 409, data: { error: { message: 'Already exists' } } };
  const event = { ...e, htmlLink: `https://calendar.google.com/calendar/event?eid=${e.id}` };
  events.set(e.id, event);
  return { statusCode: 200, data: event };
}).persist();
google.intercept({ path: /^\/calendar\/v3\/calendars\/primary\/events\/[a-f0-9]+\?sendUpdates=none$/, method: 'PATCH' }).reply(options => {
  const id = options.path.split('/').at(-1)!.split('?')[0];
  const event = events.get(id);
  if (!event) return { statusCode: 404, data: { error: { message: 'Not found' } } };
  const moved = { ...event, ...JSON.parse(String(options.body)) };
  events.set(id, moved);
  return { statusCode: 200, data: moved };
}).persist();
google.intercept({ path: /^\/calendar\/v3\/calendars\/primary\/events\/[a-f0-9]+\?sendUpdates=none$/, method: 'DELETE' }).reply(options => {
  const id = options.path.split('/').at(-1)!.split('?')[0];
  events.delete(id);
  return { statusCode: 204, data: '' };
}).persist();

const app = express();
app.get('/__e2e/google', (_req, res) => res.json({ events: [...events.values()], refreshes }));
app.post('/__e2e/google/reset', (_req, res) => { events.clear(); refreshes = 0; res.json({ ok: true }); });
app.use((await import('../apps/api/src/app.ts')).default);
app.listen(4100, '127.0.0.1', () => console.log('Local E2E API ready; external Google requests are simulated.'));
