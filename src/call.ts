/**
 * The model call: turns "which service, which model, whose key" into a function, called from the
 * page straight to that service. Entry `byok/call`.
 *
 * This is the only module that imports the AI SDK (`ai`; each `@ai-sdk/*` client is loaded by its
 * driver when a call is built). A page that imports this entry lazily (`await import('byok/call')`)
 * keeps the SDK out of its first download; everything a settings page needs is in `byok`.
 *
 * The key read from the settings is sent to its own service and nowhere else: one driver per
 * service, and the registry below is a plain object, so which service gets which key is visible
 * in one place. Every failure comes back as a `ModelCallError`, a plain sentence that never
 * contains the key; a cancel stays an AbortError.
 */
import { APICallError, generateText, RetryError, type LanguageModel } from 'ai';
import { CATALOG, modelChoice, serviceInfo } from './catalog';
import { codeFor, plainError } from './errors';
import type { ByokSettings } from './store';
import { anthropic } from './services/anthropic';
import { google } from './services/google';
import { openai } from './services/openai';
import type { CallOptions, Driver } from './services/driver';
import { isAbort, ModelCallError, type Catalog, type ModelCall, type ModelChoice, type ServiceId, type ServiceInfo } from './types';

export type { CallOptions, Driver } from './services/driver';

/** Every service byok can call. Adding one: a driver file, a line here, and a catalog entry. */
export const DRIVERS: Readonly<Record<ServiceId, Driver>> = { anthropic, openai, google };

/** Any failure of a model call as a `ModelCallError` whose message never contains the key. */
export function toModelCallError(error: unknown, info: Pick<ServiceInfo, 'name'>, { model = '' }: { model?: string } = {}): ModelCallError {
  if (error instanceof ModelCallError) return error;
  // The AI SDK retries a 429 or a 5xx, then throws a RetryError holding the last failure.
  const last = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(last)) {
    return plainError(codeFor(last.statusCode, last.responseBody ?? ''), info, { model, status: last.statusCode });
  }
  // A browser reports "no network" and "refused by CORS" alike: a TypeError from fetch.
  if (last instanceof TypeError) return plainError('network', info, { model });
  return plainError('failed', info, { model });
}

export interface CallOptionsIn {
  /** The services and models offered (default: byok's catalog). */
  catalog?: Catalog;
  /** Replaces the network for every call (tests pass a fake transport). */
  fetch?: typeof globalThis.fetch;
}

/** One concrete choice: a service, a model id ('' for its default) and the key. */
export interface KeyedChoice {
  service: ServiceId;
  model: string;
  apiKey: string;
}

/** A language model ready for the AI SDK, with what it was built from (never the key). */
export interface ResolvedModel {
  service: ServiceInfo;
  model: ModelChoice;
  languageModel: LanguageModel;
  /** Pass as `providerOptions` to `generateText` / `streamText`. */
  providerOptions: CallOptions | undefined;
}

function driverFor(service: ServiceId): Driver {
  const driver = DRIVERS[service];
  if (!driver) throw new Error(`byok: no driver for the service "${String(service)}"`);
  return driver;
}

/** Checks the key at once (a `no_key` error before any request) and names the model to send. */
function prepare(choice: KeyedChoice, catalog: Catalog) {
  const info = serviceInfo(choice.service, catalog);
  const driver = driverFor(choice.service);
  const apiKey = choice.apiKey.trim();
  if (!apiKey) throw plainError('no_key', info);
  return { info, driver, apiKey, model: modelChoice(choice.service, choice.model, catalog) };
}

/**
 * The AI SDK language model for a choice, for apps that call the SDK themselves (streaming, tool
 * calling). Map their failures with `toModelCallError(error, resolved.service, { model })`.
 */
export async function resolveChoice(choice: KeyedChoice, { catalog = CATALOG, fetch }: CallOptionsIn = {}): Promise<ResolvedModel> {
  const { info, driver, apiKey, model } = prepare(choice, catalog);
  const languageModel = await driver.languageModel(apiKey, model.id, { fetch });
  return { service: info, model, languageModel, providerOptions: driver.callOptions };
}

/** Reads the chosen service, model and key from the settings. */
async function choiceFrom(settings: ByokSettings): Promise<KeyedChoice> {
  const values = await settings.values();
  const service = values['text.service'];
  return { service, model: values['text.model'], apiKey: await settings.revealKey(service) };
}

