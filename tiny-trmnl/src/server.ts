import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { Liquid } from 'liquidjs';
import {
  loadRuntimeConfig,
  parseScreenConfigs,
  type ScreenConfig,
  writeScreenConfigs,
} from './config.ts';
import { HomeAssistantApi } from './home-assistant.ts';
import { Orchestrator } from './orchestrator.ts';
import { PluginFactory } from './plugins/plugin-factory.ts';

// ── Load config ──────────────────────────────────────────────────────────────

const {
  appConfig,
  dataDir,
  screenConfigs: initialScreenConfigs,
  screensPath,
} = loadRuntimeConfig();
console.log(`[config] Using data directory ${dataDir}`);
console.log(`[config] Active screen config file ${screensPath}`);
let screenConfigs = initialScreenConfigs;

// ── Orchestrator ─────────────────────────────────────────────────────────────

const homeAssistantApi = new HomeAssistantApi(
  appConfig.ha.baseUrl,
  appConfig.ha.token,
);

const pluginFactory = new PluginFactory(homeAssistantApi);

const orchestrator = new Orchestrator(
  new Liquid({
    root: new URL('./../templates', import.meta.url).pathname,
    extname: '.liquid',
  }),
  pluginFactory,
);

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown error';
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error) || 'Unknown error';
  } catch {
    return String(error);
  }
}

function extractPostedScreenConfigs(body: unknown): ScreenConfig[] {
  if (Array.isArray(body)) {
    return parseScreenConfigs(body);
  }

  if (body && typeof body === 'object' && 'screenConfigs' in body) {
    return parseScreenConfigs(body.screenConfigs);
  }

  throw new Error(
    'Expected request body to be an array of screen configs or an object with screenConfigs',
  );
}

async function applyScreenConfigs(
  nextScreenConfigs: ScreenConfig[],
): Promise<void> {
  for (const screenConfig of nextScreenConfigs) {
    pluginFactory.validateScreenConfig(screenConfig);
  }

  writeScreenConfigs(screensPath, nextScreenConfigs);
  await orchestrator.replaceScreens(nextScreenConfigs);
  screenConfigs = nextScreenConfigs;
}

console.log(`Attaching ${screenConfigs.length} screen(s)...`);
for (const screen of screenConfigs) {
  console.log(
    `[${screen.screenId}] plugin=${screen.pluginId} refresh=${screen.refresh}s`,
  );
  await orchestrator.attachScreen(screen);
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const app = new Hono();

app.use(logger());

app.post('/api/config/screens', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    const message = normalizeErrorMessage(error);
    console.error(
      `[config] Failed to parse posted screen config JSON: ${message}`,
    );
    return c.json({ error: `Invalid JSON body: ${message}` }, 400);
  }

  let nextScreenConfigs: ScreenConfig[];
  try {
    nextScreenConfigs = extractPostedScreenConfigs(body);
  } catch (error) {
    const message = normalizeErrorMessage(error);
    console.error(`[config] Rejected posted screen config: ${message}`, error);
    return c.json({ error: message }, 400);
  }

  try {
    await applyScreenConfigs(nextScreenConfigs);
  } catch (error) {
    const message = normalizeErrorMessage(error);
    console.error(`[config] Failed to apply screen config: ${message}`, error);
    return c.json({ error: message }, 500);
  }

  console.log(
    `[config] Applied ${nextScreenConfigs.length} screen config(s) from API`,
  );
  return c.json({
    message: 'Screen config updated',
    screenConfigs: nextScreenConfigs,
    screensPath,
  });
});

app.get('/api/html/:screenId', async (c) => {
  const screenId = c.req.param('screenId');

  const screen = orchestrator.getScreen(screenId);
  if (!screen) {
    return c.text('Screen not found', 404);
  }

  return c.html(screen.html);
});

app.get('/api/image/:screenId', (c) => {
  const screenId = c.req.param('screenId');

  const screen = orchestrator.getScreen(screenId);
  if (!screen) {
    return c.text('Screen not found', 404);
  } else {
    return c.body(new Uint8Array(screen.image), 200, {
      'content-type': 'image/png',
    });
  }
});

serve({ fetch: app.fetch, port: 8080 }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});
