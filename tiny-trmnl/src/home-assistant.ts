import { setTimeout as delay } from 'node:timers/promises';
import * as z from 'zod';

const CALENDAR_RETRY_DELAYS = [500, 1000, 2000];

const ZodCalendars = z.array(
  z.object({ entity_id: z.string(), name: z.string() }),
);

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

export class HomeAssistantApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async fetchCalendars(): Promise<z.infer<typeof ZodCalendars>> {
    const res = await fetch(`${this.baseUrl}/api/calendars`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(
        `Home Assistant calendar discovery failed: ${res.status} ${res.statusText}`,
      );
    }
    return ZodCalendars.parse(await res.json());
  }

  async fetchCalendarEvents(calendarId: string): Promise<CalendarEvent[]> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 365);

    const url =
      `${this.baseUrl}/api/calendars/${calendarId}` +
      `?start=${start.toISOString()}&end=${end.toISOString()}`;

    for (let attempt = 0; ; attempt++) {
      let failure: unknown;
      let transient = false;
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) return (await res.json()) as CalendarEvent[];
        failure = new Error(
          `Home Assistant API error for ${calendarId}: ${res.status} ${res.statusText}`,
        );
        transient = res.status === 429 || res.status >= 500;
        await res.body?.cancel();
      } catch (error) {
        failure = error;
        transient =
          error instanceof TypeError ||
          (error instanceof Error &&
            (error.name === 'TimeoutError' || error.name === 'AbortError'));
      }
      const retryDelay = CALENDAR_RETRY_DELAYS[attempt];
      if (!transient || retryDelay === undefined) throw failure;
      console.warn(
        `[${calendarId}] Calendar request failed; retrying in ${retryDelay}ms`,
        failure,
      );
      await delay(retryDelay);
    }
  }
}
