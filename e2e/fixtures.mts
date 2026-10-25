import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { localKeys } from './local-stack.mjs';
import { encrypt } from '../apps/api/src/lib/secrets.ts';

type Account = { id: string; memberId: string; email: string; password: string; name: string };
type Workspace = { id: string; owner: Account; sales: Account; admin: SupabaseClient; ownerApi: APIRequestContext; salesApi: APIRequestContext; connectCalendar: () => Promise<void> };

export async function signIn(page: Page, account: Account) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'All changes saved' })).toBeVisible();
}

export async function availability(page: Page, status: 'available' | 'busy' | 'offline') {
  const response = page.waitForResponse(r => /\/api\/members\/.+\/status$/.test(r.url()) && r.request().method() === 'POST');
  await page.getByLabel('My availability').selectOption(status);
  const changed = await response;
  expect(changed.ok(), await changed.text()).toBeTruthy();
}

export async function createLead(page: Page, name: string) {
  await page.goto('/leads');
  await page.getByRole('tab', { name: /All leads/ }).click();
  await page.getByRole('button', { name: 'New lead', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  const phone = '+1555' + String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
  await dialog.getByLabel('Phone', { exact: true }).fill(phone);
  const response = page.waitForResponse(r => r.url().endsWith('/api/leads') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Create & assign' }).click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(201);
  const lead = await result.json() as { leadId: string; contactId: string };
  await expect(page.locator(`#lead-${lead.leadId}`)).toBeVisible();
  return lead;
}

export const test = base.extend<{ workspace: Workspace }>({
  workspace: async ({ playwright, request }, use) => {
    const keys = localKeys();
    const admin = createClient(keys.API_URL, keys.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const suffix = randomUUID().slice(0, 8);
    const owner: Account = { id: '', memberId: '', name: 'E2E Owner', email: `owner-${suffix}@e2e.example.com`, password: randomBytes(18).toString('base64url') };
    const sales: Account = { id: '', memberId: '', name: 'E2E Salesperson', email: `sales-${suffix}@e2e.example.com`, password: randomBytes(18).toString('base64url') };
    for (const account of [owner, sales]) {
      const { data, error } = await admin.auth.admin.createUser({ email: account.email, password: account.password, email_confirm: true });
      expect(error?.message).toBeUndefined(); account.id = data.user!.id;
    }
    const boot = await admin.rpc('bootstrap_workspace', { p_user: owner.id, p_name: `E2E Playwright ${suffix}`, p_email: owner.email, p_full_name: owner.name });
    expect(boot.error?.message).toBeUndefined();
    const id = boot.data as string;
    const member = await admin.from('members').select('id').eq('user_id', owner.id).single();
    expect(member.error?.message).toBeUndefined(); owner.memberId = member.data!.id;
    const role = await admin.from('roles').select('id').eq('workspace_id', id).eq('name', 'Sales').single();
    expect(role.error?.message).toBeUndefined();
    const added = await admin.rpc('api_add_member', { p_actor: owner.memberId, p_ws: id, p_user: sales.id, p_email: sales.email, p_name: sales.name, p_level: 'user', p_role: role.data!.id });
    expect(added.error?.message).toBeUndefined();
    const sm = await admin.from('members').select('id').eq('user_id', sales.id).single();
    expect(sm.error?.message).toBeUndefined(); sales.memberId = sm.data!.id;
    const contexts: APIRequestContext[] = [];
    for (const account of [owner, sales]) {
      const auth = createClient(keys.API_URL, keys.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const signed = await auth.auth.signInWithPassword({ email: account.email, password: account.password });
      expect(signed.error?.message).toBeUndefined();
      contexts.push(await playwright.request.newContext({ baseURL: 'http://127.0.0.1:5179', extraHTTPHeaders: { Authorization: `Bearer ${signed.data.session!.access_token}` } }));
    }
    const [ownerApi, salesApi] = contexts;
    const settings = await ownerApi.patch('/api/workspace', { data: { settings: { maxOpenLeads: 100, levels: [{ target: 'assignee', seconds: 300 }, { target: 'next', seconds: 300 }] } } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    await request.post('http://127.0.0.1:4100/__e2e/google/reset');
    const connectCalendar = async () => {
      process.env.TOKEN_ENCRYPTION_KEY = createHash('sha256').update(keys.SERVICE_ROLE_KEY).digest('hex');
      const saved = await admin.from('integration_secrets').upsert({ workspace_id: id, provider: 'google_calendar', member_id: owner.memberId, ciphertext: encrypt(JSON.stringify({ refresh_token: 'local-calendar-refresh', access_token: 'expired-local-access', expires_at: Date.now() - 1000, email: owner.email })) }, { onConflict: 'workspace_id,provider,member_id' });
      expect(saved.error?.message).toBeUndefined();
      const status = await admin.rpc('api_calendar_set_status', { p_actor: owner.memberId, p_ws: id, p_member: owner.memberId, p_status: 'connected', p_tz: 'America/New_York' });
      expect(status.error?.message).toBeUndefined();
    };
    await use({ id, owner, sales, admin, ownerApi, salesApi, connectCalendar });
    for (const context of contexts) await context.dispose();
    // The complete disposable database is reset before the next run. Production is never a cleanup target.
  },
});
export { expect };
