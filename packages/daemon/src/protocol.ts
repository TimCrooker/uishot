import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptureQuery } from '@uishot/core';
import type { ExecuteResult, VerifiedState } from './executor.js';

/**
 * Socket lives in tmpdir keyed by project root: immune to the macOS 104-char
 * unix socket path limit regardless of how deep the project lives.
 */
export function socketPath(root: string): string {
  return join(tmpdir(), `uishot-${createHash('sha1').update(root).digest('hex').slice(0, 12)}.sock`);
}

export interface DaemonStatus {
  pid: number;
  root: string;
  uptimeMs: number;
  sessions: string[];
}

export interface VerifyFailure extends VerifiedState {
  message?: string;
  stuckShotPath?: string;
}

export interface MethodMap {
  ping: { params: undefined; result: 'pong' };
  status: { params: undefined; result: DaemonStatus };
  snap: { params: CaptureQuery; result: ExecuteResult };
  verify: { params: { feature?: string }; result: VerifyFailure[] };
  invalidateSessions: { params: undefined; result: 'ok' };
  shutdown: { params: undefined; result: 'ok' };
}

export type Method = keyof MethodMap;

export interface RequestMessage {
  id: number;
  method: Method;
  params?: unknown;
}

export type ResponseMessage =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
