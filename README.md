# byok

Bring your own AI keys, for browser apps: the person picks an AI service and a model, pastes their own API key, and your web app calls the service straight from their browser with it, with no backend of yours in between.

For developers of web apps that make AI calls client-side. Server-side key platforms (`@byok-sdk/*`) and browser-extension kits (`@amenophis1er/byok`) solve neighbouring problems; byok is a settings section you mount in a web app's own settings, over [Vercel's AI SDK](https://ai-sdk.dev) (`ai`).

It gives you four things such apps usually write themselves:

- **A settings schema** ([Zod](https://zod.dev)): per capability, which service and which model, plus one secret key per service. Mount it in your app's settings, or use byok's own store and panel.
- **The call**: settings in, `(prompt) => Promise<string>` out, with errors a person can act on ("Anthropic refused the key. Check it in Settings, or paste a new one.") whose text never includes the key.
- **A cost estimate** before a run, from a stated price; "cost not estimated" rather than $0 when there is none.
- **A key field** (React) that keeps the key out of DOM attributes, the page's HTML and React state, and asks password managers not to save it ([the tests](test/react.test.tsx)).

```bash
npm install byok zod ai
```

## Quick start

```ts
import { createByokStore } from 'byok';
import { makeModelCall } from 'byok/call';

const settings = createByokStore();            // kept in this browser
await settings.setKey('anthropic', pastedKey); // from your key field
await settings.save({ 'text.model': 'claude-sonnet-5-5' });

const ask = await makeModelCall(settings);
const answer = await ask('Summarise this in one line: ...');
```

`byok/call` is the only entry that loads the AI SDK; import it lazily (`await import('byok/call')`) to keep the SDK out of your first download.

A settings panel, if your app has none:

```tsx
import { ByokPanel } from 'byok/react';

<ByokPanel />  // service, model and its price, the key, other keys, Undo after Forget
```

Each service's default model is the first in its list, the most capable, which is also the most expensive (Claude Opus for Anthropic). Save a `text.model`, or pass a catalog that lists a cheaper model first.

## Errors a person can act on

Every failure is a `ModelCallError` with a `code` and one fixed sentence: `no_key`, `bad_key`, `no_credit`, `rate_limit`, `model`, `busy`, `network`, `cut_off`, `declined`, `failed`. The service's own error text is never passed on, because some services quote part of the key in it. A missing key fails at once, before any request. A cancelled call (`signal`) is an `AbortError`. `FATAL_CODES` are the ones after which retrying with the same settings cannot help. `isModelCallError(e)` checks by name and code, for code that may see two copies of byok.

```ts
import { isModelCallError } from 'byok';

try {
  await ask(prompt, { signal });
} catch (e) {
  if (isModelCallError(e)) showToPerson(e.message);
}
```

## Cost before a run

byok does the arithmetic and the wording; your app knows the shape of its run.

```ts
import { estimate, formatCost, modelChoice } from 'byok';

const model = modelChoice('anthropic', '');                       // the service's default
const figure = estimate({ inputWords: 90_000, outputTokens: 4_000 }, model);
`About ${figure.words} words, ${formatCost(figure.cost)}`;        // "... about $0.55" or "cost not estimated"
```

## Where the settings live

byok reads its settings through one seam, `ByokSettings` (`catalog`, `values()`, `revealKey(service)`). Two wirings, neither of which changes byok:

| Wiring | What the app does |
|---|---|
| **Own** (default) | `createByokStore()`: plain values and keys in this browser, behind [zodal](https://github.com/i2mint/zodal) `DataProvider`s, under the `byok` namespace. Apps on one site that keep the default share the keys, so a person sets a key once; pass `namespace` to keep an app's own. |
| **Host section** | Mount byok's schema in your [zodal-dials](https://github.com/i2mint/zodal-dials) settings, `mountSection('ai', byokSchema())`, and hand byok your effective values: `fromSection({ effective: () => store.getState().effective, secrets, prefix: 'ai' })`. Keys stay in your secret backend under `ai.keys.<service>`. |

`adoptKeys` moves keys from an older place (an app's previous storage, or byok's own store when moving to a host section) without overwriting a key already set.

Keys never enter the plain settings record, a form value, a log, the address or an error message, and reads give a masked `SecretRef`. What byok does not protect against: anyone with the unlocked device and browser profile, any script on the page, and any other page of the same site can read a key stored in this browser. Encrypting it in the same storage would not change that. Pass a different `secrets` backend (a server vault), with `where` saying where it keeps them, when keys must not live on the device.

## Services and models

Anthropic, OpenAI and Google out of the box (`CATALOG`), each with a short curated model list, most capable first. Pass your own `catalog` to offer fewer services or other models; set `customModels: true` on a service to send ids that are not in its list. Anthropic calls carry the header `anthropic-dangerous-direct-browser-access: true`, which Anthropic requires for a call from a web page with the person's own key. OpenAI calls ask OpenAI not to keep the request for later retrieval (`store: false`); OpenAI's own retention policy still applies.

For streaming or tool calling, take the AI SDK model and call the SDK yourself:

```ts
const { resolveModel, toModelCallError } = await import('byok/call');
const { languageModel, providerOptions, service, model } = await resolveModel(settings);
// streamText({ model: languageModel, providerOptions, tools, ... }); map failures with toModelCallError(e, service, { model: model.id })
```

## Entries

| Import | Holds | Needs |
|---|---|---|
| `byok` | schema, catalog, store, estimate, error types | `zod` |
| `byok/call` | `makeModelCall`, `modelCall`, `resolveModel`, `toModelCallError` | `ai` 7 (each service's client loads on first use) |
| `byok/react` | `KeyField`, `OtherKeys`, `ByokPanel` | `react` |

The design record (seams, defaults, what is deliberately not a seam) is [docs/seams.md](docs/seams.md).

## License

Apache-2.0
