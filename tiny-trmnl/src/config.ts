import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import * as z from 'zod';

export interface ScreenConfig {
  screenId: string;
  refresh: number; // seconds
  pluginId: string;
  pluginConfig: object;
}

export interface AppConfig {
  baseUrl: string;
  ha: {
    baseUrl: string;
    token: string;
  };
}

const ZodAppConfig = z.object({
  baseUrl: z.string().min(1),
  ha: z.object({
    baseUrl: z.string().min(1),
    token: z.string(),
  }),
});

const ZodScreenConfig = z.object({
  screenId: z.string().min(1),
  refresh: z.int().positive(),
  pluginId: z.string().min(1),
  pluginConfig: z.object({}).catchall(z.unknown()).default({}),
});

const ZodScreenConfigs = z.array(ZodScreenConfig);

const DEMO_SCREEN_CONFIGS: ScreenConfig[] = [
  {
    screenId: 'daily-quote',
    pluginId: 'quote',
    refresh: 3600,
    pluginConfig: {},
  },
  {
    screenId: 'weather-hannover',
    pluginId: 'weather',
    refresh: 3600,
    pluginConfig: {
      locationName: 'Hannover, Germany',
      latitude: 52.3759,
      longitude: 9.732,
      timezone: 'Europe/Berlin',
    },
  },
];

function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    throw new Error(`Failed to read JSON from ${filePath}: ${error}`);
  }
}

function ensureScreenConfigFile(filePath: string): void {
  if (existsSync(filePath)) {
    return;
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(DEMO_SCREEN_CONFIGS, null, 2)}\n`);
  console.log(
    `[config] No screen config found at ${filePath}. Created demo config with ${DEMO_SCREEN_CONFIGS.length} screens.`,
  );
}

function validateUniqueScreenIds(screenConfigs: ScreenConfig[]): void {
  const seen = new Set<string>();

  for (const screenConfig of screenConfigs) {
    if (seen.has(screenConfig.screenId)) {
      throw new Error(`Duplicate screenId found in screen config: ${screenConfig.screenId}`);
    }

    seen.add(screenConfig.screenId);
  }
}

export function parseScreenConfigs(rawScreenConfigs: unknown): ScreenConfig[] {
  let screenConfigs: ScreenConfig[];
  try {
    screenConfigs = ZodScreenConfigs.parse(rawScreenConfigs);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(formatValidationError(error));
    }
    throw error;
  }

  validateUniqueScreenIds(screenConfigs);

  return screenConfigs;
}

export function loadScreenConfigs(screensPath: string): ScreenConfig[] {
  ensureScreenConfigFile(screensPath);

  console.log(`[config] Loading screen configs from ${screensPath}...`);
  const rawScreenConfigs = readJsonFile(screensPath);

  try {
    return parseScreenConfigs(rawScreenConfigs);
  } catch (error) {
    throw new Error(`Invalid screen config in ${screensPath}: ${error}`);
  }
}

export function writeScreenConfigs(
  screensPath: string,
  screenConfigs: ScreenConfig[],
): void {
  mkdirSync(dirname(screensPath), { recursive: true });

  const tmpPath = `${screensPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(screenConfigs, null, 2)}\n`);
  renameSync(tmpPath, screensPath);
  console.log(
    `[config] Stored ${screenConfigs.length} screen config(s) in ${screensPath}`,
  );
}

export function loadRuntimeConfig(dataDir = process.env.DATA_DIR ?? '/data'): {
  appConfig: AppConfig;
  dataDir: string;
  optionsPath: string;
  screenConfigs: ScreenConfig[];
  screensPath: string;
} {
  const optionsPath = join(dataDir, 'options.json');
  const screensPath = join(dataDir, 'screens.json');

  console.log(`[config] Loading add-on options from ${optionsPath}...`);
  const rawAppConfig = readJsonFile(optionsPath);

  let appConfig: AppConfig;
  try {
    appConfig = ZodAppConfig.parse(rawAppConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid add-on options in ${optionsPath}: ${formatValidationError(error)}`,
      );
    }
    throw error;
  }

  const screenConfigs = loadScreenConfigs(screensPath);

  console.log(
    `[config] Config loaded: baseUrl=${appConfig.baseUrl}, screens=${screenConfigs.length}`,
  );

  return {
    appConfig,
    dataDir,
    optionsPath,
    screenConfigs,
    screensPath,
  };
}


