import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { CaptureTarget, Manifest, Surface, SurfaceSession, ShotRecord } from 'uishot-core';
import {
  diffPath,
  diffPngs,
  failedShotPath,
  prevPath,
  resolveOutPath,
  shotPath,
  shotsDir,
  updateIndex,
  writeShot,
} from 'uishot-core';

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
  /** Coarse phase events (session boots, per-viewport captures) for CLI stderr. */
  onProgress?: (message: string) => void;
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
  const progress = opts.onProgress ?? (() => {});

  async function captureOne(session: SurfaceSession, t: CaptureTarget): Promise<void> {
    session.resetErrorCount();
    // `storage` seeds are scoped to their target: snapshot origin storage on
    // first load, restore after, so a seeded panel-open doesn't leak into
    // every later capture in the sweep.
    const usesStorage = t.steps.some((s) => s.action === 'storage');
    let storageSnapshot: string | undefined;
    const snapshotOnce = async (): Promise<void> => {
      if (usesStorage && storageSnapshot === undefined && session.snapshotStorage) {
        storageSnapshot = await session.snapshotStorage();
      }
    };
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
    const navAndSettle = async (): Promise<void> => {
      try {
        await session.goto(t.route);
      } catch (err) {
        // A nav timeout under sweep load (dev-server transform backlog) is the
        // dominant transient in real projects; one retry converts a false FAIL
        // into a capture. Anything else (refused, DNS) fails straight through.
        if (!/goto.*Timeout.*exceeded/i.test((err as Error).message)) throw err;
        progress(`retrying navigation to ${t.route} after a timeout`);
        await session.goto(t.route);
      }
      await snapshotOnce();
      try {
        await settle();
      } catch (err) {
        if (session.recoverIfBounced && (await session.recoverIfBounced())) {
          await settle();
        } else {
          throw err;
        }
      }
    };
    const captureAt = async (vp: (typeof t.sizes)[number]): Promise<void> => {
      progress(`capturing ${t.screenId}/${t.state}@${vp.name}`);
      const img = await session.capture(vp, t.clip);
      // Custom --out is a throwaway destination: write the PNG verbatim, no
      // prev-rotation / diff / index bookkeeping (those are default-shot concepts).
      if (t.out) {
        const outPath = resolveOutPath(t.out, t.screenId, t.state, vp);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, img.png);
        shots.push({
          screen: t.screenId,
          state: t.state,
          size: vp.name,
          path: outPath,
          capturedAt: new Date().toISOString(),
          gitSha: sha,
          consoleErrors: img.consoleErrors,
          ...(img.warnings.length > 0 ? { warnings: img.warnings } : {}),
        });
        return;
      }
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
        ...(img.warnings.length > 0 ? { warnings: img.warnings } : {}),
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
    };
    try {
      if (t.steps.length > 0) {
        // Stateful targets rebuild the state per viewport: transient overlays
        // (dropdowns, popovers, portals) close on resize, so resizing after
        // the recipe would capture a silently-degraded state. verify replays
        // the exact same way — a recipe that only works at desktop widths is
        // rot, and blessing it at one viewport would be a lie.
        for (const vp of t.sizes) {
          if (opts.verifyOnly) progress(`verifying ${t.screenId}/${t.state}@${vp.name}`);
          await session.setViewport(vp);
          try {
            await navAndSettle();
          } catch (err) {
            const at = ` (at ${vp.width}x${vp.height})`;
            if (err instanceof StepFailure) err.cause.message += at;
            else (err as Error).message += at;
            throw err;
          }
          if (!opts.verifyOnly) await captureAt(vp);
        }
        if (opts.verifyOnly) {
          verified.push({ screen: t.screenId, state: t.state, ok: true });
          return;
        }
      } else {
        if (opts.verifyOnly) progress(`verifying ${t.screenId}/${t.state}`);
        await navAndSettle();
        if (opts.verifyOnly) {
          verified.push({ screen: t.screenId, state: t.state, ok: true });
          return;
        }
        for (const vp of t.sizes) await captureAt(vp);
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
    } finally {
      if (storageSnapshot !== undefined && session.restoreStorage) {
        try {
          await session.restoreStorage(storageSnapshot);
        } catch {
          // restore is best-effort; the next target's goto re-baselines anyway
        }
      }
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
          progress(`opening session "${t.session}" (first use boots the browser and may log in)`);
          session = await surface.openSession(t.session, cfg, manifest);
          sessions.set(t.session, session);
        }
        await captureOne(session, t);
      }
    } finally {
      for (const s of sessions.values()) await s.dispose();
    }
  }

  await Promise.all(Array.from({ length: Math.min(manifest.parallelism, targets.length) }, () => worker()));
  // Only default-location shots belong in the index; custom --out captures are
  // ad-hoc destinations and must not pollute the registry / diff baselines.
  const indexable = shots.filter((s) => s.path.startsWith(shotsDir(root)));
  if (indexable.length > 0) updateIndex(root, indexable);
  return { shots, failures, verified };
}
