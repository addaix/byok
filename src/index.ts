/**
 * byok: bring your own AI keys, for browser apps.
 *
 * The settings for "which AI service, which model, whose key" as one Zod schema a host can mount,
 * byok's own store for them in this browser, the cost estimate, and the error sentences. This entry
 * has no AI SDK and no React: the call is `byok/call`, the key field `byok/react`.
 */
export * from './types';
export * from './catalog';
export { SENTENCES, plainError, codeFor } from './errors';
export * from './schema';
export {
  adoptKeys,
  createByokStore,
  DEFAULT_NAMESPACE,
  deviceSecretBackend,
  fromSection,
  IN_THIS_BROWSER,
  type ByokSettings,
  type ByokStore,
  type ByokView,
  type SecretRecord,
  type ValuesRecord,
} from './store';
export * from './estimate';
