import type { CalendarEvent } from './homeassistant.ts';

interface DayEntry {
  allDay?: boolean;
  time?: string;
  title: string;
  location?: string;
  until?: string;
  label?: string;
}

const UNTITLED_EVENT_TITLES = [
  '¯\\_(ツ)_/¯',
  'ಠ_ಠ',
  '(╯°□°）╯︵ ┻━┻',
  'ʕ•ᴥ•ʔ',
  '( ˘ ³˘)♥',
  '(ᵔᴥᵔ)',
];

function getRandomUntitledEventTitle(): string {
  const index = Math.floor(Math.random() * UNTITLED_EVENT_TITLES.length);
  return UNTITLED_EVENT_TITLES[index] ?? 'Untitled';
}

function getEventTitle(summary: string | null | undefined): string {
  const trimmedSummary = summary?.trim();
  return trimmedSummary ? trimmedSummary : getRandomUntitledEventTitle();
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatHeader(date: Date, todayKey: string): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
  const suffix = toDateKey(date) === todayKey ? ' · Today' : '';
  return `${formatted}${suffix}`;
}

function getOrCreateDay(
  dayMap: Map<string, { date: Date; entries: DayEntry[] }>,
  dateKey: string,
  date: Date,
): { date: Date; entries: DayEntry[] } {
  let day = dayMap.get(dateKey);
  if (!day) {
    day = { date: new Date(date), entries: [] };
    dayMap.set(dateKey, day);
  }
  return day;
}

function processAllDayEvent(
  event: CalendarEvent,
  label: string,
  today: Date,
  dayMap: Map<string, { date: Date; entries: DayEntry[] }>,
): void {
  const startDate = new Date(`${event.start.date}T00:00:00`);
  const endDate = new Date(`${event.end.date}T00:00:00`);
  const firstVisibleDate = startDate < today ? today : startDate;
  if (endDate <= today) return;

  const key = toDateKey(firstVisibleDate);
  const day = getOrCreateDay(dayMap, key, firstVisibleDate);

  const lastDay = new Date(endDate);
  lastDay.setDate(lastDay.getDate() - 1);
  const isMultiDay = lastDay.getTime() > firstVisibleDate.getTime();

  const entry: DayEntry = {
    allDay: true,
    title: getEventTitle(event.summary),
    label,
  };
  if (event.location) entry.location = event.location;
  if (isMultiDay) {
    const formatted = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(lastDay);
    entry.until = `until ${formatted}`;
  }
  day.entries.push(entry);
}

function processTimedEvent(
  event: CalendarEvent,
  label: string,
  today: Date,
  dayMap: Map<string, { date: Date; entries: DayEntry[] }>,
): void {
  if (!event.start.dateTime) return;

  const startDt = new Date(event.start.dateTime);
  if (startDt < today) return;

  const key = toDateKey(startDt);
  const day = getOrCreateDay(dayMap, key, startDt);

  const hours = String(startDt.getHours()).padStart(2, '0');
  const minutes = String(startDt.getMinutes()).padStart(2, '0');
  const entry: DayEntry = {
    time: `${hours}:${minutes}`,
    title: getEventTitle(event.summary),
    label,
  };
  if (event.location) entry.location = event.location;
  day.entries.push(entry);
}

function deduplicateEntries(entries: DayEntry[]): DayEntry[] {
  const deduplicatedEntries: DayEntry[] = [];
  const entriesByTitle = new Map<string, DayEntry>();

  for (const entry of entries) {
    const normalizedTitle = entry.title.toLowerCase();
    const existingEntry = entriesByTitle.get(normalizedTitle);

    if (!existingEntry) {
      entriesByTitle.set(normalizedTitle, entry);
      deduplicatedEntries.push(entry);
      continue;
    }

    existingEntry.label = '♥';
    if (!existingEntry.location && entry.location) {
      existingEntry.location = entry.location;
    }
    if (!existingEntry.until && entry.until) {
      existingEntry.until = entry.until;
    }
  }

  return deduplicatedEntries;
}

export function buildCalendarData(
  sources: { events: CalendarEvent[]; label: string }[],
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayKey = toDateKey(today);

  // Single shared day map keyed by YYYY-MM-DD — all sources feed into it
  const dayMap = new Map<string, { date: Date; entries: DayEntry[] }>();

  for (const { events, label } of sources) {
    for (const event of events) {
      if (event.start.date) {
        processAllDayEvent(event, label, today, dayMap);
      } else {
        processTimedEvent(event, label, today, dayMap);
      }
    }
  }

  // Sort days chronologically, sort entries within each day
  const days = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { date, entries }]) => {
      entries.sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        if (a.time && b.time) return a.time.localeCompare(b.time);
        return 0;
      });

      return {
        header: formatHeader(date, todayKey),
        entries: deduplicateEntries(entries),
      };
    });

  return { days };
}
