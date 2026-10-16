import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { expect, test } from '@playwright/test';
import { Hono } from 'hono';
import { type ScreenConfig, writeScreenConfigs } from '../src/config.ts';
import { HomeAssistantApi } from '../src/home-assistant.ts';
import { createManagementApp } from '../src/management.ts';
import { PluginFactory } from '../src/plugins/plugin-factory.ts';

const initialScreen: ScreenConfig = {
  screenId: 'daily-quote',
  pluginId: 'quote',
  refresh: 3600,
  pluginConfig: {},
  screenSize: { width: 800, height: 480 },
};

let server: ReturnType<typeof serve>;
let baseURL: string;
let directory: string;
let screens: ScreenConfig[];
let calendarFailure: boolean;
let saveFailure: boolean;
let previewed: ScreenConfig | undefined;

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'tiny-trmnl-management-'));
  const factory = new PluginFactory(new HomeAssistantApi('http://unused', ''));
  const app = createManagementApp({
    screensPath: join(directory, 'screens.json'),
    getScreens: () => screens,
    validateScreen: (screen) => factory.validateScreenConfig(screen),
    saveScreens: async (next) => {
      if (saveFailure) throw new Error('Storage unavailable');
      writeScreenConfigs(join(directory, 'screens.json'), next);
      screens = next;
    },
    preview: async (screen) => {
      previewed = screen;
      return '<html><body><h1>Screen preview</h1><script>parent.compromised = true;</script></body></html>';
    },
    getCalendars: async () => {
      if (calendarFailure) throw new Error('Home Assistant unavailable');
      return [
        { entity_id: 'calendar.family', name: 'Family' },
        { entity_id: 'calendar.work', name: 'Work' },
      ];
    },
  });
  server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const instance = serve(
      { fetch: app.fetch, port: 0, hostname: '127.0.0.1' },
      (info) => {
        baseURL = `http://127.0.0.1:${info.port}/`;
        resolve(instance);
      },
    );
  });
});

test.beforeEach(() => {
  screens = [structuredClone(initialScreen)];
  calendarFailure = false;
  saveFailure = false;
  previewed = undefined;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  rmSync(directory, { recursive: true });
});

test('manage multiple screens, preview drafts, persist and reload', async ({
  page,
}) => {
  await page.goto(baseURL);
  await expect(page.getByRole('button', { name: 'daily-quote' })).toBeVisible();
  await page.getByRole('button', { name: 'Add screen', exact: true }).click();
  await page.getByLabel('Screen ID', { exact: true }).fill('kitchen');
  await page.getByLabel('Content', { exact: true }).selectOption('calendar');
  await expect(page.getByText('2 calendars available')).toBeVisible();
  await page.getByRole('button', { name: 'Add calendar', exact: true }).click();
  await page
    .getByLabel('Calendar', { exact: true })
    .selectOption('calendar.family');
  await page.getByLabel('One-character label').fill('F');
  await page.getByRole('button', { name: 'Add calendar', exact: true }).click();
  await page
    .getByLabel('Calendar', { exact: true })
    .nth(1)
    .selectOption('calendar.work');
  await page.getByLabel('One-character label').nth(1).fill('W');
  await page.getByLabel('Width (pixels)').fill('1872');
  await page.getByLabel('Height (pixels)').fill('1404');
  await page.getByRole('button', { name: 'Update preview' }).click();
  await expect(
    page
      .frameLocator('#preview')
      .getByRole('heading', { name: 'Screen preview' }),
  ).toBeVisible();
  await expect(page.locator('#preview')).toHaveCSS('width', '1872px');
  await expect(page.locator('#preview')).toHaveCSS('height', '1404px');
  expect(screens).toEqual([initialScreen]);
  expect(previewed?.pluginConfig).toEqual({
    calendars: [
      { entity: 'calendar.family', label: 'F' },
      { entity: 'calendar.work', label: 'W' },
    ],
  });
  expect(await page.evaluate('window.compromised')).toBeUndefined();
  await page.getByRole('button', { name: 'Save all changes' }).click();
  await expect(page.locator('#status')).toContainText('All screens saved');
  expect(screens).toHaveLength(2);
  expect(
    JSON.parse(readFileSync(join(directory, 'screens.json'), 'utf8')),
  ).toEqual(screens);
  await page.reload();
  await page.getByRole('button', { name: 'kitchen' }).click();
  await expect(page.getByLabel('Width (pixels)')).toHaveValue('1872');
  await expect(
    page.getByLabel('Calendar', { exact: true }).first(),
  ).toHaveValue('calendar.family');
  await expect(
    page.getByRole('link', { name: 'Display image' }),
  ).toHaveAttribute('href', 'api/image/kitchen');
});

