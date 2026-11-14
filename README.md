# byok

Bring your own AI keys, in a browser app: the person picks an AI service and a model, pastes their own API key, and the app calls the service straight from their browser with it.

byok gives you four things that every app doing this writes for itself:

- **A settings schema** (Zod): per capability, which service and which model, plus one secret key per service. Mount it in your app's settings, or use byok's own.
- **The call**: settings in, a `(prompt) => Promise<string>` out, with errors a person can act on ("Anthropic refused the key. Check it in Settings, or paste a new one.") that never contain the key.
- **A cost estimate** before a run, from a stated price, and "cost not estimated" rather than $0 when there is none.
- **A key field** (React) that never puts the key in the DOM, in React state, or in front of a password manager.

```bash
npm install byok zod
```

## Quick start

```ts
import { createByokStore } from 'byok';

const settings = createByokStore();            // kept in this browser
await settings.setKey('anthropic', pastedKey); // from your key field
await settings.save({ 'text.model': 'claude-sonnet-5-5' });

const { makeModelCall } = await import('byok/call'); // the AI SDK loads only now
const ask = await makeModelCall(settings);
const answer = await ask('Summarise this in one line: ...');
```

A settings panel, if your app has none:

```tsx
import { ByokPanel } from 'byok/react';

<ByokPanel />  // service, model and its price, the key, other keys, Undo after Forget
```

## Errors a person can act on

Every failure is a `ModelCallError` with a `code` and one fixed sentence: `no_key`, `bad_key`, `no_credit`, `rate_limit`, `model`, `busy`, `network`, `cut_off`, `declined`, `failed`. The service's own error text is never passed on, because some services quote part of the key in it. A missing key fails at once, before any request. A cancelled call (`signal`) stays an `AbortError`. `FATAL_CODES` are the ones after which retrying with the same settings cannot help.

```ts
import { ModelCallError, FATAL_CODES } from 'byok';

try {
  await ask(prompt, { signal });
} catch (e) {
  if (e instanceof ModelCallError) showToPerson(e.message);
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

byok reads its settings through one seam, `ByokSettings` (`values()` and `revealKey(service)`). Three wirings, none of which changes byok:

| Wiring | What the app does |
|---|---|
| **Own** (default) | `createByokStore()`: plain values and keys in this browser, behind zodal `DataProvider`s. |
| **Host section** | Mount byok's schema in your zodal-dials settings, `mountSection('ai', byokSchema())`, and hand byok its section: `fromSection({ read: () => sectionOf(store, 'ai', byokSchema()), secrets, prefix: 'ai' })`. Keys stay in your secret backend under `ai.keys.<service>`. |
| **Both** | Layer byok's own store under your section in your dials cascade; byok reads the resolved section the same way. |

Keys never enter the plain settings record, a form value, a log, the address or an error message, and reads give a masked `SecretRef`. What byok does not protect against, said plainly: anyone with the unlocked device and browser profile, or any script on the page, can read a key stored in this browser. Encrypting it in the same storage would not change that. Pass a different `secrets` backend (a server vault) when keys must not live on the device.

## Services and models

Anthropic, OpenAI and Google out of the box (`CATALOG`), each with a short curated model list, most capable first. Pass your own `catalog` to offer fewer services or other models. Anthropic calls carry the header `anthropic-dangerous-direct-browser-access: true`, which Anthropic requires for a call from a web page with the user's own key. OpenAI calls ask the service not to store the request.

For streaming or tool calling, take the AI SDK model and call the SDK yourself:

```ts
const { resolveModel, toModelCallError } = await import('byok/call');
const { languageModel, providerOptions, service, model } = await resolveModel(settings);
// streamText({ model: languageModel, providerOptions, tools, ... }); map failures with toModelCallError(e, service, { model: model.id })
```

## Entries

| Import | Holds | Loads |
|---|---|---|
| `byok` | schema, catalog, store, estimate, error types | zod, `@zodal/store-localstorage` |
| `byok/call` | `makeModelCall`, `modelCall`, `resolveModel`, `toModelCallError` | the AI SDK (each service's client on first use) |
| `byok/react` | `KeyField`, `OtherKeys`, `ByokPanel` | React |

The design record (seams, defaults, what is deliberately not a seam) is [docs/seams.md](docs/seams.md).

## License

Apache-2.0
