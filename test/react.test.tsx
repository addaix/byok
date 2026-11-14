// @vitest-environment jsdom
/**
 * The key field, rendered: the typed key is never in an attribute of the page (a `value` attribute
 * would put it in the DOM, a saved page, a bug report's HTML), nor in the page's state, and the
 * field asks browsers and password managers not to offer to save it. Forget has an Undo.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ByokPanel } from '../src/react';
import { memoryStore } from './helpers';

const KEY = 'sk-ant-invented-SECRETSECRET-0000';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every attribute value of every element under `root`, joined. */
const allAttributes = (root: Element) =>
  [root, ...root.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => `${a.name}=${a.value}`)).join('\n');
const button = (container: Element, text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('ByokPanel and its key field', () => {
  it('never carries the typed key in an attribute or the DOM, and is not offered to password managers', async () => {
    const { store, secretsProvider } = memoryStore();
    await act(async () => root.render(<ByokPanel store={store} />));
    await settle();
    const input = container.querySelector<HTMLInputElement>('#byok-key')!;
    expect(input).not.toBeNull();
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.hasAttribute('data-1p-ignore')).toBe(true);
    expect(input.getAttribute('data-lpignore')).toBe('true');
    expect(input.getAttribute('spellcheck')).toBe('false');

    await act(async () => {
      input.value = KEY; // what typing does to the field
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(allAttributes(container)).not.toContain('SECRET');
    expect(container.innerHTML).not.toContain('SECRET');

    await act(async () => button(container, 'Save key')!.click());
    await settle();
    expect(container.textContent).toContain('•••• (set)');
    expect(container.innerHTML).not.toContain('SECRET');
    expect(JSON.stringify(await secretsProvider.getList({}))).toContain('SECRET'); // stored, where it belongs
  });

  it('lists the other stored keys, each with its own Forget, and offers Undo after Forget', async () => {
    const { store } = memoryStore();
    await store.setKey('anthropic', KEY);
    await store.setKey('openai', 'sk-proj-SECRET-2');
    await act(async () => root.render(<ByokPanel store={store} />));
    await settle();
    expect(container.textContent).toContain('Other keys kept here');
    expect(container.textContent).toContain('OpenAI key');

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Forget this Anthropic key"]')!.click());
    await settle();
    expect((await store.load()).keys.anthropic?.isSet).toBe(false);
    expect(container.textContent).toContain('Forgot the Anthropic key.');
    expect(container.innerHTML).not.toContain('SECRET');

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Undo forgetting the Anthropic key"]')!.click());
    await settle();
    expect(await store.revealKey('anthropic')).toBe(KEY);
    expect(container.textContent).toContain('Restored the Anthropic key.');
  });

  it('switching the service resets the model to that service\'s default, and shows its price line', async () => {
    const { store } = memoryStore();
    await store.save({ 'text.model': 'claude-haiku-5-5' });
    await act(async () => root.render(<ByokPanel store={store} />));
    await settle();
    expect(container.textContent).toContain('$0.1 per million tokens sent');
    const select = container.querySelector<HTMLSelectElement>('#byok-service')!;
    await act(async () => {
      select.value = 'openai';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(await store.values()).toEqual({ 'text.service': 'openai', 'text.model': '' });
    expect(container.textContent).toContain('cost not estimated');
    expect(container.textContent).toContain('Get an OpenAI key');
  });

  it('never saves a key typed for one service as another service\'s key', async () => {
    const { store } = memoryStore();
    await act(async () => root.render(<ByokPanel store={store} />));
    await settle();
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('#byok-key')!;
      input.value = KEY;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const select = container.querySelector<HTMLSelectElement>('#byok-service')!;
    await act(async () => {
      select.value = 'openai';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(container.querySelector<HTMLInputElement>('#byok-key')!.value).toBe('');
    await act(async () => button(container, 'Save key')!.click());
    await settle();
    expect(await store.revealKey('openai')).toBe('');
    expect(container.textContent).toContain('Paste your key first.');
  });

  it('says so and keeps the typed key when saving fails; repeated Enter saves once', async () => {
    const { store } = memoryStore();
    let calls = 0;
    const failing = { ...store, setKey: async () => { calls += 1; throw new Error('quota'); } };
    await act(async () => root.render(<ByokPanel store={failing} />));
    await settle();
    const input = container.querySelector<HTMLInputElement>('#byok-key')!;
    await act(async () => {
      input.value = KEY;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 3; i++) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle();
    expect(calls).toBe(1);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Could not save the key');
    expect(input.value).toBe(KEY); // still there, to try again
    expect(container.innerHTML).not.toContain('SECRET');
  });

  it('withdraws Undo once a newer key is saved, so an older key never overwrites it', async () => {
    const { store } = memoryStore();
    await store.setKey('anthropic', 'sk-ant-OLD-SECRET');
    await act(async () => root.render(<ByokPanel store={store} />));
    await settle();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Forget this Anthropic key"]')!.click());
    await settle();
    expect(button(container, 'Undo')).toBeDefined();
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('#byok-key')!;
      input.value = KEY;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button(container, 'Save key')!.click());
    await settle();
    expect(button(container, 'Undo')).toBeUndefined();
    expect(await store.revealKey('anthropic')).toBe(KEY);
  });

  it('tells the person where the key is kept only when the store knows', async () => {
    const { store, secrets } = memoryStore();
    await act(async () => root.render(<ByokPanel store={store} />));
    await settle();
    expect(container.textContent).toContain('Kept in this browser, on this device.');
    const { createByokStore } = await import('../src');
    const vault = createByokStore({ secrets }); // a backend passed without `where`
    await act(async () => root.render(<ByokPanel store={vault} />));
    await settle();
    expect(container.textContent).not.toContain('Kept in this browser');
    expect(container.textContent).toContain('Sent only to Anthropic, when you use it.');
  });
});
