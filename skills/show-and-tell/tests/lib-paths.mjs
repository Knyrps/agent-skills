// Where the throwaway copy lives and how it runs; no imports from the copy, so run.mjs can use it before syncing.
import os from 'node:os';
import path from 'node:path';
export const ROOT = path.join(os.tmpdir(), 'show-and-tell-test');
export const SKILL = path.join(ROOT, 'skill');
export const SHOTS = path.join(ROOT, 'shots');
// Host names for tests that need a site which is not allowed yet: the test browser resolves every name under
// TEST_DOMAIN to this machine by itself (--host-resolver-rules), so no DNS service and no network is needed.
// They are not loopback names to the skill, which only looks at the name.
export const TEST_DOMAIN = 'show-and-tell.test';
export const testHost = prefix => `${prefix}-${Date.now().toString(36)}.${TEST_DOMAIN}`;
// Flags the person running the tests set themselves (e.g. --no-sandbox as root in a container) are kept.
const ownArgs = (v = process.env.DEMO_BROWSER_ARGS || '') => { try { const a = JSON.parse(v); if (Array.isArray(a)) return a.map(String); } catch {} return v.split(/\s+/).filter(Boolean); };
export const ENV = { ...process.env, DEMO_BRIDGE_PORT: '47713', DEMO_CDP_PORT: '9434', DEMO_LAB_PORT: '47714',
  DEMO_DATA: path.join(ROOT, 'data'), DEMO_PROFILE: path.join(ROOT, 'profile'),
  DEMO_BROWSER_ARGS: JSON.stringify([...ownArgs(), `--host-resolver-rules=MAP *.${TEST_DOMAIN} 127.0.0.1`]) };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
