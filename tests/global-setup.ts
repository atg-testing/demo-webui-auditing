import { FullConfig, chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenvPkg from 'dotenv';
dotenvPkg.config();

/** Returns true if ANY localStorage entry looks like a JWT and is within <5 minutes of expiry. */
function isSessionExpiredSoon(storageStatePath: string): boolean {
  try {
    const raw = fs.readFileSync(storageStatePath, 'utf-8');
    const state = JSON.parse(raw) as { origins?: Array<{ localStorage?: Array<{ value?: string }> }> };
    const nowSec = Date.now() / 1000;
    for (const origin of state.origins ?? []) {
      for (const entry of origin.localStorage ?? []) {
        const val = entry.value ?? '';
        // Basic JWT heuristic: three base64url segments separated by dots
        if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(val)) {
          try {
            const payload = JSON.parse(Buffer.from(val.split('.')[1], 'base64').toString('utf-8'));
            if (typeof payload.exp === 'number' && payload.exp - nowSec < 300) return true;
          } catch { /* not a JWT — skip */ }
        }
      }
    }
  } catch { /* file missing or invalid — treat as expired */ return true; }
  return false;
}

async function globalSetup(_config: FullConfig) {
  // Ensure reports directory exists
  const reportsDir = path.resolve('reports', 'auditing');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  // Check auth session files and warn if any are expired
  const authDir = path.resolve('auth-sessions');
  if (fs.existsSync(authDir)) {
    for (const file of fs.readdirSync(authDir).filter(f => f.endsWith('.json'))) {
      const sessionPath = path.join(authDir, file);
      if (isSessionExpiredSoon(sessionPath)) {
        console.warn(`[GlobalSetup] ⚠️  Auth session "${file}" is expired or expiring soon.`);
        console.warn(`[GlobalSetup]    Re-capture the session in ATG and replace ${sessionPath}`);
        console.warn(`[GlobalSetup]    or set AUTH_*_STORAGE_STATE_PATH in .env to a valid session file.`);
      }
    }
  }
}

export default globalSetup;
