import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { parseScreenConfigs, type ScreenConfig } from './config.ts';

interface ManagementServices {
  screensPath: string;
  getScreens(): ScreenConfig[];
  validateScreen(screen: ScreenConfig): void;
  saveScreens(screens: ScreenConfig[]): Promise<void>;
  preview(screen: ScreenConfig): Promise<string>;
  getCalendars(): Promise<{ entity_id: string; name: string }[]>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createManagementApp(services: ManagementServices): Hono {
  const app = new Hono();
  let saving = false;

  app.get('/', (c) =>
    c.html(readFileSync(new URL('../web/index.html', import.meta.url), 'utf8')),
  );
  for (const [name, contentType] of [
    ['app.js', 'text/javascript'],
    ['style.css', 'text/css'],
  ]) {
    app.get(`/ui/${name}`, (c) =>
      c.body(
        readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8'),
        200,
        { 'Content-Type': `${contentType}; charset=utf-8` },
      ),
    );
  }
  app.use('/api/config/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    // Browsers must not send configuration changes from another website.
    const origin = c.req.header('origin');
    if (
      c.req.method === 'POST' &&
      origin &&
      origin !== new URL(c.req.url).origin
    ) {
      return c.json(
        { error: 'Cross-origin configuration requests are not allowed' },
        403,
      );
    }
    await next();
  });
  app.get('/api/config/screens', (c) =>
    c.json({ screenConfigs: services.getScreens() }),
  );
  app.get('/api/config/calendars', async (c) => {
    try {
      return c.json({ calendars: await services.getCalendars() });
    } catch (error) {
      console.error('[config] Calendar discovery failed', error);
      return c.json({ error: errorMessage(error) }, 502);
    }
  });
  app.post('/api/config/:action', async (c) => {
    const action = c.req.param('action');
    if (action !== 'screens' && action !== 'preview') return c.notFound();
    let screens: ScreenConfig[];
    try {
      const body: unknown = await c.req.json();
      const raw =
        action === 'preview'
          ? [body]
          : Array.isArray(body)
            ? body
            : body && typeof body === 'object' && 'screenConfigs' in body
              ? body.screenConfigs
              : undefined;
      screens = parseScreenConfigs(raw);
      for (const screen of screens) services.validateScreen(screen);
    } catch (error) {
      console.error('[config] Invalid configuration', error);
      return c.json({ error: errorMessage(error) }, 400);
    }
    if (action === 'preview') {
      try {
        const screen = screens[0];
        if (!screen) throw new Error('Expected one screen');
        return c.html(await services.preview(screen));
      } catch (error) {
        console.error('[config] Preview failed', error);
        return c.json({ error: errorMessage(error) }, 500);
      }
    }
    if (saving)
      return c.json(
        { error: 'A save is already in progress. Please retry.' },
        409,
      );
    saving = true;
    try {
      await services.saveScreens(screens);
      return c.json({
        message: 'Screen config updated',
        screenConfigs: services.getScreens(),
        screensPath: services.screensPath,
      });
    } catch (error) {
      console.error('[config] Save failed', error);
      return c.json({ error: errorMessage(error) }, 500);
    } finally {
      saving = false;
    }
  });
  return app;
}
