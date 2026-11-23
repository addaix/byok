/**
 * The model call with a fake transport in place of the network: the key goes to its own service
 * only, a reply comes back as text, and every failure becomes a plain sentence that never contains
 * the key. No real service is called.
 */
import { describe, expect, it } from 'vitest';
import { makeModelCall, modelCall, resolveModel, type KeyedChoice } from '../src/call';
import { FATAL_CODES, isModelCallError, ModelCallError, OPENAI } from '../src';
import { anthropicReply, fakeTransport, memoryStore, type Sent } from './helpers';

const KEY = 'sk-ant-api03-SECRETSECRETSECRET-1234';
const OPENAI_KEY = 'sk-proj-SECRETSECRETSECRET-5678';
const GOOGLE_KEY = 'AIzaSECRETSECRETSECRET-9012';
const anthropicChoice: KeyedChoice = { service: 'anthropic', model: '', apiKey: KEY };

/** The error a call ends in. */
async function failure(choice: KeyedChoice, respond: (sent: Sent) => { status: number; body: unknown } | Error): Promise<ModelCallError> {
  const { fetch } = fakeTransport(respond);
  try {
    await modelCall(choice, { fetch, maxRetries: 0 })('hello');
  } catch (error) {
    return error as ModelCallError;
  }
  throw new Error('the call did not fail');
}

describe('modelCall onUsage', () => {
  it('reports the real usage once per call the service answered, a refused reply included, and never when no answer came', async () => {
    const seen: Array<{ inputTokens: number; outputTokens: number }> = [];
    const ok = fakeTransport(() => ({ status: 200, body: anthropicReply('hi') }));
    const call = modelCall(anthropicChoice, { fetch: ok.fetch, onUsage: (u) => seen.push(u) });
    await call('a');
    await call('b');
    expect(seen).toEqual([{ inputTokens: 12, outputTokens: 3 }, { inputTokens: 12, outputTokens: 3 }]);
    // cut off at the cap: refused here, but billed by the service, so counted
    const cut = fakeTransport(() => ({ status: 200, body: { ...anthropicReply('half', 'max_tokens'), usage: { input_tokens: 26_000, output_tokens: 4_800 } } }));
    await expect(modelCall(anthropicChoice, { fetch: cut.fetch, onUsage: (u) => seen.push(u) })('c')).rejects.toMatchObject({ code: 'cut_off' });
    expect(seen.at(-1)).toEqual({ inputTokens: 26_000, outputTokens: 4_800 });
    // no answer at all (a refused key): nothing billed, nothing reported
    const refused = fakeTransport(() => ({ status: 401, body: { error: { type: 'authentication_error', message: 'invalid x-api-key' } } }));
    await expect(modelCall(anthropicChoice, { fetch: refused.fetch, maxRetries: 0, onUsage: (u) => seen.push(u) })('d')).rejects.toThrow(ModelCallError);
    expect(seen).toHaveLength(3);
  });
});

