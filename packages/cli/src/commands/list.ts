import type { Command } from 'commander';
import { loadManifest } from '@uishot/core';
import { projectRoot } from '../context.js';

interface ListOptions {
  feature?: string;
  json?: boolean;
}

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List addressable screens, states, and features')
    .option('--feature <tag>', 'filter to one feature')
    .option('--json')
    .action((opts: ListOptions) => {
      const manifest = loadManifest(projectRoot());
      const screens = Object.values(manifest.screens).filter(
        (s) => !opts.feature || s.feature === opts.feature,
      );
      if (opts.json) {
        console.log(
          JSON.stringify(
            screens.map((s) => ({
              id: s.id,
              route: s.route,
              feature: s.feature,
              states: Object.keys(s.states),
            })),
            null,
            2,
          ),
        );
        return;
      }
      if (screens.length === 0) {
        console.log('No screens in the manifest yet. Run `uishot init` or add screens to uishot.config.yaml.');
        return;
      }
      for (const s of screens) {
        const states = Object.keys(s.states);
        console.log(`${s.id}  ${s.route}${s.feature ? `  [${s.feature}]` : ''}`);
        for (const st of states) console.log(`  - ${st}`);
      }
      console.log(
        `\nviewports: ${Object.entries(manifest.viewports)
          .map(([n, v]) => `${n}=${v.width}x${v.height}`)
          .join(', ')}  (default: ${manifest.defaultSizes.join(',')})`,
      );
      console.log(`sessions: ${Object.keys(manifest.sessions).join(', ') || '(none)'}`);
    });
}
