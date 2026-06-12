import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface DiscoveredRoutes {
  static: { id: string; route: string }[];
  /** Param routes need a representative id; emitted as commented manifest entries. */
  param: string[];
}

function walkFiles(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

/**
 * Discover routes from the repo's router conventions, or undefined when no
 * supported convention is detected (TanStack Router file routes for now).
 */
export function discoverRoutes(root: string): DiscoveredRoutes | undefined {
  const routesDir = join(root, 'src', 'routes');
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
  const hasTanstack = Boolean(
    pkg.dependencies?.['@tanstack/react-router'] ?? pkg.devDependencies?.['@tanstack/react-router'],
  );
  if (!hasTanstack || !existsSync(routesDir)) return undefined;
  return tanstackRoutes(walkFiles(routesDir, routesDir));
}

/**
 * Map TanStack Router file-convention paths (relative to the routes dir) to
 * route entries. Layout segments (leading underscore) are stripped; `index`
 * maps to the parent path; `$param` segments are bucketed separately.
 */
export function tanstackRoutes(files: string[]): DiscoveredRoutes {
  const staticRoutes: { id: string; route: string }[] = [];
  const param: string[] = [];
  for (const file of files) {
    const noExt = file.replace(/\.(tsx|ts|jsx|js)$/, '');
    if (noExt.endsWith('__root') || noExt.includes('.lazy')) continue;
    if (/\.(test|spec)$/.test(noExt) || noExt.includes('.test.') || noExt.includes('.spec.')) continue;
    // TanStack excludes `-`-prefixed files/dirs from routing entirely.
    if (noExt.split(/[/.]/).some((s) => s.startsWith('-'))) continue;
    const segments = noExt
      .split(/[/.]/)
      .filter((s) => s.length > 0 && !s.startsWith('_') && s !== 'route' && s !== 'index');
    const routePath = '/' + segments.join('/');
    if (segments.some((s) => s.startsWith('$'))) {
      param.push(routePath);
      continue;
    }
    const id = segments.length === 0 ? 'home' : segments.join('.');
    if (!staticRoutes.some((r) => r.route === routePath)) {
      staticRoutes.push({ id, route: routePath === '/' ? '/' : routePath });
    }
  }
  return { static: staticRoutes, param };
}