test('calendar discovery failure allows manual entry and retry', async ({
  page,
}) => {
  calendarFailure = true;
  await page.goto(baseURL);
  await page.getByLabel('Content', { exact: true }).selectOption('calendar');
  await expect(page.locator('#calendar-status')).toContainText(
    'Home Assistant unavailable',
  );
  await page.getByRole('button', { name: 'Add calendar', exact: true }).click();
  await page.getByLabel('Calendar', { exact: true }).selectOption('__manual');
  await page.getByLabel('Calendar entity ID').fill('calendar.manual');
  await page.getByRole('button', { name: 'Save all changes' }).click();
  await expect(page.locator('#status')).toContainText('All screens saved');
  expect(screens[0]?.pluginConfig).toEqual({
    calendars: [{ entity: 'calendar.manual', label: 'A' }],
  });
  calendarFailure = false;
  await page.getByRole('button', { name: 'Reload calendars' }).click();
  await expect(page.locator('#calendar-status')).toContainText(
    '2 calendars available',
  );
  await expect(page.getByLabel('Calendar', { exact: true })).toHaveValue(
    'calendar.manual',
  );
});

test('weather settings survive switching screens and failed saves remain editable', async ({
  page,
}) => {
  await page.goto(baseURL);
  await page.getByLabel('Content', { exact: true }).selectOption('weather');
  await page.getByLabel('Location name').fill('Berlin');
  await page.getByLabel('Latitude').fill('52.52');
  await page.getByLabel('Longitude').fill('13.405');
  await page.getByLabel('Timezone (optional)').fill('');
  await page.getByRole('button', { name: 'Add screen', exact: true }).click();
  await page.getByRole('button', { name: 'daily-quote' }).click();
  await expect(page.getByLabel('Location name')).toHaveValue('Berlin');
  saveFailure = true;
  await page.getByRole('button', { name: 'Save all changes' }).click();
  await expect(page.locator('#status')).toContainText(
    'Could not save: Storage unavailable',
  );
  await expect(
    page.getByRole('button', { name: 'Save all changes' }),
  ).toBeEnabled();
  expect(screens).toEqual([initialScreen]);
  saveFailure = false;
  await page.getByRole('button', { name: 'Save all changes' }).click();
  await expect(page.locator('#status')).toContainText('All screens saved');
  expect(screens[0]?.pluginConfig).toEqual({
    locationName: 'Berlin',
    latitude: 52.52,
    longitude: 13.405,
  });
});

test('deleting the last screen persists an empty list', async ({ page }) => {
  await page.goto(baseURL);
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete screen' }).click();
  await expect(page.getByText('No screens yet.')).toBeVisible();
  expect(screens).toHaveLength(1);
  await page.getByRole('button', { name: 'Save all changes' }).click();
  await expect(page.locator('#status')).toContainText('All screens saved');
  expect(screens).toEqual([]);
  await page.reload();
  await expect(page.getByText('No screens yet.')).toBeVisible();
});

test('configuration API validates plugin settings, duplicates and preview without mutation', async ({
  request,
}) => {
  for (const invalid of [
    [initialScreen, initialScreen],
    [{ ...initialScreen, pluginId: 'unknown' }],
    [{ ...initialScreen, pluginId: 'weather' }],
    [{ ...initialScreen, refresh: 0 }],
  ]) {
    const response = await request.post(`${baseURL}api/config/screens`, {
      data: invalid,
    });
    expect(response.status()).toBe(400);
  }
  const malformed = await request.post(`${baseURL}api/config/screens`, {
    data: '{',
  });
  expect(malformed.status()).toBe(400);
  const preview = await request.post(`${baseURL}api/config/preview`, {
    data: initialScreen,
  });
  expect(preview.status()).toBe(200);
  expect(await preview.text()).toContain('Screen preview');
  expect(screens).toEqual([initialScreen]);
  const save = await request.post(`${baseURL}api/config/screens`, { data: [] });
  expect(save.ok()).toBe(true);
  const get = await request.get(`${baseURL}api/config/screens`);
  expect(await get.json()).toEqual({ screenConfigs: [] });
  const crossOrigin = await request.post(`${baseURL}api/config/screens`, {
    data: [initialScreen],
    headers: { Origin: 'https://untrusted.example' },
  });
  expect(crossOrigin.status()).toBe(403);
  expect(screens).toEqual([]);
});

test('Home Assistant calendar discovery sends authorization and reports upstream errors', async () => {
  const app = new Hono();
  let failure = false;
  app.get('/api/calendars', (c) => {
    expect(c.req.header('authorization')).toBe('Bearer test-token');
    if (failure) return c.text('Unauthorized', 401);
    return c.json([{ entity_id: 'calendar.family', name: 'Family' }]);
  });
  const haServer = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  try {
    if (!haServer.listening)
      await new Promise<void>((resolve) => haServer.once('listening', resolve));
    const address = haServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP listener');
    const api = new HomeAssistantApi(
      `http://127.0.0.1:${address.port}`,
      'test-token',
    );
    expect(await api.fetchCalendars()).toEqual([
      { entity_id: 'calendar.family', name: 'Family' },
    ]);
    failure = true;
    await expect(api.fetchCalendars()).rejects.toThrow('401');
  } finally {
    await new Promise<void>((resolve, reject) =>
      haServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
