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
