// Where the throwaway copy lives and how it runs; no imports from the copy, so run.mjs can use it before syncing.
import os from 'node:os';
import path from 'node:path';
export const ROOT = path.join(os.tmpdir(), 'show-and-tell-test');
export const SKILL = path.join(ROOT, 'skill');
export const SHOTS = path.join(ROOT, 'shots');
export const ENV = { ...process.env, DEMO_BRIDGE_PORT: '47713', DEMO_CDP_PORT: '9434', DEMO_LAB_PORT: '47714',
  DEMO_DATA: path.join(ROOT, 'data'), DEMO_PROFILE: path.join(ROOT, 'profile') };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
