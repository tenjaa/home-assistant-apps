import type { Liquid } from 'liquidjs';
import { firefox } from 'playwright';
import type { ScreenConfig } from './config.ts';
import { convertImage } from './image-magick.ts';
import type { Plugin, PluginFactory } from './plugins/plugin-factory.ts';

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

  private normalizeErrorMessage(error: unknown): string {
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

  private async generateImage(screen: Plugin): Promise<void> {
    let templateName = screen.pluginId;
    let data: object;

    console.log(`[${screen.screenId}] Gathering data...`);
    try {
      data = await screen.getData();
    } catch (error) {
      const errorMessage = this.normalizeErrorMessage(error);
      templateName = 'error';
      data = {
        errorMessage,
        pluginId: screen.pluginId,
        renderedAt: new Date().toISOString(),
        screenId: screen.screenId,
      };
      console.error(
        `[${screen.screenId}] Failed to gather data, rendering error screen instead: ${errorMessage}`,
        error,
      );
    }

    console.log(
      `[${screen.screenId}] Rendering template ${templateName}.liquid...`,
    );
    const html = await this.liquid.renderFile(templateName, data);

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
        `[${screen.screenId}] Image cached using ${templateName}.liquid (${image.byteLength} bytes)`,
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
