# Seams and surfaces

The boundaries byok v1 commits to. Later work adds at one of these; it does not move them.

## Seam table

| # | Seam | Who it is for | v1 default (no new dependency) | Replacement it was declared for |
|---|---|---|---|---|
| 1 | `settings` (`ByokSettings`): where byok reads the services offered, the choice of service and model, and the key | the end user, through the host | `createByokStore()`: byok's own store in this browser, namespace `byok` | a host section mounted with zodal-dials `mountSection`, read with `fromSection` over the host's effective values |
| 2 | `secrets` (`SecretBackend`): where keys are kept | the end user, indirectly | `deviceSecretBackend()`: this browser's storage through `@zodal/store-localstorage` | zodal-dials `providerSecretBackend` (same contract, not yet on npm: i2mint/zodal#23); a server vault over `@zodal/store-http` when keys must follow a person between devices |
| 3 | `catalog`: the services offered, their models and prices, whether custom model ids are sent | the developer | `CATALOG`: Anthropic, OpenAI, Google with short curated lists | each app's own list (apps already differ on defaults, on which services they offer, and on typed model ids). It travels with the settings, so the page and the call read the same list. |
| 4 | `Button` slot in the React parts | the developer | `DefaultButton`: pressed on pointerdown, pending with `aria-busy` / `aria-disabled`, ignores repeat presses | the app's own button with its press feedback; `@zodal/ui`'s `usePress` once published |

`config` (the `DataProvider` under the own store's plain values), `namespace` (which storage keys the own store uses) and `fetch` (the transport, for tests) are parameters too, but they are the storage seam and a test seam, not product boundaries.

**Not built: the "both" wiring** (byok's own store layered under a host section, so a key set once is overridable per app). The host's dials cascade can do it once a consumer needs it; `adoptKeys` already moves keys between the two places.

## Not seams, on purpose

- **How a service is called.** The AI SDK is already the provider abstraction. One driver file per service (`src/services/`), registered in a plain object in `call.ts`; adding a service is a driver, a line, and a catalog entry.
- **The error sentences.** Fixed, written once (`src/errors.ts`), so no service text (which can quote the key) ever reaches a person.
- **A capability registry.** v1 has one capability, `text` (a language model). Its keys are named per capability (`text.service`, `text.model`), so a second one (speech, voice, search) is an ADD of `<capability>.service` / `.model` keys, sharing the per-service `keys.<service>`.
- **Field order and labels.** In the schema's `.meta()`, read by `@zodal/dials-ui`'s `toSettingsForm`.

## Structural types shared with zodal-dials

`SecretRef`, `SecretBackend`, `makeSecretRef` and `isSecretRef` match `@zodal/dials-core` field for field, so a dials backend is accepted as is. They are declared in `src/types.ts` because the dials version that has the browser backend is not on npm yet. Once it is, they become re-exports and `deviceSecretBackend` wraps `providerSecretBackend`; no caller changes.

## Surfaces

| Surface | v1 | Would it change the core? |
|---|---|---|
| TS library (three entries: `byok`, `byok/call`, `byok/react`; `ai` 7 is an optional peer, needed by `byok/call` only) | built | n/a |
| React panel / key field | built (`byok/react`) | no: props in, callbacks out; the store is a parameter |
| Agent skill | not yet | no: every operation has a name a stranger can be told (set a key, pick a model, estimate, call) |
| CLI / MCP / HTTP | not applicable | byok is a browser component; a server-side twin would hold keys in a vault behind the same `SecretBackend` |

## v1 is done when

`npm run ci-local` passes, including the smoke test in `test/call.test.ts` ("v1 smoke"): a fresh own store, a key set, a model call that returns text through a fake transport.
