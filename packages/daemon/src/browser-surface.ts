import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CapturedImage,
  Manifest,
  RecipeStep,
  SessionConfig,
  Surface,
  SurfaceSession,
  Viewport,
} from 'uishot-core';

// Generous enough for a dev server transforming a heavy app under parallel
// load; a genuinely broken selector still fails with clear evidence.
const ACT_TIMEOUT = 10000;
const WAIT_TIMEOUT = 15000;

export class BrowserSurface implements Surface {
  private browser?: Browser;
  private contexts = new Map<string, BrowserContext>();
  private reauths = new Map<string, Promise<void>>();
  private navLocks = new Map<string, Promise<void>>();

  constructor(private rootDir: string) {}

  /**
   * Per-session navigation lock. Every SPA page-boot re-runs the app's token
   * refresh; concurrent boots in one session race a rotating refresh cookie
   * and trip reuse-revocation, killing the whole session family. Navigations
   * serialize per session; readiness waits, recipes, and captures still
   * overlap across workers.
   */
  private async withNavLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.navLocks.get(name) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.navLocks.set(name, prev.then(() => mine));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private statePath(name: string): string {
    return join(this.rootDir, '.uishot', 'sessions', `${name}.json`);
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) this.browser = await chromium.launch({ headless: true });
    return this.browser;
  }

  async invalidateSession(name: string): Promise<void> {
    await this.contexts.get(name)?.close().catch(() => {});
    this.contexts.delete(name);
    rmSync(this.statePath(name), { force: true });
  }

  private async ensureContext(name: string, config: SessionConfig, manifest: Manifest): Promise<BrowserContext> {
    const existing = this.contexts.get(name);
    if (existing) return existing;
    const browser = await this.ensureBrowser();
    mkdirSync(join(this.rootDir, '.uishot', 'sessions'), { recursive: true });
    const statePath = this.statePath(name);
    let ctx: BrowserContext;
    if (existsSync(statePath)) {
      ctx = await browser.newContext({ storageState: statePath });
    } else {
      ctx = await browser.newContext();
      await runSessionSetup(ctx, config, manifest);
      await ctx.storageState({ path: statePath });
    }
    this.contexts.set(name, ctx);
    return ctx;
  }

  /**
   * Re-auth runs session setup in the SAME shared context (never closes it —
   * sibling pages from parallel workers stay alive) and is mutexed per
   * session so concurrent bounces trigger a single login.
   */
  private reauthContext(name: string, ctx: BrowserContext, config: SessionConfig, manifest: Manifest): Promise<void> {
    let inflight = this.reauths.get(name);
    if (!inflight) {
      inflight = (async () => {
        await runSessionSetup(ctx, config, manifest);
        await ctx.storageState({ path: this.statePath(name) });
      })().finally(() => this.reauths.delete(name));
      this.reauths.set(name, inflight);
    }
    return inflight;
  }

  async openSession(name: string, config: SessionConfig, manifest: Manifest): Promise<SurfaceSession> {
    const ctx = await this.ensureContext(name, config, manifest);
    const page = await ctx.newPage();
    return new BrowserSession(page, manifest.baseUrl, {
      loginRoute: config.loginRoute,
      lockNav: (fn) => this.withNavLock(name, fn),
      reauth: async () => {
        await this.reauthContext(name, ctx, config, manifest);
        return ctx.newPage();
      },
    });
  }

  async dispose(): Promise<void> {
    for (const c of this.contexts.values()) await c.close().catch(() => {});
    this.contexts.clear();
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
  }
}

export async function runSessionSetup(
  ctx: BrowserContext,
  config: SessionConfig,
  manifest: Manifest,
): Promise<void> {
  const page = await ctx.newPage();
  try {
    if (config.inject) {
      const url = new URL(manifest.baseUrl);
      if (config.inject.cookies?.length) {
        await ctx.addCookies(
          config.inject.cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: url.hostname,
            path: c.path ?? '/',
          })),
        );
      }
      await page.goto(manifest.baseUrl + (config.loginRoute ?? '/'));
      if (config.inject.localStorage) {
        await page.evaluate((kv: Record<string, string>) => {
          for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
        }, config.inject.localStorage);
      }
    } else if (config.recipe) {
      const loginRoute = config.loginRoute ?? '/';
      await page.goto(manifest.baseUrl + loginRoute);
      // Already authenticated (the app bounced us off the login page): the
      // session is valid, re-running the login recipe would hang on missing
      // form fields.
      await page.waitForLoadState('networkidle').catch(() => {});
      if (!page.url().includes(loginRoute)) return;
      const session = new BrowserSession(page, manifest.baseUrl, {
        loginRoute: undefined,
        lockNav: undefined,
        reauth: async () => page,
      });
      for (const step of config.recipe) await session.act(step);
    }
  } finally {
    await page.close();
  }
}

class BrowserSession implements SurfaceSession {
  private consoleErrors = 0;
  private lastRoute: string | undefined;

  constructor(
    private page: Page,
    private baseUrl: string,
    private opts: {
      reauth: () => Promise<Page>;
      loginRoute: string | undefined;
      lockNav: (<T>(fn: () => Promise<T>) => Promise<T>) | undefined;
    },
  ) {
    this.attachListeners();
  }

