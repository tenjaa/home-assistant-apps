import { readFileSync } from 'node:fs';

export interface CalendarEvent {
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  summary: string;
  description: string | null;
  location: string | null;
  uid: string | null;
  recurrence_id: string | null;
  rrule: string | null;
}

interface OptionsJson {
  home_assistant_token: string;
  home_assistant_base_url?: string;
  base_url?: string;
  calendars: { entity: string; label: string }[];
}

interface TinyTrmnlConfig {
  homeAssistantBaseUrl: string;
  homeAssistantToken: string;
  baseUrl: string;
  calendars: { entity: string; label: string }[];
}

function loadConfig(): TinyTrmnlConfig {
  const configPath = process.env.CONFIG_PATH ?? '/data/options.json';

  let options: OptionsJson;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    options = JSON.parse(raw) as OptionsJson;
  } catch (err) {
    throw new Error(`Failed to read config from ${configPath}: ${err}`);
  }

  if (!options.home_assistant_token) {
    throw new Error('Missing "home_assistant_token" in config');
  }

  if (!Array.isArray(options.calendars) || options.calendars.length === 0) {
    throw new Error('Missing or empty "calendars" array in config');
  }

  for (const cal of options.calendars) {
    if (typeof cal.entity !== 'string' || typeof cal.label !== 'string') {
      throw new Error(
        `Each calendar entry must have string "entity" and "label" fields`,
      );
    }
  }

  return {
    homeAssistantBaseUrl:
      options.home_assistant_base_url ?? 'http://homeassistant.local:8123',
    homeAssistantToken: options.home_assistant_token,
    baseUrl: options.base_url ?? 'http://localhost:8080',
    calendars: options.calendars,
  };
}

const config = loadConfig();
const HA_BASE_URL = config.homeAssistantBaseUrl;
const HA_TOKEN = config.homeAssistantToken;

export const BASE_URL = config.baseUrl;

export const CALENDARS: { id: string; label: string }[] = config.calendars.map(
  (cal) => ({ id: cal.entity, label: cal.label }),
);

export async function fetchCalendarEvents(
  calendarId: string,
): Promise<CalendarEvent[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 365);

  const url =
    `${HA_BASE_URL}/api/calendars/${calendarId}` +
    `?start=${start.toISOString()}&end=${end.toISOString()}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${HA_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(
      `Home Assistant API error for ${calendarId}: ${res.status} ${res.statusText}`,
    );
  }

  return (await res.json()) as CalendarEvent[];
}
