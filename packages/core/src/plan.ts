import type { Manifest, RecipeStep, Viewport } from './types.js';
import { ManifestError } from './manifest.js';

export interface CaptureQuery {
  screen?: string;
  url?: string;
  feature?: string;
  all?: boolean;
  state?: string;
  doSteps?: RecipeStep[];
  sizes?: string[];
  session?: string;
  diff?: boolean;
}

export interface CaptureTarget {
  screenId: string;
  route: string;
  state: string;
  steps: RecipeStep[];
  readyWhen?: string;
  session: string;
  sizes: Viewport[];
  diff: boolean;
}

function viewportsFor(m: Manifest, sizes?: string[]): Viewport[] {
  const names = sizes && sizes.length > 0 ? sizes : m.defaultSizes;
  return names.map((n) => {
    const vp = m.viewports[n];
    if (!vp) {
      throw new ManifestError(`Unknown size "${n}". Available: ${Object.keys(m.viewports).join(', ')}`);
    }
    return vp;
  });
}

export function resolveTargets(m: Manifest, q: CaptureQuery): CaptureTarget[] {
  const sizes = viewportsFor(m, q.sizes);
  const mk = (
    screenId: string,
    route: string,
    state: string,
    steps: RecipeStep[],
    readyWhen?: string,
    session?: string,
  ): CaptureTarget => ({
    screenId,
    route,
    state,
    steps,
    readyWhen,
    session: q.session ?? session ?? 'default',
    sizes,
    diff: q.diff ?? false,
  });

  if (q.url) {
    return [mk(`route:${q.url}`, q.url, q.doSteps?.length ? 'adhoc' : 'base', q.doSteps ?? [])];
  }

  if (q.screen) {
    const sc = m.screens[q.screen];
    if (!sc) {
      // Tolerate a raw route passed as the positional argument.
      if (q.screen.startsWith('/')) return resolveTargets(m, { ...q, screen: undefined, url: q.screen });
      throw new ManifestError(
        `Unknown screen "${q.screen}". Available: ${Object.keys(m.screens).join(', ')} (or pass a /route)`,
      );
    }
    let state = 'base';
    let steps: RecipeStep[] = [];
    if (q.state) {
      const s = sc.states[q.state];
      if (!s) {
        throw new ManifestError(
          `Screen "${sc.id}" has no state "${q.state}". Available: ${Object.keys(sc.states).join(', ') || '(none)'}`,
        );
      }
      state = q.state;
      steps = [...s];
    }
    if (q.doSteps?.length) {
      state = 'adhoc';
      steps = [...steps, ...q.doSteps];
    }
    return [mk(sc.id, sc.route, state, steps, sc.readyWhen, sc.session)];
  }

  const screens = Object.values(m.screens).filter((sc) => q.all || (q.feature && sc.feature === q.feature));
  if (q.feature && screens.length === 0) {
    const feats = [...new Set(Object.values(m.screens).map((s) => s.feature).filter(Boolean))];
    throw new ManifestError(
      `No screens tagged feature "${q.feature}". Features: ${feats.join(', ') || '(none)'}`,
    );
  }
  return screens.flatMap((sc) => [
    mk(sc.id, sc.route, 'base', [], sc.readyWhen, sc.session),
    ...Object.entries(sc.states).map(([st, steps]) =>
      mk(sc.id, sc.route, st, [...steps], sc.readyWhen, sc.session),
    ),
  ]);
}
