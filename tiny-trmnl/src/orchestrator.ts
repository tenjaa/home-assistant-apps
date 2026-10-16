import type { Liquid } from 'liquidjs';
import { firefox } from 'playwright';
import type { ScreenConfig, ScreenSize } from './config.ts';
import { convertImage } from './image-magick.ts';
import type { Plugin, PluginFactory } from './plugins/plugin-factory.ts';

export class Orchestrator {
  private readonly cache = new Map<string, { html: string; image: Buffer }>();
  private readonly refreshTimers = new Map<
    string,
    ReturnType<typeof setInterval>
  >();

  constructor(
    private readonly liquid: Liquid,
    private readonly pluginFactory: PluginFactory,
  ) {}

  async replaceScreens(
    screenConfigs: ScreenConfig[],
    beforeCommit: () => void = () => {},
  ): Promise<void> {
    const prepared = [];
    for (const screenConfig of screenConfigs) {
      const screen = this.pluginFactory.createScreen(screenConfig);
      const result = await this.generateImage(screen, screenConfig.screenSize);
      prepared.push({ screenConfig, screen, result });
    }
    beforeCommit();
    this.clearScreens();
    for (const { screenConfig, screen, result } of prepared) {
      this.cache.set(screenConfig.screenId, result);
      this.scheduleRefresh(screenConfig, screen);
    }
  }

  async attachScreen(screenConfig: ScreenConfig): Promise<void> {
    const screen = this.pluginFactory.createScreen(screenConfig);

    console.log(
      `[${screenConfig.screenId}] Initial screen generation at ${screenConfig.screenSize.width}x${screenConfig.screenSize.height}...`,
    );
    const result = await this.generateImage(screen, screenConfig.screenSize);
    this.cache.set(screenConfig.screenId, result);
    this.scheduleRefresh(screenConfig, screen);
  }

  private scheduleRefresh(screenConfig: ScreenConfig, screen: Plugin): void {
    console.log(
      `[${screenConfig.screenId}] Scheduling refresh every ${screenConfig.refresh}s`,
    );
    let refreshing = false;
    const timer = setInterval(async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const result = await this.generateImage(
          screen,
          screenConfig.screenSize,
        );
        if (this.refreshTimers.get(screenConfig.screenId) === timer) {
          this.cache.set(screenConfig.screenId, result);
        }
      } catch (error) {
        console.error(`[${screenConfig.screenId}] Refresh failed`, error);
      } finally {
        refreshing = false;
      }
    }, screenConfig.refresh * 1000);
    this.refreshTimers.set(screenConfig.screenId, timer);
  }

  clearScreens(): void {
    for (const [screenId, timer] of this.refreshTimers.entries()) {
      clearInterval(timer);
      console.log(`[${screenId}] Removed scheduled refresh`);
    }

    this.refreshTimers.clear();
    this.cache.clear();
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

  async preview(screenConfig: ScreenConfig): Promise<string> {
    return this.renderScreen(this.pluginFactory.createScreen(screenConfig));
  }

  private async renderScreen(screen: Plugin): Promise<string> {
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
    return html;
  }

  private async generateImage(
    screen: Plugin,
    screenSize: ScreenSize,
  ): Promise<{ html: string; image: Buffer }> {
    const html = await this.renderScreen(screen);
    console.log(`[${screen.screenId}] Taking screenshot...`);
    const browser = await firefox.launch();
    try {
      const context = await browser.newContext({
        screen: screenSize,
        viewport: screenSize,
      });
      const page = await context.newPage();
      await page.setContent(html);
      const screenshot = await page.screenshot({ type: 'png' });
      const image = await convertImage(screenshot);
      return { html, image };
    } finally {
      await browser.close();
    }
  }

  getScreen(id: string): { html: string; image: Buffer } | undefined {
    return this.cache.get(id);
  }
}
