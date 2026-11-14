/**
 * The settings byok owns: ONE Zod schema saying, per capability, which service does it and with
 * which model, plus one secret key per service. This is the single source of truth; a host app
 * mounts it into its own settings (zodal-dials `mountSection('ai', byokSchema())`) and never
 * copies it.
 *
 * Keys are flat and dotted, as zodal-dials wants (the dot is the grouping; the schema never nests),
 * and relative to byok: a host picks the prefix.
 *
 * - `text.service`, `text.model`: the `text` capability (a language model). A second capability
 *   (speech, voice, search) is an ADD: its own `<capability>.service` / `.model` keys.
 * - `keys.<service>`: the key for each service, shared by every capability that service serves.
 *   Marked `secret: true`, so zodal-dials routes it to a secret backend and only ever shows a
 *   masked `SecretRef`.
 *
 * Labels, help and order come from each field's `.meta()` (read by `@zodal/dials-ui`'s
 * `toSettingsForm`).
 */
import { z } from 'zod';
import { CATALOG, servicesOf } from './catalog';
import type { Catalog, ServiceId } from './types';

/** The setting key of a service's API key, relative to byok's section. */
export type KeyField = `keys.${ServiceId}`;
export const keyField = (service: ServiceId): KeyField => `keys.${service}`;

/** byok's settings, plain values and keys (a key is a string here; on a page it is a masked ref). */
export type ByokValues = { 'text.service': ServiceId; 'text.model': string } & Partial<Record<KeyField, string>>;

/** The plain (non-secret) part: what a page shows and edits as values. */
export type ByokPlainValues = Pick<ByokValues, 'text.service' | 'text.model'>;

/** The names of the plain settings, in order. */
export const PLAIN_FIELDS = ['text.service', 'text.model'] as const;

/** Longest key accepted (real keys are about 100-200 characters). */
const MAX_KEY_LENGTH = 1000;

/**
 * byok's settings schema for a catalog (default: every service byok can call). The first service
 * of the catalog is the default one.
 */
export function byokSchema({ catalog = CATALOG }: { catalog?: Catalog } = {}) {
  const services = servicesOf(catalog);
  if (!services.length) throw new Error('byok: the catalog offers no service');
  const enumLabels = Object.fromEntries(services.map((id) => [id, catalog[id]!.name]));
  const keyFields = Object.fromEntries(
    services.map((id, i) => [
      keyField(id),
      z
        .string()
        .max(MAX_KEY_LENGTH)
        .default('')
        .meta({ secret: true, title: `Your ${catalog[id]!.name} key`, order: 20 + i, facets: ['keys'], service: id }),
    ]),
  );
  return z.object({
    'text.service': z
      .enum(services as [ServiceId, ...ServiceId[]])
      .default(services[0]!)
      .meta({ title: 'AI service', enumLabels, order: 10, facets: ['text'] }),
    'text.model': z
      .string()
      .max(200)
      .default('')
      .meta({ title: 'Model', description: "Empty means the service's default model.", order: 11, facets: ['text'] }),
    ...keyFields,
  });
}

export type ByokSchema = ReturnType<typeof byokSchema>;

/** The plain values with every field at its default. */
export const byokDefaults = ({ catalog = CATALOG }: { catalog?: Catalog } = {}): ByokPlainValues => {
  const parsed = byokSchema({ catalog }).parse({}) as Record<string, unknown>;
  return { 'text.service': parsed['text.service'] as ServiceId, 'text.model': parsed['text.model'] as string };
};
