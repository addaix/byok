/**
 * One service's way of making an AI SDK language model from a key and a model id. Each driver is in
 * its own file and loads its `@ai-sdk/*` package only when a call is built, so a page that never
 * calls Google never downloads Google's client.
 */
import type { LanguageModel } from 'ai';

/** Options a service's calls always carry (the AI SDK's `providerOptions`). */
export type CallOptions = Record<string, Record<string, string | number | boolean>>;

export interface Driver {
  /** `fetch` replaces the network (tests pass a fake transport). */
  languageModel(apiKey: string, model: string, options?: { fetch?: typeof globalThis.fetch }): Promise<LanguageModel>;
  callOptions?: CallOptions;
}
