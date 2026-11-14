/**
 * byok's settings: the schema a host mounts, its own store, and the host-section view. A key goes
 * to the secret backend only, never into the plain record, and reads of it are masked.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { byokDefaults, byokSchema, CATALOG, createByokStore, fromSection, keyField, modelChoice, OPENAI, serviceInfo } from '../src';
import { memoryStore } from './helpers';

const KEY = 'sk-ant-api03-SECRETSECRETSECRET-1234';

describe('byokSchema', () => {
  it('has, per capability, a service and a model, and one secret key per service of the catalog', () => {
    const schema = byokSchema();
    expect(Object.keys(schema.shape)).toEqual(['text.service', 'text.model', 'keys.anthropic', 'keys.openai', 'keys.google']);
    for (const id of ['anthropic', 'openai', 'google'] as const) {
      const meta = (schema.shape as Record<string, z.ZodType>)[keyField(id)]!.meta() as Record<string, unknown>;
      expect(meta.secret).toBe(true);
      expect(meta.service).toBe(id);
    }
    expect(byokDefaults()).toEqual({ 'text.service': 'anthropic', 'text.model': '' });
  });

  it('follows the catalog: its services, its first service as the default', () => {
    const schema = byokSchema({ catalog: { openai: OPENAI } });
    expect(Object.keys(schema.shape)).toEqual(['text.service', 'text.model', 'keys.openai']);
    expect(byokDefaults({ catalog: { openai: OPENAI } })['text.service']).toBe('openai');
    expect(() => byokSchema({ catalog: {} })).toThrow(/offers no service/);
  });

  it('mounts in a host schema under a prefix, keeping each field and its meta (the zodal-dials mountSection shape)', () => {
    const mounted = Object.fromEntries(Object.entries(byokSchema().shape).map(([k, v]) => [`ai.${k}`, v]));
    const host = z.object({ theme: z.enum(['light', 'dark']).default('light'), ...mounted });
    const parsed = host.parse({}) as Record<string, unknown>;
    expect(parsed['ai.text.service']).toBe('anthropic');
    expect(((host.shape as Record<string, z.ZodType>)['ai.keys.openai']!.meta() as Record<string, unknown>).secret).toBe(true);
  });
});

describe('modelChoice', () => {
  it("is the named model, or the service's default when the id is empty or another service's", () => {
    expect(modelChoice('anthropic', 'claude-sonnet-5-5').id).toBe('claude-sonnet-5-5');
    expect(modelChoice('anthropic', '').id).toBe('claude-opus-5-5');
    expect(modelChoice('openai', 'claude-opus-5-5').id).toBe('gpt-5.5');
    expect(() => serviceInfo('google', { openai: OPENAI })).toThrow(/does not offer the service "google"/);
    expect(Object.keys(CATALOG)).toEqual(['anthropic', 'openai', 'google']);
  });
});

describe('createByokStore', () => {
  it('works with nothing passed (its own store in this environment), starting from the defaults', async () => {
    const store = createByokStore({ config: memoryStore().config, secrets: memoryStore().secrets });
    const view = await store.load();
    expect(view.values).toEqual({ 'text.service': 'anthropic', 'text.model': '' });
    expect(view.keys.anthropic).toMatchObject({ isSet: false, masked: 'not set' });
  });

  it('keeps a key in the secret backend only, and shows it masked', async () => {
    const { store, config, secretsProvider } = memoryStore();
    await store.save({ 'text.model': 'claude-sonnet-5-5' });
    const ref = await store.setKey('anthropic', KEY);
    expect(ref).toMatchObject({ isSet: true, masked: '•••• (set)' });
    expect(JSON.stringify(await config.getList({}))).not.toContain('SECRET');
    expect(JSON.stringify(await store.load())).not.toContain('SECRET');
    expect(JSON.stringify(await secretsProvider.getList({}))).toContain('SECRET'); // where it is, on purpose
    expect(await store.revealKey('anthropic')).toBe(KEY);
    expect(await store.revealKey('openai')).toBe('');
  });

  it('refuses a key, or a value the schema refuses, through save', async () => {
    const { store } = memoryStore();
    await expect(store.save({ 'keys.anthropic': KEY } as never)).rejects.toThrow(/saved with setKey/);
    await expect(store.save({ 'text.service': 'mistral' } as never)).rejects.toThrow();
    await expect(store.save({ colour: 'red' } as never)).rejects.toThrow(/not a setting: colour/);
  });

  it('forgets a key, and an empty key is a forget', async () => {
    const { store, secrets } = memoryStore();
    await store.setKey('anthropic', KEY);
    await store.setKey('openai', 'sk-other-SECRET');
    await store.forgetKey('anthropic');
    expect((await store.load()).keys.anthropic?.isSet).toBe(false);
    expect(await secrets.list()).toEqual(['keys.openai']);
    expect(await store.setKey('openai', '   ')).toMatchObject({ isSet: false });
    expect(await secrets.list()).toEqual([]);
    await store.forgetKey('google'); // nothing stored: no error
  });

  it('falls back to the default for a stored value that no longer fits the schema', async () => {
    const { store, config } = memoryStore();
    await config.create({ id: 'byok', values: { 'text.service': 'retired-service' as never, 'text.model': 'claude-haiku-5-5' } });
    expect(await store.values()).toEqual({ 'text.service': 'anthropic', 'text.model': 'claude-haiku-5-5' });
  });

  it('never lets a storage error carry the stored text', async () => {
    const failing = memoryStore().secretsProvider;
    failing.getOne = async () => {
      throw new Error(`corrupt: ${KEY}`);
    };
    failing.upsert = async () => {
      throw new Error(`disk full while writing ${KEY}`);
    };
    const { dataProviderSecretBackend } = await import('../src');
    const backend = dataProviderSecretBackend(failing);
    const error = await backend.set('keys.anthropic', KEY).catch((e: Error) => e);
    expect(String(error)).toMatch(/write `keys.anthropic` failed/);
    expect(String(error)).not.toContain('SECRET');
  });
});

describe('fromSection (a host mounted byok under a prefix)', () => {
  it("reads the plain values from the host's section and the key from the host's backend under the prefix", async () => {
    const { secrets } = memoryStore();
    await secrets.set('ai.keys.openai', 'sk-proj-SECRET');
    const settings = fromSection({ read: () => ({ 'text.service': 'openai', 'text.model': 'gpt-5.4-mini' }), secrets, prefix: 'ai' });
    expect(await settings.values()).toEqual({ 'text.service': 'openai', 'text.model': 'gpt-5.4-mini' });
    expect(await settings.revealKey('openai')).toBe('sk-proj-SECRET');
    expect(await settings.revealKey('anthropic')).toBe('');
    expect(() => fromSection({ read: () => ({}), secrets, prefix: '' })).toThrow(/prefix/);
  });
});
