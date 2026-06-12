import type { Command } from 'commander';
import { chromium } from 'playwright';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { MANIFEST_FILENAME } from '@uishot/core';
import { projectRoot } from '../context.js';
import { tanstackRoutes } from '../discover/tanstack.js';

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

function walkFiles(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

function discoverTanstack(root: string): string | undefined {
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
  const discovered = tanstackRoutes(walkFiles(routesDir, routesDir));
  if (discovered.static.length === 0 && discovered.param.length === 0) return undefined;
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

      if (!existsSync(chromium.executablePath())) {
        console.log('Next: npx playwright install chromium');
      }
      console.log(
        'Next: set the baseUrl env var, configure a session, add screens — the uishot-init skill walks an agent through it.',
      );
    });
}
