/** Google (Gemini), called from the page with the person's own key. */
import type { Driver } from './driver';

export const google: Driver = {
  async languageModel(apiKey, model, { fetch } = {}) {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    return createGoogleGenerativeAI({ apiKey, fetch })(model);
  },
};
