import * as z from 'zod';

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

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
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
}
