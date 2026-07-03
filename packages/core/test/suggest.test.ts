import { describe, it, expect } from 'vitest';
import { rankSuggestions, type SuggestionCandidate } from '../src/suggest.js';

const cand = (label: string, text: string): SuggestionCandidate => ({ label, text });

describe('rankSuggestions', () => {
  it('ranks a near-miss testid first for a typo selector', () => {
    const out = rankSuggestions('[data-testid=open-filter]', [
      cand('[data-testid=items-table]', 'items-table'),
      cand('[data-testid=open-filters]', 'open-filters'),
      cand('[data-testid=apply]', 'apply'),
    ]);
    expect(out[0]).toBe('[data-testid=open-filters]');
  });

  it('matches accessible text candidates against selector tokens', () => {
    const out = rankSuggestions('[data-testid=refund]', [
      cand('button "Cancel order"', 'Cancel order'),
      cand('button "Refund order"', 'Refund order'),
    ]);
    expect(out[0]).toBe('button "Refund order"');
  });

  it('returns nothing when no candidate is plausibly related', () => {
    const out = rankSuggestions('[data-testid=refund-modal]', [
      cand('[data-testid=nav-home]', 'nav-home'),
      cand('button "Log out"', 'Log out'),
    ]);
    expect(out).toEqual([]);
  });

  it('ignores structural selector noise (data/testid/tag names) when matching', () => {
    // "data" and "testid" must not create a match with a candidate named "test-data-grid"
    const out = rankSuggestions('[data-testid=submit-payment]', [
      cand('[data-testid=test-data-grid]', 'test-data-grid'),
      cand('[data-testid=payment-submit]', 'payment-submit'),
    ]);
    expect(out[0]).toBe('[data-testid=payment-submit]');
    expect(out).not.toContain('[data-testid=test-data-grid]');
  });

  it('caps results at the limit', () => {
    const out = rankSuggestions(
      '[data-testid=item-row]',
      [
        cand('[data-testid=item-row-1]', 'item-row-1'),
        cand('[data-testid=item-row-2]', 'item-row-2'),
        cand('[data-testid=item-row-3]', 'item-row-3'),
        cand('[data-testid=item-row-4]', 'item-row-4'),
      ],
      3,
    );
    expect(out).toHaveLength(3);
  });
});
