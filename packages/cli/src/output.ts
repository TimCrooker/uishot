import type { ExecuteResult } from 'uishot-daemon';

/**
 * Print an execute result for an agent consumer.
 * Default mode: one produced file path per line on stdout (the minimal useful
 * payload); failures on stderr. JSON mode: the full result object.
 * Returns the process exit code.
 */
export function emit(result: ExecuteResult, json: boolean): number {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return result.failures.length > 0 ? 1 : 0;
  }
  for (const shot of result.shots) {
    const diffNote =
      shot.changedRatio !== undefined ? `  (changed ${(shot.changedRatio * 100).toFixed(1)}%)` : '';
    const errNote = shot.consoleErrors > 0 ? `  [${shot.consoleErrors} console errors]` : '';
    console.log(`${shot.path}${diffNote}${errNote}`);
  }
  for (const failure of result.failures) {
    console.error(`FAIL ${failure.message}`);
  }
  return result.failures.length > 0 ? 1 : 0;
}
