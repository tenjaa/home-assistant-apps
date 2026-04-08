import * as z from 'zod';
import type { Plugin } from './plugin-factory.ts';

interface BrightskyHour {
  timestamp: string;
  temperature: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  precipitation: number | null;
  precipitation_probability: number | null;
  precipitation_probability_6h: number | null;
  cloud_cover: number | null;
  condition: string | null;
  icon: string | null;
}

interface BrightskyResponse {
  weather: BrightskyHour[];
}

function iconToCondition(icon: string | null): string {
  switch (icon) {
    case 'clear-day':
    case 'clear-night':
      return 'Clear';
    case 'partly-cloudy-day':
    case 'partly-cloudy-night':
      return 'Partly cloudy';
    case 'cloudy':
      return 'Cloudy';
    case 'fog':
      return 'Fog';
    case 'wind':
      return 'Windy';
    case 'rain':
      return 'Rain';
    case 'sleet':
      return 'Sleet';
    case 'snow':
      return 'Snow';
    case 'hail':
      return 'Hail';
    case 'thunderstorm':
      return 'Thunderstorm';
    default:
      return icon ?? 'Unknown';
  }
}

export const ZodWeatherPluginConfig = z.object({
  locationName: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string().optional(),
});
type WeatherPluginConfig = z.infer<typeof ZodWeatherPluginConfig>;

export class WeatherPlugin implements Plugin {
  readonly pluginId: string = 'weather';

  constructor(
    readonly screenId: string,
    private readonly config: WeatherPluginConfig,
  ) {}

  async getData(): Promise<object> {
    const today = new Date().toISOString().slice(0, 10);
    const url = new URL('https://api.brightsky.dev/weather');
    url.searchParams.set('lat', `${this.config.latitude}`);
    url.searchParams.set('lon', `${this.config.longitude}`);
    url.searchParams.set('date', today);
    if (this.config.timezone) {
      url.searchParams.set('tz', this.config.timezone);
    }

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Brightsky API error: ${res.status} ${res.statusText}`);
    }

    const payload = (await res.json()) as BrightskyResponse;
    const hours = payload.weather;
    if (!hours || hours.length === 0) {
      throw new Error('Brightsky API response missing weather data');
    }

    // Find the closest hourly entry to now
    const nowMs = Date.now();
    const current = hours.reduce((closest, h) => {
      const diff = Math.abs(new Date(h.timestamp).getTime() - nowMs);
      const prevDiff = Math.abs(new Date(closest.timestamp).getTime() - nowMs);
      return diff < prevDiff ? h : closest;
    });

    const temps = hours.map((h) => h.temperature).filter((t): t is number => t !== null);
    const rainProbs = hours
      .map((h) => h.precipitation_probability ?? h.precipitation_probability_6h)
      .filter((p): p is number => p !== null);

    return {
      location: this.config.locationName,
      current: {
        temperatureC: current.temperature,
        windSpeedKmh: current.wind_speed,
        windDirection: current.wind_direction,
        condition: iconToCondition(current.icon),
        updatedAt: current.timestamp,
      },
      today: {
        highC: temps.length > 0 ? Math.max(...temps) : null,
        lowC: temps.length > 0 ? Math.min(...temps) : null,
        precipitationChancePercent: rainProbs.length > 0 ? Math.max(...rainProbs) : null,
      },
    };
  }
}