  private attachListeners(): void {
    this.page.on('console', (m) => {
      if (m.type() === 'error') this.consoleErrors++;
    });
    this.page.on('pageerror', () => {
      this.consoleErrors++;
    });
  }

  async goto(route: string): Promise<void> {
    this.lastRoute = route;
    if (this.opts.lockNav) {
      await this.opts.lockNav(() => this.performGoto(route));
    } else {
      await this.performGoto(route);
    }
  }

  private async performGoto(route: string): Promise<void> {
    const target = route.startsWith('http') ? route : this.baseUrl + route;
    await this.page.goto(target, { waitUntil: 'load' });
    // Settle the SPA boot (incl. its token-refresh call) INSIDE the nav lock:
    // releasing at 'load' would let the next page's refresh race this one's
    // rotation. Also surfaces post-hydration login redirects immediately.
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    // Deterministic self-heal: bounced to login means stale auth. Re-auth once, retry.
    const { loginRoute } = this.opts;
    if (loginRoute && route !== loginRoute && this.page.url().includes(loginRoute)) {
      await this.reauthAndRetry(target, loginRoute);
    }
  }

  private async reauthAndRetry(target: string, loginRoute: string): Promise<void> {
    await this.page.close().catch(() => {});
    this.page = await this.opts.reauth();
    this.attachListeners();
    await this.page.goto(target, { waitUntil: 'load' });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    if (this.page.url().includes(loginRoute)) {
      throw new Error(
        `Still redirected to ${loginRoute} after re-auth. The session recipe/inject config is broken — ` +
          `fix the session in uishot.config.yaml, then run: uishot doctor --reauth`,
      );
    }
  }

  /**
   * SPAs often redirect to login AFTER hydration, past the immediate post-load
   * bounce check. Called when a readiness wait fails: if the page drifted to
   * the login route, re-auth + re-navigate and report true so the caller can
   * retry its wait once.
   */
  async recoverIfBounced(): Promise<boolean> {
    const { loginRoute } = this.opts;
    if (!loginRoute || !this.lastRoute || this.lastRoute === loginRoute) return false;
    if (!this.page.url().includes(loginRoute)) return false;
    const target = this.lastRoute.startsWith('http') ? this.lastRoute : this.baseUrl + this.lastRoute;
    if (this.opts.lockNav) {
      await this.opts.lockNav(() => this.reauthAndRetry(target, loginRoute));
    } else {
      await this.reauthAndRetry(target, loginRoute);
    }
    return true;
  }

  async act(step: RecipeStep): Promise<void> {
    const sel = step.selector ?? '';
    try {
      switch (step.action) {
        case 'goto':
          return await this.goto(step.value!);
        case 'click':
          return await this.page.click(sel, { timeout: ACT_TIMEOUT });
        case 'fill':
          return await this.page.fill(sel, step.value!, { timeout: ACT_TIMEOUT });
        case 'select': {
          await this.page.selectOption(sel, step.value!, { timeout: ACT_TIMEOUT });
          return;
        }
        case 'hover':
          return await this.page.hover(sel, { timeout: ACT_TIMEOUT });
        case 'press':
          return await this.page.keyboard.press(step.value!);
        case 'scrollTo':
          return await this.page.locator(sel).scrollIntoViewIfNeeded({ timeout: ACT_TIMEOUT });
        case 'waitFor': {
          await this.page.waitForSelector(sel, { timeout: WAIT_TIMEOUT });
          return;
        }
        case 'waitMs':
          return await this.page.waitForTimeout(Number(step.value));
        case 'storage': {
          // Seeds localStorage; the app reads it on its NEXT boot, so recipes
          // pair this with a goto to re-load from the deterministic baseline.
          await this.page.evaluate(
            ([k, v]) => localStorage.setItem(k!, v!),
            [step.selector, step.value] as const,
          );
          return;
        }
      }
    } catch (err) {
      throw new Error(
        `step ${step.action}${sel ? ` ${sel}` : ''}${step.value ? `=${step.value}` : ''} failed: ${
          (err as Error).message.split('\n')[0]
        }`,
      );
    }
  }

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async setViewport(viewport: Viewport): Promise<void> {
    await this.page.setViewportSize({ width: viewport.width, height: viewport.height });
  }

  async capture(viewport: Viewport): Promise<CapturedImage> {
    await this.setViewport(viewport);
    const png = await this.page.screenshot({ fullPage: true });
    return { png: Buffer.from(png), consoleErrors: this.consoleErrors };
  }

  async snapshotStorage(): Promise<string> {
    return this.page.evaluate(() => JSON.stringify(localStorage));
  }

  async restoreStorage(snapshot: string): Promise<void> {
    await this.page.evaluate((snap: string) => {
      const entries = JSON.parse(snap) as Record<string, string>;
      localStorage.clear();
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    }, snapshot);
  }

  resetErrorCount(): void {
    this.consoleErrors = 0;
  }

  async dispose(): Promise<void> {
    await this.page.close().catch(() => {});
  }
}
