/**
 * Anthropic (Claude), called from the page with the person's own key.
 *
 * Anthropic refuses calls from a web page unless the request says it knows the key is exposed to
 * that page: the header `anthropic-dangerous-direct-browser-access: true`. That is the point of
 * bring-your-own-key (the key is the person's own, on their own device), so it is sent.
 */
import type { Driver } from './driver';

export const anthropic: Driver = {
  async languageModel(apiKey, model, { fetch } = {}) {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    return createAnthropic({ apiKey, fetch, headers: { 'anthropic-dangerous-direct-browser-access': 'true' } })(model);
  },
};
