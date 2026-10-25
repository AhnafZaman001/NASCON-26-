import { test, expect, signIn, createLead, availability } from '../fixtures.mts';

test('real owner login persists across refresh and logout ends the session', async ({ page, workspace }) => {
  await signIn(page, workspace.owner);
  await page.reload();
  await expect(page.getByText(`Signed in as ${workspace.owner.email}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('invalid credentials are rejected rather than entering the demo workspace', async ({ page, workspace }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(workspace.owner.email);
  await page.getByLabel('Password', { exact: true }).fill('deliberately-wrong-local-test-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByText(/Invalid login credentials/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('owner can navigate every application section and reload direct links', async ({ page, workspace }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page, workspace.owner);
  for (const [name, route] of [['Contacts', 'contacts'], ['Pipeline', 'pipeline'], ['Inbox', 'inbox'], ['Payments', 'payments'], ['Calendar', 'calendar'], ['Integrations', 'integrations'], ['Audit log', 'audit'], ['Settings', 'settings'], ['Leads', 'leads']] as const) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${route}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  await page.goto('/integrations?calendar=connected');
  await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('new lead skips a Busy owner and persists assignment to the Available salesperson', async ({ page, workspace }) => {
  await signIn(page, workspace.owner);
  await availability(page, 'busy');
  await expect.poll(async () => (await workspace.admin.from('members').select('status').eq('id', workspace.owner.memberId).single()).data?.status).toBe('busy');
  const lead = await createLead(page, 'E2E Available assignment');
  await expect(page.locator(`#lead-${lead.leadId}`)).toContainText(workspace.sales.name);
  await page.reload();
  await page.getByRole('tab', { name: /All leads/ }).click();
  await expect(page.locator(`#lead-${lead.leadId}`)).toContainText(workspace.sales.name);
  const stored = await workspace.admin.from('leads').select('owner_id,workspace_id').eq('id', lead.leadId).single();
  expect(stored.data).toEqual({ owner_id: workspace.sales.memberId, workspace_id: workspace.id });
});

test('salesperson acknowledgement prevents escalation after the original deadline', async ({ page, browser, workspace }) => {
  await workspace.ownerApi.patch('/api/workspace', { data: { settings: { levels: [{ target: 'assignee', seconds: 5 }, { target: 'next', seconds: 300 }] } } });
  await signIn(page, workspace.owner);
  const context = await browser.newContext();
  const salesperson = await context.newPage();
  await signIn(salesperson, workspace.sales);
  await availability(page, 'busy');
  const lead = await createLead(page, 'E2E Timely acknowledgement');
  await availability(page, 'available');
  await salesperson.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Leads', exact: true }).click();
  const row = salesperson.locator(`#lead-${lead.leadId}`);
  await row.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(row).toContainText('Acknowledged');
  await salesperson.waitForTimeout(6500);
  const result = await workspace.ownerApi.get('/api/leads');
  expect(result.ok()).toBeTruthy();
  const stored = await workspace.admin.from('leads').select('owner_id,status,escalation_count,ack_deadline').eq('id', lead.leadId).single();
  expect(stored.data).toEqual({ owner_id: workspace.sales.memberId, status: 'acknowledged', escalation_count: 0, ack_deadline: null });
  await context.close();
});

test('Offline salesperson immediately hands an unacknowledged lead to the Available owner', async ({ page, browser, workspace }) => {
  await signIn(page, workspace.owner);
  await availability(page, 'busy');
  const lead = await createLead(page, 'E2E Absence reassignment');
  await availability(page, 'available');
  await expect.poll(async () => (await workspace.admin.from('members').select('status').eq('id', workspace.owner.memberId).single()).data?.status).toBe('available');
  const context = await browser.newContext();
  const salesperson = await context.newPage();
  await signIn(salesperson, workspace.sales);
  await availability(salesperson, 'offline');
  await expect.poll(async () => (await workspace.admin.from('leads').select('owner_id').eq('id', lead.leadId).single()).data?.owner_id).toBe(workspace.owner.memberId);
  await page.goto('/leads');
  const row = page.locator(`#lead-${lead.leadId}`);
  await expect(row).toContainText(workspace.owner.name);
  await expect(row).not.toContainText('Level 2');
  const assignments = await workspace.admin.from('lead_assignments').select('reason').eq('lead_id', lead.leadId);
  expect(assignments.data?.map(a => a.reason)).toEqual(['initial', 'absence']);
  await row.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(row).toContainText('Acknowledged');
  await context.close();
});

test('owner can manually reassign; salesperson cannot reassign through a direct API call', async ({ page, workspace }) => {
  await signIn(page, workspace.owner);
  const lead = await createLead(page, 'E2E Manual reassignment');
  const row = page.locator(`#lead-${lead.leadId}`);
  const current = await workspace.admin.from('leads').select('owner_id').eq('id', lead.leadId).single();
  if (current.data?.owner_id !== workspace.owner.memberId) await row.getByRole('combobox').selectOption(workspace.owner.memberId);
  await expect(row).toContainText(workspace.owner.name);
  await row.getByRole('combobox').selectOption(workspace.sales.memberId);
  await expect(row).toContainText(workspace.sales.name);
  const denied = await workspace.salesApi.post(`/api/leads/${lead.leadId}/reassign`, { data: { to: workspace.owner.memberId } });
  expect(denied.status()).toBe(403);
  const acknowledgeDenied = await workspace.ownerApi.post(`/api/leads/${lead.leadId}/acknowledge`);
  expect(acknowledgeDenied.status()).toBe(403);
});
