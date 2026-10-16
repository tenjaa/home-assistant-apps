import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { Liquid } from 'liquidjs';
import {
  loadRuntimeConfig,
  type ScreenConfig,
  writeScreenConfigs,
} from './config.ts';
import { HomeAssistantApi } from './home-assistant.ts';
import { createManagementApp } from './management.ts';
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

async function applyScreenConfigs(
  nextScreenConfigs: ScreenConfig[],
): Promise<void> {
  for (const screenConfig of nextScreenConfigs) {
    pluginFactory.validateScreenConfig(screenConfig);
  }

  await orchestrator.replaceScreens(nextScreenConfigs, () =>
    writeScreenConfigs(screensPath, nextScreenConfigs),
  );
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

app.route(
  '/',
  createManagementApp({
    screensPath,
    getScreens: () => screenConfigs,
    validateScreen: (screen) => pluginFactory.validateScreenConfig(screen),
    saveScreens: applyScreenConfigs,
    preview: (screen) => orchestrator.preview(screen),
    getCalendars: () => homeAssistantApi.fetchCalendars(),
  }),
);

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
