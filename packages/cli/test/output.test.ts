import { describe, it, expect, vi, afterEach } from 'vitest';
import { emit } from '../src/output.js';
import type { ExecuteResult } from 'uishot-daemon';

const shot = (over: Partial<ExecuteResult['shots'][number]> = {}): ExecuteResult['shots'][number] => ({
  screen: 'items.list',
  state: 'base',
  size: 'lg',
  path: '.uishot/shots/items.list/base@1440x900.png',
  capturedAt: '2026-07-03T00:00:00.000Z',
  gitSha: 'abc1234',
  consoleErrors: 0,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('emit', () => {
  it('prints shot warnings to stderr, keeping stdout as path lines', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = emit(
      { shots: [shot({ warnings: ['1 image(s) failed to load'] })], failures: [], verified: [] },
      false,
    );
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatch(/^\.uishot\/shots\/items\.list\/base@1440x900\.png/);
    expect(error).toHaveBeenCalledWith('warning items.list/base@lg: 1 image(s) failed to load');
  });

  it('emits nothing to stderr for clean shots', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    emit({ shots: [shot()], failures: [], verified: [] }, false);
    expect(error).not.toHaveBeenCalled();
  });
});
