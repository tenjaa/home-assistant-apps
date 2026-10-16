import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  snapshotPathTemplate: '{testDir}/visual/snapshots/{arg}{ext}',
  expect: {
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.025,
      threshold: 0.2,
    },
  },
  use: {
    browserName: 'firefox',
  },
});
