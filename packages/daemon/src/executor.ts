import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { CaptureTarget, Manifest, Surface, SurfaceSession, ShotRecord } from '@uishot/core';
import {
  diffPath,
  diffPngs,
  failedShotPath,
  prevPath,
  shotPath,
  updateIndex,
  writeShot,
} from '@uishot/core';

export interface CaptureFailure {
  screen: string;
  state: string;
  message: string;
  stuckShotPath: string | undefined;
}

export interface VerifiedState {
  screen: string;
  state: string;
  ok: boolean;
}

export interface ExecuteResult {
  shots: ShotRecord[];
  failures: CaptureFailure[];
  verified: VerifiedState[];
}

export interface ExecuteOptions {
  verifyOnly?: boolean;
}

class StepFailure extends Error {
  constructor(
    public stepIndex: number,
    public override cause: Error,
  ) {
    super(cause.message);
  }
}

function gitSha(root: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const POOL = 4;

export async function executeTargets(
  root: string,
  manifest: Manifest,
  surface: Surface,
  targets: CaptureTarget[],
  opts: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const sha = gitSha(root);
  const shots: ShotRecord[] = [];
  const failures: CaptureFailure[] = [];
  const verified: VerifiedState[] = [];
  const queue = [...targets];

  async function captureOne(session: SurfaceSession, t: CaptureTarget): Promise<void> {
    session.resetErrorCount();
    // Readiness + recipe as one retryable sequence: SPAs can bounce to login
    // after hydration (past goto's immediate check), so any failure gets one
    // recover-and-replay from a fresh navigation.
    const settle = async (): Promise<void> => {
      if (t.readyWhen) await session.act({ action: 'waitFor', selector: t.readyWhen });
      for (const [i, step] of t.steps.entries()) {
        try {
          await session.act(step);
        } catch (err) {
          throw new StepFailure(i, err as Error);
        }
      }
    };
    try {
      await session.goto(t.route);
      try {
        await settle();
      } catch (err) {
        if (session.recoverIfBounced && (await session.recoverIfBounced())) {
          await settle();
        } else {
          throw err;
        }
      }
      if (opts.verifyOnly) {
        verified.push({ screen: t.screenId, state: t.state, ok: true });
        return;
      }
      for (const vp of t.sizes) {
        const img = await session.capture(vp);
        const path = shotPath(root, t.screenId, t.state, vp);
        const hadPrev = existsSync(path);
        writeShot(path, img.png);
        const rec: ShotRecord = {
          screen: t.screenId,
          state: t.state,
          size: vp.name,
          path,
          capturedAt: new Date().toISOString(),
          gitSha: sha,
          consoleErrors: img.consoleErrors,
        };
        if (t.diff && hadPrev) {
          const d = diffPngs(readFileSync(prevPath(path)), img.png);
          rec.changedRatio = d.changedRatio;
          if (d.diffPng) {
            writeFileSync(diffPath(path), d.diffPng);
            rec.diffPath = diffPath(path);
          }
        }
        shots.push(rec);
      }
    } catch (err) {
      if (err instanceof StepFailure) {
        const stuck = failedShotPath(root, t.screenId, t.state, t.sizes[0]!);
        try {
          writeShot(stuck, (await session.capture(t.sizes[0]!)).png);
        } catch {
          // evidence is best-effort
        }
        failures.push({
          screen: t.screenId,
          state: t.state,
          stuckShotPath: stuck,
          message:
            `recipe ${t.screenId}/${t.state} failed at step ${err.stepIndex + 1} (${err.cause.message}). ` +
            `Stuck-state evidence: ${stuck}. Fix the recipe in uishot.config.yaml, or re-record: ` +
            `uishot snap ${t.screenId} --do "..." && uishot promote ${t.screenId} --name ${t.state}`,
        });
      } else {
        failures.push({
          screen: t.screenId,
          state: t.state,
          stuckShotPath: undefined,
          message: `${t.screenId}/${t.state}: ${(err as Error).message}`,
        });
      }
      if (opts.verifyOnly) verified.push({ screen: t.screenId, state: t.state, ok: false });
    }
  }

  async function worker(): Promise<void> {
    const sessions = new Map<string, SurfaceSession>();
    try {
      for (let t = queue.shift(); t; t = queue.shift()) {
        let session = sessions.get(t.session);
        if (!session) {
          const cfg = manifest.sessions[t.session];
          if (!cfg) {
            failures.push({
              screen: t.screenId,
              state: t.state,
              stuckShotPath: undefined,
              message: `Unknown session "${t.session}". Sessions: ${Object.keys(manifest.sessions).join(', ')}`,
            });
            continue;
          }
          session = await surface.openSession(t.session, cfg, manifest);
          sessions.set(t.session, session);
        }
        await captureOne(session, t);
      }
    } finally {
      for (const s of sessions.values()) await s.dispose();
    }
  }

  await Promise.all(Array.from({ length: Math.min(POOL, targets.length) }, () => worker()));
  if (shots.length > 0) updateIndex(root, shots);
  return { shots, failures, verified };
}
