/**
 * The services byok offers out of the box and the models each one lists: data only, no AI SDK, so
 * a settings page and an estimate load without it.
 *
 * Sources. Anthropic ids and prices: the fleet's `claude-api` skill model table (cached
 * 2026-11-03), ids written exactly as listed there. OpenAI and Google ids: the model lists the
 * installed `@ai-sdk/openai` and `@ai-sdk/google` declare. No stated source gives OpenAI's or
 * Google's prices, so those carry none and a page says "cost not estimated".
 *
 * Keeping it current: verify ids against each service's own model-list API before adding one, and
 * never persist an alias as a default.
 * An app that needs a different list passes its own catalog; this one is only the default.
 */
import type { Catalog, ModelChoice, ServiceId, ServiceInfo } from './types';

const ANTHROPIC_PRICE_SOURCE = 'claude-api skill model table, cached 2026-11-03';

export const ANTHROPIC: ServiceInfo = {
  id: 'anthropic',
  name: 'Anthropic',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  keyPlaceholder: 'sk-ant-...',
  models: [
    {
      id: 'claude-opus-5-5',
      label: 'Claude Opus 5.5',
      note: 'The most careful choice',
      price: { input_per_mtok: 4, output_per_mtok: 20, source: ANTHROPIC_PRICE_SOURCE },
    },
    {
      id: 'claude-sonnet-5-5',
      label: 'Claude Sonnet 5.5',
      note: 'About half the cost of Opus',
      price: { input_per_mtok: 2, output_per_mtok: 10, source: ANTHROPIC_PRICE_SOURCE },
    },
    {
      id: 'claude-haiku-5-5',
      label: 'Claude Haiku 5.5',
      note: 'Cheapest and fastest; may choose less well',
      price: { input_per_mtok: 0.1, output_per_mtok: 0.5, source: `${ANTHROPIC_PRICE_SOURCE} (prompts up to 100K tokens)` },
    },
  ],
};

export const OPENAI: ServiceInfo = {
  id: 'openai',
  name: 'OpenAI',
  keyUrl: 'https://platform.openai.com/api-keys',
  keyPlaceholder: 'sk-...',
  models: [
    { id: 'gpt-5.5', label: 'GPT-5.5', note: 'Most capable of these', price: null },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', note: 'Cheaper and faster', price: null },
  ],
};

export const GOOGLE: ServiceInfo = {
  id: 'google',
  name: 'Google',
  keyUrl: 'https://aistudio.google.com/apikey',
  keyPlaceholder: 'AIza...',
  models: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', note: 'Fast, and cheaper', price: null },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)', note: 'More capable; a preview', price: null },
  ],
};

/** The default catalog: every service byok can call, Anthropic first. */
export const CATALOG: Catalog = { anthropic: ANTHROPIC, openai: OPENAI, google: GOOGLE };

/** The ids a catalog offers, in its order. */
export const servicesOf = (catalog: Catalog): ServiceId[] => Object.keys(catalog) as ServiceId[];

/** A service's entry; throws, naming the service, when the catalog does not offer it. */
export function serviceInfo(service: ServiceId, catalog: Catalog = CATALOG): ServiceInfo {
  const info = catalog[service];
  if (!info) throw new Error(`byok: the catalog does not offer the service "${String(service)}"`);
  return info;
}

/**
 * The model a setting names, or the service's default (its first) when it names none or one that
 * is not in this service's list: a model id left over from another service is never sent.
 */
export function modelChoice(service: ServiceId, model: string, catalog: Catalog = CATALOG): ModelChoice {
  const { models } = serviceInfo(service, catalog);
  return models.find((m) => m.id === model) ?? models[0]!;
}
