import type { Command } from 'commander';
import { loadManifest } from '@uishot/core';
import { projectRoot } from '../context.js';
import { discoverRoutes } from '../discover/tanstack.js';
import { computeDrift, driftSnippet } from '../drift-report.js';

interface DriftOptions {
  strict?: boolean;
  json?: boolean;
}

export function registerDrift(program: Command): void {
  program
    .command('drift')
    .description('Diff the manifest against the codebase route tree: uncovered routes, orphaned screens')
    .option('--strict', 'exit 1 when any drift is found (CI gate)')
    .option('--json')
    .action((opts: DriftOptions) => {
      const root = projectRoot();
      const manifest = loadManifest(root, process.env, { lenient: true });
      const discovered = discoverRoutes(root);
      if (!discovered) {
        console.log(
          'Route discovery is not available for this framework (TanStack Router file routes supported). ' +
            'Drift here is limited to recipe rot — run `uishot verify`.',
        );
        return;
      }
      const report = computeDrift(manifest, discovered);
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const clean =
          report.uncovered.length === 0 && report.uncoveredParam.length === 0 && report.orphaned.length === 0;
        if (clean) {
          console.log('No drift: every discovered route is covered and every screen route still exists.');
        }
        if (report.uncovered.length > 0) {
          console.log(`${report.uncovered.length} route(s) in the codebase have no screen — paste into screens::`);
          console.log(driftSnippet(report.uncovered));
        }
        if (report.uncoveredParam.length > 0) {
          console.log(
            `${report.uncoveredParam.length} param route(s) uncovered (add a screen with a representative id):`,
          );
          for (const p of report.uncoveredParam) console.log(`  ${p}`);
        }
        if (report.orphaned.length > 0) {
          console.log(`${report.orphaned.length} screen(s) point at routes that no longer exist — fix or remove:`);
          for (const o of report.orphaned) console.log(`  ${o.id}: ${o.route}`);
        }
        console.log('\nRecipe rot is a separate axis: run `uishot verify`.');
      }
      const hasDrift =
        report.uncovered.length > 0 || report.uncoveredParam.length > 0 || report.orphaned.length > 0;
      process.exit(opts.strict && hasDrift ? 1 : 0);
    });
}
