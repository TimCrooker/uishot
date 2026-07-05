import { createServer, createConnection, type Server, type Socket } from 'node:net';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest, resolveTargets, type CaptureQuery } from 'uishot-core';
import { BrowserSurface } from './browser-surface.js';
import { executeTargets } from './executor.js';
import { socketPath, type DaemonStatus, type RequestMessage, type ResponseMessage, type VerifyFailure } from './protocol.js';

export interface ServerOptions {
  /** Shut down after this long with no requests. */
  idleMs: number;
}

export interface RunningServer {
  server: Server;
  /** Resolves when the server has fully closed (socket removed, surface disposed). */
  closed: Promise<void>;
  stop(): Promise<void>;
}

async function isSocketLive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = createConnection(path);
    conn.once('connect', () => {
      conn.destroy();
      resolve(true);
    });
    conn.once('error', () => resolve(false));
  });
}

export async function startServer(root: string, opts: ServerOptions): Promise<RunningServer> {
  const sock = socketPath(root);
  if (await isSocketLive(sock)) {
    throw new Error(`A uishot daemon is already running for ${root} (socket: ${sock})`);
  }
  rmSync(sock, { force: true }); // stale socket from a crashed daemon

  const startedAt = Date.now();
  let surface: BrowserSurface | undefined;
  const getSurface = () => (surface ??= new BrowserSurface(root));

  let stopRequested = false;
  let resolveClosed: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));

  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void stop(), opts.idleMs);
    idleTimer.unref();
  };

  async function dispatch(req: RequestMessage, emitProgress: (m: string) => void): Promise<unknown> {
    switch (req.method) {
      case 'ping':
        return 'pong';
      case 'status': {
        let sessions: string[] = [];
        try {
          sessions = Object.keys(loadManifest(root).sessions);
        } catch {
          // status stays useful even when the manifest can't resolve
        }
        const status: DaemonStatus = {
          pid: process.pid,
          root,
          uptimeMs: Date.now() - startedAt,
          sessions,
        };
        return status;
      }
      case 'snap': {
        // Manifest reloads fresh per job (picks up agent edits with zero
        // restart); caller env wins over the daemon's spawn-time env.
        const { env, ...query } = req.params as CaptureQuery & { env?: Record<string, string> };
        const manifest = loadManifest(root, { ...process.env, ...env });
        const targets = resolveTargets(manifest, query);
        return executeTargets(root, manifest, getSurface(), targets, { onProgress: emitProgress });
      }
      case 'verify': {
        const { feature, env } = (req.params ?? {}) as { feature?: string; env?: Record<string, string> };
        const manifest = loadManifest(root, { ...process.env, ...env });
        const targets = resolveTargets(manifest, feature ? { feature } : { all: true });
        const res = await executeTargets(root, manifest, getSurface(), targets, {
          verifyOnly: true,
          onProgress: emitProgress,
        });
        return res.verified.map((v): VerifyFailure => {
          if (v.ok) return v;
          const f = res.failures.find((x) => x.screen === v.screen && x.state === v.state);
          return { ...v, message: f?.message, stuckShotPath: f?.stuckShotPath };
        });
      }
      case 'invalidateSessions': {
        // Manifest-independent: drop the live surface and all cached auth state.
        await surface?.dispose().catch(() => {});
        surface = undefined;
        rmSync(join(root, '.uishot', 'sessions'), { recursive: true, force: true });
        return 'ok';
      }
      case 'shutdown':
        stopRequested = true;
        return 'ok';
      default:
        throw new Error(`Unknown method "${(req as { method: string }).method}"`);
    }
  }

  const server = createServer((conn: Socket) => {
    let buffer = '';
    conn.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        void handleLine(line, conn);
      }
    });
    conn.on('error', () => {});
  });

  async function handleLine(line: string, conn: Socket): Promise<void> {
    resetIdle();
    let req: RequestMessage;
    try {
      req = JSON.parse(line) as RequestMessage;
    } catch {
      conn.write(JSON.stringify({ id: -1, ok: false, error: 'invalid JSON request' }) + '\n');
      return;
    }
    const emitProgress = (m: string): void => {
      if (!conn.destroyed) conn.write(JSON.stringify({ id: req.id, progress: m }) + '\n');
    };
    let res: ResponseMessage;
    try {
      res = { id: req.id, ok: true, result: await dispatch(req, emitProgress) };
    } catch (err) {
      res = { id: req.id, ok: false, error: (err as Error).message };
    }
    if (!conn.destroyed) conn.write(JSON.stringify(res) + '\n');
    if (stopRequested) void stop();
  }

  async function stop(): Promise<void> {
    if (idleTimer) clearTimeout(idleTimer);
    server.close();
    await surface?.dispose().catch(() => {});
    rmSync(sock, { force: true });
    rmSync(join(root, '.uishot', 'daemon.pid'), { force: true });
    resolveClosed();
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(sock, resolve);
  });
  mkdirSync(join(root, '.uishot'), { recursive: true });
  writeFileSync(join(root, '.uishot', 'daemon.pid'), String(process.pid));
  resetIdle();

  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());

  return { server, closed, stop };
}
