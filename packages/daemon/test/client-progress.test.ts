import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DaemonClient } from '../src/client.js';
import { socketPath } from '../src/protocol.js';

const root = mkdtempSync(join(tmpdir(), 'uishot-cli-'));
let server: Server;

afterAll(() => server?.close());

describe('DaemonClient progress frames', () => {
  it('routes progress frames to the handler before resolving with the result', async () => {
    server = createServer((conn) => {
      conn.on('data', (chunk) => {
        const req = JSON.parse(chunk.toString().trim()) as { id: number };
        conn.write(JSON.stringify({ id: req.id, progress: 'opening session "default"' }) + '\n');
        conn.write(JSON.stringify({ id: req.id, progress: 'capturing items.list/base@lg' }) + '\n');
        conn.write(
          JSON.stringify({ id: req.id, ok: true, result: { shots: [], failures: [], verified: [] } }) + '\n',
        );
      });
    });
    await new Promise<void>((r) => server.listen(socketPath(root), r));

    const client = await DaemonClient.connect(root);
    const events: string[] = [];
    const res = await client.request('snap', { screen: 'items.list' }, (m) => events.push(m));
    expect(events).toEqual(['opening session "default"', 'capturing items.list/base@lg']);
    expect(res.failures).toEqual([]);
    client.close();
  });
});
