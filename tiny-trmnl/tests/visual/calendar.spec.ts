/// <reference lib="dom" />

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, expect, test } from '@playwright/test';
import { Liquid } from 'liquidjs';
import { convertImage } from '../../src/image-magick.ts';
import { calendarData } from './fixtures/calendar-data.ts';
import { calendarOverflowData } from './fixtures/calendar-overflow-data.ts';

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

type Screen = (typeof screens)[number];

async function renderCalendar(browser: Browser, screen: Screen, data: object) {
  const html = await liquid.renderFile('calendar', data);
  const context = await browser.newContext({
    screen,
    viewport: screen,
  });

  try {
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

    const layout = await page.evaluate(() => {
      const container = document.querySelector('.container');
      const items = [...document.querySelectorAll('.t-item')];
      const entries = [...document.querySelectorAll('.t-item .item')];

      if (!container) {
        throw new Error('Calendar container not found');
      }

      const containerBounds = container.getBoundingClientRect();
      const itemBounds = items.map((item) => item.getBoundingClientRect());
      const entryBounds = entries.map((entry) => entry.getBoundingClientRect());

      return {
        containerHeight: containerBounds.height,
        containerScrollHeight: container.scrollHeight,
        containerScrollWidth: container.scrollWidth,
        containerWidth: containerBounds.width,
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        fontStatus: document.fonts.status,
        hiddenOverflow: getComputedStyle(container).overflow === 'hidden',
        offscreenEntries: entryBounds.filter(
          (entry) =>
            entry.right > containerBounds.right ||
            entry.bottom > containerBounds.bottom,
        ).length,
        offscreenItems: itemBounds.filter(
          (item) =>
            item.right > containerBounds.right ||
            item.bottom > containerBounds.bottom,
        ).length,
        rightmostItem:
          itemBounds.length > 0
            ? Math.max(...itemBounds.map((item) => item.right))
            : 0,
        totalEntries: entries.length,
        totalItems: items.length,
      };
    });

    const screenshot = await page.screenshot({
      animations: 'disabled',
      type: 'png',
    });

    return {
      failedAssets,
      image: await convertImage(screenshot),
      layout,
    };
  } finally {
    await context.close();
  }
}

test.describe('calendar image', () => {
  for (const screen of screens) {
    test(`${screen.name} screen (${screen.width}x${screen.height})`, async ({
      browser,
    }) => {
      const { failedAssets, image, layout } = await renderCalendar(
        browser,
        screen,
        calendarData,
      );

      expect(
        failedAssets,
        'all TRMNL styles, fonts, and images loaded',
      ).toEqual([]);
      expect(layout.fontStatus).toBe('loaded');
      expect(layout.containerWidth).toBeGreaterThan(screen.width * 0.95);
      if (screen.name === 'large') {
        expect(layout.rightmostItem).toBeGreaterThan(screen.width * 0.7);
      }

      expect(image).toMatchSnapshot(`calendar-${screen.name}.png`);
    });

    test(`${screen.name} screen clips excess entries (${screen.width}x${screen.height})`, async ({
      browser,
    }) => {
      const { failedAssets, image, layout } = await renderCalendar(
        browser,
        screen,
        calendarOverflowData,
      );

      expect(
        failedAssets,
        'all TRMNL styles, fonts, and images loaded',
      ).toEqual([]);
      expect(layout.fontStatus).toBe('loaded');
      expect(layout.totalItems).toBe(calendarOverflowData.days.length);
      expect(layout.totalEntries).toBe(
        calendarOverflowData.days.reduce(
          (total, day) => total + day.entries.length,
          0,
        ),
      );
      expect(layout.hiddenOverflow).toBe(true);
      expect(layout.offscreenItems).toBeGreaterThan(0);
      expect(layout.offscreenEntries).toBeGreaterThan(0);
      expect(layout.containerScrollWidth).toBeGreaterThan(
        layout.containerWidth,
      );
      expect(layout.containerScrollHeight).toBeLessThanOrEqual(
        layout.containerHeight,
      );
      expect(layout.documentWidth).toBe(screen.width);
      expect(layout.documentHeight).toBe(screen.height);

      expect(image).toMatchSnapshot(`calendar-overflow-${screen.name}.png`);
    });
  }
});
