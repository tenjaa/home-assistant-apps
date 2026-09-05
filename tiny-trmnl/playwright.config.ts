import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  expect: {
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.001,
      threshold: 0.2,
    },
  },
  use: {
    browserName: 'firefox',
  },
});
