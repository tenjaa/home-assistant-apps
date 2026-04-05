import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { Liquid } from 'liquidjs';
import { HomeAssistantApi } from './home-assistant.ts';
import { Orchestrator } from './orchestrator.ts';
import { PluginFactory } from './plugins/plugin-factory.ts';

export interface ScreenConfig {
  screenId: string;
  refresh: number; // seconds
  pluginId: string;
  pluginConfig: object;
}

interface Config {
  baseUrl: string;
  ha: {
    baseUrl: string;
    token: string;
  };
  screenConfigs: ScreenConfig[];
}

// ── Load config ──────────────────────────────────────────────────────────────

const configPath = process.env.CONFIG_PATH ?? '/data/options.json';
console.log(`Loading config from ${configPath}...`);

let config: Config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8')) as Config;
} catch (err) {
  throw new Error(`Failed to read config from ${configPath}: ${err}`);
}

console.log(
  `Config loaded: baseUrl=${config.baseUrl}, screens=${config.screenConfigs.length}`,
);

// ── Orchestrator ─────────────────────────────────────────────────────────────

const homeAssistantApi = new HomeAssistantApi(
  config.ha.baseUrl,
  config.ha.token,
);

const pluginFactory = new PluginFactory(homeAssistantApi);

const orchestrator = new Orchestrator(
  new Liquid({
    root: new URL('./../templates', import.meta.url).pathname,
    extname: '.liquid',
  }),
  pluginFactory,
);

console.log(`Attaching ${config.screenConfigs.length} screen(s)...`);
for (const screen of config.screenConfigs) {
  console.log(
    `[${screen.screenId}] plugin=${screen.pluginId} refresh=${screen.refresh}s`,
  );
  await orchestrator.attachScreen(screen);
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const app = new Hono();

app.use(logger());

app.get('/api/setup', (c) => {
  return c.json({
    api_key: randomUUID(),
    friendly_id: randomUUID(),
    image_url: `${config.baseUrl}/api/image`,
    message: 'Hello from tiny-trmnl',
  });
});

app.get('/api/display', (c) => {
  const id = c.req.query('id') ?? config.screenConfigs[0]?.screenId;
  if (!id) return c.json({ status: 1, error: 'No screens configured' }, 503);

  const imageUrl = `${config.baseUrl}/api/image?id=${encodeURIComponent(id)}`;
  console.log(`[${id}] Serving display → ${imageUrl}`);

  return c.json({
    status: 0,
    image_url: imageUrl,
    filename: `${randomUUID()}.png`,
    update_firmware: false,
    firmware_url: 'https://trmnl-fw.s3.us-east-2.amazonaws.com/FW1.7.5.bin',
    refresh_rate: 600,
    reset_firmware: false,
  });
});

app.post('/api/log', async (c) => {
  const body = await c.req.text();
  console.log('Device log:', body);
  return c.body(null, 204);
});

app.get('/api/html/:screenId', async (c) => {
  const screenId = c.req.param('screenId');

  const screen = orchestrator.getScreen(screenId);
  if (!screen) {
    return c.text('Screen not found', 404);
  } else {
    c.html(screen.html);
  }
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
