import type { RecipeStep } from './types.js';
import { ManifestError } from './manifest.js';

const SELECTOR_ACTIONS = ['click', 'hover', 'scrollTo', 'waitFor'] as const;
const VALUE_ACTIONS = ['press', 'waitMs', 'goto'] as const;
const KV_ACTIONS = ['fill', 'select'] as const;
const ALL = ['goto', 'click', 'fill', 'select', 'hover', 'press', 'scrollTo', 'waitFor', 'waitMs'];

/** Parse a CLI --do string like "click:[data-testid=x]" or "fill:#qty=3" into a RecipeStep. */
export function parseDo(input: string): RecipeStep {
  const sep = input.indexOf(':');
  if (sep === -1) {
    throw new ManifestError(`--do "${input}" must be ACTION:ARG. Actions: ${ALL.join(', ')}`);
  }
  const action = input.slice(0, sep);
  const rest = input.slice(sep + 1);
  if ((SELECTOR_ACTIONS as readonly string[]).includes(action)) {
    return { action: action as RecipeStep['action'], selector: rest };
  }
  if ((VALUE_ACTIONS as readonly string[]).includes(action)) {
    const value = action === 'waitMs' ? String(Math.min(Number(rest), 5000)) : rest;
    return { action: action as RecipeStep['action'], value };
  }
  if ((KV_ACTIONS as readonly string[]).includes(action)) {
    const eq = rest.lastIndexOf('=');
    if (eq <= 0) {
      throw new ManifestError(
        `--do "${input}": use ${action}:SELECTOR=VALUE (values containing "=" need a named state in YAML)`,
      );
    }
    return { action: action as RecipeStep['action'], selector: rest.slice(0, eq), value: rest.slice(eq + 1) };
  }
  throw new ManifestError(`Unknown --do action "${action}". Actions: ${ALL.join(', ')}`);
}
