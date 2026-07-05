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
import { rankSuggestions, type SuggestionCandidate } from 'uishot-core';

// Generous enough for a dev server transforming a heavy app under parallel
// load; a genuinely broken selector still fails with clear evidence.
const ACT_TIMEOUT = 10000;
const WAIT_TIMEOUT = 15000;
// Settle-before-capture: a shot taken while the page is still becoming itself
// (pending fonts/images, streaming DOM mutations) is a silent lie. Wait for a
// quiet window, capped so a live ticker can't hang a capture — it gets a
// warning instead.
const SETTLE_QUIET_MS = 200;
const SETTLE_TIMEOUT_MS = 3000;
// Inner-scroll expansion: production SPAs lock the shell to the viewport and
// scroll inside a nested container, so a document-height `fullPage` capture
// silently clips their content. Before the screenshot we grow those containers
// (and the ancestors constraining them) so the document truthfully contains
// everything, then restore. Windowed lists that keep growing get an honest
// clipped-content warning instead.
const OVERFLOW_THRESHOLD_PX = 100;
const GROWTH_TOLERANCE_PX = 100;
const MAX_CAPTURE_HEIGHT_PX = 10000;

interface ExpandOutcome {
  mode: 'none' | 'expanded' | 'fallback';
  warning?: string;
}

/**
 * Runs in the page. Finds clipped scroll containers (or uses `root` when
 * capturing a single element), neutralizes the height/overflow constraints on
 * them and their ancestor chains, and verifies the layout is stable at its new
 * size. Saved inline styles are stashed on `window` for restoreExpansion().
 */
