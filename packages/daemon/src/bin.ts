#!/usr/bin/env node
import { startServer } from './server.js';

const root = process.argv[2] ?? process.cwd();
const idleMs = Number(process.env.UISHOT_IDLE_MS ?? 1_800_000);

startServer(root, { idleMs })
  .then(({ closed }) => {
    console.log(`uishot daemon listening for ${root} (pid ${process.pid})`);
    return closed;
  })
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
