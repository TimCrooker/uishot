import type { Command } from 'commander';
import { getClient, manifestEnv, projectRoot } from '../context.js';
import { emit } from '../output.js';

interface DiffOptions {
  state?: string;
  sizes?: string;
  session?: string;
  json?: boolean;
}

export function registerDiff(program: Command): void {
  program
    .command('diff <screenOrRoute>')
    .description('Capture and pixel-diff vs the previous capture (% changed + .diff.png)')
    .option('--state <name>')
    .option('--sizes <names>')
    .option('--session <name>')
    .option('--json')
    .action(async (screenOrRoute: string, opts: DiffOptions) => {
      const root = projectRoot();
      const client = await getClient(root);
      const result = await client.request('snap', {
        screen: screenOrRoute,
        state: opts.state,
        sizes: opts.sizes?.split(','),
        session: opts.session,
        diff: true,
        env: manifestEnv(root),
      });
      client.close();
      // Diff is information, not a gate: exit 0 regardless of change ratio.
      const code = emit(result, Boolean(opts.json));
      process.exit(result.failures.length > 0 ? code : 0);
    });
}
