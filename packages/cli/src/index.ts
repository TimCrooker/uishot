#!/usr/bin/env node
import { Command } from 'commander';
import { registerSnap } from './commands/snap.js';
import { registerSweep } from './commands/sweep.js';
import { registerDiff } from './commands/diff.js';
import { registerList } from './commands/list.js';
import { registerVerify } from './commands/verify.js';
import { registerPromote } from './commands/promote.js';
import { registerDaemon } from './commands/daemon.js';
import { registerDoctor } from './commands/doctor.js';
import { registerInit } from './commands/init.js';
import { registerDrift } from './commands/drift.js';

const program = new Command('uishot').description('Instant, addressable UI screenshots for agents');

registerSnap(program);
registerSweep(program);
registerDiff(program);
registerList(program);
registerVerify(program);
registerPromote(program);
registerDaemon(program);
registerDoctor(program);
registerInit(program);
registerDrift(program);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
