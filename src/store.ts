/**
 * Where byok reads its settings: one seam, `ByokSettings`, and two wirings (neither changes
 * byok's code).
 *
 * - **Own** (the default): `createByokStore()`, byok's own store in this browser. Plain values in
 *   one record, keys in a secret backend, both behind zodal `DataProvider`s.
 * - **Host section**: the host mounts `byokSchema()` in its own zodal-dials settings under a prefix
 *   (`mountSection('ai', byokSchema())`) and hands byok its effective values:
 *   `fromSection({ effective: () => store.getState().effective, secrets, prefix: 'ai' })`.
 *
 * Moving keys between wirings (or from an app's older storage) is `adoptKeys`.
 *
 * What it protects. Keys never enter the plain settings record, a form value, a log, the address
 * or an error message, and reads give a masked `SecretRef`; the plaintext comes only from
 * `revealKey`, which a page uses only to build a call. What it does not protect against: anyone
 * with the unlocked device and browser profile, any script running on the page, and any other page
 * of the same site (origin) can read a key stored in this browser. Encrypting it in the same
 * storage would not change that.
 */
import type { DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { CATALOG, servicesOf } from './catalog';
import { byokDefaults, byokSchema, keyField, PLAIN_FIELDS, type ByokPlainValues } from './schema';
import { makeSecretRef, type Catalog, type SecretBackend, type SecretRef, type ServiceId } from './types';

/** What byok reads: the plain choices, (for a call only) a service's key, and the services offered. */
export interface ByokSettings {
  /** The services and models these settings choose among. */
  readonly catalog: Catalog;
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
  /**
   * Where the keys are kept, as a page should tell the person, or undefined when the store does
   * not know (a secret backend was passed without saying).
   */
  readonly where: string | undefined;
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

/**
 * The default namespace of byok's own storage. Every app of one site (origin) that keeps the
 * default shares one choice of service and one set of keys, so a person sets a key once; pass an
 * app's own `namespace` to keep them apart.
 */
export const DEFAULT_NAMESPACE = 'byok';
const VALUES_ID = 'byok';

/** What the own store says about where keys are kept, when it keeps them in this browser. */
export const IN_THIS_BROWSER = 'Kept in this browser, on this device. Anyone using this browser profile can read it.';

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
 * A `SecretBackend` over any zodal `DataProvider`. Not exported from `byok`: it is the same
 * contract as zodal-dials `providerSecretBackend` (same record ids, `secret:` + key, and `value`
 * field, so keys stored now are found after the switch), which replaces it once `@zodal/dials-core`
 * 0.2 is on npm (i2mint/zodal#23). A storage error is replaced by one naming only the key, since
 * the raw error may carry the stored text.
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

/** This browser's keys, on this device, under `<namespace>:secrets`. */
export const deviceSecretBackend = ({ namespace = DEFAULT_NAMESPACE }: { namespace?: string } = {}): SecretBackend =>
  dataProviderSecretBackend(createLocalStorageProvider<SecretRecord>({ storageKey: `${namespace}:secrets` }));

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
 * byok's own store. By default both parts are in this browser: plain values under
 * `<namespace>:settings`, keys under `<namespace>:secrets`. Pass `config` (a zodal `DataProvider`)
 * and `secrets` (a `SecretBackend`) to keep them elsewhere, a server vault for instance, and then
 * `where` to say so to the person.
 */
export function createByokStore({
  catalog = CATALOG,
  namespace = DEFAULT_NAMESPACE,
  config,
  secrets,
  where,
}: { catalog?: Catalog; namespace?: string; config?: DataProvider<ValuesRecord>; secrets?: SecretBackend; where?: string } = {}): ByokStore {
  const plain = config ?? createLocalStorageProvider<ValuesRecord>({ storageKey: `${namespace}:settings` });
  const keys = secrets ?? deviceSecretBackend({ namespace });
  const schemaShape = byokSchema({ catalog }).shape as Record<string, { parse(v: unknown): unknown }>;
  const stored = async () => (await getOrUndefined(plain, VALUES_ID))?.values ?? {};
  const values = async () => plainValuesOf(await stored(), catalog);
  return {
    catalog,
    where: where ?? (secrets ? undefined : IN_THIS_BROWSER),
    values,
    async revealKey(service) {
      const key = await keys.reveal(keyField(service));
      return typeof key === 'string' ? key : '';
    },
    async load() {
      const refs: ByokView['keys'] = {};
      for (const service of servicesOf(catalog)) refs[service] = await keys.get(keyField(service));
      return { values: await values(), keys: refs };
    },
    async save(patch) {
      for (const [name, value] of Object.entries(patch)) {
        if (!(PLAIN_FIELDS as readonly string[]).includes(name)) {
          throw new Error(name.startsWith('keys.') ? 'byok: a key is saved with setKey, never with the other settings' : `byok: not a setting: ${name}`);
        }
        schemaShape[name]!.parse(value); // refuse a value the schema refuses
      }
      await put(plain, { id: VALUES_ID, values: { ...(await stored()), ...patch } });
    },
    async setKey(service, key) {
      const trimmed = key.trim();
      if (!trimmed) {
        await keys.delete(keyField(service));
        return makeSecretRef(keyField(service), false);
      }
      return keys.set(keyField(service), trimmed);
    },
    forgetKey: (service) => keys.delete(keyField(service)),
  };
}

/** `'ai'`, `'ai.'` and `' ai '` are the same prefix. */
const normalPrefix = (prefix: string) => prefix.trim().replace(/\.+$/, '');

/**
 * byok's settings read from a host's settings, where the host mounted byok's schema under
 * `prefix` (the host-section wiring).
 *
 * `effective` returns the host's effective values, keyed as the host keys them (`ai.text.service`);
 * a zodal-dials store's `getState().effective` or a resolution's `effective` is exactly that.
 * `secrets` is the host's secret backend, where a mounted key lives under `<prefix>.keys.<service>`.
 */
export function fromSection({
  effective,
  secrets,
  prefix,
  catalog = CATALOG,
}: {
  effective: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  secrets: Pick<SecretBackend, 'reveal'>;
  prefix: string;
  catalog?: Catalog;
}): ByokSettings {
  const p = normalPrefix(prefix);
  if (!p) throw new Error('byok fromSection: the prefix must be a non-empty string');
  return {
    catalog,
    async values() {
      const host = await effective();
      const own = Object.fromEntries(PLAIN_FIELDS.map((name) => [name, host[`${p}.${name}`]]));
      return plainValuesOf(own, catalog);
    },
    async revealKey(service) {
      const key = await secrets.reveal(`${p}.${keyField(service)}`);
      return typeof key === 'string' ? key : '';
    },
  };
}

/**
 * Copy keys into a store that does not have them yet, from another place (an app's older storage,
 * or byok's own store when moving to a host section). Returns the services whose key was adopted.
 * A key already in `into` is never overwritten. Removing the old copies is the caller's step,
 * once it has checked the new ones.
 */
export async function adoptKeys({
  from,
  into,
  services,
}: {
  /** The old key of a service, or undefined/'' when there is none. */
  from: (service: ServiceId) => Promise<string | undefined>;
  into: Pick<ByokStore, 'revealKey' | 'setKey'>;
  services: readonly ServiceId[];
}): Promise<ServiceId[]> {
  const adopted: ServiceId[] = [];
  for (const service of services) {
    if (await into.revealKey(service)) continue;
    const old = (await from(service))?.trim();
    if (!old) continue;
    await into.setKey(service, old);
    adopted.push(service);
  }
  return adopted;
}
