import type { Plugin } from './plugin-factory.ts';

const fallbackQuotes: { quote: string; author: string }[] = [
  {
    quote: 'Success is the sum of small efforts, repeated day in and day out.',
    author: 'Robert Collier',
  },
  {
    quote: 'Action is the foundational key to all success.',
    author: 'Pablo Picasso',
  },
  {
    quote: 'What you do today can improve all your tomorrows.',
    author: 'Ralph Marston',
  },
];

export class QuotePlugin2 implements Plugin {
  readonly pluginId = 'quote';

  constructor(readonly screenId: string) {}

  async getData(): Promise<object> {
    return fallbackQuotes[Math.floor(Math.random() * fallbackQuotes.length)]!;
  }
}
