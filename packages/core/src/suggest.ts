/**
 * Near-miss suggestion scoring for failed selectors. Pure: the daemon harvests
 * candidates from the live DOM; this ranks them against the selector the agent
 * asked for, so a failure message can answer "did you mean…?".
 */

export interface SuggestionCandidate {
  /** How an agent would address the element, e.g. `[data-testid=refund-button]` or `button "Refund order"`. */
  label: string;
  /** Raw text to match against: the testid value or the accessible text. */
  text: string;
}

/** Selector plumbing that carries no intent about the target element. */
const NOISE = new Set([
  'data', 'testid', 'test', 'id', 'class', 'aria', 'role', 'label', 'text',
  'button', 'div', 'span', 'input', 'select', 'a', 'nth', 'has', 'visible',
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !NOISE.has(t));
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** Dice coefficient over character bigrams; 1 for identical tokens. */
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.size === 0 || bb.size === 0) return 0;
  let common = 0;
  for (const g of ba) if (bb.has(g)) common++;
  return (2 * common) / (ba.size + bb.size);
}

const SCORE_FLOOR = 0.45;

/**
 * Rank candidates by how well they match the intent tokens of a failed
 * selector. Score = mean over the selector's tokens of the best-matching
 * candidate token. Candidates below the floor are dropped entirely — a wrong
 * suggestion is worse than none.
 */
export function rankSuggestions(
  failedSelector: string,
  candidates: SuggestionCandidate[],
  limit = 3,
): string[] {
  const want = tokens(failedSelector);
  if (want.length === 0) return [];
  const scored = candidates
    .map((c) => {
      const have = tokens(c.text);
      if (have.length === 0) return { label: c.label, score: 0 };
      const score =
        want.reduce((sum, w) => sum + Math.max(...have.map((h) => tokenSimilarity(w, h))), 0) /
        want.length;
      return { label: c.label, score };
    })
    .filter((s) => s.score >= SCORE_FLOOR)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.label);
}
