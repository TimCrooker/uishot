import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DaemonClient } from 'uishot-daemon';
import { projectRoot } from '../context.js';

export function registerDaemon(program: Command): void {
  const daemon = program.command('daemon').description('Daemon lifecycle (normally automatic)');

  daemon.command('status').action(async () => {
    const root = projectRoot();
    try {
      const client = await DaemonClient.connect(root);
      const status = await client.request('status');
      client.close();
      console.log(
        `running: pid ${status.pid}, uptime ${Math.round(status.uptimeMs / 1000)}s, sessions: ${
          status.sessions.join(', ') || '(none)'
        }`,
      );
    } catch {
      console.log('not running');
    }
  });

  daemon.command('stop').action(async () => {
    const root = projectRoot();
    try {
      const client = await DaemonClient.connect(root);
      await client.request('shutdown');
      client.close();
      console.log('stopped');
    } catch {
      // No live socket — fall back to the pidfile in case of a wedged daemon.
      try {
        const pid = Number(readFileSync(join(root, '.uishot', 'daemon.pid'), 'utf8'));
        process.kill(pid, 'SIGTERM');
        console.log(`stopped (pid ${pid} via pidfile)`);
      } catch {
        console.log('not running');
      }
    }
  });
}
