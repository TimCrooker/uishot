import { execa, type ResultPromise } from 'execa';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const FIXTURE_PORT = 4798;

let proc: ResultPromise | undefined;

export async function setup() {
  const fixtureDir = fileURLToPath(new URL('../../../fixtures/demo-app', import.meta.url));
  proc = execa(
    join(fixtureDir, 'node_modules', '.bin', 'vite'),
    ['--port', String(FIXTURE_PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: fixtureDir, reject: false },
  );
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${FIXTURE_PORT}/login.html`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('demo-app fixture server did not start within 15s');
}

export async function teardown() {
  proc?.kill('SIGTERM');
}
