/**
 * A failed model call as a plain sentence a person can act on, never containing the key.
 *
 * The services' own error texts are deliberately NOT passed on: OpenAI's "Incorrect API key
 * provided: sk-abc...xyz" quotes part of the key, and any text from a service could. Each code has
 * a fixed sentence written here; the only things taken from a failure are its HTTP status and a
 * few known words of its body (read, never shown). Mapping an AI SDK error to a code is in
 * `call.ts` (`toModelCallError`), the one module that imports the SDK.
 */
import { ModelCallError, type ModelCallErrorCode, type ServiceInfo } from './types';

/** The sentence for each code; `{name}` is the service's name, `{model}` the model id. */
export const SENTENCES: Readonly<Record<ModelCallErrorCode, string>> = {
  no_key: 'No {name} key is set. Add yours in Settings.',
  bad_key: '{name} refused the key. Check it in Settings, or paste a new one.',
  no_credit: '{name} says the account behind this key has no credit left. Add credit in your {name} account, then try again.',
  rate_limit: '{name} is limiting how fast this key can be used. Wait a minute, then try again.',
  model: '{name} does not offer the model "{model}" to this key. Pick another model in Settings.',
  busy: '{name} is busy or failing at the moment. Try again in a few minutes.',
  network: 'Could not reach {name}. Check your connection, then try again.',
  cut_off: 'The reply from {name} was cut off before it finished, so it was not used.',
  declined: '{name} declined to answer this request.',
  failed: 'The call to {name} failed.',
};

/** The error for a code, as its fixed sentence. */
export function plainError(
  code: ModelCallErrorCode,
  info: Pick<ServiceInfo, 'name'>,
  { model = '', status }: { model?: string; status?: number } = {},
): ModelCallError {
  const sentence = SENTENCES[code].replaceAll('{name}', info.name).replaceAll('{model}', model);
  const withStatus = code === 'failed' && status ? `${sentence} It answered ${status}.` : sentence;
  return new ModelCallError(code, withStatus, status);
}

/** Which code an HTTP status and response body mean. The body is read for a few known words only. */
export function codeFor(status: number | undefined, body: string): ModelCallErrorCode {
  const said = body.toLowerCase();
  if (status === undefined) return 'network';
  if (status === 401) return 'bad_key';
  // Google answers a bad key with 400 and API_KEY_INVALID.
  if (said.includes('api_key_invalid') || said.includes('api key not valid')) return 'bad_key';
  if (status === 402 || said.includes('credit balance') || said.includes('insufficient_quota') || said.includes('billing')) return 'no_credit';
  if (status === 403) return 'bad_key'; // a key without permission for this use
  if (status === 404 || said.includes('model_not_found') || (status === 400 && said.includes('model:'))) return 'model';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'busy'; // 529 is Anthropic's "overloaded"
  return 'failed';
}
