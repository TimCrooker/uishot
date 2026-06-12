import { describe, it, expect } from 'vitest';
import { parseManifest, ManifestError } from '../src/manifest.js';

const VALID = `
app:
  baseUrl: \${TEST_APP_URL}
  defaultSizes: [sm, lg]
viewports:
  sm: 390x844
  lg: 1440x900
sessions:
  default:
    loginRoute: /login.html
    recipe:
      - fill: ["#email", "a@b.c"]
      - click: "button[type=submit]"
      - waitFor: "[data-testid=app-shell]"
screens:
  items.list:
    route: /items.html
    feature: items
    readyWhen: "[data-testid=items-table]"
    states:
      filters-open:
        - click: "[data-testid=open-filters]"
        - waitFor: "[role=dialog]"
`;

describe('parseManifest', () => {
  it('parses a valid manifest with env substitution', () => {
    const m = parseManifest(VALID, { TEST_APP_URL: 'http://127.0.0.1:4799' });
    expect(m.baseUrl).toBe('http://127.0.0.1:4799');
    expect(m.viewports.sm).toEqual({ name: 'sm', width: 390, height: 844 });
    expect(m.screens['items.list']!.states['filters-open']![0]).toEqual({
      action: 'click',
      selector: '[data-testid=open-filters]',
    });
    expect(m.sessions.default!.recipe![0]).toEqual({ action: 'fill', selector: '#email', value: 'a@b.c' });
  });

  it('fails loudly on missing env var, naming the variable', () => {
    expect(() => parseManifest(VALID, {})).toThrowError(/TEST_APP_URL/);
  });

  it('fails on malformed viewport string', () => {
    expect(() => parseManifest(VALID.replace('390x844', 'huge'), { TEST_APP_URL: 'x' })).toThrowError(
      ManifestError,
    );
  });

  it('rejects unknown step actions with the offending key in the message', () => {
    const bad = VALID.replace('click: "[data-testid=open-filters]"', 'clickHard: "[x]"');
    expect(() => parseManifest(bad, { TEST_APP_URL: 'x' })).toThrowError(/clickHard/);
  });

  it('caps waitMs at 5000', () => {
    const m = parseManifest(VALID.replace('- waitFor: "[role=dialog]"', '- waitMs: 99999'), {
      TEST_APP_URL: 'x',
    });
    expect(m.screens['items.list']!.states['filters-open']![1]).toEqual({ action: 'waitMs', value: '5000' });
  });

  it('rejects defaultSizes referencing unknown viewports', () => {
    expect(() => parseManifest(VALID.replace('[sm, lg]', '[sm, xl]'), { TEST_APP_URL: 'x' })).toThrowError(
      /xl/,
    );
  });

  it('strips trailing slash from baseUrl', () => {
    const m = parseManifest(VALID, { TEST_APP_URL: 'http://x/' });
    expect(m.baseUrl).toBe('http://x');
  });
});
