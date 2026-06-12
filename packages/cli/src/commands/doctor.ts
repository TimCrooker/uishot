import type { Command } from 'commander';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { loadManifest, ManifestError, type Manifest } from '@uishot/core';
import { getClient, projectRoot } from '../context.js';

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
                `dev server not reachable at ${manifest.baseUrl}. Start it, or fix the baseUrl env var.`,
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
            // A 1-screen snap per session proves auth end-to-end (login bounce would fail it).
            const firstScreen = Object.keys(manifest.screens)[0];
            if (!firstScreen) {
              client.close();
              return 'no screens to validate against';
            }
            for (const name of names) {
              const res = await client.request('snap', {
                screen: firstScreen,
                session: name,
                sizes: [manifest.defaultSizes[0]!],
              });
              if (res.failures.length > 0) throw new Error(`session "${name}": ${res.failures[0]!.message}`);
            }
            client.close();
            return `${names.join(', ')} all authenticate`;
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
