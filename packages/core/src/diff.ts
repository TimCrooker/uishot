import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface DiffResult {
  changedRatio: number;
  diffPng: Buffer | undefined;
  reason: string | undefined;
}

export function diffPngs(prev: Buffer, next: Buffer): DiffResult {
  const a = PNG.sync.read(prev);
  const b = PNG.sync.read(next);
  if (a.width !== b.width || a.height !== b.height) {
    return {
      changedRatio: 1,
      diffPng: undefined,
      reason: `dimensions-changed ${a.width}x${a.height} -> ${b.width}x${b.height}`,
    };
  }
  const out = new PNG({ width: a.width, height: a.height });
  const changed = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });
  const changedRatio = changed / (a.width * a.height);
  return { changedRatio, diffPng: changedRatio > 0 ? PNG.sync.write(out) : undefined, reason: undefined };
}
