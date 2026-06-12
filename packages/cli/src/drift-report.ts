import type { Manifest } from 'uishot-core';
import type { DiscoveredRoutes } from './discover/tanstack.js';

export interface DriftReport {
  /** Routes that exist in the codebase but no manifest screen covers. */
  uncovered: { id: string; route: string }[];
  /** Param routes in the codebase with no covering screen (need a representative id). */
  uncoveredParam: string[];
  /** Manifest screens whose route no longer exists in the codebase. */
  orphaned: { id: string; route: string }[];
}

/** Strip a representative id back to its pattern shape for param matching: /items/42/details -> segments. */
function routeCoveredByScreens(paramRoute: string, screenRoutes: string[]): boolean {
  const pattern = paramRoute.split('/').filter(Boolean);
  return screenRoutes.some((r) => {
    const actual = r.split('/').filter(Boolean);
    if (actual.length !== pattern.length) return false;
    return pattern.every((seg, i) => seg.startsWith('$') || seg === actual[i]);
  });
}

export function computeDrift(manifest: Manifest, discovered: DiscoveredRoutes): DriftReport {
  const screenRoutes = Object.values(manifest.screens).map((s) => s.route);
  const screenRouteSet = new Set(screenRoutes);

  const uncovered = discovered.static.filter((r) => !screenRouteSet.has(r.route));
  const uncoveredParam = discovered.param.filter((p) => !routeCoveredByScreens(p, screenRoutes));

  const known = new Set(discovered.static.map((r) => r.route));
  const orphaned = Object.values(manifest.screens)
    .filter((s) => {
      if (known.has(s.route)) return false;
      // A screen route may instantiate a param route (/items/42 covers /items/$id).
      return !discovered.param.some((p) => routeCoveredByScreens(p, [s.route]));
    })
    .map((s) => ({ id: s.id, route: s.route }));

  return { uncovered, uncoveredParam, orphaned };
}

/** YAML snippet an agent can paste for uncovered routes. */
export function driftSnippet(uncovered: { id: string; route: string }[]): string {
  return uncovered
    .map((r) => `  ${r.id}:\n    route: ${r.route}\n    feature: ${r.id.split('.')[0]}`)
    .join('\n');
}
