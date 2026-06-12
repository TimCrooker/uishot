import type { Command } from 'commander';
import { chromium } from 'playwright';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { MANIFEST_FILENAME } from '@uishot/core';
import { projectRoot } from '../context.js';
import { discoverRoutes } from '../discover/tanstack.js';

const TEMPLATE = `# uishot manifest — every screen/state here is instantly capturable.
# Docs: https://github.com/TimCrooker/uishot
app:
  # Resolved from env at run time; uishot fails loudly if the var is unset.
  baseUrl: \${APP_URL}
  defaultSizes: [sm, lg]

viewports:
  sm: 390x844
  md: 768x1024
  lg: 1440x900

sessions: {}
  # default:
  #   loginRoute: /login
  #   recipe:
  #     - fill: ["#email", "\${UISHOT_EMAIL}"]
  #     - fill: ["#password", "\${UISHOT_PASSWORD}"]
  #     - click: "button[type=submit]"
  #     - waitFor: "[data-testid=app-shell]"

screens: {}
  # items.list:
  #   route: /items
  #   feature: items
  #   readyWhen: "[data-testid=items-table]"
  #   states:
  #     filters-open:
  #       - click: "[data-testid=open-filters]"
  #       - waitFor: "[role=dialog]"
`;

function discoverTanstack(root: string): string | undefined {
  const discovered = discoverRoutes(root);
  if (!discovered || (discovered.static.length === 0 && discovered.param.length === 0)) return undefined;
  const lines = ['screens:'];
  for (const r of discovered.static) {
    lines.push(`  ${r.id}:`);
    lines.push(`    route: ${r.route}`);
    const feature = r.id.split('.')[0]!;
    lines.push(`    feature: ${feature}`);
  }
  if (discovered.param.length > 0) {
    lines.push('  # Param routes need a representative id baked in (e.g. /items/42):');
    for (const p of discovered.param) lines.push(`  # route: ${p}`);
  }
  return lines.join('\n') + '\n';
}

function installSkills(root: string): string[] {
  const skillsPkgJson = createRequire(import.meta.url).resolve('@uishot/skills/package.json');
  const skillsDir = join(dirname(skillsPkgJson), 'skills');
  const installed: string[] = [];
  for (const name of ['uishot', 'uishot-init']) {
    for (const targetBase of ['.claude/skills', '.agents/skills']) {
      const target = join(root, targetBase, name, 'SKILL.md');
      if (existsSync(target)) continue;
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(skillsDir, name, 'SKILL.md'), target);
      installed.push(relative(root, target));
    }
  }
  return installed;
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Scaffold uishot.config.yaml, discover routes, install agent skills')
    .action(() => {
      const root = projectRoot();
      const manifestPath = join(root, MANIFEST_FILENAME);

      if (existsSync(manifestPath)) {
        console.log(`${MANIFEST_FILENAME} exists, skipped`);
      } else {
        const discovered = discoverTanstack(root);
        const content = discovered ? TEMPLATE.replace(/^screens: \{\}[\s\S]*$/m, discovered) : TEMPLATE;
        writeFileSync(manifestPath, content);
        console.log(
          `wrote ${MANIFEST_FILENAME}${discovered ? ' (seeded from TanStack Router conventions)' : ''}`,
        );
      }

      const gitignorePath = join(root, '.gitignore');
      const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
      if (!gitignore.split('\n').some((l) => l.trim() === '.uishot/')) {
        appendFileSync(gitignorePath, `${gitignore.endsWith('\n') || gitignore === '' ? '' : '\n'}.uishot/\n`);
        console.log('added .uishot/ to .gitignore');
      }

      const installed = installSkills(root);
      for (const path of installed) console.log(`installed ${path}`);

      console.log('\nNext steps:');
      let step = 1;
      if (!existsSync(chromium.executablePath())) {
        console.log(`  ${step++}. npx playwright install chromium`);
      }
      console.log(`  ${step++}. Set the baseUrl env var (e.g. export APP_URL=http://localhost:3000)`);
      console.log(`  ${step++}. Add a session + screens to ${MANIFEST_FILENAME} (the uishot-init skill walks an agent through it)`);
      console.log(`  ${step++}. uishot doctor   # proves manifest, dev server, browser, and auth end-to-end`);
      console.log(`  ${step}. uishot snap <screen>   # then iterate: edit -> snap -> look`);
      console.log('Keep it honest as the app evolves: uishot drift (route coverage) + uishot verify (recipe rot).');
    });
}
