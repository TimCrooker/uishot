import type { Command } from 'commander';
import { getClient, projectRoot } from '../context.js';
import { emit } from '../output.js';

interface SweepOptions {
  sizes?: string;
  session?: string;
  diff?: boolean;
  json?: boolean;
}

async function runSweep(query: { feature?: string; all?: boolean }, opts: SweepOptions): Promise<never> {
  const root = projectRoot();
  const client = await getClient(root);
  const result = await client.request('snap', {
    ...query,
    sizes: opts.sizes?.split(','),
    session: opts.session,
    diff: Boolean(opts.diff),
  });
  client.close();
  process.exit(emit(result, Boolean(opts.json)));
}

export function registerSweep(program: Command): void {
  program
    .command('feature <tag>')
    .description('Capture every screen and named state tagged with a feature')
    .option('--sizes <names>', 'comma-separated viewport names')
    .option('--session <name>')
    .option('--diff', 'pixel-diff vs previous captures')
    .option('--json')
    .action((tag: string, opts: SweepOptions) => runSweep({ feature: tag }, opts));

  program
    .command('all')
    .description('Capture every screen and named state in the manifest')
    .option('--sizes <names>', 'comma-separated viewport names')
    .option('--session <name>')
    .option('--diff', 'pixel-diff vs previous captures')
    .option('--json')
    .action((opts: SweepOptions) => runSweep({ all: true }, opts));
}
