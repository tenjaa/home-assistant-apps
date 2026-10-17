import type { Liquid } from 'liquidjs';
import { firefox } from 'playwright';
import type { ScreenConfig, ScreenSize } from './config.ts';
import { convertImage } from './image-magick.ts';
import type { Plugin, PluginFactory } from './plugins/plugin-factory.ts';

interface ScreenImage {
  html: string;
  image: Buffer;
}

interface CachedScreen extends ScreenImage {
  lastSuccessful?: ScreenImage;
}

const STALE_HINT = `<div role="status" style="position:fixed;bottom:0;left:0;z-index:2147483647;background:#fff;color:#000;border:1px solid #000;padding:3px 6px;font:12px/1.2 sans-serif">Update failed - showing previous image</div>`;

function addStaleHint(html: string): string {
  return html.includes('</body>')
    ? html.replace('</body>', `${STALE_HINT}</body>`)
    : `${html}${STALE_HINT}`;
}

export class Orchestrator {
  private readonly cache = new Map<string, CachedScreen>();
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
          this.cache.get(screenConfig.screenId),
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
    const result = await this.renderScreen(
      this.pluginFactory.createScreen(screenConfig),
    );
    return result.html;
  }

  private async renderScreen(
    screen: Plugin,
    previous?: ScreenImage,
  ): Promise<{ html: string; successful: boolean }> {
    let templateName = screen.pluginId;
    let data: object;
    let successful = true;

    console.log(`[${screen.screenId}] Gathering data...`);
    try {
      data = await screen.getData();
    } catch (error) {
      const errorMessage = this.normalizeErrorMessage(error);
      console.error(
        `[${screen.screenId}] Failed to gather data, ${previous ? 'keeping previous image' : 'rendering error screen instead'}: ${errorMessage}`,
        error,
      );
      if (previous) {
        return { html: addStaleHint(previous.html), successful: false };
      }
      successful = false;
      templateName = 'error';
      data = {
        errorMessage,
        pluginId: screen.pluginId,
        renderedAt: new Date().toISOString(),
        screenId: screen.screenId,
      };
    }

    console.log(
      `[${screen.screenId}] Rendering template ${templateName}.liquid...`,
    );
    const html = await this.liquid.renderFile(templateName, data);
    return { html, successful };
  }

  private async generateImage(
    screen: Plugin,
    screenSize: ScreenSize,
    previous?: CachedScreen,
  ): Promise<CachedScreen> {
    const lastSuccessful = previous?.lastSuccessful;
    const { html, successful } = await this.renderScreen(
      screen,
      lastSuccessful,
    );
    const screenshotHtml =
      !successful && lastSuccessful
        ? addStaleHint(
            `<html><body style="margin:0;overflow:hidden"><img alt="Previous screen" src="data:image/png;base64,${lastSuccessful.image.toString('base64')}" style="display:block;width:100vw;height:100vh"></body></html>`,
          )
        : html;
    console.log(`[${screen.screenId}] Taking screenshot...`);
    const browser = await firefox.launch();
    try {
      const context = await browser.newContext({
        screen: screenSize,
        viewport: screenSize,
      });
      const page = await context.newPage();
      await page.setContent(screenshotHtml);
      const screenshot = await page.screenshot({ type: 'png' });
      const image = await convertImage(screenshot);
      return {
        html,
        image,
        lastSuccessful: successful ? { html, image } : lastSuccessful,
      };
    } finally {
      await browser.close();
    }
  }

  getScreen(id: string): { html: string; image: Buffer } | undefined {
    return this.cache.get(id);
  }
}
