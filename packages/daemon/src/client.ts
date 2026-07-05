import { createConnection, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { socketPath, type Method, type MethodMap } from './protocol.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DaemonClient {
  private nextId = 1;
  private buffer = '';
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (m: string) => void }
  >();

  private constructor(private conn: Socket) {
    conn.on('data', (chunk) => this.onData(chunk));
    conn.on('error', () => this.failAll(new Error('daemon connection lost')));
    conn.on('close', () => this.failAll(new Error('daemon connection closed')));
  }

  static connect(root: string): Promise<DaemonClient> {
    return new Promise((resolve, reject) => {
      const conn = createConnection(socketPath(root));
      conn.once('connect', () => resolve(new DaemonClient(conn)));
      conn.once('error', (err) => reject(err));
    });
  }

  /** Connect to the project daemon, spawning it first if it is not running. */
  static async connectOrSpawn(
    root: string,
    daemonBin: string,
    onProgress?: (message: string) => void,
  ): Promise<DaemonClient> {
    try {
      return await DaemonClient.connect(root);
    } catch {
      onProgress?.('starting uishot daemon (cold start boots Chromium; warm snaps are ~1-2s)');
      mkdirSync(join(root, '.uishot'), { recursive: true });
      const logFd = openSync(join(root, '.uishot', 'daemon.log'), 'a');
      const child = spawn(process.execPath, [daemonBin, root], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });
      child.unref();
      const deadline = Date.now() + 10000;
      let lastErr: Error | undefined;
      while (Date.now() < deadline) {
        try {
          return await DaemonClient.connect(root);
        } catch (err) {
          lastErr = err as Error;
          await sleep(100);
        }
      }
      throw new Error(
        `uishot daemon failed to start within 10s (${lastErr?.message}). Log: ${join(root, '.uishot', 'daemon.log')}`,
      );
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as {
        id: number;
        ok?: boolean;
        result?: unknown;
        error?: string;
        progress?: string;
      };
      const waiter = this.pending.get(msg.id);
      if (!waiter) continue;
      if (msg.progress !== undefined) {
        waiter.onProgress?.(msg.progress);
        continue; // interim frame — the terminal response is still coming
      }
      this.pending.delete(msg.id);
      if (msg.ok) waiter.resolve(msg.result);
      else waiter.reject(new Error(msg.error));
    }
  }

  private failAll(err: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(err);
    this.pending.clear();
  }

  request<M extends Method>(
    method: M,
    ...args: MethodMap[M]['params'] extends undefined
      ? [] | [undefined, ((message: string) => void)?]
      : [MethodMap[M]['params'], ((message: string) => void)?]
  ): Promise<MethodMap[M]['result']> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params: args[0] }) + '\n';
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress: args[1] });
      this.conn.write(payload);
    });
  }

  close(): void {
    this.conn.destroy();
  }
}
