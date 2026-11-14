/**
 * Where byok reads its settings: one seam, `ByokSettings`, with three wirings (none changes byok's
 * code).
 *
 * - **Own** (the default): `createByokStore()`, byok's own store in this browser. Plain values in
 *   one record, keys in a secret backend, both behind zodal `DataProvider`s.
 * - **Host section**: the host mounts `byokSchema()` in its own zodal-dials settings under a prefix
 *   (`mountSection('ai', byokSchema())`) and hands byok a view of that subtree with
 *   `fromSection({ read: () => sectionOf(store, 'ai', schema), secrets, prefix: 'ai' })`.
 * - **Both**: the host's dials cascade layers byok's own store under its section; byok reads the
 *   resolved section the same way.
 *
 * What it protects, stated plainly. Keys never enter the plain settings record, a form value, a
 * log, the address or an error message, and reads give a masked `SecretRef`; the plaintext comes
 * only from `revealKey`, which a page uses only to build a call. What it does not protect against:
 * anyone with the unlocked device and browser profile, or any script running on the page, can read
 * a key stored in this browser. Encrypting it in the same storage would not change that.
 */
import type { DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { CATALOG, servicesOf } from './catalog';
import { byokDefaults, byokSchema, keyField, PLAIN_FIELDS, type ByokPlainValues } from './schema';
import { makeSecretRef, type Catalog, type SecretBackend, type SecretRef, type ServiceId } from './types';

/** What byok reads: the plain choices, and (for a call only) a service's key. */
export interface ByokSettings {
  values(): Promise<ByokPlainValues>;
  /** The key itself, for building a call only; '' when none is set. */
  revealKey(service: ServiceId): Promise<string>;
}

/** What a settings page shows: the plain values, and for each service whether a key is set. */
export interface ByokView {
  values: ByokPlainValues;
  /** Masked: the key itself is never here. */
  keys: Partial<Record<ServiceId, SecretRef>>;
}

/** byok's own store: the reads, and the writes its settings page makes. */
export interface ByokStore extends ByokSettings {
  load(): Promise<ByokView>;
  /** Change plain values (never a key: those go through `setKey`). Refuses a value the schema refuses. */
  save(patch: Partial<ByokPlainValues>): Promise<void>;
  /** Store a key (trimmed); an empty one forgets it. */
  setKey(service: ServiceId, key: string): Promise<SecretRef>;
  forgetKey(service: ServiceId): Promise<void>;
}

/** One stored record of plain values. */
export interface ValuesRecord {
  id: string;
  values: Partial<ByokPlainValues>;
}

/** One stored secret. */
export interface SecretRecord {
  id: string;
  value: string;
}

/** Where byok keeps its own settings in this browser (separate from the keys, so neither can carry the other). */
export const SETTINGS_STORAGE_KEY = 'byok:settings';
export const SECRETS_STORAGE_KEY = 'byok:secrets';
const VALUES_ID = 'byok';

async function getOrUndefined<T>(provider: DataProvider<T>, id: string): Promise<T | undefined> {
  try {
    return await provider.getOne(id);
  } catch {
    return undefined; // none stored
  }
}

async function put<T extends { id: string }>(provider: DataProvider<T>, record: T): Promise<void> {
  if (provider.upsert) await provider.upsert(record);
  else if (await getOrUndefined(provider, record.id)) await provider.update(record.id, record);
  else await provider.create(record);
}

/**
 * A `SecretBackend` over any zodal `DataProvider`: by default this browser's storage.
 *
 * Replace with zodal-dials `providerSecretBackend` once `@zodal/dials-core` 0.2 is on npm
 * (i2mint/zodal#23); this is the same contract, kept to what byok needs. A storage error is
 * replaced by one naming only the key, since the raw error may carry the stored text.
 */
export function dataProviderSecretBackend(provider: DataProvider<SecretRecord>, { namespace = 'secret:' } = {}): SecretBackend {
  const idOf = (key: string) => `${namespace}${key}`;
  const guarded = async <R>(what: string, key: string | undefined, call: () => Promise<R>): Promise<R> => {
    try {
      return await call();
    } catch {
      throw new Error(`byok secret backend: ${what}${key === undefined ? '' : ` \`${key}\``} failed`);
    }
  };
  const read = async (key: string) => (await getOrUndefined(provider, idOf(key)))?.value || undefined;
  return {
    has: async (key) => (await read(key)) !== undefined,
    get: async (key) => makeSecretRef(key, (await read(key)) !== undefined),
    reveal: read,
    async set(key, value) {
      if (typeof value !== 'string') throw new Error(`byok: secret \`${key}\` must be a string`);
      await guarded('write', key, () => put(provider, { id: idOf(key), value }));
      return makeSecretRef(key, value !== '');
    },
    async delete(key) {
      if (await getOrUndefined(provider, idOf(key))) await guarded('delete', key, () => provider.delete(idOf(key)));
    },
    list: () =>
      guarded('list', undefined, async () =>
        (await provider.getList({})).data.map((r) => r.id).filter((id) => id.startsWith(namespace)).map((id) => id.slice(namespace.length)),
      ),
  };
}

