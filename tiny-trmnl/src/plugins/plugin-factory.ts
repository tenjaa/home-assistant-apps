import type { HomeAssistantApi } from '../home-assistant.ts';
import type { ScreenConfig } from '../server.ts';
import { CalendarPlugin, ZodCalendarPluginConfig } from './calendar.ts';
import { QuotePlugin2 } from './quote.ts';
import { WeatherPlugin, ZodWeatherPluginConfig } from './weather.ts';

export interface Plugin {
  readonly pluginId: string;
  readonly screenId: string;

  getData(): Promise<object>;
}

export class PluginFactory {
  constructor(private readonly ha: HomeAssistantApi) {}

  createScreen(screenConfig: ScreenConfig): Plugin {
    switch (screenConfig.pluginId) {
      case 'quote':
        return new QuotePlugin2(screenConfig.screenId);
      case 'calendar':
        return new CalendarPlugin(
          screenConfig.screenId,
          this.ha,
          ZodCalendarPluginConfig.parse(screenConfig.pluginConfig),
        );
      case 'weather':
        return new WeatherPlugin(
          screenConfig.screenId,
          ZodWeatherPluginConfig.parse(screenConfig.pluginConfig),
        );

      default:
        throw new Error(`Unknown plugin id ${screenConfig.pluginId}`);
    }
  }
}