describe('modelCall', () => {
  it('sends the prompt to Anthropic only, with the key and the browser header, and returns the text', async () => {
    const { fetch, sent } = fakeTransport(() => ({ status: 200, body: anthropicReply('hello back') }));
    expect(await modelCall(anthropicChoice, { fetch })('Say hello')).toBe('hello back');
    expect(sent).toHaveLength(1);
    expect(new URL(sent[0]!.url).origin).toBe('https://api.anthropic.com');
    expect(sent[0]!.headers['x-api-key']).toBe(KEY);
    expect(sent[0]!.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(sent[0]!.body.model).toBe('claude-opus-5-5'); // '' is the service's default
    expect(JSON.stringify(sent[0]!.body)).toContain('Say hello');
    expect(JSON.stringify(sent[0]!.body)).not.toContain(KEY); // the key is a header, never in the body
  });

  it('sends an OpenAI key to OpenAI only, and asks it not to store the request', async () => {
    const { fetch, sent } = fakeTransport(() => ({ status: 401, body: { error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } } }));
    await expect(modelCall({ service: 'openai', model: 'gpt-5.4-mini', apiKey: OPENAI_KEY }, { fetch, maxRetries: 0 })('hi')).rejects.toThrow(ModelCallError);
    expect(new URL(sent[0]!.url).origin).toBe('https://api.openai.com');
    expect(sent[0]!.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(sent[0]!.headers['x-api-key']).toBeUndefined();
    expect(sent[0]!.body.model).toBe('gpt-5.4-mini');
    expect(sent[0]!.body.store).toBe(false);
  });

  it('sends a Google key to Google only', async () => {
    const { fetch, sent } = fakeTransport(() => ({ status: 403, body: { error: { message: `API key not valid ${GOOGLE_KEY}` } } }));
    const error = await modelCall({ service: 'google', model: '', apiKey: GOOGLE_KEY }, { fetch, maxRetries: 0 })('hi').catch((e) => e);
    expect(error.code).toBe('bad_key');
    expect(new URL(sent[0]!.url).origin).toBe('https://generativelanguage.googleapis.com');
    expect(sent[0]!.url).toContain('gemini-3.5-flash');
    expect(sent[0]!.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
    expect(error.message).not.toContain('SECRET');
  });

  it("never sends another service's model id: an unknown id falls back to the service's default", async () => {
    const { fetch, sent } = fakeTransport(() => ({ status: 200, body: anthropicReply('ok') }));
    await modelCall({ ...anthropicChoice, model: 'gpt-5.5' }, { fetch })('hi');
    expect(sent[0]!.body.model).toBe('claude-opus-5-5');
  });

  it('refuses at once, before any request, when there is no key', () => {
    expect(() => modelCall({ ...anthropicChoice, apiKey: '  ' })).toThrow(/No Anthropic key is set/);
    try {
      modelCall({ ...anthropicChoice, apiKey: '' });
    } catch (error) {
      expect((error as ModelCallError).code).toBe('no_key');
      expect(FATAL_CODES.has('no_key')).toBe(true);
    }
  });

  it.each([
    ['a refused key', { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } } }, 'bad_key', /refused the key/],
    ['no credit', { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } }, 'no_credit', /no credit left/],
    ['a rate limit', { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit' } } }, 'rate_limit', /limiting how fast/],
    ['an unknown model', { status: 404, body: { type: 'error', error: { type: 'not_found_error', message: 'model: claude-nope' } } }, 'model', /does not offer the model/],
    ['an overloaded service', { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }, 'busy', /busy or failing/],
    ['something else', { status: 418, body: { message: `teapot ${KEY}` } }, 'failed', /failed\. It answered 418/],
  ])('turns %s into a plain sentence without the key', async (_what, answer, code, words) => {
    const error = await failure(anthropicChoice, () => answer);
    expect(error).toBeInstanceOf(ModelCallError);
    expect(error.code).toBe(code);
    expect(error.message).toMatch(words);
    for (const text of [error.message, JSON.stringify(error), String(error.stack ?? '')]) expect(text).not.toContain('SECRET');
  });

  it('says "no credit" for OpenAI\'s insufficient quota, and never repeats its message (which quotes the key)', async () => {
    const error = await failure({ service: 'openai', model: '', apiKey: OPENAI_KEY }, () => ({
      status: 429, body: { error: { message: `You exceeded your current quota (key ${OPENAI_KEY})`, type: 'insufficient_quota', code: 'insufficient_quota' } },
    }));
    expect(error.code).toBe('no_credit');
    expect(error.message).toBe('OpenAI says the account behind this key has no credit left. Add credit in your OpenAI account, then try again.');
  });

  it('says "could not reach" when the network fails', async () => {
    const error = await failure(anthropicChoice, () => new TypeError('Failed to fetch'));
    expect(error.code).toBe('network');
    expect(error.message).toBe('Could not reach Anthropic. Check your connection, then try again.');
  });

  it('reports a reply cut off at the cap, rather than returning half of it', async () => {
    const error = await failure(anthropicChoice, () => ({ status: 200, body: anthropicReply('{"half": ', 'max_tokens') }));
    expect(error.code).toBe('cut_off');
  });

  it('merges provider options over the driver defaults, and applies a reply cap by prompt', async () => {
    const { fetch, sent } = fakeTransport(() => ({ status: 200, body: { id: 'r', object: 'response', created_at: 1, model: 'gpt-5.5', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } } }));
    await modelCall({ service: 'openai', model: '', apiKey: OPENAI_KEY }, { fetch, maxOutputTokens: (p) => p.length * 100, providerOptions: { openai: { user: 'u1' } } })('abc').catch(() => undefined);
    expect(sent[0]!.body.store).toBe(false);
    expect(sent[0]!.body.user).toBe('u1');
    expect(sent[0]!.body.max_output_tokens).toBe(300);
  });

  it('keeps a cancel a cancel', async () => {
    const controller = new AbortController();
    let reached = false;
    const fetch = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        reached = true;
        const stop = () => reject(new DOMException('aborted', 'AbortError'));
        if (init?.signal?.aborted) stop();
        init?.signal?.addEventListener('abort', stop);
      })) as typeof globalThis.fetch;
    const call = modelCall(anthropicChoice, { fetch })('hello', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20)); // the request is under way
    expect(reached).toBe(true);
    controller.abort();
    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('the paths a review found', () => {
  it('a cancel that arrives with a failure is a clean AbortError, never the raw SDK error', async () => {
    const controller = new AbortController();
    const fetch = (async () => {
      controller.abort(); // the person cancels while the 401 is arriving
      return new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } }), { status: 401, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const error = await modelCall({ service: 'openai', model: '', apiKey: OPENAI_KEY }, { fetch, maxRetries: 0 })('hi', { signal: controller.signal }).catch((e) => e);
    expect(error.name).toBe('AbortError');
    for (const text of [String(error), JSON.stringify(error), String(error.stack ?? ''), JSON.stringify(Object.getOwnPropertyNames(error).map((k) => (error as Record<string, unknown>)[k]))]) {
      expect(text).not.toContain('SECRET');
    }
  });

  it('a reply that did not finish (Anthropic compaction, Google OTHER) is a failure, not an empty answer', async () => {
    const error = await failure(anthropicChoice, () => ({ status: 200, body: anthropicReply('', 'compaction') }));
    expect(error.code).toBe('failed');
  });

  it("Google's 400 API_KEY_INVALID is a refused key, so a run stops", async () => {
    const error = await failure({ service: 'google', model: '', apiKey: GOOGLE_KEY }, () => ({
      status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } },
    }));
    expect(error.code).toBe('bad_key');
    expect(FATAL_CODES.has(error.code)).toBe(true);
  });

  it('isModelCallError recognises the error by name and code', () => {
    const copy = Object.assign(new Error('x'), { name: 'ModelCallError', code: 'bad_key' });
    expect(isModelCallError(copy)).toBe(true);
    expect(isModelCallError(new Error('x'))).toBe(false);
  });
});

