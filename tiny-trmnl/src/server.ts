import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { firefox } from 'playwright';
import { BASE_URL } from './homeassistant.ts';
import { convertImage } from './image-magick.ts';
import { renderCalendarHtml } from './liquid.ts';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let cachedImage: Buffer | null = null;

async function generateImage(): Promise<Buffer> {
  console.log('Generating image...');
  const startMs = Date.now();
  const browser = await firefox.launch();
  console.log(`Browser launched (${Date.now() - startMs}ms)`);
  const context = await browser.newContext({
    screen: { height: 480, width: 800 },
    viewport: { height: 480, width: 800 },
  });
  const page = await context.newPage();
  const html = await renderCalendarHtml();
  console.log(`HTML rendered (${Date.now() - startMs}ms)`);
  await page.setContent(html);
  const screenshot = await page.screenshot({ type: 'png' });
  console.log(`Screenshot taken (${Date.now() - startMs}ms)`);
  const converted = await convertImage(screenshot);
  console.log(`Image converted (${Date.now() - startMs}ms)`);
  await context.close();
  await browser.close();
  console.log(`Image generated successfully in ${Date.now() - startMs}ms`);
  return Buffer.from(converted);
}

async function refreshCache(): Promise<void> {
  console.log('Refreshing image cache...');
  try {
    cachedImage = await generateImage();
    console.log('Image cache updated');
  } catch (err) {
    console.error('Failed to generate image:', err);
  }
}

const app = new Hono();

app.use(logger());

app.get('/api/setup', (c) => {
  console.log('Headers:', c.req.header());
  return c.json({
    api_key: randomUUID(),
    friendly_id: randomUUID(),
    image_url: 'url.com',
    message: 'Hello from tiny-trmnl',
  });
});

app.get('/api/display', (c) => {
  console.log('Serving image URL:', `${BASE_URL}/api/image`);
  console.log(
    'Cache status:',
    cachedImage ? `${cachedImage.length} bytes` : 'empty',
  );

  return c.json({
    status: 0,
    image_url: `${BASE_URL}/api/image`,
    filename: `${crypto.randomUUID()}.png`,
    update_firmware: false,
    firmware_url: 'https://trmnl-fw.s3.us-east-2.amazonaws.com/FW1.7.5.bin',
    refresh_rate: 600,
    reset_firmware: false,
  });
});

app.post('/api/log', async (c) => {
  const body = await c.req.text();
  console.log('Received log request with body:', body);
  return c.body(null, 204);
});

app.get('/api/html', async (c) => {
  console.log('Received HTML request');
  const html = await renderCalendarHtml();
  return c.html(html);
});

app.get('/api/image', async (c) => {
  if (!cachedImage) {
    console.warn('Image requested but cache is empty, returning 503');
    return c.text('Image not yet generated, try again shortly', 503);
  }
  console.log(`Serving cached image (${cachedImage.length} bytes)`);
  return c.body(new Uint8Array(cachedImage), 200, {
    'content-type': 'image/png',
  });
});

app.post('/api/refresh', async (c) => {
  console.log('Received manual refresh request');
  const before = Date.now();
  await refreshCache();
  console.log(`Manual refresh completed in ${Date.now() - before}ms`);
  return c.text('OK', 200);
});

serve(
  {
    fetch: app.fetch,
    port: 8080,
  },
  async (info) => {
    console.log('Triggering initial image generation...');
    await refreshCache();
    console.log(
      `Scheduling image refresh every ${REFRESH_INTERVAL_MS / 1000 / 60} minutes`,
    );
    setInterval(refreshCache, REFRESH_INTERVAL_MS);
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
