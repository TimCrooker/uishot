import type { Command } from 'commander';
import { getClient, projectRoot } from '../context.js';

interface VerifyOptions {
  feature?: string;
  json?: boolean;
}

export function registerVerify(program: Command): void {
  program
    .command('verify')
    .description('Replay every recipe (readyWhen + states) without screenshots; report rot')
    .option('--feature <tag>', 'limit to one feature')
    .option('--json')
    .action(async (opts: VerifyOptions) => {
      const client = await getClient(projectRoot());
      const results = await client.request('verify', { feature: opts.feature });
      client.close();
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (const r of results) {
          if (r.ok) console.log(`ok ${r.screen}/${r.state}`);
          else console.log(`FAIL ${r.screen}/${r.state}: ${r.message ?? 'unknown failure'}`);
        }
      }
      process.exit(results.some((r) => !r.ok) ? 1 : 0);
    });
}
