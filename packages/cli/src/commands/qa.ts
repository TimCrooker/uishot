import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { ExecuteResult } from 'uishot-daemon';
import { getClient, manifestEnv, progressToStderr, projectRoot } from '../context.js';

const QA_STATE_FILE = '.uishot/qa-state.json';

interface QaState {
  lastRun: string; // ISO timestamp
  baselineShots: Record<string, QaShotBaseline>;
}

interface QaShotBaseline {
  // key: "screen/state@size"
  changedRatio?: number;
  gitSha: string;
  capturedAt: string;
}

interface QaFindings {
  regressions: QaFinding[];
  errors: QaFinding[];
  warnings: QaFinding[];
  recipeFailures: QaFinding[];
  newScreens: string[];
  removedScreens: string[];
}

interface QaFinding {
  screen: string;
  state: string;
  size: string;
  path?: string;
  diffPath?: string;
  detail: string;
  value: number; // changedRatio or consoleErrors
}

interface QaOptions {
  threshold?: string;
  report?: string;
  sinceLast?: boolean;
  json?: boolean;
  feature?: string;
  sizes?: string;
}

const DEFAULT_THRESHOLD = 0.02;

function loadQaState(root: string): QaState {
  const p = join(root, QA_STATE_FILE);
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      // corrupt state — start fresh
    }
  }
  return { lastRun: '', baselineShots: {} };
}

function saveQaState(root: string, state: QaState): void {
  writeFileSync(join(root, QA_STATE_FILE), JSON.stringify(state, null, 2));
}

function classify(result: ExecuteResult, threshold: number, previousRun: QaState | null): QaFindings {
  const findings: QaFindings = {
    regressions: [],
    errors: [],
    warnings: [],
    recipeFailures: [],
    newScreens: [],
    removedScreens: [],
  };

  const keys = new Set<string>();

  for (const shot of result.shots) {
    const key = `${shot.screen}/${shot.state}@${shot.size}`;
    keys.add(key);

    if (shot.changedRatio !== undefined && shot.changedRatio > threshold) {
      const severity = shot.changedRatio > 0.05 ? 'P1 (significant)' : 'P2 (minor)';
      findings.regressions.push({
        screen: shot.screen,
        state: shot.state,
        size: shot.size,
        path: shot.path,
        diffPath: shot.diffPath,
        detail: `Visual regression (${severity}): ${(shot.changedRatio * 100).toFixed(1)}% changed`,
        value: shot.changedRatio,
      });
    }

    if (shot.consoleErrors > 0) {
      const severity = shot.consoleErrors > 5 ? 'P1' : 'P2';
      findings.errors.push({
        screen: shot.screen,
        state: shot.state,
        size: shot.size,
        path: shot.path,
        detail: `JS errors (${severity}): ${shot.consoleErrors} console error(s)`,
        value: shot.consoleErrors,
      });
    }

    if (shot.warnings && shot.warnings.length > 0) {
      for (const w of shot.warnings) {
        findings.warnings.push({
          screen: shot.screen,
          state: shot.state,
          size: shot.size,
          path: shot.path,
          detail: w,
          value: 0,
        });
      }
    }
  }

  for (const failure of result.failures) {
    findings.recipeFailures.push({
      screen: failure.screen,
      state: failure.state,
      size: '',
      path: failure.stuckShotPath,
      detail: failure.message,
      value: 0,
    });
  }

  // Since-last analysis
  if (previousRun && previousRun.lastRun) {
    const prevKeys = new Set(Object.keys(previousRun.baselineShots));
    for (const k of keys) {
      if (!prevKeys.has(k)) findings.newScreens.push(k);
    }
    for (const k of prevKeys) {
      if (!keys.has(k)) findings.removedScreens.push(k);
    }
  }

  return findings;
}

/**
 * Scale icon for severity.
 */
function icon(severity: string): string {
  if (severity.startsWith('P0')) return '🔴';
  if (severity.startsWith('P1')) return '🟠';
  return '🟡';
}

/**
 * Produce a compact summary markdown section.
 */
