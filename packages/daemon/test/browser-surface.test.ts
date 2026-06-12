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
  injected:
    inject:
      localStorage:
        token: demo
screens: {}
`;

const manifest = parseManifest(YAML, { FIX_URL: BASE });

let surface: BrowserSurface;

beforeAll(() => {
  surface = new BrowserSurface(mkdtempSync(join(tmpdir(), 'uishot-')));
});
afterAll(() => surface.dispose());

describe('BrowserSurface', () => {
  it('authenticates via recipe and reaches a guarded page', async () => {
    const s = await surface.openSession('default', manifest.sessions.default!, manifest);
    await s.goto('/items.html');
    expect(await s.currentUrl()).toContain('/items.html');
    const shot = await s.capture(manifest.viewports.lg!);
    const png = PNG.sync.read(shot.png);
    expect(png.width).toBe(1280);
    await s.dispose();
  });

  it('authenticates via localStorage injection', async () => {
    const s = await surface.openSession('injected', manifest.sessions.injected!, manifest);
    await s.goto('/dashboard.html');
    expect(await s.currentUrl()).toContain('/dashboard.html');
    await s.dispose();
  });

  it('executes recipe steps (modal opens) and viewports differ', async () => {
    const s = await surface.openSession('default', manifest.sessions.default!, manifest);
    await s.goto('/items.html');
    await s.act({ action: 'click', selector: '[data-testid=open-filters]' });
    await s.act({ action: 'waitFor', selector: 'dialog[open]' });
    const lg = await s.capture(manifest.viewports.lg!);
    const sm = await s.capture(manifest.viewports.sm!);
    expect(PNG.sync.read(sm.png).width).toBe(390);
    expect(lg.png.equals(sm.png)).toBe(false);
    await s.dispose();
  });

  it('act failure throws with selector and step context', async () => {
    const s = await surface.openSession('default', manifest.sessions.default!, manifest);
    await s.goto('/items.html');
    await expect(s.act({ action: 'click', selector: '[data-testid=ghost]' })).rejects.toThrowError(
      /\[data-testid=ghost\]/,
    );
    await s.dispose();
  });
});
