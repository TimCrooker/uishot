import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shotPath, failedShotPath, updateIndex, readIndex } from '../src/shots.js';

const vp = { name: 'lg', width: 1440, height: 900 };

describe('shots', () => {
  it('builds predictable paths', () => {
    expect(shotPath('/r', 'orders.detail', 'refund-modal', vp)).toBe(
      '/r/.uishot/shots/orders.detail/refund-modal@1440x900.png',
    );
    expect(shotPath('/r', 'orders.detail', 'base', vp)).toBe(
      '/r/.uishot/shots/orders.detail/base@1440x900.png',
    );
    expect(failedShotPath('/r', 'orders.detail', 'refund-modal', vp)).toBe(
      '/r/.uishot/shots/orders.detail/__failed-refund-modal@1440x900.png',
    );
  });

  it('sanitizes ad-hoc ids derived from routes', () => {
    expect(shotPath('/r', 'route:/orders/123', 'adhoc', vp)).toBe(
      '/r/.uishot/shots/route__orders_123/adhoc@1440x900.png',
    );
  });

  it('updateIndex merges records by key and persists', () => {
    const root = mkdtempSync(join(tmpdir(), 'uishot-'));
    updateIndex(root, [
      { screen: 'a', state: 'base', size: 'lg', path: 'p1', capturedAt: 't1', gitSha: 'x', consoleErrors: 0 },
    ]);
    updateIndex(root, [
      { screen: 'a', state: 'base', size: 'lg', path: 'p1', capturedAt: 't2', gitSha: 'y', consoleErrors: 2 },
    ]);
    const idx = readIndex(root);
    expect(Object.keys(idx)).toEqual(['a/base@lg']);
    expect(idx['a/base@lg']!.capturedAt).toBe('t2');
    expect(idx['a/base@lg']!.consoleErrors).toBe(2);
  });
});
