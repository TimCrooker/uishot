import { describe, it, expect } from 'vitest';
import { parseDo } from '../src/do-parser.js';

describe('parseDo', () => {
  it('parses selector actions', () => {
    expect(parseDo('click:[data-testid=refund]')).toEqual({
      action: 'click',
      selector: '[data-testid=refund]',
    });
    expect(parseDo('waitFor:[role=dialog]')).toEqual({ action: 'waitFor', selector: '[role=dialog]' });
    expect(parseDo('hover:.row')).toEqual({ action: 'hover', selector: '.row' });
    expect(parseDo('scrollTo:#footer')).toEqual({ action: 'scrollTo', selector: '#footer' });
  });

  it('splits fill/select on the LAST equals', () => {
    expect(parseDo('fill:[data-testid=qty]=3')).toEqual({
      action: 'fill',
      selector: '[data-testid=qty]',
      value: '3',
    });
    expect(parseDo('select:#status=shipped')).toEqual({
      action: 'select',
      selector: '#status',
      value: 'shipped',
    });
  });

  it('parses value actions', () => {
    expect(parseDo('press:Enter')).toEqual({ action: 'press', value: 'Enter' });
    expect(parseDo('waitMs:300')).toEqual({ action: 'waitMs', value: '300' });
    expect(parseDo('goto:/orders/123')).toEqual({ action: 'goto', value: '/orders/123' });
  });

  it('caps waitMs at 5000', () => {
    expect(parseDo('waitMs:99999')).toEqual({ action: 'waitMs', value: '5000' });
  });

  it('parses storage seeds', () => {
    expect(parseDo('storage:chat-sidebar-collapsed=false')).toEqual({
      action: 'storage',
      selector: 'chat-sidebar-collapsed',
      value: 'false',
    });
  });

  it('rejects unknown actions with available vocabulary in the message', () => {
    expect(() => parseDo('tap:#x')).toThrowError(/tap.*goto, click, fill/s);
  });

  it('rejects fill without a value', () => {
    expect(() => parseDo('fill:#email')).toThrowError(/fill:SELECTOR=VALUE/);
  });

  it('rejects input without a colon', () => {
    expect(() => parseDo('click')).toThrowError(/ACTION:ARG/);
  });
});
