export type RecipeAction =
  | 'goto'
  | 'click'
  | 'fill'
  | 'select'
  | 'hover'
  | 'press'
  | 'scrollTo'
  | 'waitFor'
  | 'waitMs'
  | 'storage';

export interface RecipeStep {
  action: RecipeAction;
  /** click, fill, select, hover, scrollTo, waitFor; storage (localStorage key) */
  selector?: string;
  /** fill, select (option value), press (key), waitMs (ms), goto (route), storage (value) */
  value?: string;
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface CookieSeed {
  name: string;
  value: string;
  path?: string;
}

export interface SessionConfig {
  loginRoute?: string;
  recipe?: RecipeStep[];
  inject?: {
    localStorage?: Record<string, string>;
    cookies?: CookieSeed[];
  };
}

export interface ScreenConfig {
  id: string;
  route: string;
  feature?: string;
  readyWhen?: string;
  /** Session name; defaults to "default". */
  session?: string;
  /** Named interaction states: recorded recipes replayed against the screen. */
  states: Record<string, RecipeStep[]>;
}

export interface Manifest {
  baseUrl: string;
  defaultSizes: string[];
  /** Concurrent capture workers for sweeps (1 for rotation-sensitive auth). */
  parallelism: number;
  viewports: Record<string, Viewport>;
  sessions: Record<string, SessionConfig>;
  screens: Record<string, ScreenConfig>;
}
