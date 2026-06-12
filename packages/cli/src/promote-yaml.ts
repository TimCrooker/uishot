import { parseDocument } from 'yaml';
import type { RecipeStep } from 'uishot-core';

/**
 * Insert steps as screens.<id>.states.<name> in the manifest YAML text,
 * preserving comments and formatting.
 */
export function promoteIntoYaml(
  yamlText: string,
  screenId: string,
  stateName: string,
  steps: RecipeStep[],
): string {
  const doc = parseDocument(yamlText);
  if (!doc.hasIn(['screens', screenId])) {
    throw new Error(
      `Screen "${screenId}" not in manifest — promote works on screens, not raw routes. Add the screen first.`,
    );
  }
  const stepNodes = steps.map((s) => {
    switch (s.action) {
      case 'fill':
      case 'select':
      case 'storage':
        return { [s.action]: [s.selector, s.value] };
      case 'press':
      case 'goto':
        return { [s.action]: s.value };
      case 'waitMs':
        return { waitMs: Number(s.value) };
      default:
        return { [s.action]: s.selector };
    }
  });
  doc.setIn(['screens', screenId, 'states', stateName], doc.createNode(stepNodes));
  return doc.toString();
}
