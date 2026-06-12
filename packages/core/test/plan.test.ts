import { describe, it, expect } from 'vitest';
import { resolveTargets } from '../src/plan.js';
import { parseManifest } from '../src/manifest.js';

const YAML = `
app:
  baseUrl: \${TEST_APP_URL}
  defaultSizes: [sm, lg]
viewports:
  sm: 390x844
  lg: 1440x900
sessions:
  default:
    loginRoute: /login.html
screens:
  items.list:
    route: /items.html
    feature: items
    readyWhen: "[data-testid=items-table]"
    states:
      filters-open:
        - click: "[data-testid=open-filters]"
        - waitFor: "[role=dialog]"
  orders.detail:
    route: /orders.html
    feature: orders
    states:
      refund-modal:
        - click: "[data-testid=refund]"
        - waitFor: "[role=dialog]"
`;

const manifest = parseManifest(YAML, { TEST_APP_URL: 'http://x' });

describe('resolveTargets', () => {
  it('screen id -> base state at default sizes', () => {
    const t = resolveTargets(manifest, { screen: 'items.list' });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ screenId: 'items.list', state: 'base', steps: [], session: 'default' });
    expect(t[0]!.sizes.map((v) => v.name)).toEqual(['sm', 'lg']);
  });

  it('named state pulls recipe steps', () => {
    const t = resolveTargets(manifest, { screen: 'items.list', state: 'filters-open' });
    expect(t[0]!.state).toBe('filters-open');
    expect(t[0]!.steps).toHaveLength(2);
  });

  it('unknown state error lists available states', () => {
    expect(() => resolveTargets(manifest, { screen: 'items.list', state: 'nope' })).toThrowError(
      /filters-open/,
    );
  });

  it('unknown screen error lists available screens', () => {
    expect(() => resolveTargets(manifest, { screen: 'ghost' })).toThrowError(/items\.list, orders\.detail/);
  });

  it('--do appends to state steps and labels target adhoc', () => {
    const t = resolveTargets(manifest, {
      screen: 'items.list',
      state: 'filters-open',
      doSteps: [{ action: 'press', value: 'Escape' }],
    });
    expect(t[0]!.state).toBe('adhoc');
    expect(t[0]!.steps).toHaveLength(3);
  });

  it('raw route becomes an addressable adhoc target', () => {
    const t = resolveTargets(manifest, { url: '/orders/123' });
    expect(t[0]).toMatchObject({ screenId: 'route:/orders/123', route: '/orders/123', state: 'base' });
  });

  it('a /route passed as the screen arg falls through to url handling', () => {
    const t = resolveTargets(manifest, { screen: '/orders/123' });
    expect(t[0]!.route).toBe('/orders/123');
  });

  it('feature expands to base + every named state of tagged screens', () => {
    const t = resolveTargets(manifest, { feature: 'items' });
    expect(t.map((x) => `${x.screenId}/${x.state}`)).toEqual(['items.list/base', 'items.list/filters-open']);
  });

  it('unknown feature error lists available features', () => {
    expect(() => resolveTargets(manifest, { feature: 'nope' })).toThrowError(/items, orders/);
  });

  it('all expands every screen and state', () => {
    const t = resolveTargets(manifest, { all: true });
    expect(t).toHaveLength(4);
  });

  it('sizes override and unknown size errors with available names', () => {
    const t = resolveTargets(manifest, { screen: 'items.list', sizes: ['lg'] });
    expect(t[0]!.sizes.map((v) => v.name)).toEqual(['lg']);
    expect(() => resolveTargets(manifest, { screen: 'items.list', sizes: ['xl'] })).toThrowError(/sm, lg/);
  });
});
