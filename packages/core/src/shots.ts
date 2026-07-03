import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Viewport } from './types.js';

export interface ShotRecord {
  screen: string;
  state: string;
  size: string;
  path: string;
  capturedAt: string;
  gitSha: string;
  consoleErrors: number;
  /** Truth flags from capture (settle timeout, broken images, clipped/truncated content). Omitted when clean. */
  warnings?: string[];
  changedRatio?: number;
  diffPath?: string;
}

export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '') || 'screen';
}

export function shotsDir(root: string): string {
  return join(root, '.uishot', 'shots');
}

export function shotPath(root: string, screenId: string, state: string, vp: Viewport): string {
  return join(shotsDir(root), sanitizeId(screenId), `${sanitizeId(state)}@${vp.width}x${vp.height}.png`);
}

/**
 * Resolve a custom `--out` destination. A `.png` path is used verbatim (single
 * capture); a directory gets a disambiguated `<screen>_<state>@WxH.png` filename
 * so a multi-size/multi-screen capture doesn't collide.
 */
export function resolveOutPath(out: string, screenId: string, state: string, vp: Viewport): string {
  if (/\.png$/i.test(out)) return out;
  return join(out, `${sanitizeId(screenId)}_${sanitizeId(state)}@${vp.width}x${vp.height}.png`);
}

export function failedShotPath(root: string, screenId: string, state: string, vp: Viewport): string {
  return join(
    shotsDir(root),
    sanitizeId(screenId),
    `__failed-${sanitizeId(state)}@${vp.width}x${vp.height}.png`,
  );
}

export function prevPath(p: string): string {
  return p.replace(/\.png$/, '.prev.png');
}

export function diffPath(p: string): string {
  return p.replace(/\.png$/, '.diff.png');
}

const indexFile = (root: string) => join(shotsDir(root), 'index.json');

export function readIndex(root: string): Record<string, ShotRecord> {
  try {
    return JSON.parse(readFileSync(indexFile(root), 'utf8')) as Record<string, ShotRecord>;
  } catch {
    return {};
  }
}

export function updateIndex(root: string, records: ShotRecord[]): void {
  const idx = readIndex(root);
  for (const r of records) idx[`${sanitizeId(r.screen)}/${sanitizeId(r.state)}@${r.size}`] = r;
  const file = indexFile(root);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(idx, null, 2));
  renameSync(tmp, file);
}

/** Write a shot, rotating any existing capture to its .prev.png slot first. */
export function writeShot(path: string, png: Buffer): { rotatedPrev: boolean } {
  mkdirSync(dirname(path), { recursive: true });
  let rotatedPrev = false;
  if (existsSync(path)) {
    renameSync(path, prevPath(path));
    rotatedPrev = true;
  }
  writeFileSync(path, png);
  return { rotatedPrev };
}
