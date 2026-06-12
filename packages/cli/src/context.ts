import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILENAME, referencedEnvVars } from '@uishot/core';
import { DaemonClient } from '@uishot/daemon';

export function daemonBinPath(): string {
  return createRequire(import.meta.url).resolve('@uishot/daemon/bin');
}

/**
 * Env vars the manifest references, resolved from the CLI's environment.
 * Sent with every daemon request — the daemon's own env is frozen at spawn
 * time and must not go stale-y wrong when the caller's env changes.
 */
export function manifestEnv(root: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(join(root, MANIFEST_FILENAME), 'utf8');
  } catch {
    return {};
  }
  const env: Record<string, string> = {};
  for (const name of referencedEnvVars(text)) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export async function getClient(root: string): Promise<DaemonClient> {
  return DaemonClient.connectOrSpawn(root, daemonBinPath());
}

export function projectRoot(): string {
  return process.cwd();
}
