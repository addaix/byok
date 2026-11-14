/** The cost estimate: a figure only from a stated price, never $0 for an unknown one. */
import { describe, expect, it } from 'vitest';
import { ANTHROPIC, costOf, estimate, formatCost, formatDollars, OPENAI, priceLine, roundWords, sentWords, TOKENS_PER_WORD, wordCount } from '../src';

const opus = ANTHROPIC.models[0]!;
const gpt = OPENAI.models[0]!;

describe('estimate', () => {
  it('prices tokens, or words at about 1.3 tokens each, on the model', () => {
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, opus)).toBe(24);
    expect(costOf({ inputWords: 1_000_000 }, opus)).toBeCloseTo(4 * TOKENS_PER_WORD);
    expect(estimate({ inputWords: 10_000, outputTokens: 500 }, opus)).toEqual({ words: 10_000, cost: (10_000 * 1.3 * 4 + 500 * 20) / 1e6 });
  });

  it('says "cost not estimated" for a model without a price, never $0', () => {
    expect(costOf({ inputWords: 1000 }, gpt)).toBeNull();
    expect(formatCost(null)).toBe('cost not estimated');
    expect(sentWords({ words: 81_200, replyWords: 300, model: gpt })).toBe('Sent about 81,000 words (cost not estimated)');
    expect(priceLine(gpt)).toMatch(/No price is known/);
    expect(priceLine(opus)).toBe('$4 per million tokens sent, $20 per million in replies.');
  });

  it('rounds for a person: words to the thousand, dollars to two significant figures', () => {
    expect(roundWords(91_600)).toBe('92,000');
    expect([0.4812, 2.31, 13.4, 0.01234, 0].map(formatDollars)).toEqual(['$0.48', '$2.3', '$13', '$0.012', '$0']);
    expect(wordCount('  three  little words\n')).toBe(3);
  });
});
