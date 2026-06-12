import type { Command } from 'commander';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { loadManifest, ManifestError, type Manifest } from 'uishot-core';
import { getClient, manifestEnv, projectRoot } from '../context.js';

interface DoctorOptions {
  reauth?: boolean;
}

interface Check {
  name: string;
  run: () => Promise<string>;
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check manifest, dev server, browser, daemon, and session health')
    .option('--reauth', 'drop cached sessions and re-authenticate')
    .action(async (opts: DoctorOptions) => {
      const root = projectRoot();
      let manifest: Manifest | undefined;
      let failed = false;

      const checks: Check[] = [
        {
          name: 'manifest',
          run: async () => {
            manifest = loadManifest(root);
            return `${Object.keys(manifest.screens).length} screens, ${Object.keys(manifest.sessions).length} sessions`;
          },
        },
        {
          name: 'dev server',
          run: async () => {
            if (!manifest) throw new Error('skipped (manifest failed)');
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            try {
              await fetch(manifest.baseUrl, { signal: controller.signal });
            } catch {
              throw new Error(
                `dev server not reachable at ${manifest.baseUrl}. Start it, or fix the baseUrl env var. ` +
                  `(If the server claims it's running: some dev servers bind IPv6-only — try http://localhost:PORT ` +
                  `instead of 127.0.0.1, or start the server with --host.)`,
              );
            } finally {
              clearTimeout(timer);
            }
            return `reachable at ${manifest.baseUrl}`;
          },
        },
        {
          name: 'chromium',
          run: async () => {
            const path = chromium.executablePath();
            if (!existsSync(path)) throw new Error('not installed. Run: npx playwright install chromium');
            return 'installed';
          },
        },
        {
          name: 'daemon',
          run: async () => {
            const client = await getClient(root); // auto-starts: that's a fix, not a failure
            const status = await client.request('status');
            if (opts.reauth) await client.request('invalidateSessions');
            client.close();
            return `running (pid ${status.pid})${opts.reauth ? ', sessions invalidated' : ''}`;
          },
        },
        {
          name: 'sessions',
          run: async () => {
            if (!manifest) throw new Error('skipped (manifest failed)');
            const names = Object.keys(manifest.sessions);
            if (names.length === 0) return 'none configured';
            const client = await getClient(root);
            // A 1-screen snap per session proves auth end-to-end (login bounce
            // would fail it). Each session is validated against a screen that
            // actually uses it; unreferenced sessions are skipped.
            const validated: string[] = [];
            const skipped: string[] = [];
            for (const name of names) {
              const screen = Object.values(manifest.screens).find((s) => (s.session ?? 'default') === name);
              if (!screen) {
                skipped.push(name);
                continue;
              }
              const res = await client.request('snap', {
                screen: screen.id,
                session: name,
                sizes: [manifest.defaultSizes[0]!],
                env: manifestEnv(root),
              });
              if (res.failures.length > 0) throw new Error(`session "${name}": ${res.failures[0]!.message}`);
              validated.push(name);
            }
            client.close();
            const skipNote = skipped.length > 0 ? ` (${skipped.join(', ')}: no screen uses it, skipped)` : '';
            return `${validated.join(', ') || 'none'} authenticate${skipNote}`;
          },
        },
      ];

      for (const check of checks) {
        try {
          console.log(`ok ${check.name} — ${await check.run()}`);
        } catch (err) {
          failed = true;
          console.log(`FAIL ${check.name} — ${(err as Error).message}`);
        }
      }
      process.exit(failed ? 1 : 0);
    });
}
