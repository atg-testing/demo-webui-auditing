import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load .env file — copy .env.example to .env and fill in your values
dotenv.config();

const isHeaded = process.env.HEADED === 'true';
const slowMo = process.env.SLOWMO ? parseInt(process.env.SLOWMO, 10) : 0;
const isCI = process.env.CI === 'true';

export default defineConfig({
globalSetup: './tests/global-setup.ts',
testDir: './tests',
// Audit tests run many behavioral experiments per field. 300 s (5 min) is a generous
// ceiling that covers pages with many fields and slow network, while still cutting a
// truly hung test before it wastes 10 minutes.
timeout: 300_000,
expect: { timeout: 10_000 },
workers: process.env.WORKERS
? (process.env.WORKERS === 'auto' ? undefined : parseInt(process.env.WORKERS, 10))
: 1,
reporter: [['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'test-results/results.json' }]],
use: {
headless: !isHeaded,
// 3 s is sufficient for any DOM action on an already-loaded page (even heavy SPAs).
// FieldExperimentRunner sets explicit timeouts on its own actions; this value caps
// only the actions that have no explicit timeout (getAttribute, isVisible, evaluate,
// etc.) — all of which are synchronous DOM reads that resolve in <50 ms normally.
// The previous 15 s value caused these reads to silently hang for 15 s on any
// transient state, neutralising the per-action timeout reductions in the engine.
actionTimeout: 3_000,
launchOptions: { slowMo },
screenshot: 'only-on-failure',
video: isCI ? 'off' : 'retain-on-failure',
trace: 'on-first-retry',
},
projects: [
{ name: 'chromium', use: { browserName: 'chromium' } }
],
outputDir: 'test-results/',
});