import { test, expect, signIn } from '../fixtures.mts';

function tomorrow(hour = 15) {
  const date = new Date(Date.now() + 86_400_000);
  return `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`;
}

test('booking is blocked when an employee has not connected a calendar', async ({ page, workspace }) => {
  await signIn(page, workspace.owner);
  await page.goto('/calendar');
  await expect(page.getByText("E2E Owner hasn't connected a Google Calendar, so they can't be booked.", { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book', exact: true })).toBeDisabled();
  const leadResponse = await workspace.ownerApi.post('/api/leads', { data: { name: 'E2E No calendar contact', phone: '+15551110001' } });
  expect(leadResponse.status()).toBe(201);
  const lead = await leadResponse.json();
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const response = await workspace.ownerApi.post('/api/appointments', { data: { contactId: lead.contactId, memberId: workspace.owner.memberId, title: 'Must not book', start, end: new Date(new Date(start).getTime() + 1800_000).toISOString(), timezone: 'Asia/Karachi' } });
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toContain("hasn't connected");
});

test('calendar contract: booking refreshes tokens, persists time zones, reschedules and cancels', async ({ page, workspace, request }) => {
  await workspace.connectCalendar();
  const leadResponse = await workspace.ownerApi.post('/api/leads', { data: { name: 'E2E Appointment Customer', phone: '+15551110002' } });
  expect(leadResponse.status()).toBe(201);
  const lead = await leadResponse.json();
  await signIn(page, workspace.owner);
  await page.goto(`/calendar?contact=${lead.contactId}`);
  await page.getByLabel('Employee', { exact: true }).selectOption(workspace.owner.memberId);
  await page.getByLabel('Title', { exact: true }).fill('E2E Calendar Contract');
  const start = tomorrow();
  await page.getByLabel('Start (Asia/Karachi)', { exact: true }).fill(start);
  await expect(page.getByText(/For E2E Owner \(America\/New_York\)/)).toBeVisible();
  const book = page.getByRole('button', { name: 'Book', exact: true });
  await expect(book).toBeEnabled();
  const response = page.waitForResponse(r => r.url().endsWith('/api/appointments') && r.request().method() === 'POST');
  await book.click();
  const booked = await response;
  expect(booked.status(), await booked.text()).toBe(201);
  const appointment = (await booked.json()).appointment;
  const expectedTime = new Date(start + ':00+05:00').getTime();
  expect(appointment.start).toBe(expectedTime);
  expect(appointment.tz).toBe('America/New_York');
  const card = page.locator('div.rounded-xl').filter({ has: page.getByText('E2E Calendar Contract', { exact: true }) }).last();
  await expect(card).toBeVisible();
  const provider = await (await request.get('http://127.0.0.1:4100/__e2e/google')).json();
  expect(provider.refreshes).toBeGreaterThan(0);
  expect(provider.events).toHaveLength(1);
  expect(new Date(provider.events[0].start.dateTime).getTime()).toBe(expectedTime);
  expect(provider.events[0].start.timeZone).toBe('America/New_York');
  await page.reload();
  await expect(page.getByText('E2E Calendar Contract', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  const movedStart = tomorrow(16);
  await page.getByLabel('New start time', { exact: true }).fill(movedStart);
  const moveResponse = page.waitForResponse(r => r.url().includes(`/api/appointments/${appointment.id}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await moveResponse).status()).toBe(200);
  const moved = await (await request.get('http://127.0.0.1:4100/__e2e/google')).json();
  expect(new Date(moved.events[0].start.dateTime).getTime()).toBe(new Date(movedStart + ':00+05:00').getTime());
  const cancelResponse = page.waitForResponse(r => r.url().endsWith(`/api/appointments/${appointment.id}/cancel`));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await cancelResponse).status()).toBe(200);
  await expect(page.getByText('E2E Calendar Contract', { exact: true })).not.toBeVisible();
  const cancelled = await workspace.admin.from('appointments').select('status').eq('id', appointment.id).single();
  expect(cancelled.data?.status).toBe('cancelled');
  expect((await (await request.get('http://127.0.0.1:4100/__e2e/google')).json()).events).toHaveLength(0);
  const activity = await workspace.admin.from('activities').select('data').eq('contact_id', lead.contactId).eq('type', 'appointment').order('id');
  expect(activity.data?.map(a => a.data.text).join('\n')).toMatch(/Booked[\s\S]*Rescheduled[\s\S]*Cancelled/);
});

test('calendar contract: a conflicting booking is rejected and no duplicate event is stored', async ({ page, workspace, request }) => {
  await workspace.connectCalendar();
  const lead = await (await workspace.ownerApi.post('/api/leads', { data: { name: 'E2E Conflict Customer', phone: '+15551110003' } })).json();
  const start = new Date(tomorrow() + ':00+05:00').toISOString();
  const appointment = { contactId: lead.contactId, memberId: workspace.owner.memberId, title: 'E2E Existing Slot', start, end: new Date(new Date(start).getTime()+1800_000).toISOString(), timezone: 'Asia/Karachi' };
  const first = await workspace.ownerApi.post('/api/appointments', { data: appointment });
  expect(first.status(), await first.text()).toBe(201);
  await signIn(page, workspace.owner);
  await page.goto(`/calendar?contact=${lead.contactId}`);
  await page.getByLabel('Title', { exact: true }).fill('E2E Conflicting Slot');
  await page.getByLabel('Start (Asia/Karachi)', { exact: true }).fill(tomorrow());
  await expect(page.getByText('Overlaps:', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book anyway', exact: true })).toBeVisible();
  const response = page.waitForResponse(r => r.url().endsWith('/api/appointments') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  expect((await response).status()).toBe(409);
  const rows = await workspace.admin.from('appointments').select('id').eq('workspace_id', workspace.id);
  expect(rows.data).toHaveLength(1);
  expect((await (await request.get('http://127.0.0.1:4100/__e2e/google')).json()).events).toHaveLength(1);
});
