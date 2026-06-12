import { describe, it, expect, beforeAll } from 'vitest';
import { execa } from 'execa';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(fileURLToPath(new URL('.', import.meta.url)), '../dist/index.js');

let project: string;

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'uishot-init-'));
  writeFileSync(
    join(project, 'package.json'),
    JSON.stringify({ name: 'fake-app', dependencies: { '@tanstack/react-router': '^1.0.0' } }),
  );
  mkdirSync(join(project, 'src', 'routes', '_authenticated'), { recursive: true });
  writeFileSync(join(project, 'src', 'routes', '__root.tsx'), '');
  writeFileSync(join(project, 'src', 'routes', 'login.tsx'), '');
  writeFileSync(join(project, 'src', 'routes', '_authenticated', 'items.index.tsx'), '');
  writeFileSync(join(project, 'src', 'routes', '_authenticated', 'items.$itemId.tsx'), '');
});

describe('uishot init', () => {
  it('scaffolds manifest seeded from TanStack routes, gitignore, and skills', async () => {
    const { stdout } = await execa(process.execPath, [CLI, 'init'], { cwd: project });
    expect(stdout).toContain('seeded from TanStack Router conventions');

    const manifest = readFileSync(join(project, 'uishot.config.yaml'), 'utf8');
    expect(manifest).toContain('route: /items');
    expect(manifest).toContain('# route: /items/$itemId');
    expect(manifest).toContain('baseUrl: ${APP_URL}');

    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toContain('.uishot/');
    expect(existsSync(join(project, '.claude', 'skills', 'uishot', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'skills', 'uishot-init', 'SKILL.md'))).toBe(true);
  });

  it('is idempotent — never overwrites existing files', async () => {
    const before = readFileSync(join(project, 'uishot.config.yaml'), 'utf8');
    const { stdout } = await execa(process.execPath, [CLI, 'init'], { cwd: project });
    expect(stdout).toContain('exists, skipped');
    expect(readFileSync(join(project, 'uishot.config.yaml'), 'utf8')).toBe(before);
  });
});
