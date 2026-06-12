import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MANIFEST_FILENAME } from '@uishot/core';
import { startServer, type RunningServer } from '../src/server.js';
import { DaemonClient } from '../src/client.js';

const BASE = 'http://127.0.0.1:4799';

const YAML = `
app:
  baseUrl: ${BASE}
  defaultSizes: [lg]
viewports:
  lg: 1280x800
sessions:
  default:
    loginRoute: /login.html
    recipe:
      - fill: ["#email", "a@b.c"]
      - fill: ["#password", "pw"]
      - click: "button[type=submit]"
      - waitFor: "[data-testid=app-shell]"
screens:
  dashboard:
    route: /dashboard.html
    feature: home
`;

let root: string;
let server: RunningServer;
let client: DaemonClient;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'uishot-srv-'));
  writeFileSync(join(root, MANIFEST_FILENAME), YAML);
  server = await startServer(root, { idleMs: 60000 });
  client = await DaemonClient.connect(root);
});

afterAll(async () => {
  await client.request('shutdown').catch(() => {});
  await server.closed;
});

describe('daemon server', () => {
  it('responds to ping and status', async () => {
    expect(await client.request('ping')).toBe('pong');
    const status = await client.request('status');
    expect(status.pid).toBe(process.pid);
    expect(status.root).toBe(root);
  });

  it('executes a snap job over the socket', async () => {
    const res = await client.request('snap', { screen: 'dashboard', sizes: ['lg'] });
    expect(res.failures).toEqual([]);
    expect(res.shots).toHaveLength(1);
    expect(res.shots[0]!.path).toContain('dashboard/base@1280x800.png');
  });

  it('returns ok:false errors with helpful messages', async () => {
    await expect(client.request('snap', { screen: 'ghost' })).rejects.toThrowError(/Available: dashboard/);
  });

  it('verify replays recipes', async () => {
    const res = await client.request('verify', {});
    expect(res).toEqual([{ screen: 'dashboard', state: 'base', ok: true }]);
  });
});
