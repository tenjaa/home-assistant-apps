import * as z from 'zod';
import type { Plugin } from './plugin-factory.ts';

interface OpenMeteoResponse {
  current?: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
}

function weatherCodeToText(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
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
    private readonly pluginConfig: WeatherPluginConfig,
  ) {}

  async getData(): Promise<object> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', `${this.pluginConfig.latitude}`);
    url.searchParams.set('longitude', `${this.pluginConfig.longitude}`);
    url.searchParams.set(
      'current',
      'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    );
    url.searchParams.set(
      'daily',
      'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    );
    url.searchParams.set('forecast_days', '1');
    url.searchParams.set(
      'timezone',
      this.pluginConfig.timezone ?? 'Europe/Berlin',
    );

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Weather API error: ${res.status} ${res.statusText}`);
    }

    const payload = (await res.json()) as OpenMeteoResponse;
    if (!payload.current) {
      throw new Error('Weather API response missing current data');
    }

    return {
      location: this.pluginConfig.locationName,
      current: {
        temperatureC: payload.current.temperature_2m,
        feelsLikeC: payload.current.apparent_temperature,
        windSpeedKmh: payload.current.wind_speed_10m,
        condition: weatherCodeToText(payload.current.weather_code),
        updatedAt: payload.current.time,
      },
      today: {
        highC: payload.daily?.temperature_2m_max?.[0] ?? null,
        lowC: payload.daily?.temperature_2m_min?.[0] ?? null,
        precipitationChancePercent:
          payload.daily?.precipitation_probability_max?.[0] ?? null,
      },
    };
  }
}
