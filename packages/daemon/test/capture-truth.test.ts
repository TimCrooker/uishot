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
