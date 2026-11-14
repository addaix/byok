/**
 * What a request will cost on the person's key, said before it runs.
 *
 * byok owns the arithmetic and the wording; the app owns the shape of its run (how many prompts,
 * how long each one is, how long a reply may be) and passes the totals here. A cost is given only
 * when the chosen model has a price from a stated source; otherwise it is null and a page says
 * "cost not estimated", never $0. Figures are rounded on the page (words to the thousand, dollars
 * to two significant figures): they are estimates, not quotes.
 */
import type { ModelChoice } from './types';

/** A rough rule for English text: a token is about three quarters of a word. */
export const TOKENS_PER_WORD = 1.3;

/** What is sent and received, in words or tokens (tokens win when both are given). */
export interface Usage {
  inputWords?: number;
  inputTokens?: number;
  outputWords?: number;
  outputTokens?: number;
}

export interface Figure {
  /** Words sent to the model. */
  words: number;
  /** US dollars, text sent and replies; null when the model has no known price (never 0 for unknown). */
  cost: number | null;
}

const tokens = (t: number | undefined, w: number | undefined) => t ?? (w ?? 0) * TOKENS_PER_WORD;

/** Dollars for a usage on a model, or null when the model has no price. */
export function costOf(usage: Usage, model: Pick<ModelChoice, 'price'>): number | null {
  const price = model.price;
  if (!price) return null;
  const input = tokens(usage.inputTokens, usage.inputWords);
  const output = tokens(usage.outputTokens, usage.outputWords);
  return (input * price.input_per_mtok + output * price.output_per_mtok) / 1_000_000;
}

/** A usage as a `Figure`: the words sent, and the cost (or null). */
export function estimate(usage: Usage, model: Pick<ModelChoice, 'price'>): Figure {
  const words = usage.inputWords ?? Math.round((usage.inputTokens ?? 0) / TOKENS_PER_WORD);
  return { words, cost: costOf(usage, model) };
}

/** Words to the nearest thousand, as written: "92,000" (no false precision). */
export function roundWords(words: number): string {
  return (Math.round(words / 1000) * 1000).toLocaleString('en-US');
}

/** Dollars to two significant figures: "$0.48", "$2.3", "$13", "$0.012". */
export function formatDollars(dollars: number): string {
  if (!(dollars > 0)) return '$0';
  const digits = Math.max(0, 1 - Math.floor(Math.log10(dollars)));
  return `$${dollars.toFixed(digits)}`;
}

/** A cost as a page says it: "about $0.48", or "cost not estimated" without a price. */
export const formatCost = (cost: number | null): string => (cost === null ? 'cost not estimated' : `about ${formatDollars(cost)}`);

/** After a run: "Sent about 81,000 words (about $0.32)", or "(cost not estimated)" without a price. */
export function sentWords({ words, replyWords, model }: { words: number; replyWords: number; model: Pick<ModelChoice, 'price'> }): string {
  return `Sent about ${roundWords(words)} words (${formatCost(costOf({ inputWords: words, outputWords: replyWords }, model))})`;
}

/** Words in a text (for "sent about N words"). */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The price of a model as one help line, or what a page says without one. */
export function priceLine(model: Pick<ModelChoice, 'price'>): string {
  const p = model.price;
  return p
    ? `$${p.input_per_mtok} per million tokens sent, $${p.output_per_mtok} per million in replies.`
    : 'No price is known here for this model, so a request shows "cost not estimated".';
}
