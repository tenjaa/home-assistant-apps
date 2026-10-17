import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { expect, test } from '@playwright/test';
import { HomeAssistantApi } from '../src/home-assistant.ts';

test.afterEach(() => mock.restoreAll());

test('calendar requests retry server errors with exponential backoff and preserve request options', async () => {
  const calls: { time: number; url: string; options?: RequestInit }[] = [];
  const events = [{ summary: 'Family event' }];
  mock.method(
    globalThis,
    'fetch',
    async (url: string, options?: RequestInit) => {
      calls.push({ time: Date.now(), url, options });
      return calls.length < 4
        ? new Response('Unavailable', { status: 500 })
        : Response.json(events);
    },
  );
  const api = new HomeAssistantApi('http://home-assistant', 'test-token');
  await expect(api.fetchCalendarEvents('calendar.family')).resolves.toEqual(
    events,
  );
  expect(calls).toHaveLength(4);
  for (const [index, wait] of [500, 1000, 2000].entries()) {
    const current = calls[index + 1];
    const previous = calls[index];
    assert(current && previous);
    expect(current.time - previous.time).toBeGreaterThanOrEqual(wait - 20);
  }
  for (const call of calls) {
    const url = new URL(call.url);
    expect(url.pathname).toBe('/api/calendars/calendar.family');
    expect(url.searchParams.has('start')).toBe(true);
    expect(url.searchParams.has('end')).toBe(true);
    expect(call.options?.headers).toEqual({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
    expect(call.options?.signal).toBeInstanceOf(AbortSignal);
  }
  expect(new Set(calls.map((call) => call.options?.signal)).size).toBe(4);
});

test('calendar requests stop after four failed attempts', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    return new Response('Unavailable', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  });
  const api = new HomeAssistantApi('http://home-assistant', '');
  await expect(api.fetchCalendarEvents('calendar.family')).rejects.toThrow(
    'Home Assistant API error for calendar.family: 503 Service Unavailable',
  );
  expect(fetchMock.mock.callCount()).toBe(4);
});

for (const failure of ['network', 'timeout', 'body-timeout', 'rate-limit']) {
  test(`calendar requests retry a ${failure} failure`, async () => {
    let attempts = 0;
    mock.method(globalThis, 'fetch', async () => {
      if (++attempts === 1) {
        if (failure === 'network') throw new TypeError('fetch failed');
        if (failure === 'timeout')
          throw new DOMException('Timed out', 'TimeoutError');
        if (failure === 'body-timeout') {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new DOMException('Timed out', 'TimeoutError'));
              },
            }),
          );
        }
        return new Response('Too many requests', { status: 429 });
      }
      return Response.json([]);
    });
    await expect(
      new HomeAssistantApi('http://home-assistant', '').fetchCalendarEvents(
        'calendar.family',
      ),
    ).resolves.toEqual([]);
    expect(attempts).toBe(2);
  });
}

for (const status of [400, 401, 403, 404]) {
  test(`calendar requests do not retry HTTP ${status}`, async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      return new Response('Client error', { status });
    });
    await expect(
      new HomeAssistantApi('http://home-assistant', '').fetchCalendarEvents(
        'calendar.family',
      ),
    ).rejects.toThrow(
      `Home Assistant API error for calendar.family: ${status}`,
    );
    expect(fetchMock.mock.callCount()).toBe(1);
  });
}

test('calendar requests do not retry malformed responses', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => new Response('not JSON'),
  );
  await expect(
    new HomeAssistantApi('http://home-assistant', '').fetchCalendarEvents(
      'calendar.family',
    ),
  ).rejects.toThrow();
  expect(fetchMock.mock.callCount()).toBe(1);
});
