import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseManifest, resolveTargets, readIndex } from 'uishot-core';
import { BrowserSurface } from '../src/browser-surface.js';
import { executeTargets } from '../src/executor.js';

const BASE = 'http://127.0.0.1:4799';

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

const manifest = parseManifest(YAML, { FIX_URL: BASE });

let root: string;
let surface: BrowserSurface;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'uishot-exec-'));
  surface = new BrowserSurface(root);
});
afterAll(() => surface.dispose());

describe('executeTargets', () => {
  it('captures base + state at two sizes and writes index', async () => {
    const targets = resolveTargets(manifest, { screen: 'items.list', sizes: ['sm', 'lg'] }).concat(
      resolveTargets(manifest, { screen: 'items.list', state: 'filters-open', sizes: ['sm', 'lg'] }),
    );
    const res = await executeTargets(root, manifest, surface, targets);
    expect(res.failures).toEqual([]);
    expect(res.shots).toHaveLength(4);
    for (const s of res.shots) expect(existsSync(s.path)).toBe(true);
    expect(Object.keys(readIndex(root))).toHaveLength(4);
  });

  it('second run rotates prev and computes diff when requested', async () => {
    const targets = resolveTargets(manifest, { screen: 'dashboard', sizes: ['lg'], diff: true });
    await executeTargets(root, manifest, surface, targets);
    const res = await executeTargets(root, manifest, surface, targets);
    expect(res.failures).toEqual([]);
    expect(res.shots[0]!.changedRatio).toBeDefined();
    expect(res.shots[0]!.changedRatio).toBeLessThan(0.01);
  });

  it('recipe failure produces stuck-state evidence and prescriptive error', async () => {
    const targets = resolveTargets(manifest, { screen: 'items.list', state: 'broken', sizes: ['lg'] });
    const res = await executeTargets(root, manifest, surface, targets);
    expect(res.shots).toEqual([]);
    const f = res.failures[0]!;
    expect(f.message).toMatch(/step 1/);
    expect(f.message).toMatch(/data-testid=ghost/);
    expect(f.stuckShotPath).toBeDefined();
    expect(existsSync(f.stuckShotPath!)).toBe(true);
    expect(f.message).toMatch(/uishot promote/);
  });

  it('verifyOnly replays recipes without writing screenshots', async () => {
    const targets = resolveTargets(manifest, { screen: 'items.list', state: 'filters-open', sizes: ['lg'] });
    const res = await executeTargets(root, manifest, surface, targets, { verifyOnly: true });
    expect(res.failures).toEqual([]);
    expect(res.shots).toEqual([]);
    expect(res.verified).toEqual([{ screen: 'items.list', state: 'filters-open', ok: true }]);
  });

  it('unknown session fails with the session list', async () => {
    const targets = resolveTargets(manifest, { screen: 'dashboard', session: 'admin', sizes: ['lg'] });
    const res = await executeTargets(root, manifest, surface, targets);
    expect(res.failures[0]!.message).toMatch(/Unknown session "admin"/);
  });

  it('clip captures a single element', async () => {
    const targets = resolveTargets(manifest, {
      screen: 'items.list',
      sizes: ['lg'],
      clip: '[data-testid=items-table]',
    });
    const res = await executeTargets(root, manifest, surface, targets);
    expect(res.failures).toEqual([]);
    expect(res.shots).toHaveLength(1);
    expect(existsSync(res.shots[0]!.path)).toBe(true);
  });

  it('captures an inline WIDTHxHEIGHT size', async () => {
    const targets = resolveTargets(manifest, { screen: 'dashboard', sizes: ['800x1600'] });
    const res = await executeTargets(root, manifest, surface, targets);
    expect(res.failures).toEqual([]);
    expect(res.shots[0]!.size).toBe('800x1600');
    expect(existsSync(res.shots[0]!.path)).toBe(true);
  });

  it('--out writes to a custom destination and stays out of the index', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'uishot-out-'));
    const before = Object.keys(readIndex(root)).length;
    const targets = resolveTargets(manifest, { screen: 'dashboard', sizes: ['lg'], out: outDir });
    const res = await executeTargets(root, manifest, surface, targets);
    expect(res.failures).toEqual([]);
    expect(res.shots[0]!.path.startsWith(outDir)).toBe(true);
    expect(existsSync(res.shots[0]!.path)).toBe(true);
    expect(Object.keys(readIndex(root)).length).toBe(before);
  });
});
