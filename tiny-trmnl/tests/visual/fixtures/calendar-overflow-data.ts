const dayCount = 36;
const entriesPerDay = 3;

export const calendarOverflowData = {
  days: Array.from({ length: dayCount }, (_, dayIndex) => ({
    header: `DAY ${String(dayIndex + 1).padStart(2, '0')}`,
    entries: Array.from({ length: entriesPerDay }, (_, entryIndex) => ({
      allDay: entryIndex === 0,
      label: entryIndex % 2 === 0 ? 'T' : 'K',
      title: `Calendar entry ${dayIndex + 1}.${entryIndex + 1}`,
      ...(entryIndex === 0
        ? { location: 'Family calendar' }
        : { time: `${String(9 + entryIndex).padStart(2, '0')}:00` }),
    })),
  })),
};
