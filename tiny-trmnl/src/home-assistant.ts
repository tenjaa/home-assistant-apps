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