describe('from the settings', () => {
  it("uses the settings' own catalog", async () => {
    const { createByokStore } = await import('../src');
    const { config, secrets } = memoryStore();
    const store = createByokStore({ catalog: { openai: { ...OPENAI, customModels: true } }, config, secrets });
    await store.save({ 'text.model': 'gpt-5.6-terra' });
    await store.setKey('openai', OPENAI_KEY);
    const { fetch, sent } = fakeTransport(() => ({ status: 500, body: {} }));
    await (await makeModelCall(store, { fetch, maxRetries: 0 }))('hi').catch(() => undefined);
    expect(sent[0]!.body.model).toBe('gpt-5.6-terra');
  });

  it('v1 smoke: a fresh own store, a key set, a model call that returns text', async () => {
    const { store } = memoryStore();
    await store.save({ 'text.service': 'anthropic', 'text.model': 'claude-haiku-5-5' });
    await store.setKey('anthropic', `  ${KEY}  `);
    const { fetch, sent } = fakeTransport(() => ({ status: 200, body: anthropicReply('it works') }));
    const call = await makeModelCall(store, { fetch });
    expect(await call('hi')).toBe('it works');
    expect(sent[0]!.headers['x-api-key']).toBe(KEY); // trimmed when stored
    expect(sent[0]!.body.model).toBe('claude-haiku-5-5');
  });

  it("says which key is missing, before any request, when the chosen service's key is not set", async () => {
    const { store } = memoryStore();
    await store.setKey('anthropic', KEY);
    await store.save({ 'text.service': 'openai' });
    await expect(makeModelCall(store)).rejects.toThrow('No OpenAI key is set. Add yours in Settings.');
  });

  it('resolves an AI SDK model for apps that call the SDK themselves, without exposing the key', async () => {
    const { store } = memoryStore();
    await store.setKey('anthropic', KEY);
    const resolved = await resolveModel(store);
    expect(resolved.service.id).toBe('anthropic');
    expect(resolved.model.id).toBe('claude-opus-5-5');
    expect(typeof resolved.languageModel).toBe('object');
    expect(JSON.stringify({ ...resolved, languageModel: undefined })).not.toContain('SECRET');
  });
});