async function expandInPage(args: {
  root: Element | null;
  threshold: number;
  growthTol: number;
  maxHeight: number;
}): Promise<{ mode: 'none' | 'expanded' | 'fallback'; hiddenPx?: number; desc?: string; truncated?: boolean }> {
  const { root, threshold, growthTol, maxHeight } = args;
  const html = document.documentElement;
  const describe = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const testid = el.getAttribute('data-testid');
    if (testid) return `${tag}[data-testid=${testid}]`;
    if (el.id) return `${tag}#${el.id}`;
    const cls = el.classList[0];
    return cls ? `${tag}.${cls}` : tag;
  };
  const hiddenPx = (el: Element): number => el.scrollHeight - el.clientHeight;
  const scrollable = (el: Element): boolean => {
    const oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  };

  let containers: Element[];
  if (root) {
    containers = hiddenPx(root) > threshold ? [root] : [];
  } else {
    containers = Array.from(document.querySelectorAll('*'))
      .filter((el) => el !== html && el !== document.body && hiddenPx(el) > threshold && scrollable(el))
      .sort((a, b) => hiddenPx(b) - hiddenPx(a))
      .slice(0, 5);
  }
  if (containers.length === 0) return { mode: 'none' };
  const worst = containers[0]!;
  const info = { hiddenPx: hiddenPx(worst), desc: describe(worst) };

  const saved: Array<[HTMLElement, string | null]> = [];
  const grown = new Set<Element>();
  const grow = (el: HTMLElement): void => {
    if (grown.has(el)) return;
    grown.add(el);
    saved.push([el, el.getAttribute('style')]);
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('overflow-y', 'visible', 'important');
    // In a column-flex parent, `flex: 1 1 0` pins the height regardless of
    // `height: auto`; releasing the main axis doesn't touch cross-axis width.
    const parent = el.parentElement;
    if (parent) {
      const ps = getComputedStyle(parent);
      if (/flex/.test(ps.display) && ps.flexDirection.startsWith('column')) {
        el.style.setProperty('flex', 'none', 'important');
      }
    }
  };
  for (const c of containers) {
    let cur: HTMLElement | null = c as HTMLElement;
    while (cur) {
      grow(cur);
      cur = cur.parentElement;
    }
  }
  const restore = (): void => {
    for (const [el, style] of saved) {
      if (style === null) el.removeAttribute('style');
      else el.setAttribute('style', style);
    }
  };
  (window as unknown as Record<string, unknown>).__uishotRestore = restore;

  const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await tick();
  const h1 = html.scrollHeight;
  await new Promise((r) => setTimeout(r, 80));
  await tick();
  const h2 = html.scrollHeight;
  if (h2 - h1 > growthTol) {
    // Windowed rendering: content grows to fill whatever space we give it.
    // There is no true bottom — back off and report the clip honestly.
    restore();
    delete (window as unknown as Record<string, unknown>).__uishotRestore;
    return { mode: 'fallback', ...info };
  }
  if (h2 > maxHeight) {
    // scrollHeight includes hidden overflow, so capping <html> can't shrink a
    // fullPage capture — shrink the grown container itself by the excess.
    const el = worst as HTMLElement;
    const excess = h2 - maxHeight;
    el.style.setProperty('height', `${Math.max(100, el.scrollHeight - excess)}px`, 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('overflow-y', 'hidden', 'important');
    return { mode: 'expanded', ...info, truncated: true };
  }
  return { mode: 'expanded', ...info };
}

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
      const context = await this.failureContext(sel).catch(() => '');
      throw new Error(
        `step ${step.action}${sel ? ` ${sel}` : ''}${step.value ? `=${step.value}` : ''} failed: ${
          (err as Error).message.split('\n')[0]
        }${context}`,
      );
    }
  }

  /**
   * Failure diagnostics: where the page actually is, and what on it looks like
   * what the failed selector wanted. Turns a dead-end timeout into a repair
   * prompt. Best-effort and bounded — never masks the original failure.
   */
  private async failureContext(sel: string): Promise<string> {
    let out = '';
    try {
      const title = await this.page.title();
      out = ` Page: ${this.page.url()}${title ? ` ("${title}")` : ''}.`;
    } catch {
      return out;
    }
    if (!sel) return out;
    try {
      // Distinguish "wrong selector" from "right selector, wrong viewport/state":
      // an existing-but-hidden element is a visibility problem, and saying so
      // saves the agent from hunting for a rename that never happened.
      const count = await this.page.locator(sel).count();
      if (count > 0) {
        const visible = await this.page
          .locator(sel)
          .first()
          .isVisible()
          .catch(() => false);
        if (!visible) {
          const vp = this.page.viewportSize();
          const at = vp ? ` at ${vp.width}x${vp.height}` : '';
          return `${out} The selector matches ${count} element(s), but not visible${at} — likely hidden at this viewport or in this state.`;
        }
      }
    } catch {
      // diagnostics only
    }
    try {
      const candidates = await this.page.evaluate((): SuggestionCandidate[] => {
        const found: { label: string; text: string }[] = [];
        for (const el of Array.from(document.querySelectorAll('[data-testid]'))) {
          const v = el.getAttribute('data-testid')!;
          found.push({ label: `[data-testid=${v}]`, text: v });
        }
        const seen = new Set<string>();
        for (const el of Array.from(document.querySelectorAll('button, a, [role]'))) {
          const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
          if (!text || seen.has(text)) continue;
          seen.add(text);
          found.push({ label: `${el.tagName.toLowerCase()} "${text}"`, text });
          if (found.length >= 250) break;
        }
        return found.slice(0, 250);
      });
      const ranked = rankSuggestions(sel, candidates);
      if (ranked.length > 0) out += ` Near matches: ${ranked.join(', ')}.`;
    } catch {
      // suggestions are a bonus, not a dependency
    }
    return out;
  }

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async setViewport(viewport: Viewport): Promise<void> {
    await this.page.setViewportSize({ width: viewport.width, height: viewport.height });
  }

  async capture(viewport: Viewport, clip?: string): Promise<CapturedImage> {
    await this.setViewport(viewport);
    const warnings = await this.settle();
    const expansion = await this.expandClipped(clip);
    if (expansion.warning) warnings.push(expansion.warning);
    let png: Buffer;
    try {
      png = Buffer.from(
        clip
          ? await this.page.locator(clip).screenshot({ timeout: ACT_TIMEOUT })
          : await this.page.screenshot({ fullPage: true }),
      );
    } finally {
      if (expansion.mode === 'expanded') await this.restoreExpansion();
    }
    return { png, consoleErrors: this.consoleErrors, warnings };
  }

  /** Grow clipped scroll containers so the capture holds all content; see expandInPage. */
  private async expandClipped(clip?: string): Promise<ExpandOutcome> {
    try {
      const root = clip
        ? await this.page.locator(clip).elementHandle({ timeout: ACT_TIMEOUT })
        : null;
      const res = await this.page.evaluate(expandInPage, {
        root,
        threshold: OVERFLOW_THRESHOLD_PX,
        growthTol: GROWTH_TOLERANCE_PX,
        maxHeight: MAX_CAPTURE_HEIGHT_PX,
      });
      if (res.mode === 'fallback') {
        return {
          mode: 'fallback',
          warning:
            `content clipped: ~${res.hiddenPx}px hidden inside ${res.desc} (content grows when expanded — ` +
            `likely a virtualized list); use --clip on a smaller region or a taller size`,
        };
      }
      if (res.mode === 'expanded' && res.truncated) {
        return { mode: 'expanded', warning: `content truncated at ${MAX_CAPTURE_HEIGHT_PX}px` };
      }
      return { mode: res.mode };
    } catch {
      // Expansion is an enhancement over the plain capture — never fail a shot on it.
      return { mode: 'none' };
    }
  }

  private async restoreExpansion(): Promise<void> {
    await this.page
      .evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        if (typeof w.__uishotRestore === 'function') (w.__uishotRestore as () => void)();
        delete w.__uishotRestore;
      })
      .catch(() => {});
  }

  /**
   * Bounded settle pass: flush pending paints, wait for fonts and images, then
   * require a mutation-quiet window before the screenshot. Best-effort — a
   * settle problem flags the shot, it never fails the capture.
   */
  private async settle(): Promise<string[]> {
    const warnings: string[] = [];
    try {
      const res = await this.page.evaluate(
        async ({ quietMs, timeoutMs }: { quietMs: number; timeoutMs: number }) => {
          const deadline = Date.now() + timeoutMs;
          const remaining = () => Math.max(0, deadline - Date.now());
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          try {
            await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, remaining()))]);
          } catch {
            /* fonts API quirks never block a capture */
          }
          const pending = Array.from(document.images).filter((i) => !i.complete);
          await Promise.race([
            Promise.all(
              pending.map(
                (i) =>
                  new Promise((r) => {
                    i.addEventListener('load', r, { once: true });
                    i.addEventListener('error', r, { once: true });
                  }),
              ),
            ),
            new Promise((r) => setTimeout(r, remaining())),
          ]);
          const settled = await new Promise<boolean>((resolve) => {
            let timer: ReturnType<typeof setTimeout>;
            const done = (ok: boolean) => {
              obs.disconnect();
              resolve(ok);
            };
            const arm = () => {
              // A full quiet window no longer fits before the deadline: the
              // page is still mutating at the cap — report it honestly.
              if (remaining() < quietMs) return done(false);
              timer = setTimeout(() => done(true), quietMs);
            };
            const obs = new MutationObserver(() => {
              clearTimeout(timer);
              arm();
            });
            obs.observe(document.documentElement, {
              subtree: true,
              childList: true,
              attributes: true,
              characterData: true,
            });
            arm();
          });
          const failedImages = Array.from(document.images).filter(
            (i) => i.complete && i.naturalWidth === 0,
          ).length;
          return { settled, failedImages };
        },
        { quietMs: SETTLE_QUIET_MS, timeoutMs: SETTLE_TIMEOUT_MS },
      );
      if (!res.settled) warnings.push(`layout still mutating after ${SETTLE_TIMEOUT_MS}ms`);
      if (res.failedImages > 0) warnings.push(`${res.failedImages} image(s) failed to load`);
    } catch {
      // settle is diagnostics, not a gate
    }
    return warnings;
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
