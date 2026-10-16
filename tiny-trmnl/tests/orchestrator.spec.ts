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
