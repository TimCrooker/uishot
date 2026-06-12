import { describe, it, expect } from 'vitest';
import { parseManifest } from 'uishot-core';
import { promoteIntoYaml } from '../src/promote-yaml.js';

const YAML = `# my manifest comment
app:
  baseUrl: http://x
  defaultSizes: [lg]
viewports:
  lg: 1440x900
sessions: {}
screens:
  items.list:
    route: /items
    feature: items
`;

describe('promoteIntoYaml', () => {
  it('inserts a named state that round-trips through parseManifest', () => {
    const out = promoteIntoYaml(YAML, 'items.list', 'filters-open', [
      { action: 'click', selector: '[data-testid=open-filters]' },
      { action: 'fill', selector: '#qty', value: '3' },
      { action: 'storage', selector: 'panel-open', value: 'true' },
      { action: 'waitMs', value: '500' },
    ]);
    const m = parseManifest(out, {});
    expect(m.screens['items.list']!.states['filters-open']).toEqual([
      { action: 'click', selector: '[data-testid=open-filters]' },
      { action: 'fill', selector: '#qty', value: '3' },
      { action: 'storage', selector: 'panel-open', value: 'true' },
      { action: 'waitMs', value: '500' },
    ]);
  });

  it('preserves comments', () => {
    const out = promoteIntoYaml(YAML, 'items.list', 's', [{ action: 'click', selector: '#x' }]);
    expect(out).toContain('# my manifest comment');
  });

  it('rejects unknown screens with guidance', () => {
    expect(() => promoteIntoYaml(YAML, 'ghost', 's', [])).toThrowError(/Add the screen first/);
  });
});
