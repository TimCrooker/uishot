import type { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILENAME } from 'uishot-core';
import { projectRoot } from '../context.js';
import { readLastDo } from '../last-do.js';
import { promoteIntoYaml } from '../promote-yaml.js';

export function registerPromote(program: Command): void {
  program
    .command('promote <screen>')
    .description('Persist the last --do chain on a screen as a named state in the manifest')
    .requiredOption('--name <state>', 'name for the new state')
    .action((screen: string, opts: { name: string }) => {
      const root = projectRoot();
      const lastDo = readLastDo(root);
      if (!lastDo) {
        throw new Error('Nothing to promote: run a snap with --do first (the successful chain is recorded).');
      }
      if (lastDo.screen !== screen) {
        throw new Error(
          `Last --do chain was recorded on "${lastDo.screen}", not "${screen}". ` +
            `Run the --do snap on ${screen} first, or promote ${lastDo.screen}.`,
        );
      }
      const manifestPath = join(root, MANIFEST_FILENAME);
      const updated = promoteIntoYaml(readFileSync(manifestPath, 'utf8'), screen, opts.name, lastDo.steps);
      writeFileSync(manifestPath, updated);
      console.log(`Promoted. Reproduce with: uishot snap ${screen} --state ${opts.name}`);
    });
}
