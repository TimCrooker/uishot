import type { Manifest, RecipeStep, SessionConfig, Viewport } from './types.js';

export interface CapturedImage {
  png: Buffer;
  consoleErrors: number;
  /** Truth flags: anything that makes this shot less than fully trustworthy. Empty = clean. */
  warnings: string[];
}

export interface SurfaceSession {
  goto(route: string): Promise<void>;
  act(step: RecipeStep): Promise<void>;
  currentUrl(): Promise<string>;
  /** Set viewport BEFORE building interaction state — overlays (dropdowns, popovers) close on resize. */
  setViewport(viewport: Viewport): Promise<void>;
  /** Capture the full page, or a single element when `clip` (a selector) is given. */
  capture(viewport: Viewport, clip?: string): Promise<CapturedImage>;
  resetErrorCount(): void;
  /**
   * Optional late-bounce recovery: if the surface detects it drifted to an
   * auth/login state after navigation, recover (re-auth + re-navigate) and
   * return true so the caller can retry its readiness wait once.
   */
  recoverIfBounced?(): Promise<boolean>;
  /**
   * Optional origin-storage snapshot/restore, used to keep `storage` recipe
   * seeds scoped to their own target instead of leaking into later captures.
   */
  snapshotStorage?(): Promise<string>;
  restoreStorage?(snapshot: string): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * A capture target backend. v1 ships BrowserSurface (Playwright); a simulator
 * surface for native apps slots in behind this same interface.
 */
export interface Surface {
  openSession(name: string, config: SessionConfig, manifest: Manifest): Promise<SurfaceSession>;
  /** Drop cached auth for a session (forces re-setup on next open). */
  invalidateSession(name: string): Promise<void>;
  dispose(): Promise<void>;
}
