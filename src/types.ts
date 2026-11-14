/**
 * What byok deals in: AI services and their models, the settings one call needs, the one kind of
 * error a call ends in, and the masked secret types it shares with zodal-dials.
 *
 * No AI SDK and no React here: a settings page, an estimate and a host's settings schema load this
 * without either.
 */

/** The services byok knows how to call. A catalog may offer any subset of them. */
export const SERVICE_IDS = ['anthropic', 'openai', 'google'] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

/** A price in US dollars per million tokens, and where it was read. */
export interface Price {
  input_per_mtok: number;
  output_per_mtok: number;
  /** Where the figure comes from, and when it was read (a price changes; say "about"). */
  source: string;
}

export interface ModelChoice {
  /** The id sent to the service, exactly (never an alias such as `*-latest`). */
  id: string;
  label: string;
  /** When to pick it, in a few words. */
  note: string;
  /** null when no stated source gives it: a page then says "cost not estimated", never $0. */
  price: Price | null;
}

export interface ServiceInfo {
  id: ServiceId;
  /** The service's name, as a page says it ("sent to Anthropic"). */
  name: string;
  /** Where a person gets a key. */
  keyUrl: string;
  /** What a key looks like, as a placeholder (never a real key). */
  keyPlaceholder: string;
  /** A short curated list, most capable first. The first is the default. */
  models: readonly ModelChoice[];
}

/** The services an app offers, in the order a page lists them. */
export type Catalog = Readonly<Partial<Record<ServiceId, ServiceInfo>>>;

/**
 * The model as an app calls it: a prompt in, the reply's text out. `signal` cancels a call in
 * flight (the request is aborted).
 */
export type ModelCall = (prompt: string, options?: { signal?: AbortSignal }) => Promise<string>;

/** The plain (non-secret) settings of the `text` capability. */
export interface TextChoice {
  service: ServiceId;
  /** A model id; '' means the service's default (its first model). */
  model: string;
}

/**
 * Why a call failed, as something a person can act on. Each code has one fixed sentence; none
 * ever contains the key or the service's own message (which can quote part of the key).
 */
export type ModelCallErrorCode =
  | 'no_key'
  | 'bad_key'
  | 'no_credit'
  | 'rate_limit'
  | 'model'
  | 'busy'
  | 'network'
  | 'cut_off'
  | 'declined'
  | 'failed';

export class ModelCallError extends Error {
  // `override`: Error already has a `name`; this one lets a page tell it apart.
  override name = 'ModelCallError';
  constructor(
    readonly code: ModelCallErrorCode,
    message: string,
    /** The HTTP status the service answered, when there was one. */
    readonly status?: number,
  ) {
    super(message);
  }
}

/** The codes after which no later call with the same settings can succeed: a run stops at the first. */
export const FATAL_CODES: ReadonlySet<ModelCallErrorCode> = new Set(['no_key', 'bad_key', 'no_credit', 'model']);

/** True for the error a cancelled call ends in (passed through, never turned into a message). */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

// --- Shared with zodal-dials, structurally -------------------------------------------------------
// These match `SecretRef`, `SecretBackend` and `makeSecretRef` in `@zodal/dials-core` field for field,
// so a zodal-dials backend (`providerSecretBackend`, `createSensitiveSettingsProvider`'s secrets) is
// accepted as is. They are declared here because the dials version that has them is not on npm yet
// (i2mint/zodal#23); once it is, these become re-exports.

/** A masked reference to a secret: whether it is set, and a display mask. Never the value. */
export interface SecretRef {
  readonly _tag: 'SecretRef';
  key: string;
  isSet: boolean;
  /** "•••• (set)" or "not set". */
  masked: string;
}

/** Where secrets are kept. Reads return a masked ref; the plaintext comes only from `reveal`. */
export interface SecretBackend {
  has(key: string): Promise<boolean>;
  get(key: string): Promise<SecretRef>;
  reveal(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<SecretRef>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export function makeSecretRef(key: string, isSet: boolean): SecretRef {
  return { _tag: 'SecretRef', key, isSet, masked: isSet ? '•••• (set)' : 'not set' };
}

export function isSecretRef(v: unknown): v is SecretRef {
  return typeof v === 'object' && v !== null && (v as { _tag?: unknown })._tag === 'SecretRef';
}
