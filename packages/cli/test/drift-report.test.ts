import { describe, it, expect } from 'vitest';
import { parseManifest } from '@uishot/core';
import { computeDrift, driftSnippet } from '../src/drift-report.js';

const manifest = parseManifest(
  `
app:
  baseUrl: http://x
  defaultSizes: [lg]
viewports:
  lg: 1440x900
sessions: {}
screens:
  items:
    route: /items
    feature: items
  items.detail:
    route: /items/42
    feature: items
  ghost:
    route: /removed-page
    feature: legacy
`,
  {},
);

const discovered = {
  static: [
    { id: 'items', route: '/items' },
    { id: 'orders', route: '/orders' },
    { id: 'settings.billing', route: '/settings/billing' },
  ],
  param: ['/items/$id', '/orders/$orderId'],
};

describe('computeDrift', () => {
  const report = computeDrift(manifest, discovered);

  it('finds routes with no covering screen', () => {
    expect(report.uncovered).toEqual([
      { id: 'orders', route: '/orders' },
      { id: 'settings.billing', route: '/settings/billing' },
    ]);
  });

  it('treats a representative-id screen as covering its param route', () => {
    // /items/42 covers /items/$id; /orders/$orderId remains uncovered
    expect(report.uncoveredParam).toEqual(['/orders/$orderId']);
  });

  it('flags screens whose route no longer exists', () => {
    expect(report.orphaned).toEqual([{ id: 'ghost', route: '/removed-page' }]);
  });

  it('emits a pasteable YAML snippet', () => {
    expect(driftSnippet(report.uncovered)).toContain('settings.billing:');
    expect(driftSnippet(report.uncovered)).toContain('route: /settings/billing');
    expect(driftSnippet(report.uncovered)).toContain('feature: settings');
  });

  it('reports clean when everything is covered', () => {
    const clean = computeDrift(manifest, {
      static: [
        { id: 'items', route: '/items' },
        { id: 'removed-page', route: '/removed-page' },
      ],
      param: ['/items/$id'],
    });
    expect(clean).toEqual({ uncovered: [], uncoveredParam: [], orphaned: [] });
  });
});
