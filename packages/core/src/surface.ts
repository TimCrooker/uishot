import type { Manifest, RecipeStep, SessionConfig, Viewport } from './types.js';

export interface CapturedImage {
  png: Buffer;
  consoleErrors: number;
}

export interface SurfaceSession {
  goto(route: string): Promise<void>;
  act(step: RecipeStep): Promise<void>;
  currentUrl(): Promise<string>;
  capture(viewport: Viewport): Promise<CapturedImage>;
  resetErrorCount(): void;
  /**
   * Optional late-bounce recovery: if the surface detects it drifted to an
   * auth/login state after navigation, recover (re-auth + re-navigate) and
   * return true so the caller can retry its readiness wait once.
   */
  recoverIfBounced?(): Promise<boolean>;
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
