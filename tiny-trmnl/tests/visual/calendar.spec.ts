/// <reference lib="dom" />

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { Liquid } from 'liquidjs';
import { convertImage } from '../../src/image-magick.ts';
import { calendarData } from './fixtures/calendar-data.ts';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const liquid = new Liquid({
  root: resolve(testDirectory, '../../templates'),
  extname: '.liquid',
});

const screens = [
  { name: 'small', width: 800, height: 480 },
  { name: 'large', width: 1872, height: 1404 },
] as const;

const trmnlAssetPrefix = 'https://trmnl.com/';

test.describe('calendar image', () => {
  for (const screen of screens) {
    test(`${screen.name} screen (${screen.width}x${screen.height})`, async ({
      browser,
    }) => {
      const html = await liquid.renderFile('calendar', calendarData);
      const context = await browser.newContext({
        screen,
        viewport: screen,
      });
      const page = await context.newPage();
      const failedAssets: string[] = [];

      page.on('requestfailed', (request) => {
        if (request.url().startsWith(trmnlAssetPrefix)) {
          failedAssets.push(request.url());
        }
      });
      page.on('response', (response) => {
        if (response.url().startsWith(trmnlAssetPrefix) && !response.ok()) {
          failedAssets.push(`${response.status()} ${response.url()}`);
        }
      });

      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);

      expect(
        failedAssets,
        'all TRMNL styles, fonts, and images loaded',
      ).toEqual([]);
      expect(await page.evaluate(() => document.fonts.status)).toBe('loaded');

      const screenshot = await page.screenshot({
        animations: 'disabled',
        type: 'png',
      });
      const image = await convertImage(screenshot);

      expect(image).toMatchSnapshot(`calendar-${screen.name}.png`);

      await context.close();
    });
  }
});