function summary(findings: QaFindings): string {
  const lines: string[] = [];
  const total =
    findings.regressions.length +
    findings.errors.length +
    findings.warnings.length +
    findings.recipeFailures.length;

  if (total === 0) {
    return '✅ All screens clean — no regressions, errors, warnings, or failures.';
  }

  const symbol = findings.recipeFailures.length > 0 ? '🚨' : total > 3 ? '⚠️' : 'ℹ️';
  lines.push(`${symbol} **QA Report** — ${total} finding(s)`);
  lines.push('');

  if (findings.regressions.length > 0) {
    lines.push(`📐 **Visual Regressions** (${findings.regressions.length})`);
    for (const r of findings.regressions) {
      lines.push(`  ${icon(r.detail)} \`${r.screen}/${r.state}@${r.size}\` — ${r.detail}`);
    }
    lines.push('');
  }

  if (findings.errors.length > 0) {
    lines.push(`🐛 **JS Errors** (${findings.errors.length})`);
    for (const e of findings.errors) {
      lines.push(`  ${icon(e.detail)} \`${e.screen}/${e.state}@${e.size}\` — ${e.detail}`);
    }
    lines.push('');
  }

  if (findings.warnings.length > 0) {
    lines.push(`💡 **Capture Warnings** (${findings.warnings.length})`);
    for (const w of findings.warnings) {
      lines.push(`  - \`${w.screen}/${w.state}@${w.size}\`: ${w.detail}`);
    }
    lines.push('');
  }

  if (findings.recipeFailures.length > 0) {
    lines.push(`💥 **Recipe Failures** (${findings.recipeFailures.length})`);
    for (const f of findings.recipeFailures) {
      lines.push(`  - \`${f.screen}/${f.state}\`: ${f.detail.split('\n')[0]}`);
    }
    lines.push('');
  }

  if (findings.newScreens.length > 0) {
    lines.push(`🆕 **New Screens** (${findings.newScreens.length})`);
    for (const s of findings.newScreens) lines.push(`  - \`${s}\``);
    lines.push('');
  }

  if (findings.removedScreens.length > 0) {
    lines.push(`🗑️ **Removed Screens** (${findings.removedScreens.length})`);
    for (const s of findings.removedScreens) lines.push(`  - \`${s}\``);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Translate findings into GitHub-issue-ready markdown sections.
 * Each section maps to an issue body template that a CI runner can pipe to `gh issue create`.
 */
function githubReport(findings: QaFindings, threshold: number): string {
  const parts: string[] = [];
  parts.push('# QA Report');
  parts.push(`> Threshold: ${(threshold * 100).toFixed(0)}% pixel change, ${new Date().toISOString()}`);
  parts.push('');

  if (findings.regressions.length > 0) {
    parts.push('## Visual Regressions');
    parts.push('');
    for (const r of findings.regressions) {
      parts.push(`- **${r.screen}/${r.state}@${r.size}** — ${r.detail}`);
      if (r.path) parts.push(`  - Screenshot: \`${r.path}\``);
      if (r.diffPath) parts.push(`  - Diff: \`${r.diffPath}\``);
      parts.push(`  - \`changedRatio\`: ${r.value.toFixed(4)}`);
    }
    parts.push('');
  }

  if (findings.errors.length > 0) {
    parts.push('## Console Errors');
    parts.push('');
    for (const e of findings.errors) {
      parts.push(`- **${e.screen}/${e.state}@${e.size}** — ${e.value} errors`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

export function registerQa(program: Command): void {
  program
    .command('qa')
    .description(
      'One-shot QA run: full sweep + classify + structured report. ' +
        'Replaces the manual uishot all + parse + file-issues pipeline.',
    )
    .option('--threshold <ratio>', 'pixel-diff sensitivity (default: 0.02)', String)
    .option('--report <style>', 'summary (default), detailed, or github', 'summary')
    .option('--since-last', 'only show changes since previous QA run')
    .option('--json', 'structured findings as JSON')
    .option('--feature <tag>', 'limit to one feature')
    .option('--sizes <names>', 'comma-separated viewport names')
    .action(async (opts: QaOptions) => {
      const root = projectRoot();
      const threshold = opts.threshold ? parseFloat(opts.threshold) : DEFAULT_THRESHOLD;

      // Run full sweep with diff (like `uishot all --diff`)
      const client = await getClient(root);
      const result: ExecuteResult = await client.request(
        'snap',
        {
          ...(opts.feature ? { feature: opts.feature } : { all: true }),
          sizes: opts.sizes?.split(','),
          diff: true,
          env: manifestEnv(root),
        },
        progressToStderr,
      );
      client.close();

      // Load prior state for since-last
      const prior = opts.sinceLast ? loadQaState(root) : null;

      // Classify
      const findings = classify(result, threshold, prior);

      // Save new baseline
      const baselineShots: Record<string, QaShotBaseline> = {};
      for (const shot of result.shots) {
        baselineShots[`${shot.screen}/${shot.state}@${shot.size}`] = {
          changedRatio: shot.changedRatio,
          gitSha: shot.gitSha,
          capturedAt: shot.capturedAt,
        };
      }
      saveQaState(root, { lastRun: new Date().toISOString(), baselineShots });

      // Output
      if (opts.json) {
        console.log(JSON.stringify({ findings, shots: result.shots.length, failures: result.failures.length }, null, 2));
      } else if (opts.report === 'github') {
        console.log(githubReport(findings, threshold));
      } else if (opts.report === 'detailed') {
        console.log(JSON.stringify(findings, null, 2));
      } else {
        // summary (default)
        console.log(summary(findings));
      }

      const hasRegressions = findings.regressions.length > 0 || findings.recipeFailures.length > 0;
      process.exit(hasRegressions ? 1 : 0);
    });
}
