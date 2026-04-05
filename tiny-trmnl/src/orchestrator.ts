import type { Liquid } from 'liquidjs';
import { firefox } from 'playwright';
import { convertImage } from './image-magick.ts';
import type { Plugin, PluginFactory } from './plugins/plugin-factory.ts';
import type { ScreenConfig } from './server.ts';

export interface HaConfig {
  baseUrl: string;
  token: string;
}

export class Orchestrator {
  private readonly cache = new Map<string, { html: string; image: Buffer }>();

  constructor(
    private readonly liquid: Liquid,
    private readonly pluginFactory: PluginFactory,
  ) {}

  async attachScreen(screenConfig: ScreenConfig): Promise<void> {
    const screen = this.pluginFactory.createScreen(screenConfig);

    console.log(`[${screenConfig.screenId}] Initial screen generation...`);
    await this.generateImage(screen);
    console.log(
      `[${screenConfig.screenId}] Scheduling refresh every ${screenConfig.refresh}s`,
    );
    setInterval(
      () => void this.generateImage(screen),
      screenConfig.refresh * 1000,
    );
  }

  private async generateImage(screen: Plugin): Promise<void> {
    console.log(`[${screen.screenId}] Gathering data...`);
    const data = await screen.getData();
    console.log(`[${screen.screenId}] Rendering template...`);
    const html = await this.liquid.renderFile(screen.pluginId, data);

    console.log(`[${screen.screenId}] Taking screenshot...`);
    const browser = await firefox.launch();
    const context = await browser.newContext({
      screen: { height: 480, width: 800 },
      viewport: { height: 480, width: 800 },
    });
    try {
      const page = await context.newPage();
      await page.setContent(html);
      const screenshot = await page.screenshot({ type: 'png' });
      const image = await convertImage(screenshot);
      this.cache.set(screen.screenId, { html, image });
      console.log(
        `[${screen.pluginId}] Image cached (${image.byteLength} bytes)`,
      );
    } finally {
      await context.close();
      await browser.close();
    }
  }

  getScreen(id: string): { html: string; image: Buffer } | undefined {
    return this.cache.get(id);
  }
}
