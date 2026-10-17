import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { expect, test } from '@playwright/test';
import { Liquid } from 'liquidjs';
import type { ScreenConfig } from '../src/config.ts';
import { HomeAssistantApi } from '../src/home-assistant.ts';
import { Orchestrator } from '../src/orchestrator.ts';
import { PluginFactory } from '../src/plugins/plugin-factory.ts';

test('previews do not change active screens and replacement is committed only after successful generation and storage', async () => {
  const liquid = new Liquid();
  liquid.renderFile = async (name) => {
    if (name === 'broken') throw new Error('Template failed');
    return `<html><body>${name}</body></html>`;
  };
  const factory = new PluginFactory(new HomeAssistantApi('http://unused', ''));
  factory.createScreen = (config) => ({
    screenId: config.screenId,
    pluginId: config.pluginId,
    getData: async () => ({}),
  });
  const orchestrator = new Orchestrator(liquid, factory);
  const config: ScreenConfig = {
    screenId: 'old',
    pluginId: 'quote',
    refresh: 3600,
    pluginConfig: {},
    screenSize: { width: 200, height: 100 },
  };
  try {
    await orchestrator.attachScreen(config);
    const original = orchestrator.getScreen('old');
    expect(original?.image.subarray(1, 4).toString()).toBe('PNG');
    await expect(
      orchestrator.preview({ ...config, screenId: 'draft' }),
    ).resolves.toContain('quote');
    expect(orchestrator.getScreen('draft')).toBeUndefined();
    await expect(
      orchestrator.replaceScreens([{ ...config, pluginId: 'broken' }]),
    ).rejects.toThrow('Template failed');
    expect(orchestrator.getScreen('old')).toBe(original);
    await expect(
      orchestrator.replaceScreens([{ ...config, screenId: 'new' }], () => {
        throw new Error('Disk full');
      }),
    ).rejects.toThrow('Disk full');
    expect(orchestrator.getScreen('old')).toBe(original);
    expect(orchestrator.getScreen('new')).toBeUndefined();
    let committed = false;
    await orchestrator.replaceScreens([{ ...config, screenId: 'new' }], () => {
      committed = true;
    });
    expect(committed).toBe(true);
    expect(orchestrator.getScreen('old')).toBeUndefined();
    expect(orchestrator.getScreen('new')?.image.byteLength).toBeGreaterThan(0);
    await orchestrator.replaceScreens([]);
    expect(orchestrator.getScreen('new')).toBeUndefined();
  } finally {
    orchestrator.clearScreens();
  }
});

test('failed refreshes preserve the last successful image with a hint and recover automatically', async ({
  page,
}) => {
  mock.timers.enable({ apis: ['setInterval'] });
  const liquid = new Liquid();
  liquid.renderFile = async (name, data) =>
    `<html><body style="margin:0;background:white;color:black"><h1>${name}: ${data && 'title' in data ? data.title : ''}</h1></body></html>`;
  let failure = false;
  let title = 'Original events';
  const factory = new PluginFactory(new HomeAssistantApi('http://unused', ''));
  factory.createScreen = (config) => ({
    screenId: config.screenId,
    pluginId: config.pluginId,
    getData: async () => {
      if (failure) throw new Error('Calendar unavailable');
      return { title };
    },
  });
  const orchestrator = new Orchestrator(liquid, factory);
  const config: ScreenConfig = {
    screenId: 'family-calendar',
    pluginId: 'calendar',
    refresh: 60,
    pluginConfig: {},
    screenSize: { width: 800, height: 480 },
  };
  try {
    await orchestrator.attachScreen(config);
    const original = orchestrator.getScreen(config.screenId);
    assert(original);
    failure = true;
    mock.timers.tick(60000);
    await expect
      .poll(() => orchestrator.getScreen(config.screenId)?.html)
      .toContain('Update failed - showing previous image');
    const stale = orchestrator.getScreen(config.screenId);
    assert(stale);
    expect(stale.html).toContain('Original events');
    expect(stale.html).not.toContain('Calendar unavailable');
    await page.setViewportSize(config.screenSize);
    await page.setContent(stale.html);
    const hint = page.getByRole('status');
    await expect(hint).toBeVisible();
    const bounds = await hint.boundingBox();
    assert(bounds);
    expect(bounds.x).toBe(0);
    expect(bounds.y + bounds.height).toBeCloseTo(config.screenSize.height);
    const comparison = await page.evaluate(
      async ({ original, stale, hintTop }) => {
        async function pixels(base64: string) {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas context unavailable');
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, canvas.width, canvas.height);
        }
        const before = await pixels(original);
        const after = await pixels(stale);
        let changedAboveHint = 0;
        let changedBelowHint = 0;
        for (let i = 0; i < before.data.length; i++) {
          if (before.data[i] !== after.data[i]) {
            if (i < before.width * Math.floor(hintTop) * 4) changedAboveHint++;
            else changedBelowHint++;
          }
        }
        return { changedAboveHint, changedBelowHint };
      },
      {
        original: original.image.toString('base64'),
        stale: stale.image.toString('base64'),
        hintTop: bounds.y,
      },
    );
    expect(comparison.changedAboveHint).toBe(0);
    expect(comparison.changedBelowHint).toBeGreaterThan(0);

    mock.timers.tick(60000);
    await expect
      .poll(() => orchestrator.getScreen(config.screenId))
      .not.toBe(stale);
    expect(
      orchestrator.getScreen(config.screenId)?.image.equals(stale.image),
    ).toBe(true);
    const stillStale = orchestrator.getScreen(config.screenId);
    assert(stillStale);
    await page.setContent(stillStale.html);
    await expect(page.getByRole('status')).toHaveCount(1);

    failure = false;
    title = 'Updated events';
    mock.timers.tick(60000);
    await expect
      .poll(() => orchestrator.getScreen(config.screenId)?.html)
      .toContain('Updated events');
    expect(orchestrator.getScreen(config.screenId)?.html).not.toContain(
      'Update failed',
    );
  } finally {
    orchestrator.clearScreens();
    mock.timers.reset();
  }
});

test('initial data failures show an error screen and do not become the last successful image', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const liquid = new Liquid();
  liquid.renderFile = async (name, data) =>
    `<html><body>${name}: ${data && 'errorMessage' in data ? data.errorMessage : 'Recovered events'}</body></html>`;
  let failure = true;
  const factory = new PluginFactory(new HomeAssistantApi('http://unused', ''));
  factory.createScreen = (config) => ({
    screenId: config.screenId,
    pluginId: config.pluginId,
    getData: async () => {
      if (failure) throw new Error('Calendar unavailable');
      return {};
    },
  });
  const orchestrator = new Orchestrator(liquid, factory);
  const config: ScreenConfig = {
    screenId: 'family-calendar',
    pluginId: 'calendar',
    refresh: 60,
    pluginConfig: {},
    screenSize: { width: 200, height: 100 },
  };
  try {
    await orchestrator.attachScreen(config);
    const original = orchestrator.getScreen(config.screenId);
    assert(original);
    expect(original.html).toContain('error: Calendar unavailable');
    mock.timers.tick(60000);
    await expect
      .poll(() => orchestrator.getScreen(config.screenId))
      .not.toBe(original);
    expect(orchestrator.getScreen(config.screenId)?.html).not.toContain(
      'showing previous image',
    );
    failure = false;
    mock.timers.tick(60000);
    await expect
      .poll(() => orchestrator.getScreen(config.screenId)?.html)
      .toContain('calendar: Recovered events');
  } finally {
    orchestrator.clearScreens();
    mock.timers.reset();
  }
});
