/** OpenAI, called from the page with the person's own key. */
import type { Driver } from './driver';

export const openai: Driver = {
  // Ask OpenAI not to keep the request for later retrieval.
  callOptions: { openai: { store: false } },
  async languageModel(apiKey, model, { fetch } = {}) {
    const { createOpenAI } = await import('@ai-sdk/openai');
    return createOpenAI({ apiKey, fetch })(model);
  },
};
