import { Liquid } from 'liquidjs';
import { buildCalendarData } from './calendar-orchestrator.ts';
import { CALENDARS, fetchCalendarEvents } from './homeassistant.ts';

const engine = new Liquid({
  root: new URL('./../templates', import.meta.url).pathname,
  extname: '.liquid',
});

export async function renderCalendarHtml(): Promise<string> {
  const sources = await Promise.all(
    CALENDARS.map(async ({ id, label }) => ({
      events: await fetchCalendarEvents(id),
      label,
    })),
  );
  const calendarData = buildCalendarData(sources);
  return engine.renderFile('calendar', calendarData);
}
