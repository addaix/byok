/** Test helpers: a fake network, and byok's own store kept in memory. */
import { createInMemoryProvider } from '@zodal/store';
import { createByokStore, IN_THIS_BROWSER, type SecretRecord, type ValuesRecord } from '../src';
import { dataProviderSecretBackend } from '../src/store';

export interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fetch that records each request and answers with `respond`'s status and body (or throws its error). */
export function fakeTransport(respond: (sent: Sent) => { status: number; body: unknown } | Error) {
  const sent: Sent[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => (headers[name] = value));
    const request = { url: String(input), headers, body: JSON.parse(String(init?.body ?? '{}')) };
    sent.push(request);
    const answer = respond(request);
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

export const anthropicReply = (text: string, stop_reason = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }],
  stop_reason, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 3 },
});

/** byok's own store over in-memory providers; `config` and `secretsProvider` are exposed for inspection. */
export function memoryStore() {
  const config = createInMemoryProvider<ValuesRecord>([]);
  const secretsProvider = createInMemoryProvider<SecretRecord>([]);
  const secrets = dataProviderSecretBackend(secretsProvider);
  // Stands in for the browser's own store, so it says what that store says.
  return { store: createByokStore({ config, secrets, where: IN_THIS_BROWSER }), config, secretsProvider, secrets };
}