/** `resolveChoice` for what the settings say (their catalog unless `options.catalog` is given). */
export async function resolveModel(settings: ByokSettings, options: CallOptionsIn = {}): Promise<ResolvedModel> {
  return resolveChoice(await choiceFrom(settings), { catalog: settings.catalog, ...options });
}

export interface ModelCallOptions extends CallOptionsIn {
  /** How often the AI SDK retries a rate limit or a server error before giving up (its default is 2). */
  maxRetries?: number;
  /** The cap on one reply, fixed or by prompt (default: the model's own limit). */
  maxOutputTokens?: number | ((prompt: string) => number);
  /** Provider options merged over the driver's (`{ anthropic: { effort: 'low' } }`). */
  providerOptions?: CallOptions;
  /**
   * Called once for every call the service answered, with the token usage it reported (thinking
   * tokens included in `outputTokens`), so a host can sum it and price it with `costOf`. That
   * includes a reply that is then refused here (cut off at the cap, declined, empty): the service
   * billed it all the same. Not called when no answer came (a network failure, a refusal such as a
   * bad key or a rate limit, a cancel). A service that reports none counts as 0. Absent: nothing changes.
   */
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

function mergeOptions(base: CallOptions | undefined, extra: CallOptions | undefined): CallOptions | undefined {
  if (!base) return extra;
  if (!extra) return base;
  const out: CallOptions = { ...base };
  for (const [name, opts] of Object.entries(extra)) out[name] = { ...base[name], ...opts };
  return out;
}

/**
 * The model function for a choice. Throws a `ModelCallError` ('no_key') at once when there is no
 * key, so a page can say so before any work starts; every later failure is a `ModelCallError`
 * too, except a cancel, which stays an AbortError.
 */
export function modelCall(choice: KeyedChoice, options: ModelCallOptions = {}): ModelCall {
  const { catalog = CATALOG, fetch, maxRetries = 2, maxOutputTokens, providerOptions, onUsage } = options;
  const { info, driver, apiKey, model } = prepare(choice, catalog);
  let languageModel: Promise<LanguageModel> | undefined;
  const load = () => {
    // Built on first use, and built again after a failed load (a flaky chunk download) rather
    // than failing every later call.
    languageModel ??= driver.languageModel(apiKey, model.id, { fetch }).catch((error: unknown) => {
      languageModel = undefined;
      throw error;
    });
    return languageModel;
  };
  const fail = (code: 'cut_off' | 'declined' | 'failed') => plainError(code, info, { model: model.id });
  return async (prompt, { signal } = {}) => {
    try {
      const { text, finishReason, usage } = await generateText({
        model: await load(),
        prompt,
        abortSignal: signal,
        maxRetries,
        maxOutputTokens: typeof maxOutputTokens === 'function' ? maxOutputTokens(prompt) : maxOutputTokens,
        providerOptions: mergeOptions(driver.callOptions, providerOptions),
      });
      // The service answered, so it billed the call, whatever the answer is worth: its usage is
      // reported before the reply is judged.
      onUsage?.({ inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 });
      // Only a reply that finished is handed back. One that hit the cap is half an answer, a
      // declined one is no answer, and the rest ('error', 'interrupted', 'other') are failures,
      // however much text came with them.
      if (finishReason === 'length') throw fail('cut_off');
      if (finishReason === 'content-filter') throw fail('declined');
      if (finishReason !== 'stop' || !text.trim()) throw fail('failed'); // an empty reply is no answer either
      return text;
    } catch (error) {
      if (isAbort(error)) throw error;
      // Cancelled while a failure was arriving: still a cancel, and never the raw SDK error,
      // which carries the service's response body (it can quote the key).
      if (signal?.aborted) throw new DOMException('The call was cancelled.', 'AbortError');
      throw toModelCallError(error, info, { model: model.id });
    }
  };
}

/** The model function for what the settings say (reads them once, now; their catalog unless given). */
export async function makeModelCall(settings: ByokSettings, options: ModelCallOptions = {}): Promise<ModelCall> {
  return modelCall(await choiceFrom(settings), { catalog: settings.catalog, ...options });
}