/** This browser's keys, on this device. */
export const deviceSecretBackend = (): SecretBackend =>
  dataProviderSecretBackend(createLocalStorageProvider<SecretRecord>({ storageKey: SECRETS_STORAGE_KEY }));

/** The plain values in `raw` that the schema accepts; the rest fall back to their defaults. */
function plainValuesOf(raw: Record<string, unknown>, catalog: Catalog): ByokPlainValues {
  const shape = byokSchema({ catalog }).shape as Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }>;
  const values = { ...byokDefaults({ catalog }) } as Record<string, unknown>;
  for (const name of PLAIN_FIELDS) {
    const parsed = shape[name]!.safeParse(raw[name]);
    if (raw[name] !== undefined && parsed.success) values[name] = parsed.data;
  }
  return values as ByokPlainValues;
}

/**
 * byok's own store. `config` holds the plain values and `secrets` the keys; both default to this
 * browser's storage. Pass zodal `DataProvider`s / a `SecretBackend` to keep them elsewhere (a
 * server vault, so keys follow the person between devices).
 */
export function createByokStore({
  catalog = CATALOG,
  config = createLocalStorageProvider<ValuesRecord>({ storageKey: SETTINGS_STORAGE_KEY }),
  secrets = deviceSecretBackend(),
}: { catalog?: Catalog; config?: DataProvider<ValuesRecord>; secrets?: SecretBackend } = {}): ByokStore {
  const schemaShape = byokSchema({ catalog }).shape as Record<string, { parse(v: unknown): unknown }>;
  const stored = async () => (await getOrUndefined(config, VALUES_ID))?.values ?? {};
  const values = async () => plainValuesOf(await stored(), catalog);
  return {
    values,
    async revealKey(service) {
      const key = await secrets.reveal(keyField(service));
      return typeof key === 'string' ? key : '';
    },
    async load() {
      const keys: ByokView['keys'] = {};
      for (const service of servicesOf(catalog)) keys[service] = await secrets.get(keyField(service));
      return { values: await values(), keys };
    },
    async save(patch) {
      for (const [name, value] of Object.entries(patch)) {
        if (!(PLAIN_FIELDS as readonly string[]).includes(name)) {
          throw new Error(name.startsWith('keys.') ? 'byok: a key is saved with setKey, never with the other settings' : `byok: not a setting: ${name}`);
        }
        schemaShape[name]!.parse(value); // refuse a value the schema refuses
      }
      await put(config, { id: VALUES_ID, values: { ...(await stored()), ...patch } });
    },
    async setKey(service, key) {
      const trimmed = key.trim();
      if (!trimmed) {
        await secrets.delete(keyField(service));
        return makeSecretRef(keyField(service), false);
      }
      return secrets.set(keyField(service), trimmed);
    },
    forgetKey: (service) => secrets.delete(keyField(service)),
  };
}

/**
 * byok's settings read from a host's settings section (the host-section wiring).
 *
 * `read` returns the section under byok's own keys (zodal-dials `sectionOf(store, prefix,
 * byokSchema())`); `secrets` is the host's secret backend, where a mounted key lives under
 * `<prefix>.keys.<service>`.
 */
export function fromSection({
  read,
  secrets,
  prefix,
  catalog = CATALOG,
}: {
  read: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  secrets: Pick<SecretBackend, 'reveal'>;
  prefix: string;
  catalog?: Catalog;
}): ByokSettings {
  if (!prefix) throw new Error('byok fromSection: the prefix must be a non-empty string');
  return {
    values: async () => plainValuesOf(await read(), catalog),
    async revealKey(service) {
      const key = await secrets.reveal(`${prefix}.${keyField(service)}`);
      return typeof key === 'string' ? key : '';
    },
  };
}
