import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { parseManifest } from 'uishot-core';
import { BrowserSurface } from '../src/browser-surface.js';

const BASE = 'http://127.0.0.1:4799';

const YAML = `
app:
  baseUrl: \${FIX_URL}
  defaultSizes: [lg]
viewports:
  lg: 1280x800
sessions:
  plain:
    inject:
      localStorage:
        token: demo
screens: {}
`;

const manifest = parseManifest(YAML, { FIX_URL: BASE });
const LG = manifest.viewports.lg!;

let surface: BrowserSurface;

beforeAll(() => {
  surface = new BrowserSurface(mkdtempSync(join(tmpdir(), 'uishot-truth-')));
});
afterAll(() => surface.dispose());

function pixel(png: PNG, x: number, y: number): { r: number; g: number; b: number } {
  const i = (png.width * y + x) << 2;
  return { r: png.data[i]!, g: png.data[i + 1]!, b: png.data[i + 2]! };
}

describe('settled capture', () => {
  it('waits for staged rendering to settle and reports broken images', async () => {
    const s = await surface.openSession('plain', manifest.sessions.plain!, manifest);
    await s.goto('/slow.html');
    const shot = await s.capture(LG);
    const png = PNG.sync.read(shot.png);
    // slow.html flips its background red→green only after mutations stop; a
    // premature capture is red.
    const px = pixel(png, 5, png.height - 5);
    expect(px.g).toBeGreaterThan(120);
    expect(px.r).toBeLessThan(100);
    expect(shot.warnings).toContain('1 image(s) failed to load');
    expect(shot.warnings.find((w) => /mutating/.test(w))).toBeUndefined();
    await s.dispose();
  });

  it('flags a page that never settles instead of hanging', async () => {
    const s = await surface.openSession('plain', manifest.sessions.plain!, manifest);
    await s.goto('/restless.html');
    const started = Date.now();
    const shot = await s.capture(LG);
    expect(Date.now() - started).toBeLessThan(10000);
    expect(shot.warnings.some((w) => /still mutating/.test(w))).toBe(true);
    await s.dispose();
  });

  it('clean pages settle fast with no warnings', async () => {
    const s = await surface.openSession('plain', manifest.sessions.plain!, manifest);
    await s.goto('/login.html');
    const shot = await s.capture(LG);
    expect(shot.warnings).toEqual([]);
    await s.dispose();
  });
});

describe('clip-proof full capture', () => {
  const SM = { name: 'sm', width: 390, height: 844 };

  it('captures the full content of a viewport-locked inner-scroll app', async () => {
    const s = await surface.openSession('plain', manifest.sessions.plain!, manifest);
    await s.goto('/feed.html');
    const shot = await s.capture(LG);
    const png = PNG.sync.read(shot.png);
    // 60 rows @40px ≈ 2400px of feed content; a shell-only capture is 800px.
    expect(png.height).toBeGreaterThan(1600);
    // The end sentinel (solid #2244aa band) must be in frame near the bottom.
    const px = pixel(png, Math.floor(png.width / 2), png.height - 30);
    expect(px.b).toBeGreaterThan(120);
    expect(px.r).toBeLessThan(100);
    expect(shot.warnings.find((w) => /clipped/.test(w))).toBeUndefined();
    await s.dispose();
  });

  it('restores the page after expanding: a second capture at another size is also complete', async () => {
    const s = await surface.openSession('plain', manifest.sessions.plain!, manifest);
    await s.goto('/feed.html');
    const lg = await s.capture(LG);
    const sm = await s.capture(SM);
    const smPng = PNG.sync.read(sm.png);
    expect(smPng.width).toBe(390);
    expect(smPng.height).toBeGreaterThan(1600);
    expect(lg.warnings.concat(sm.warnings).find((w) => /clipped/.test(w))).toBeUndefined();
    await s.dispose();
  });

  it('backs off and flags virtualized lists that grow when expanded', async () => {
    const s = await surface.openSession('plain', manifest.sessions.plain!, manifest);
    await s.goto('/virtual.html');
    const shot = await s.capture(LG);
    expect(shot.warnings.some((w) => /clipped/.test(w))).toBe(true);
    // Fallback capture is the honest viewport-height document, not a half-grown one.
    const png = PNG.sync.read(shot.png);
    expect(png.height).toBeLessThan(1000);
    await s.dispose();
  });

  it('caps absurdly tall content and says so', async () => {
    const s = await surface.openSession('plain', manifest.sessions.plain!, manifest);
    await s.goto('/tall.html');
    const shot = await s.capture(LG);
    expect(shot.warnings.some((w) => /truncated at 10000px/.test(w))).toBe(true);
    const png = PNG.sync.read(shot.png);
    expect(png.height).toBeLessThanOrEqual(10100);
    expect(png.height).toBeGreaterThan(9000);
    await s.dispose();
  });

  it('failed selectors report page context and near-miss suggestions', async () => {
    const s = await surface.openSession('plain', manifest.sessions.plain!, manifest);
    await s.goto('/items.html');
    let message = '';
    try {
      await s.act({ action: 'click', selector: '[data-testid=open-filter]' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/\[data-testid=open-filter\]/);
    expect(message).toMatch(/Page: .*\/items\.html/);
    expect(message).toMatch(/Items — Demo/);
    expect(message).toMatch(/Near matches: .*\[data-testid=open-filters\]/);
    await s.dispose();
  });

  it('omits suggestions when nothing on the page is plausibly related', async () => {
    const s = await surface.openSession('plain', manifest.sessions.plain!, manifest);
    await s.goto('/items.html');
    let message = '';
    try {
      await s.act({ action: 'click', selector: '[data-testid=zzz-qqq-www]' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Page: /);
    expect(message).not.toMatch(/Near matches/);
    await s.dispose();
  });

  it('expands a clipped element for --clip captures too', async () => {
    const s = await surface.openSession('plain', manifest.sessions.plain!, manifest);
    await s.goto('/feed.html');
    const shot = await s.capture(LG, 'main.feed');
    const png = PNG.sync.read(shot.png);
    expect(png.height).toBeGreaterThan(1600);
    await s.dispose();
  });
});
