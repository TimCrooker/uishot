import type { Command } from 'commander';
import { parseDo } from 'uishot-core';
import { getClient, manifestEnv, projectRoot } from '../context.js';
import { emit } from '../output.js';
import { writeLastDo } from '../last-do.js';

interface SnapOptions {
  state?: string;
  do?: string[];
  sizes?: string;
  session?: string;
  diff?: boolean;
  json?: boolean;
}

export function registerSnap(program: Command): void {
  program
    .command('snap <screenOrRoute>')
    .description('Capture a screen (by manifest id or /route) at one or more viewport sizes')
    .option('--state <name>', 'named state from the manifest')
    .option('--do <action...>', 'inline actions, e.g. "click:[data-testid=x]"')
    .option('--sizes <names>', 'comma-separated viewport names (default: manifest defaultSizes)')
    .option('--session <name>', 'session to capture under (default: screen session or "default")')
    .option('--diff', 'pixel-diff vs the previous capture')
    .option('--json', 'emit the full capture record as JSON')
    .action(async (screenOrRoute: string, opts: SnapOptions) => {
      const root = projectRoot();
      const doSteps = opts.do?.map(parseDo);
      const client = await getClient(root);
      const result = await client.request('snap', {
        screen: screenOrRoute,
        state: opts.state,
        doSteps,
        sizes: opts.sizes?.split(','),
        session: opts.session,
        diff: Boolean(opts.diff),
        env: manifestEnv(root),
      });
      client.close();
      if (doSteps?.length && result.failures.length === 0) {
        writeLastDo(root, screenOrRoute, doSteps);
      }
      process.exit(emit(result, Boolean(opts.json)));
    });
}
