# Seams and surfaces

The boundaries byok v1 commits to. Later work adds at one of these; it does not move them.

## Seam table

| # | Seam | Who it is for | v1 default (no new dependency) | Replacement it was declared for |
|---|---|---|---|---|
| 1 | `settings` (`ByokSettings`): where byok reads the service, the model and the key | the end user, through the host | `createByokStore()`: byok's own store in this browser | a host section mounted with zodal-dials `mountSection` / read with `sectionOf` (`fromSection`), or both as a dials cascade |
| 2 | `secrets` (`SecretBackend`): where keys are kept | the end user, indirectly | `deviceSecretBackend()`: this browser's storage through `@zodal/store-localstorage` | zodal-dials `providerSecretBackend` (same contract, not yet on npm: i2mint/zodal#23); a server vault over `@zodal/store-http` when keys must follow a person between devices |
| 3 | `catalog`: the services offered and their models and prices | the developer | `CATALOG`: Anthropic, OpenAI, Google with short curated lists | each app's own list (apps in the fleet already differ on defaults and on which services they offer) |
| 4 | `Button` slot in the React parts | the developer | `DefaultButton`: pressed on pointerdown, pending with `aria-busy` / `aria-disabled`, ignores repeat presses | the app's own button with its press feedback; `@zodal/ui`'s `usePress` once published |

`config` (the `DataProvider` under the own store's plain values) and `fetch` (the transport, for tests) are parameters too, but they are the storage seam and a test seam, not product boundaries.

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
| TS library (three entries: `byok`, `byok/call`, `byok/react`) | built | n/a |
| React panel / key field | built (`byok/react`) | no: props in, callbacks out; the store is a parameter |
| Agent skill | not yet | no: every operation has a name a stranger can be told (set a key, pick a model, estimate, call) |
| CLI / MCP / HTTP | not applicable | byok is a browser component; a server-side twin would hold keys in a vault behind the same `SecretBackend` |

## v1 is done when

`npm run ci-local` passes, including the smoke test in `test/call.test.ts` ("v1 smoke"): a fresh own store, a key set, a model call that returns text through a fake transport.
