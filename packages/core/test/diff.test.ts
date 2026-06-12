import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { diffPngs } from '../src/diff.js';

function solid(w: number, h: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe('diffPngs', () => {
  it('returns 0 for identical images and no diff buffer', () => {
    const a = solid(10, 10, [255, 0, 0]);
    expect(diffPngs(a, a)).toEqual({ changedRatio: 0, diffPng: undefined, reason: undefined });
  });

  it('returns ~1 for fully different images with a diff buffer', () => {
    const r = diffPngs(solid(10, 10, [255, 0, 0]), solid(10, 10, [0, 0, 255]));
    expect(r.changedRatio).toBeGreaterThan(0.99);
    expect(r.diffPng).toBeInstanceOf(Buffer);
  });

  it('reports dimension changes as ratio 1 with reason', () => {
    const r = diffPngs(solid(10, 10, [0, 0, 0]), solid(12, 10, [0, 0, 0]));
    expect(r).toEqual({
      changedRatio: 1,
      diffPng: undefined,
      reason: 'dimensions-changed 10x10 -> 12x10',
    });
  });
});
