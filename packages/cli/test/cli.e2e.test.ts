import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FILENAME } from 'uishot-core';

const CLI = resolve(fileURLToPath(new URL('.', import.meta.url)), '../dist/index.js');
const BASE = 'http://127.0.0.1:4798';

const YAML = `
app:
  baseUrl: \${FIX_URL}
  defaultSizes: [lg]
viewports:
  sm: 390x844
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
  items.list:
    route: /items.html
    feature: items
    readyWhen: "[data-testid=items-table]"
    states:
      filters-open:
        - click: "[data-testid=open-filters]"
        - waitFor: "dialog[open]"
      broken:
        - click: "[data-testid=ghost]"
  dashboard:
    route: /dashboard.html
    feature: home
`;

let project: string;
const env = { ...process.env, FIX_URL: BASE };

const run = (args: string[], opts: { reject?: boolean } = {}) =>
  execa(process.execPath, [CLI, ...args], { cwd: project, env, reject: opts.reject ?? true });

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'uishot-cli-'));
  writeFileSync(join(project, MANIFEST_FILENAME), YAML);
});

afterAll(async () => {
  await run(['daemon', 'stop'], { reject: false });
});

describe('uishot CLI', () => {
  it('snap prints shot paths, exits 0, files exist', async () => {
    const { stdout, stderr, exitCode } = await run(['snap', 'items.list', '--sizes', 'lg']);
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines[0]).toMatch(/\.uishot\/shots\/items\.list\/base@1280x800\.png$/);
    expect(existsSync(lines[0]!)).toBe(true);
    // Cold start narrates to stderr instead of sitting silent through
    // daemon spawn + Chromium boot + login; stdout stays a pure path list.
    expect(stderr).toMatch(/starting uishot daemon/);
    expect(stderr).toMatch(/capturing items\.list\/base@lg/);
  });

  it('warm snap completes in under 2 seconds', async () => {
    const t0 = Date.now();
    await run(['snap', 'items.list', '--sizes', 'lg']);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('--do composes ad-hoc state and records last-do.json', async () => {
    const { stdout } = await run([
      'snap',
      'items.list',
      '--do',
      'click:[data-testid=open-filters]',
      '--do',
      'waitFor:dialog[open]',
      '--sizes',
      'lg',
    ]);
    expect(stdout).toMatch(/adhoc@1280x800\.png/);
    const lastDo = JSON.parse(readFileSync(join(project, '.uishot', 'last-do.json'), 'utf8'));
    expect(lastDo.screen).toBe('items.list');
    expect(lastDo.steps).toHaveLength(2);
  });

  it('broken state exits 1 with stuck-state evidence on stderr', async () => {
    const { exitCode, stderr } = await run(['snap', 'items.list', '--state', 'broken'], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/__failed-broken@/);
    expect(stderr).toMatch(/uishot promote/);
  });

  it('feature sweep captures base + named states', async () => {
    const { stdout, exitCode } = await run(['feature', 'home', '--sizes', 'lg']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/dashboard\/base@1280x800\.png/);
  });

  it('diff reports change percentage', async () => {
    await run(['snap', 'dashboard', '--sizes', 'lg']);
    const { stdout } = await run(['diff', 'dashboard', '--sizes', 'lg']);
    expect(stdout).toMatch(/changed \d+\.\d%/);
  });

  it('list shows screens, states, features', async () => {
    const { stdout } = await run(['list']);
    expect(stdout).toContain('items.list');
    expect(stdout).toContain('filters-open');
    expect(stdout).toContain('home');
  });

  it('promote persists the last --do chain as a named state', async () => {
    await run([
      'snap',
      'items.list',
      '--do',
      'click:[data-testid=open-filters]',
      '--do',
      'waitFor:dialog[open]',
      '--sizes',
      'lg',
    ]);
    await run(['promote', 'items.list', '--name', 'filters-promoted']);
    const { stdout } = await run(['snap', 'items.list', '--state', 'filters-promoted', '--sizes', 'lg']);
    expect(stdout).toMatch(/filters-promoted@1280x800\.png/);
  });

  it('verify reports the broken recipe and exits 1', async () => {
    const { exitCode, stdout } = await run(['verify'], { reject: false });
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/ok items\.list\/base/);
    expect(stdout).toMatch(/FAIL items\.list\/broken/);
  });

  it('snap --json emits the full record', async () => {
    const { stdout } = await run(['snap', 'dashboard', '--sizes', 'lg', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.shots[0]).toMatchObject({ screen: 'dashboard', state: 'base', size: 'lg' });
    expect(parsed.shots[0].gitSha).toBeDefined();
  });

  it('daemon status reports a running daemon; stop kills it', async () => {
    const { stdout } = await run(['daemon', 'status']);
    expect(stdout).toMatch(/pid \d+/);
    await run(['daemon', 'stop']);
    const after = await run(['daemon', 'status'], { reject: false });
    expect(after.stdout + after.stderr).toMatch(/not running/);
  });
});
