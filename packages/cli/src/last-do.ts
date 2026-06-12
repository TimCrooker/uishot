import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RecipeStep } from '@uishot/core';

export interface LastDo {
  screen: string;
  steps: RecipeStep[];
  at: string;
}

const file = (root: string) => join(root, '.uishot', 'last-do.json');

export function writeLastDo(root: string, screen: string, steps: RecipeStep[]): void {
  mkdirSync(join(root, '.uishot'), { recursive: true });
  writeFileSync(file(root), JSON.stringify({ screen, steps, at: new Date().toISOString() }, null, 2));
}

export function readLastDo(root: string): LastDo | undefined {
  try {
    return JSON.parse(readFileSync(file(root), 'utf8')) as LastDo;
  } catch {
    return undefined;
  }
}
