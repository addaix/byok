# byok: dev notes

Seams (docs/seams.md): `settings` (default: own store in this browser), `secrets` (default: localStorage backend; becomes zodal-dials `providerSecretBackend` once on npm), `catalog` (default `CATALOG`), `Button` slot (default `DefaultButton`). Surfaces built: TS library, React parts.

- Three entries, enforced by `test/seam.test.ts`: `byok` (no AI SDK, no React), `byok/call` (the only AI SDK importer, with `src/services/*`), `byok/react`.
- `zod` is a peer dependency on purpose: a host mounts byok's schema, and Zod 4's `.meta()` registry must be the host's.
- A key never goes into an error message, the plain settings record, a DOM attribute or React state; every test file that handles a key checks for its `SECRET` marker. Keep that true for every change.
- Gate: `npm run ci-local` (typecheck, vitest, tsup build). Publish: commit subject with `[publish-npm]` on main (OIDC, wads npm-ci).
