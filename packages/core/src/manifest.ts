import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { Manifest, RecipeStep, ScreenConfig, SessionConfig, Viewport } from './types.js';

export class ManifestError extends Error {}

export const MANIFEST_FILENAME = 'uishot.config.yaml';

const SEL = z.string().min(1);
const stepSchema = z.union([
  z.object({ goto: z.string() }).strict(),
  z.object({ click: SEL }).strict(),
  z.object({ fill: z.tuple([SEL, z.string()]) }).strict(),
  z.object({ select: z.tuple([SEL, z.string()]) }).strict(),
  z.object({ hover: SEL }).strict(),
  z.object({ press: z.string() }).strict(),
  z.object({ scrollTo: SEL }).strict(),
  z.object({ waitFor: SEL }).strict(),
  z.object({ waitMs: z.number().int().positive() }).strict(),
  // Seed a localStorage key, then re-navigate (goto) so the app boots from a
  // deterministic baseline. The cure for persisted UI state (open panels,
  // collapsed sidebars) that makes toggle-clicks non-deterministic.
  z.object({ storage: z.tuple([z.string(), z.string()]) }).strict(),
]);

const rawSchema = z.object({
  app: z.object({
    baseUrl: z.string().min(1),
    defaultSizes: z.array(z.string()).min(1),
    // Concurrent capture workers for sweeps. Set to 1 for apps whose auth
    // rotates refresh tokens on every page boot (concurrent boots race the
    // rotation and trip reuse-revocation).
    parallelism: z.number().int().min(1).max(8).default(4),
  }),
  viewports: z.record(z.string().regex(/^\d+x\d+$/, 'expected WIDTHxHEIGHT like 390x844')),
  sessions: z
    .record(
      z.object({
        loginRoute: z.string().optional(),
        recipe: z.array(stepSchema).optional(),
        inject: z
          .object({
            localStorage: z.record(z.string()).optional(),
            cookies: z
              .array(z.object({ name: z.string(), value: z.string(), path: z.string().optional() }))
              .optional(),
          })
          .optional(),
      }),
    )
    .default({}),
  screens: z
    .record(
      z.object({
        route: z.string().min(1),
        feature: z.string().optional(),
        readyWhen: z.string().optional(),
        session: z.string().optional(),
        states: z.record(z.array(stepSchema)).default({}),
      }),
    )
    .default({}),
});

export function normalizeStep(raw: Record<string, unknown>): RecipeStep {
  const key = Object.keys(raw)[0] as string;
  const v = raw[key];
  switch (key) {
    case 'goto':
    case 'press':
      return { action: key, value: v as string };
    case 'waitMs':
      return { action: 'waitMs', value: String(Math.min(v as number, 5000)) };
    case 'fill':
    case 'select':
    case 'storage': {
      const [selector, value] = v as [string, string];
      return { action: key, selector, value };
    }
    case 'click':
    case 'hover':
    case 'scrollTo':
    case 'waitFor':
      return { action: key, selector: v as string };
    default:
      throw new ManifestError(`Unknown recipe action "${key}"`);
  }
}

function substituteEnv(text: string, env: Record<string, string | undefined>): string {
  return text.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const v = env[name];
    if (v === undefined) {
      throw new ManifestError(
        `Environment variable ${name} is referenced in ${MANIFEST_FILENAME} but not set. ` +
          `Set it before running uishot (e.g. ${name}=... uishot snap ...).`,
      );
    }
    return v;
  });
}

function collectUnknownKeys(error: z.ZodError): string[] {
  const keys: string[] = [];
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') keys.push(...issue.keys);
    if (issue.code === 'invalid_union') {
      for (const sub of issue.unionErrors) keys.push(...collectUnknownKeys(sub));
    }
  }
  return [...new Set(keys)];
}

export function parseManifest(
  yamlText: string,
  env: Record<string, string | undefined> = process.env,
): Manifest {
  const substituted = substituteEnv(yamlText, env);
  let data: unknown;
  try {
    data = parse(substituted);
  } catch (err) {
    throw new ManifestError(`${MANIFEST_FILENAME} is not valid YAML: ${(err as Error).message}`);
  }
  const parsed = rawSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const unknown = collectUnknownKeys(parsed.error);
    const detail = unknown.length > 0 ? ` Unknown key(s): "${unknown.join(', ')}".` : '';
    throw new ManifestError(`Invalid manifest at ${issue.path.join('.')}: ${issue.message}.${detail}`);
  }
  const raw = parsed.data;

  const viewports: Record<string, Viewport> = {};
  for (const [name, dims] of Object.entries(raw.viewports)) {
    const [w, h] = dims.split('x').map(Number);
    viewports[name] = { name, width: w!, height: h! };
  }
  for (const size of raw.app.defaultSizes) {
    if (!viewports[size]) {
      throw new ManifestError(
        `defaultSizes references unknown viewport "${size}". Available: ${Object.keys(viewports).join(', ')}`,
      );
    }
  }

  const sessions: Record<string, SessionConfig> = {};
  for (const [name, s] of Object.entries(raw.sessions)) {
    sessions[name] = {
      loginRoute: s.loginRoute,
      inject: s.inject,
      recipe: s.recipe?.map((st) => normalizeStep(st as Record<string, unknown>)),
    };
  }

  const screens: Record<string, ScreenConfig> = {};
  for (const [id, sc] of Object.entries(raw.screens)) {
    const states: Record<string, RecipeStep[]> = {};
    for (const [st, steps] of Object.entries(sc.states)) {
      states[st] = steps.map((s) => normalizeStep(s as Record<string, unknown>));
    }
    screens[id] = {
      id,
      route: sc.route,
      feature: sc.feature,
      readyWhen: sc.readyWhen,
      session: sc.session,
      states,
    };
  }

  return {
    baseUrl: raw.app.baseUrl.replace(/\/$/, ''),
    defaultSizes: raw.app.defaultSizes,
    parallelism: raw.app.parallelism,
    viewports,
    sessions,
    screens,
  };
}

/** Names of all ${VAR} references in a manifest text. */
export function referencedEnvVars(yamlText: string): string[] {
  return [...new Set([...yamlText.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]!))];
}

export function loadManifest(rootDir: string, env: Record<string, string | undefined> = process.env): Manifest {
  const path = join(rootDir, MANIFEST_FILENAME);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ManifestError(`No ${MANIFEST_FILENAME} found at ${path}. Run \`uishot init\` to create one.`);
  }
  return parseManifest(text, env);
}
