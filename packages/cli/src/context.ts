import { createRequire } from 'node:module';
import { DaemonClient } from '@uishot/daemon';

export function daemonBinPath(): string {
  return createRequire(import.meta.url).resolve('@uishot/daemon/bin');
}

export async function getClient(root: string): Promise<DaemonClient> {
  return DaemonClient.connectOrSpawn(root, daemonBinPath());
}

export function projectRoot(): string {
  return process.cwd();
}
